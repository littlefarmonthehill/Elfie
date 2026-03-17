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

    // Seed the default E.L.F.I.E. org. Use UPDATE on conflict so any legacy
    // plan value ('pro', 'free', 'foundation') gets corrected to 'flagship'.
    await client.query(`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES ('org_planetbrick', 'E.L.F.I.E.', 'planetbrick', 'flagship')
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
    await client.query(`ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS org_id VARCHAR(100)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_log_org_id ON ai_usage_log (org_id)`);
    console.log('[Migration] Phase-8 (ai_usage_log table) complete.');

    // ── Phase-9: Platform name column on app_settings ────────────────────────
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS platform_name TEXT`);
    console.log('[Migration] Phase-9 (platform_name column) complete.');

    // ── Phase-10: Separate platform settings row from org_planetbrick ──────
    // Platform services (OpenAI key, platform BrickLink creds, platform name)
    // now live in their own row with id='platform', org_id='platform'.
    // One-time copy from org_planetbrick row, only if the platform row doesn't exist yet.
    const { rows: srcRows } = await client.query(`SELECT id FROM app_settings WHERE id = 'org_planetbrick'`);
    if (srcRows.length > 0) {
      await client.query(`
        INSERT INTO app_settings (id, org_id, openai_api_key, bricklink_consumer_key, bricklink_consumer_secret,
          bricklink_token_value, bricklink_token_secret, platform_name, ai_enabled, selected_model)
        SELECT 'platform', 'platform', openai_api_key, bricklink_consumer_key, bricklink_consumer_secret,
          bricklink_token_value, bricklink_token_secret, platform_name, ai_enabled, selected_model
        FROM app_settings WHERE id = 'org_planetbrick'
        ON CONFLICT (id) DO NOTHING
      `);
    } else {
      await client.query(`
        INSERT INTO app_settings (id, org_id, ai_enabled, selected_model)
        VALUES ('platform', 'platform', true, 'gpt-4o-mini')
        ON CONFLICT (id) DO NOTHING
      `);
    }
    console.log('[Migration] Phase-10 (platform settings row) complete.');

    // ── Phase-11: BrickLink Catalog enrichment settings columns ──────
    const phase11Cols: Array<[string, string]> = [
      ['pom_freshness_days', 'INTEGER NOT NULL DEFAULT 180'],
      ['pom_zero_stock_skip', 'BOOLEAN NOT NULL DEFAULT TRUE'],
      ['catalog_detail_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['catalog_detail_frequency_hours', 'INTEGER NOT NULL DEFAULT 1'],
      ['catalog_detail_batch_size', 'INTEGER NOT NULL DEFAULT 500'],
      ['catalog_detail_freshness_days', 'INTEGER NOT NULL DEFAULT 90'],
      ['catalog_detail_zero_stock_skip', 'BOOLEAN NOT NULL DEFAULT TRUE'],
      ['catalog_scan_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['catalog_scan_frequency_hours', 'INTEGER NOT NULL DEFAULT 2'],
      ['catalog_scan_zero_stock_skip', 'BOOLEAN NOT NULL DEFAULT TRUE'],
    ];
    for (const [col, def] of phase11Cols) {
      await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    console.log('[Migration] Phase-11 (catalog enrichment settings) complete.');

    // ── Phase-12: API budget allocation columns ──────────────────────
    const phase12Cols: Array<[string, string]> = [
      ['pom_api_budget_pct', 'INTEGER NOT NULL DEFAULT 70'],
      ['catalog_detail_api_budget_pct', 'INTEGER NOT NULL DEFAULT 20'],
    ];
    for (const [col, def] of phase12Cols) {
      await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    console.log('[Migration] Phase-12 (API budget allocation) complete.');

    // ── Phase-13: Repricing score weights & threshold columns ───────
    const phase13Cols: Array<[string, string]> = [
      ['pom_weight_ceiling', 'REAL NOT NULL DEFAULT 0.4'],
      ['pom_weight_velocity', 'REAL NOT NULL DEFAULT 0.3'],
      ['pom_weight_scarcity', 'REAL NOT NULL DEFAULT 0.2'],
      ['pom_weight_undercut', 'REAL NOT NULL DEFAULT 0.1'],
      ['pom_velocity_high', 'REAL NOT NULL DEFAULT 2.0'],
      ['pom_velocity_low', 'REAL NOT NULL DEFAULT 0.3'],
      ['pom_scarcity_high', 'REAL NOT NULL DEFAULT 0.1'],
      ['pom_scarcity_low', 'REAL NOT NULL DEFAULT 0.005'],
      ['pom_undercut_high', 'REAL NOT NULL DEFAULT 1.5'],
      ['pom_undercut_low', 'REAL NOT NULL DEFAULT 0.8'],
    ];
    for (const [col, def] of phase13Cols) {
      await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    console.log('[Migration] Phase-13 (repricing score weights) complete.');

    // ── Phase-14: Ensure bl_catalog has a row for every inventory item ────────
    // When bl_catalog was split from bl_inventory, the item_name column was dropped
    // but the migration only seeded ~99 rows from price_guide_cache. This ensures
    // every inventory item has a bl_catalog skeleton so the next inventory sync
    // (which gets item.name from the BrickLink API) can fill in the names.
    await client.query(`
      INSERT INTO bl_catalog (item_no, item_type, color_id)
      SELECT DISTINCT i.item_no, i.item_type, COALESCE(i.color_id, 0)
      FROM bl_inventory i
      LEFT JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id
      WHERE c.item_no IS NULL
      ON CONFLICT (item_no, item_type, color_id) DO NOTHING
    `);
    console.log('[Migration] Phase-14 (bl_catalog skeleton rows from bl_inventory) complete.');

    // ── Phase-15: Per-guide freshness timestamps on price_guide_cache ─────────
    // Track sold vs stock fetch times independently so the sync can skip
    // whichever guide is still fresh and save API calls.
    await client.query(`
      ALTER TABLE price_guide_cache ADD COLUMN IF NOT EXISTS sold_fetched_at TIMESTAMP;
      ALTER TABLE price_guide_cache ADD COLUMN IF NOT EXISTS stock_fetched_at TIMESTAMP;
      UPDATE price_guide_cache
        SET sold_fetched_at  = COALESCE(sold_fetched_at, fetched_at),
            stock_fetched_at = COALESCE(stock_fetched_at, fetched_at)
        WHERE sold_fetched_at IS NULL OR stock_fetched_at IS NULL;
    `);
    console.log('[Migration] Phase-15 (per-guide freshness timestamps) complete.');

    // ── Phase-16: Copy scoring weights/thresholds from platform row to org rows ──
    // These settings were previously saved to the platform row but should be
    // per-org. Copy them once so existing values aren't lost.
    const platformRow = await client.query(`SELECT
      pom_weight_ceiling, pom_weight_velocity, pom_weight_scarcity, pom_weight_undercut,
      pom_velocity_high, pom_velocity_low, pom_scarcity_high, pom_scarcity_low,
      pom_undercut_high, pom_undercut_low
      FROM app_settings WHERE id = '__platform__' LIMIT 1`);
    if (platformRow.rows.length > 0) {
      const p = platformRow.rows[0];
      const hasValues = p.pom_weight_ceiling != null || p.pom_velocity_high != null || p.pom_scarcity_high != null || p.pom_undercut_high != null;
      if (hasValues) {
        await client.query(`
          UPDATE app_settings SET
            pom_weight_ceiling  = COALESCE(pom_weight_ceiling,  $1),
            pom_weight_velocity = COALESCE(pom_weight_velocity, $2),
            pom_weight_scarcity = COALESCE(pom_weight_scarcity, $3),
            pom_weight_undercut = COALESCE(pom_weight_undercut, $4),
            pom_velocity_high   = COALESCE(pom_velocity_high,   $5),
            pom_velocity_low    = COALESCE(pom_velocity_low,    $6),
            pom_scarcity_high   = COALESCE(pom_scarcity_high,   $7),
            pom_scarcity_low    = COALESCE(pom_scarcity_low,    $8),
            pom_undercut_high   = COALESCE(pom_undercut_high,   $9),
            pom_undercut_low    = COALESCE(pom_undercut_low,    $10)
          WHERE id != '__platform__'
        `, [p.pom_weight_ceiling, p.pom_weight_velocity, p.pom_weight_scarcity, p.pom_weight_undercut,
            p.pom_velocity_high, p.pom_velocity_low, p.pom_scarcity_high, p.pom_scarcity_low,
            p.pom_undercut_high, p.pom_undercut_low]);
      }
    }
    console.log('[Migration] Phase-16 (scoring settings to org level) complete.');

    // ── Phase-17: Copy scheduler settings from org rows to platform row ──────
    // Forum sync, rebrickable set sync, and universal catalog scheduler settings
    // were previously saved to org rows but the schedulers read from the platform row.
    // Copy org values into platform row so existing settings aren't lost.
    const orgRow = await client.query(`SELECT
      forum_sync_enabled, forum_sync_frequency,
      rebrickable_set_sync_enabled, rebrickable_set_sync_time,
      universal_catalog_schedule_enabled, universal_catalog_refresh_months, universal_catalog_retry_days
      FROM app_settings WHERE id != '__platform__' ORDER BY updated_at DESC LIMIT 1`);
    if (orgRow.rows.length > 0) {
      const o = orgRow.rows[0];
      await client.query(`
        UPDATE app_settings SET
          forum_sync_enabled                = COALESCE(forum_sync_enabled,                $1),
          forum_sync_frequency              = COALESCE(forum_sync_frequency,              $2),
          rebrickable_set_sync_enabled      = COALESCE(rebrickable_set_sync_enabled,      $3),
          rebrickable_set_sync_time         = COALESCE(rebrickable_set_sync_time,         $4),
          universal_catalog_schedule_enabled = COALESCE(universal_catalog_schedule_enabled, $5),
          universal_catalog_refresh_months   = COALESCE(universal_catalog_refresh_months,   $6),
          universal_catalog_retry_days       = COALESCE(universal_catalog_retry_days,       $7)
        WHERE id = '__platform__'
      `, [o.forum_sync_enabled, o.forum_sync_frequency,
          o.rebrickable_set_sync_enabled, o.rebrickable_set_sync_time,
          o.universal_catalog_schedule_enabled, o.universal_catalog_refresh_months, o.universal_catalog_retry_days]);
    }
    console.log('[Migration] Phase-17 (scheduler settings to platform level) complete.');

    // Phase 18: Normalize price_guide_cache for simple unique constraint
    // 1. Uppercase all item_no values (so we don't need upper() in the index)
    // 2. Replace null color_id with -1 (so we don't need COALESCE in the index)
    // 3. Deduplicate any existing rows
    // 4. Drop the old expression-based index if it exists
    await client.query(`UPDATE price_guide_cache SET item_no = upper(item_no) WHERE item_no != upper(item_no)`);
    await client.query(`UPDATE price_guide_cache SET color_id = -1 WHERE color_id IS NULL`);
    await client.query(`ALTER TABLE price_guide_cache ALTER COLUMN color_id SET DEFAULT -1`);
    await client.query(`
      DELETE FROM price_guide_cache
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY item_no, item_type, color_id, new_or_used
            ORDER BY fetched_at DESC
          ) as rn
          FROM price_guide_cache
        ) ranked
        WHERE rn > 1
      )
    `);
    await client.query(`DROP INDEX IF EXISTS price_guide_cache_natural_key`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS price_guide_cache_natural_key
      ON price_guide_cache (item_no, item_type, color_id, new_or_used)
    `);
    console.log('[Migration] Phase-18 (price_guide_cache normalize + unique index) complete.');

    // ── Phase 19: Add quantity + qty_avg_price columns to price_guide_cache ──
    await client.query(`
      ALTER TABLE price_guide_cache
        ADD COLUMN IF NOT EXISTS stock_quantity integer,
        ADD COLUMN IF NOT EXISTS sold_quantity integer,
        ADD COLUMN IF NOT EXISTS stock_qty_avg_price text,
        ADD COLUMN IF NOT EXISTS sold_qty_avg_price text
    `);
    console.log('[Migration] Phase-19 (quantity + qty_avg_price columns) complete.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS market_news (
        id SERIAL PRIMARY KEY,
        query TEXT NOT NULL,
        title TEXT NOT NULL,
        snippet TEXT,
        url TEXT NOT NULL,
        source TEXT,
        published_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS market_news_url_idx ON market_news (url)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS market_news_fetched_idx ON market_news (fetched_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS market_news_query_idx ON market_news (query)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS market_news_embeddings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        article_id INTEGER NOT NULL,
        embedding vector(1536),
        content TEXT NOT NULL,
        embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS market_news_embeddings_article_idx ON market_news_embeddings (article_id)`);

    await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS market_news_sync_enabled BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS market_news_sync_frequency INTEGER NOT NULL DEFAULT 360`);
    await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS market_news_queries TEXT[] DEFAULT ARRAY['LEGO set retirement announcements', 'LEGO reseller market news pricing trends', 'BrickLink marketplace updates sellers', 'LEGO collectible investing value 2026', 'LEGO supply chain new releases']`);
    console.log('[Migration] Phase-20 (market_news tables + settings) complete.');

    // Phase-21: Business Insights table + settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_insights (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR NOT NULL,
        category TEXT NOT NULL,
        urgency TEXT NOT NULL DEFAULT 'medium',
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        details JSONB,
        source_type TEXT,
        source_ref TEXT,
        dismissed BOOLEAN NOT NULL DEFAULT false,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS business_insights_org_id_idx ON business_insights (org_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS business_insights_category_idx ON business_insights (category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS business_insights_created_at_idx ON business_insights (created_at)`);
    await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS business_intel_enabled BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS business_intel_frequency INTEGER NOT NULL DEFAULT 360`);
    console.log('[Migration] Phase-21 (business_insights table + settings) complete.');

    // Phase-22: New usage limit columns on plan_configs
    await pool.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS limit_orders INTEGER NOT NULL DEFAULT -1`);
    await pool.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS limit_elfie_queries INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS limit_business_intel INTEGER NOT NULL DEFAULT 0`);
    console.log('[Migration] Phase-22 (plan_configs usage limit columns) complete.');

    // Phase-23: Backfill industry-standard plan defaults
    await pool.query(`UPDATE plan_configs SET
      name = 'Free Trial', tagline = '14 days to explore E.L.F.I.E.',
      price_monthly = 0, price_annual = 0, price_annual_monthly = 0,
      limit_seats = 1, limit_scans = 10, limit_automation_rules = 0,
      limit_order_history_days = 14, limit_inventory_items = 500,
      limit_orders = 25, limit_elfie_queries = 20, limit_business_intel = 0,
      feature_brick_owl = false, feature_elfie_ai = true, feature_price_o_matic = false,
      feature_easypost = false, feature_data_images = true, feature_data_semantic = false,
      feature_full_enrichment = false, feature_payment_sync = false
      WHERE plan_key = 'trial'`);
    await pool.query(`UPDATE plan_configs SET
      name = 'Foundation', tagline = 'For solo sellers getting started',
      price_monthly = 1999, price_annual = 19188, price_annual_monthly = 1599,
      limit_seats = 2, limit_scans = 50, limit_automation_rules = 3,
      limit_order_history_days = 90, limit_inventory_items = 5000,
      limit_orders = 150, limit_elfie_queries = 100, limit_business_intel = 5,
      feature_brick_owl = false, feature_elfie_ai = true, feature_price_o_matic = true,
      feature_easypost = false, feature_data_images = true, feature_data_semantic = true,
      feature_full_enrichment = false, feature_payment_sync = true
      WHERE plan_key = 'foundation'`);
    await pool.query(`UPDATE plan_configs SET
      name = 'Core', tagline = 'For growing brick businesses',
      price_monthly = 4999, price_annual = 47988, price_annual_monthly = 3999,
      limit_seats = 5, limit_scans = 250, limit_automation_rules = 10,
      limit_order_history_days = 365, limit_inventory_items = 50000,
      limit_orders = 1000, limit_elfie_queries = 500, limit_business_intel = 25,
      feature_brick_owl = true, feature_elfie_ai = true, feature_price_o_matic = true,
      feature_easypost = true, feature_data_images = true, feature_data_semantic = true,
      feature_full_enrichment = true, feature_payment_sync = true
      WHERE plan_key = 'core'`);
    await pool.query(`UPDATE plan_configs SET
      name = 'Flagship', tagline = 'For high-volume operations & teams',
      price_monthly = 9999, price_annual = 95988, price_annual_monthly = 7999,
      limit_seats = -1, limit_scans = -1, limit_automation_rules = -1,
      limit_order_history_days = -1, limit_inventory_items = -1,
      limit_orders = -1, limit_elfie_queries = -1, limit_business_intel = -1,
      feature_brick_owl = true, feature_elfie_ai = true, feature_price_o_matic = true,
      feature_easypost = true, feature_data_images = true, feature_data_semantic = true,
      feature_full_enrichment = true, feature_payment_sync = true
      WHERE plan_key = 'flagship'`);
    console.log('[Migration] Phase-23 (industry-standard plan defaults) complete.');

    // Phase-24: trial_duration_days column
    await pool.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS trial_duration_days INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`UPDATE plan_configs SET trial_duration_days = 14 WHERE plan_key = 'trial' AND trial_duration_days = 0`);
    console.log('[Migration] Phase-24 (trial_duration_days column) complete.');

    // Phase-25: pom_guide_focus column
    await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS pom_guide_focus TEXT NOT NULL DEFAULT 'both'`);
    console.log('[Migration] Phase-25 (pom_guide_focus column) complete.');

    // Phase-26: Elfie custom + live support columns on plan_configs
    await pool.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS feature_elfie_custom BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS feature_elfie_live_support BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`UPDATE plan_configs SET feature_elfie_custom = true, feature_elfie_live_support = true WHERE plan_key IN ('core', 'flagship') AND feature_elfie_custom = false`);
    console.log('[Migration] Phase-26 (elfie custom + live support plan_configs columns) complete.');

    // Phase-27: support_tickets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'escalated',
        subject TEXT,
        assigned_to VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS support_tickets_org_id_idx ON support_tickets (org_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status)`);
    console.log('[Migration] Phase-27 (support_tickets table) complete.');

    // Phase-28: Product Management tables (Vision, OKRs, Roadmap, Backlog)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_vision (
        id SERIAL PRIMARY KEY,
        what_changes TEXT NOT NULL DEFAULT '',
        how_i_feel TEXT NOT NULL DEFAULT '',
        what_people_say TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_okrs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        timeframe VARCHAR(50) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_key_results (
        id SERIAL PRIMARY KEY,
        okr_id INTEGER NOT NULL REFERENCES product_okrs(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_roadmap_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        description TEXT DEFAULT '',
        lane VARCHAR(20) NOT NULL DEFAULT 'later',
        okr_id INTEGER REFERENCES product_okrs(id) ON DELETE SET NULL,
        target_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_backlog_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        description TEXT DEFAULT '',
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        effort VARCHAR(10) NOT NULL DEFAULT 'M',
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        roadmap_item_id INTEGER REFERENCES product_roadmap_items(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('[Migration] Phase-28 (product management tables) complete.');

    // Phase-29: Update org name from PlanetBrick to E.L.F.I.E.
    await pool.query(`UPDATE organizations SET name = 'E.L.F.I.E.' WHERE id = 'org_planetbrick' AND name = 'PlanetBrick'`);
    console.log('[Migration] Phase-29 (org rename to E.L.F.I.E.) complete.');

    // Phase-30: Vision statement column + capabilities table
    await pool.query(`ALTER TABLE product_vision ADD COLUMN IF NOT EXISTS vision_statement TEXT NOT NULL DEFAULT ''`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_capabilities (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        description TEXT DEFAULT '',
        level INTEGER NOT NULL DEFAULT 1,
        parent_id INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('[Migration] Phase-30 (vision statement + capabilities table) complete.');

    // Phase-31: Capability status + backlog capability link
    await pool.query(`ALTER TABLE product_capabilities ADD COLUMN IF NOT EXISTS cap_status VARCHAR(20) NOT NULL DEFAULT 'built'`);
    await pool.query(`ALTER TABLE product_backlog_items ADD COLUMN IF NOT EXISTS capability_id INTEGER`);
    console.log('[Migration] Phase-31 (capability status + backlog capability link) complete.');

    // Phase-32: Backlog status alignment with roadmap (new/next/now/later/done)
    await pool.query(`UPDATE product_backlog_items SET status = 'next' WHERE status = 'open'`);
    await pool.query(`UPDATE product_backlog_items SET status = 'now' WHERE status = 'in-progress'`);
    await pool.query(`ALTER TABLE product_backlog_items ALTER COLUMN status SET DEFAULT 'new'`);
    console.log('[Migration] Phase-32 (backlog status alignment: open→next, in-progress→now) complete.');

    // Phase-33: Comprehensive capability tree seed (idempotent — skips if data exists)
    const capCount = await pool.query(`SELECT COUNT(*) as cnt FROM product_capabilities`);
    if (parseInt(capCount.rows[0].cnt) === 0) {
      // L1 Capabilities
      const l1s = [
        'Product Management', 'Platform and Administration', 'AI and Intelligence',
        'Sales and Analytics', 'Order Management', 'Inventory Management'
      ];
      for (const t of l1s) await pool.query(`INSERT INTO product_capabilities (title, level, cap_status) VALUES ($1, 1, 'built')`, [t]);

      // L2 Capabilities: [title, parentL1Title, status]
      const l2s: [string, string, string][] = [
        ['Execution', 'Product Management', 'built'],
        ['Strategic Planning', 'Product Management', 'built'],
        ['Support', 'Platform and Administration', 'built'],
        ['Customer Portal', 'Platform and Administration', 'built'],
        ['Billing and Subscriptions', 'Platform and Administration', 'built'],
        ['Multi-Tenant System', 'Platform and Administration', 'built'],
        ['Brick Spotter 3000', 'AI and Intelligence', 'built'],
        ['Semantic Search', 'AI and Intelligence', 'built'],
        ['E.L.F.I.E. Chat Assistant', 'AI and Intelligence', 'built'],
        ['Communications and Notifications', 'AI and Intelligence', 'later'],
        ['Business Owner Intelligence', 'AI and Intelligence', 'next'],
        ['Market Intelligence', 'Sales and Analytics', 'built'],
        ['Pricing Intelligence', 'Sales and Analytics', 'built'],
        ['Sales Dashboards', 'Sales and Analytics', 'built'],
        ['Order Adjustments', 'Order Management', 'built'],
        ['Shipping', 'Order Management', 'built'],
        ['Order Processing', 'Order Management', 'built'],
        ['Warehouse Operations', 'Inventory Management', 'built'],
        ['Catalog Management', 'Inventory Management', 'built'],
        ['BrickOwl Sync', 'Inventory Management', 'built'],
        ['BrickLink Sync', 'Inventory Management', 'built'],
      ];
      for (const [t, p, s] of l2s) {
        await pool.query(`INSERT INTO product_capabilities (title, level, parent_id, cap_status) SELECT $1, 2, id, $3 FROM product_capabilities WHERE title = $2 AND level = 1`, [t, p, s]);
      }

      // L3 Features: [title, parentL2Title, status]
      const l3s: [string, string, string][] = [
        ['Capability mapping', 'Execution', 'built'],
        ['Roadmap lanes', 'Execution', 'built'],
        ['Backlog with priority/effort/status', 'Execution', 'built'],
        ['Vision of Success', 'Strategic Planning', 'built'],
        ['AI-generated vision statements', 'Strategic Planning', 'built'],
        ['OKR tracking', 'Strategic Planning', 'built'],
        ['Live support ticket queue', 'Support', 'built'],
        ['Real-time polling', 'Support', 'built'],
        ['Ticket resolution workflow', 'Support', 'built'],
        ['Retro-futuristic showroom', 'Customer Portal', 'built'],
        ['Community features', 'Customer Portal', 'built'],
        ['Customer feedback system', 'Customer Portal', 'built'],
        ['Stripe checkout integration', 'Billing and Subscriptions', 'built'],
        ['Tiered plan management', 'Billing and Subscriptions', 'built'],
        ['Usage limit enforcement', 'Billing and Subscriptions', 'built'],
        ['Auto-renewal controls', 'Billing and Subscriptions', 'built'],
        ['Organization management', 'Multi-Tenant System', 'built'],
        ['Role-based access control', 'Multi-Tenant System', 'built'],
        ['Admin impersonation', 'Multi-Tenant System', 'built'],
        ['Approval workflow', 'Multi-Tenant System', 'built'],
        ['Multi-piece LEGO scanning', 'Brick Spotter 3000', 'built'],
        ['Contour-based segmentation', 'Brick Spotter 3000', 'built'],
        ['Brickognize classification', 'Brick Spotter 3000', 'built'],
        ['CLIP visual similarity', 'Brick Spotter 3000', 'built'],
        ['Batch Processing of Scans', 'Brick Spotter 3000', 'now'],
        ['Semantic inventory search', 'Semantic Search', 'built'],
        ['Semantic catalog search', 'Semantic Search', 'built'],
        ['Natural language queries', 'Semantic Search', 'built'],
        ['Embedding-powered search', 'Semantic Search', 'built'],
        ['Local-first API policy (zero BrickLink calls by default)', 'E.L.F.I.E. Chat Assistant', 'built'],
        ['18 built-in analysis tools (catalog, pricing, orders, sales, inventory)', 'E.L.F.I.E. Chat Assistant', 'built'],
        ['Live support escalation to human agent', 'E.L.F.I.E. Chat Assistant', 'built'],
        ['Web search integration', 'E.L.F.I.E. Chat Assistant', 'built'],
        ['Forum and market news search', 'E.L.F.I.E. Chat Assistant', 'built'],
        ['Proactive alerts (low stock, stale pricing, order issues)', 'Communications and Notifications', 'later'],
        ['Daily business briefing / digest', 'Communications and Notifications', 'later'],
        ['In-app notification center', 'Communications and Notifications', 'later'],
        ['Actionable notifications (one-click resolve)', 'Communications and Notifications', 'later'],
        ['Customizable alert thresholds', 'Communications and Notifications', 'later'],
        ['Learn owner goals and strategy over time', 'Business Owner Intelligence', 'next'],
        ['Personalized business recommendations', 'Business Owner Intelligence', 'next'],
        ['Strategy-aware responses (informed by Vision and OKRs)', 'Business Owner Intelligence', 'next'],
        ['Business health scoring', 'Business Owner Intelligence', 'next'],
        ['Trend detection and proactive insights', 'Business Owner Intelligence', 'next'],
        ['Natural language report generation', 'Business Owner Intelligence', 'next'],
        ['BrickLink forum scraping', 'Market Intelligence', 'built'],
        ['Market news AI summaries', 'Market Intelligence', 'built'],
        ['Price trend analysis', 'Market Intelligence', 'built'],
        ['Competitive pricing insights', 'Market Intelligence', 'built'],
        ['Price-o-Matic auto-pricing', 'Pricing Intelligence', 'built'],
        ['Guide-weighted scoring', 'Pricing Intelligence', 'built'],
        ['Repricing score configurator', 'Pricing Intelligence', 'built'],
        ['Scoring weights configuration', 'Pricing Intelligence', 'built'],
        ['Year-over-year comparison', 'Sales Dashboards', 'built'],
        ['Platform comparison analysis', 'Sales Dashboards', 'built'],
        ['Performance dashboard', 'Sales Dashboards', 'built'],
        ['Revenue metrics', 'Sales Dashboards', 'built'],
        ['Refund tracking', 'Order Adjustments', 'built'],
        ['PayPal capture polling', 'Order Adjustments', 'built'],
        ['Order adjustment log', 'Order Adjustments', 'built'],
        ['EasyPost multi-carrier integration', 'Shipping', 'built'],
        ['Rate shopping', 'Shipping', 'built'],
        ['Label generation', 'Shipping', 'built'],
        ['Shipment tracking', 'Shipping', 'built'],
        ['Order sync from BrickLink', 'Order Processing', 'built'],
        ['Order tracking dashboard', 'Order Processing', 'built'],
        ['Picklist generation', 'Order Processing', 'built'],
        ['EOD forms', 'Order Processing', 'built'],
        ['Aisle/Shelf/Bin hierarchy', 'Warehouse Operations', 'built'],
        ['Bin-level picklist', 'Warehouse Operations', 'built'],
        ['Inventory location tracking', 'Warehouse Operations', 'built'],
        ['Pick and pack fulfillment', 'Warehouse Operations', 'built'],
        ['Part catalog enrichment', 'Catalog Management', 'built'],
        ['Shared image/weight data', 'Catalog Management', 'built'],
        ['CLIP visual embeddings', 'Catalog Management', 'built'],
        ['Rebrickable set-part relationships', 'Catalog Management', 'built'],
        ['Cross-platform sync', 'BrickOwl Sync', 'built'],
        ['Channel mapping', 'BrickOwl Sync', 'built'],
        ['Inventory mirroring', 'BrickOwl Sync', 'built'],
        ['Real-time inventory sync', 'BrickLink Sync', 'built'],
        ['Global sync lock', 'BrickLink Sync', 'built'],
        ['SKU standardization', 'BrickLink Sync', 'built'],
        ['Inventory-catalog split architecture', 'BrickLink Sync', 'built'],
      ];
      for (const [t, p, s] of l3s) {
        await pool.query(`INSERT INTO product_capabilities (title, level, parent_id, cap_status) SELECT $1, 3, id, $3 FROM product_capabilities WHERE title = $2 AND level = 2`, [t, p, s]);
      }
      console.log('[Migration] Phase-33 (full capability tree seed) complete.');
    } else {
      // Existing DB — just ensure Batch Processing of Scans exists
      await pool.query(`
        INSERT INTO product_capabilities (title, level, parent_id, cap_status)
        SELECT 'Batch Processing of Scans', 3, id, 'now'
        FROM product_capabilities WHERE title = 'Brick Spotter 3000' AND level = 2
        AND NOT EXISTS (SELECT 1 FROM product_capabilities WHERE title = 'Batch Processing of Scans' AND level = 3)
      `);
      console.log('[Migration] Phase-33 (capability tree already populated, batch scan feature ensured) complete.');
    }

    // Phase-34: Conversation threads table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_threads (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id TEXT NOT NULL UNIQUE,
        org_id VARCHAR NOT NULL,
        title TEXT DEFAULT 'New conversation',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS conversation_threads_org_idx ON conversation_threads (org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS conversation_threads_updated_idx ON conversation_threads (updated_at)`);
    console.log('[Migration] Phase-34 (conversation threads table) complete.');

    // Phase-35: Feature votes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS feature_votes (
        id SERIAL PRIMARY KEY,
        capability_id INTEGER NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        org_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS feature_votes_unique_vote ON feature_votes (capability_id, user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS feature_votes_capability_idx ON feature_votes (capability_id)`);
    console.log('[Migration] Phase-35 (feature votes table) complete.');

    // Phase-36: TOS accepted timestamp on organizations
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMP`);
    console.log('[Migration] Phase-36 (tos_accepted_at column) complete.');

    // Phase-37: Pay-as-you-grow pricing model
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_model (
        id SERIAL PRIMARY KEY,
        base_price INTEGER NOT NULL DEFAULT 3900,
        overage_bump INTEGER NOT NULL DEFAULT 500,
        monthly_cap INTEGER NOT NULL DEFAULT 9900,
        trial_days INTEGER NOT NULL DEFAULT 14,
        base_inventory_lots INTEGER NOT NULL DEFAULT 5000,
        bump_inventory_lots INTEGER NOT NULL DEFAULT 2500,
        base_orders_per_month INTEGER NOT NULL DEFAULT 100,
        bump_orders_per_month INTEGER NOT NULL DEFAULT 50,
        base_connected_stores INTEGER NOT NULL DEFAULT 2,
        bump_connected_stores INTEGER NOT NULL DEFAULT 1,
        base_ai_calls INTEGER NOT NULL DEFAULT 200,
        bump_ai_calls INTEGER NOT NULL DEFAULT 100,
        base_scans INTEGER NOT NULL DEFAULT 50,
        bump_scans INTEGER NOT NULL DEFAULT 25,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await client.query(`
      INSERT INTO pricing_model (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('[Migration] Phase-37 (pricing_model table) complete.');

    // Phase-38: Backfill sold_quantity + sold_qty_avg_price for rows added before Phase-19
    // 9,491 rows have sold_avg_price but were synced before the qty columns existed.
    // Use sold_total_lots (best available proxy) and sold_avg_price (reasonable fallback).
    await client.query(`
      UPDATE price_guide_cache
      SET
        sold_quantity     = sold_total_lots,
        sold_qty_avg_price = sold_avg_price::text,
        sold_fetched_at   = COALESCE(sold_fetched_at, NOW())
      WHERE sold_avg_price IS NOT NULL
        AND (sold_quantity IS NULL OR sold_qty_avg_price IS NULL)
    `);
    console.log('[Migration] Phase-38 (backfill sold_quantity + sold_qty_avg_price) complete.');

    // Phase-39: Backfill stock_quantity + stock_qty_avg_price for rows added before Phase-19
    // Mirror of Phase-38 but for the stock (supply) guide side.
    await client.query(`
      UPDATE price_guide_cache
      SET
        stock_quantity      = stock_total_lots,
        stock_qty_avg_price = stock_avg_price::text,
        stock_fetched_at    = COALESCE(stock_fetched_at, NOW())
      WHERE stock_avg_price IS NOT NULL
        AND (stock_quantity IS NULL OR stock_qty_avg_price IS NULL)
    `);
    console.log('[Migration] Phase-39 (backfill stock_quantity + stock_qty_avg_price) complete.');

    // Phase-40: One-time reset of universal_catalog_queue rows that failed with the OLD
    // BL CDN URL format (/ItemImage/PL/{partNo}.png returning 404). Scoped to items
    // attempted BEFORE 2026-03-16 so re-runs (restarts) don't undo fresh work.
    await client.query(`
      UPDATE universal_catalog_queue
      SET status = 'pending', attempted_at = NULL, error_msg = NULL
      WHERE status IN ('no_image', 'failed')
        AND (attempted_at IS NULL OR attempted_at < '2026-03-16'::date)
    `);
    console.log('[Migration] Phase-40 (reset universal catalog no_image/failed for CDN URL fix) complete.');

    // Phase-41: Index part_id_mappings.rebrickable_id — the universal catalog worker now
    // looks up bl_id by rebrickable_id on every part processed; without this index that
    // query is a full table scan.
    await client.query(`
      CREATE INDEX IF NOT EXISTS part_mappings_rebrickable_id_idx
        ON part_id_mappings (rebrickable_id)
    `);
    console.log('[Migration] Phase-41 (index part_id_mappings.rebrickable_id) complete.');

    // Phase-42: Backfill part_id_mappings for universal catalog parts where the Rebrickable
    // part number is identical to the BrickLink part number (many LEGO parts share IDs across
    // both catalogs). Joins universal_catalog_queue → bl_catalog on exact part_no match.
    // Zero API calls — runs purely from data already in the DB.
    const p42 = await client.query(`
      INSERT INTO part_id_mappings (bl_id, rebrickable_id)
      SELECT DISTINCT q.part_no, q.part_no
      FROM   universal_catalog_queue q
      JOIN   bl_catalog c ON c.item_no = q.part_no AND c.item_type = 'P'
      WHERE  NOT EXISTS (
        SELECT 1 FROM part_id_mappings m WHERE m.rebrickable_id = q.part_no
      )
      ON CONFLICT DO NOTHING
    `);
    console.log(`[Migration] Phase-42 (backfill part_id_mappings from bl_catalog/universal_catalog_queue overlap) complete — ${p42.rowCount ?? 0} rows added.`);

    // Phase-43: billing_start_date column on organizations — read-only, auto-set to the date of
    // each org's first inventory sync. Represents when the org became an active customer.
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_start_date timestamp`);
    const p43 = await client.query(`
      UPDATE organizations o
      SET billing_start_date = (
        SELECT DATE_TRUNC('day', MIN(i.synced_at))
        FROM bl_inventory i
        WHERE i.org_id = o.id
      )
      WHERE o.billing_start_date IS NULL
        AND EXISTS (SELECT 1 FROM bl_inventory i WHERE i.org_id = o.id)
    `);
    // Fallback: orgs with no inventory yet get their created_at as the start date
    await client.query(`
      UPDATE organizations SET billing_start_date = DATE_TRUNC('day', created_at)
      WHERE billing_start_date IS NULL
    `);
    console.log(`[Migration] Phase-43 (billing_start_date on organizations) complete — ${p43.rowCount ?? 0} orgs set from first inventory sync.`);

    // Phase-44: Reset no_image rows queued since 2026-03-16 back to pending.
    // These were marked no_image with an incorrect Rebrickable CDN URL format
    // (missing the _{colorId} suffix). Fixed in universal-clip-catalog.ts — retry them.
    const p44 = await client.query(`
      UPDATE universal_catalog_queue
      SET status = 'pending', attempted_at = NULL, error_msg = 'reset-phase-44-url-fix'
      WHERE status = 'no_image'
        AND attempted_at >= '2026-03-16'::date
    `);
    console.log(`[Migration] Phase-44 (reset no_image rows from bad Rebrickable URL format) complete — ${p44.rowCount ?? 0} rows reset to pending.`);

    // Phase-45: Sales-percentage billing plans.
    // Creates the `plans` table, seeds the default "Pay As You Grow" plan,
    // adds plan_id to organizations, and attaches all orgs to the default plan.
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR(100) NOT NULL,
        base_price       INTEGER NOT NULL DEFAULT 3900,
        sales_percentage REAL NOT NULL DEFAULT 1.9,
        free_sales_threshold INTEGER NOT NULL DEFAULT 100000,
        is_active        BOOLEAN NOT NULL DEFAULT true,
        is_sunset        BOOLEAN NOT NULL DEFAULT false,
        created_at       TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at       TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    // Seed the default plan if it doesn't exist yet
    const p45seed = await client.query(`
      INSERT INTO plans (name, base_price, sales_percentage, free_sales_threshold)
      SELECT 'Pay As You Grow', 3900, 1.9, 100000
      WHERE NOT EXISTS (SELECT 1 FROM plans LIMIT 1)
    `);
    // Add plan_id column to organizations
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id)`);
    // Attach all orgs to the default plan (id=1) if not already set
    const p45attach = await client.query(`
      UPDATE organizations SET plan_id = 1
      WHERE plan_id IS NULL AND EXISTS (SELECT 1 FROM plans WHERE id = 1)
    `);
    console.log(`[Migration] Phase-45 (sales-percentage billing plans) complete — seeded ${p45seed.rowCount ?? 0} plan(s), attached ${p45attach.rowCount ?? 0} org(s).`);

    // ── Phase-46: Password reset tokens ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id          SERIAL PRIMARY KEY,
        user_id     VARCHAR NOT NULL,
        token       VARCHAR(64) NOT NULL UNIQUE,
        expires_at  TIMESTAMP NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('[Migration] Phase-46 (password reset tokens) complete.');

    // ── Phase-47: Remove Stripe/PayPal refund adjustments ────────────────────
    // Returns are now detected directly from BrickLink (payment.status === 'Returned')
    // and recorded with payment_method='bricklink'. Old Stripe/PayPal refund records
    // must be removed to prevent double-counting when the BrickLink order sync runs.
    // Merchant fee records (type='merchant_fee') are kept as historical data.
    await client.query(`
      DELETE FROM order_adjustments
      WHERE type = 'refund'
        AND payment_method IN ('stripe', 'paypal')
    `);
    console.log('[Migration] Phase-47 (remove Stripe/PayPal refund adjustments) complete.');

    // ── Phase-48: Remove merchant fees + drop PayPal/Stripe columns ──────────
    // Merchant fee records from Stripe/PayPal are no longer collected — returns
    // come straight from BrickLink. Remove historical merchant_fee adjustments
    // and drop the now-unused credential columns from app_settings.
    await client.query(`
      DELETE FROM order_adjustments
      WHERE type = 'merchant_fee'
        AND payment_method IN ('stripe', 'paypal')
    `);
    for (const col of [
      'paypal_client_id', 'paypal_client_secret', 'paypal_environment',
    ]) {
      await client.query(`
        ALTER TABLE app_settings DROP COLUMN IF EXISTS ${col}
      `);
    }
    console.log('[Migration] Phase-48 (merchant fees + PayPal/Stripe columns removed) complete.');

    // ── Phase-49: Restore Stripe billing columns ─────────────────────────────
    // stripe_secret_key and stripe_environment are still needed for the platform
    // admin billing integration (subscriptions, checkout, billing portal).
    // They were accidentally dropped by an early Phase-48 run that included them
    // in the DROP list before the scope was narrowed to PayPal-only.
    await client.query(`
      ALTER TABLE app_settings
        ADD COLUMN IF NOT EXISTS stripe_secret_key TEXT,
        ADD COLUMN IF NOT EXISTS stripe_environment TEXT NOT NULL DEFAULT 'live'
    `);
    console.log('[Migration] Phase-49 (restore Stripe billing columns) complete.');

    // ── Phase-50: Add item_no to order_details + backfill from bl_inventory ──
    // Stores the BrickLink part number (e.g. "3001") directly on each order
    // line item so it's available even after a lot is removed from inventory.
    await client.query(`
      ALTER TABLE order_details ADD COLUMN IF NOT EXISTS item_no TEXT
    `);
    await client.query(`
      UPDATE order_details od
      SET item_no = bi.item_no
      FROM bl_inventory bi
      WHERE bi.id = od.bricklink_inventory_id
        AND od.item_no IS NULL
    `);
    console.log('[Migration] Phase-50 (item_no on order_details) complete.');

    // ── Phase-51: warehouse_depth on organizations ────────────────────────────
    // Stores per-org warehouse hierarchy depth preference:
    //   1 = bins only, 2 = shelves + bins, 3 = aisles + shelves + bins (default)
    await client.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS warehouse_depth INTEGER NOT NULL DEFAULT 3
    `);
    console.log('[Migration] Phase-51 (warehouse_depth on organizations) complete.');

    // ── Phase-52: trial_duration_days for foundation + core ───────────────────
    // Backfill the 14-day free trial for subscribable plans seeded before this
    // was added to TIER_CONFIG.
    await client.query(`
      UPDATE plan_configs
        SET trial_duration_days = 14
      WHERE plan_key IN ('foundation', 'core')
        AND trial_duration_days = 0
    `);
    console.log('[Migration] Phase-52 (trial_duration_days for foundation/core) complete.');

    console.log('[Migration] All startup migrations finished successfully.');

  } catch (err: any) {
    console.error('[Migration] Error during startup migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
