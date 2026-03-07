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

// ─── Phase-1 Multi-Tenant Migration ──────────────────────────────────────────
// All statements use IF NOT EXISTS / IF NOT NULL guards — safe to re-run.
export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('[Migration] Running Phase-1 org migrations…');

    // 1. Create organizations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name      VARCHAR NOT NULL,
        slug      VARCHAR UNIQUE NOT NULL,
        plan      VARCHAR NOT NULL DEFAULT 'free',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // 2. Seed default PlanetBrick org (idempotent)
    await client.query(`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES ('org_planetbrick', 'PlanetBrick', 'planetbrick', 'pro')
      ON CONFLICT (id) DO NOTHING
    `);

    // 3. Add org columns to users
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id VARCHAR`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role VARCHAR DEFAULT 'owner'`);
    await client.query(`UPDATE users SET org_id = 'org_planetbrick' WHERE org_id IS NULL`);

    // 4. Add org_id to all operational tables (additive only — nullable)
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

    console.log('[Migration] Phase-1 org migrations complete.');
  } catch (err: any) {
    console.error('[Migration] Error during Phase-1 migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
