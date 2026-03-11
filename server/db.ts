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

    // ── Phase-5: Merge legacy 'default' row credentials into per-org row ───────
    // When the org row was created (id=org_id), BrickLink credentials and other
    // settings may have only been stored in the old id='default' row.
    // Copy any missing credential fields from 'default' → org row, then delete
    // the 'default' row so all future reads hit the correct row by primary key.
    await client.query(`
      UPDATE app_settings AS target
      SET
        bricklink_consumer_key    = COALESCE(NULLIF(target.bricklink_consumer_key, ''),    source.bricklink_consumer_key),
        bricklink_consumer_secret = COALESCE(NULLIF(target.bricklink_consumer_secret, ''), source.bricklink_consumer_secret),
        bricklink_token_value     = COALESCE(NULLIF(target.bricklink_token_value, ''),     source.bricklink_token_value),
        bricklink_token_secret    = COALESCE(NULLIF(target.bricklink_token_secret, ''),    source.bricklink_token_secret),
        paypal_client_id          = COALESCE(NULLIF(target.paypal_client_id, ''),          source.paypal_client_id),
        paypal_client_secret      = COALESCE(NULLIF(target.paypal_client_secret, ''),      source.paypal_client_secret)
      FROM app_settings AS source
      WHERE source.id     = 'default'
        AND target.id     = source.org_id
        AND target.id    != 'default'
    `);
    await client.query(`DELETE FROM app_settings WHERE id = 'default'`);
    console.log('[Migration] Phase-5 (merge default credentials) complete.');

    // ── Phase-6: Backfill bl_catalog from price_guide_cache ──────────────────
    // bl_catalog is the SOT for item names and categories. It gets populated by
    // the full BL inventory sync AND incrementally by fetchPriceOMagicData.
    // This one-time backfill seeds it from any existing price_guide_cache rows
    // so names/categories appear immediately without needing a re-sync.
    await client.query(`
      INSERT INTO bl_catalog (item_no, item_type, color_id, item_name, category_id, image_url, thumbnail_url)
      SELECT DISTINCT ON (item_no, item_type, COALESCE(color_id, 0))
        item_no,
        item_type,
        COALESCE(color_id, 0),
        item_name,
        category_id,
        image_url,
        thumbnail_url
      FROM price_guide_cache
      WHERE item_name IS NOT NULL
      ORDER BY item_no, item_type, COALESCE(color_id, 0), fetched_at DESC
      ON CONFLICT (item_no, item_type, color_id) DO UPDATE
      SET
        item_name    = COALESCE(EXCLUDED.item_name, bl_catalog.item_name),
        category_id  = COALESCE(EXCLUDED.category_id, bl_catalog.category_id),
        image_url    = COALESCE(EXCLUDED.image_url, bl_catalog.image_url),
        thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url)
    `);
    console.log('[Migration] Phase-6 (bl_catalog backfill from price_guide_cache) complete.');

    // ── Phase-7: Backfill bl_catalog from universal_catalog_queue (Rebrickable names) ──
    // After importFromRebrickable() runs it now writes to both universal_catalog_queue
    // AND bl_catalog in the same flush. This backfill handles the case where a queue
    // already has rows from a previous run before the flush was wired up.
    await client.query(`
      INSERT INTO bl_catalog (item_no, item_type, color_id, item_name)
      SELECT part_no, 'P', 0, part_name
      FROM universal_catalog_queue
      WHERE part_name IS NOT NULL
      ON CONFLICT (item_no, item_type, color_id) DO UPDATE
      SET item_name = COALESCE(bl_catalog.item_name, EXCLUDED.item_name)
    `);
    console.log('[Migration] Phase-7 (bl_catalog backfill from universal_catalog_queue) complete.');

    // ── Phase-8: AI usage tracking table ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_log (
        id SERIAL PRIMARY KEY,
        service VARCHAR(30) NOT NULL,
        model VARCHAR(80) NOT NULL,
        operation VARCHAR(50) NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at ON ai_usage_log (created_at)`);
    console.log('[Migration] Phase-8 (ai_usage_log table) complete.');
    console.log('[Migration] All startup migrations finished successfully.');

  } catch (err: any) {
    console.error('[Migration] Error during startup migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
