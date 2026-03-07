import pg from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import { sql } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 120000,   // 2 min — recycle idle connections before Neon kills them
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  console.error('[DB] Idle client error (handled):', err.message);
});

// Keepalive: run a lightweight query every 90 s to prevent Neon serverless
// from suspending compute during idle periods, avoiding the cold-start delay
// that would otherwise cause "Connection terminated" errors in schedulers.
setInterval(() => {
  pool.query('SELECT 1').catch((err: Error) => {
    console.error('[DB] Keepalive query failed (will retry next cycle):', err.message);
  });
}, 90 * 1000);

export const db = drizzle(pool, { schema });

// ─── Multi-Tenant Migration ───────────────────────────────────────────────────
// All statements use IF NOT EXISTS / WHERE IS NULL guards — safe to re-run on
// every server start. Order matters: tables before columns before data stamps.
export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('[Migration] Running startup migrations…');

    // ── Phase-1: Organizations table ─────────────────────────────────────────
    // Create with minimal required columns — db:push fills the rest.
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR NOT NULL,
        slug        VARCHAR UNIQUE NOT NULL,
        plan        VARCHAR NOT NULL DEFAULT 'foundation',
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Belt-and-suspenders: add billing/limit columns that db:push would add.
    // Safe no-ops if they already exist.
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website VARCHAR(255)`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status VARCHAR NOT NULL DEFAULT 'trial'`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_interval VARCHAR NOT NULL DEFAULT 'monthly'`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brickspotter_scans_this_month INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brickspotter_scans_reset_date TIMESTAMP NOT NULL DEFAULT NOW()`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_limit_override INTEGER`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brickspotter_limit_override INTEGER`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS automation_limit_override INTEGER`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP`);
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bl_api_call_limit_override INTEGER`);

    // Seed the default PlanetBrick org. Use UPDATE on conflict so any legacy
    // plan value ('pro', 'free', 'foundation') gets corrected to 'flagship'.
    await client.query(`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES ('org_planetbrick', 'PlanetBrick', 'planetbrick', 'flagship')
      ON CONFLICT (id) DO UPDATE SET
        plan = CASE WHEN organizations.plan IN ('pro', 'free', 'foundation') THEN 'flagship' ELSE organizations.plan END
    `);

    console.log('[Migration] Phase-1 (organizations) complete.');

    // ── Phase-2: Users org columns ───────────────────────────────────────────
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id VARCHAR`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role VARCHAR DEFAULT 'owner'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS super_admin BOOLEAN NOT NULL DEFAULT false`);

    // Stamp any unassigned users into the default org as owners.
    await client.query(`UPDATE users SET org_id   = 'org_planetbrick' WHERE org_id   IS NULL`);
    await client.query(`UPDATE users SET org_role = 'owner'           WHERE org_role IS NULL`);

    // Ensure platform super-admins are flagged — idempotent.
    await client.query(`
      UPDATE users SET super_admin = true
      WHERE email IN ('bhnorby@gmail.com', 'caleblauritsen@gmail.com')
    `);

    console.log('[Migration] Phase-2 (users) complete.');

    // ── Phase-3: org_id on all operational tables ────────────────────────────
    // Additive only — nullable column, then stamp existing NULL rows.
    const tables = [
      'bl_inventory', 'orders', 'app_settings', 'conversations',
      'brickanalyzer_scans', 'sync_metadata', 'sync_issues', 'bl_api_calls',
      'shipments', 'wh_aisles', 'wh_shelves', 'wh_bins', 'inventory_locations',
      'embedding_jobs', 'eod_forms', 'bl_forum_posts', 'order_adjustments', 'app_feedback',
    ];
    for (const table of tables) {
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS org_id VARCHAR`);
      await client.query(`UPDATE ${table} SET org_id = 'org_planetbrick' WHERE org_id IS NULL`);
    }

    console.log('[Migration] Phase-3 (operational tables) complete.');

    // ── Phase-4: Per-org credentials (app_settings + org_integrations) ───────
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS paypal_client_id TEXT`);
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS paypal_client_secret TEXT`);
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS paypal_environment TEXT NOT NULL DEFAULT 'live'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS org_integrations (
        id             SERIAL PRIMARY KEY,
        org_id         VARCHAR NOT NULL,
        channel        VARCHAR NOT NULL,
        display_name   TEXT,
        credentials    JSONB NOT NULL DEFAULT '{}',
        is_connected   BOOLEAN NOT NULL DEFAULT false,
        last_tested_at TIMESTAMP,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, channel)
      )
    `);

    console.log('[Migration] Phase-4 (credentials) complete.');
    console.log('[Migration] All startup migrations finished successfully.');

  } catch (err: any) {
    console.error('[Migration] Error during startup migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
