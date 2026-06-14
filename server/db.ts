import pg from 'pg';
const { Pool } = pg;
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from "@shared/schema";
import { sql } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// HTTP-based Neon client — stateless, no persistent connections, no pool exhaustion.
// Each query is an independent HTTPS request; Neon handles cold-start wakeup internally.
const neonHttp = neon(process.env.DATABASE_URL);
export const db = drizzle(neonHttp, { schema });

// Minimal pg.Pool kept only for three things that need a real TCP connection:
//   1. connect-pg-simple session store
//   2. password-reset raw queries (auth.ts)
//   3. startup fix scripts in index.ts
// max:3 stays well below Neon's connection ceiling even under full scheduler load.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.warn('[DB] Pool client error (handled):', err.message);
});

// ─── Multi-Tenant Migration ───────────────────────────────────────────────────
// All statements use IF NOT EXISTS / WHERE IS NULL guards — safe to re-run on
// every server start. Order matters: tables before columns before data stamps.
export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('[Migration] Running startup migrations…');

    // ── Pre-flight: isolated column additions that must always succeed ────────
    // These run before the phased chain so they succeed even if later phases fail.
    try {
      await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'new'`);
    } catch (_) { /* column may already exist */ }

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

    console.log('[Migration] Phase-5 (merge default credentials) — removed, skipped.');

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
    // Guard: after Phase-73, platform_name lives in platform_settings — skip ADD COLUMN
    {
      const { rows: psGuard } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_settings' LIMIT 1`
      );
      if (psGuard.length === 0) {
        await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS platform_name TEXT`);
      }
    }
    console.log('[Migration] Phase-9 (platform_name column) complete.');

    // ── Phase-10: Separate platform settings row from org_planetbrick ──────
    // Platform services now live in platform_settings (after Phase-73).
    // This phase only ensures the base platform row exists in app_settings
    // and copies over BrickLink credentials (which stayed in app_settings).
    {
      const { rows: psExists } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_settings' LIMIT 1`
      );
      const postPhase73 = psExists.length > 0;

      const { rows: srcRows } = await client.query(`SELECT id FROM app_settings WHERE id = 'org_planetbrick'`);
      if (srcRows.length > 0 && !postPhase73) {
        // Pre-Phase-73: copy everything including moved columns
        await client.query(`
          INSERT INTO app_settings (id, org_id, openai_api_key, bricklink_consumer_key, bricklink_consumer_secret,
            bricklink_token_value, bricklink_token_secret, platform_name, ai_enabled, selected_model)
          SELECT 'platform', 'platform', openai_api_key, bricklink_consumer_key, bricklink_consumer_secret,
            bricklink_token_value, bricklink_token_secret, platform_name, ai_enabled, selected_model
          FROM app_settings WHERE id = 'org_planetbrick'
          ON CONFLICT (id) DO NOTHING
        `);
      } else if (srcRows.length > 0 && postPhase73) {
        // Post-Phase-73: only copy BL credentials (moved columns are gone)
        await client.query(`
          INSERT INTO app_settings (id, org_id, bricklink_consumer_key, bricklink_consumer_secret,
            bricklink_token_value, bricklink_token_secret, ai_enabled)
          SELECT 'platform', 'platform', bricklink_consumer_key, bricklink_consumer_secret,
            bricklink_token_value, bricklink_token_secret, ai_enabled
          FROM app_settings WHERE id = 'org_planetbrick'
          ON CONFLICT (id) DO NOTHING
        `);
      } else if (postPhase73) {
        // Post-Phase-73, no org_planetbrick row: minimal platform row
        await client.query(`
          INSERT INTO app_settings (id, org_id, ai_enabled)
          VALUES ('platform', 'platform', true)
          ON CONFLICT (id) DO NOTHING
        `);
      } else {
        // Pre-Phase-73: minimal platform row with selected_model default
        await client.query(`
          INSERT INTO app_settings (id, org_id, ai_enabled, selected_model)
          VALUES ('platform', 'platform', true, 'gpt-4o-mini')
          ON CONFLICT (id) DO NOTHING
        `);
      }
    }
    console.log('[Migration] Phase-10 (platform settings row) complete.');

    // ── Pre-check: has Phase-74 run? (scheduler cols moved to platform_settings) ──
    const { rows: _p74Chk } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'bl_api_call_limit' LIMIT 1`
    );
    const phase74Ran = _p74Chk.length > 0;

    // ── Phase-11: BrickLink Catalog enrichment settings columns ──────
    // pom_freshness_days + pom_zero_stock_skip stay in app_settings (org-level).
    // catalog_detail_* and catalog_scan_* moved to platform_settings in Phase-74.
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS pom_freshness_days INTEGER NOT NULL DEFAULT 180`);
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS pom_zero_stock_skip BOOLEAN NOT NULL DEFAULT TRUE`);
    if (!phase74Ran) {
      const phase11MovedCols: Array<[string, string]> = [
        ['catalog_detail_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ['catalog_detail_frequency_hours', 'INTEGER NOT NULL DEFAULT 1'],
        ['catalog_detail_batch_size', 'INTEGER NOT NULL DEFAULT 500'],
        ['catalog_detail_freshness_days', 'INTEGER NOT NULL DEFAULT 90'],
        ['catalog_detail_zero_stock_skip', 'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['catalog_scan_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ['catalog_scan_frequency_hours', 'INTEGER NOT NULL DEFAULT 2'],
        ['catalog_scan_zero_stock_skip', 'BOOLEAN NOT NULL DEFAULT TRUE'],
      ];
      for (const [col, def] of phase11MovedCols) {
        await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
      }
    }
    console.log('[Migration] Phase-11 (catalog enrichment settings) complete.');

    // ── Phase-12: API budget allocation columns ──────────────────────
    // pom_api_budget_pct + catalog_detail_api_budget_pct moved to platform_settings in Phase-74.
    if (!phase74Ran) {
      for (const [col, def] of [
        ['pom_api_budget_pct', 'INTEGER NOT NULL DEFAULT 70'],
        ['catalog_detail_api_budget_pct', 'INTEGER NOT NULL DEFAULT 20'],
      ] as Array<[string, string]>) {
        await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
      }
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

    console.log('[Migration] Phase-16 (scoring settings to org level) — removed, skipped.');

    console.log('[Migration] Phase-17 (scheduler settings to platform level) — removed, skipped.');

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

    // market_news_* moved to platform_settings in Phase-74 — guard ADD COLUMN
    if (!phase74Ran) {
      await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS market_news_sync_enabled BOOLEAN NOT NULL DEFAULT false`);
      await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS market_news_sync_frequency INTEGER NOT NULL DEFAULT 360`);
      await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS market_news_queries TEXT[] DEFAULT ARRAY['LEGO set retirement announcements', 'LEGO reseller market news pricing trends', 'BrickLink marketplace updates sellers', 'LEGO collectible investing value 2026', 'LEGO supply chain new releases']`);
    }
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
    // business_intel_* moved to platform_settings in Phase-74 — guard ADD COLUMN
    if (!phase74Ran) {
      await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS business_intel_enabled BOOLEAN NOT NULL DEFAULT false`);
      await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS business_intel_frequency INTEGER NOT NULL DEFAULT 360`);
    }
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

    console.log('[Migration] Phase-29 (org rename to E.L.F.I.E.) — removed, skipped.');

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

    // Phase-32: schema — ensure default is 'new' (data renames already done, removed)
    await pool.query(`ALTER TABLE product_backlog_items ALTER COLUMN status SET DEFAULT 'new'`);
    console.log('[Migration] Phase-32 (backlog status alignment) complete.');

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

    console.log('[Migration] Phase-38 (backfill sold_quantity + sold_qty_avg_price) — removed, skipped.');
    console.log('[Migration] Phase-39 (backfill stock_quantity + stock_qty_avg_price) — removed, skipped.');
    console.log('[Migration] Phase-40 (reset universal catalog no_image/failed for CDN URL fix) — removed, skipped.');

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

    console.log('[Migration] Phase-44 (reset no_image rows from bad Rebrickable URL format) — removed, skipped.');

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

    console.log('[Migration] Phase-47 (remove Stripe/PayPal refund adjustments) — removed, skipped.');

    // ── Phase-48: Drop now-unused PayPal credential columns from app_settings ─
    for (const col of [
      'paypal_client_id', 'paypal_client_secret', 'paypal_environment',
    ]) {
      await client.query(`
        ALTER TABLE app_settings DROP COLUMN IF EXISTS ${col}
      `);
    }
    console.log('[Migration] Phase-48 (PayPal/Stripe columns removed) complete.');

    // ── Phase-49: Restore Stripe billing columns ─────────────────────────────
    // stripe_secret_key and stripe_environment are still needed for the platform
    // admin billing integration (subscriptions, checkout, billing portal).
    // They were accidentally dropped by an early Phase-48 run that included them
    // in the DROP list before the scope was narrowed to PayPal-only.
    // Guard: after Phase-73, these columns moved to platform_settings — skip ADD COLUMN.
    {
      const { rows: psGuard49 } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_settings' LIMIT 1`
      );
      if (psGuard49.length === 0) {
        await client.query(`
          ALTER TABLE app_settings
            ADD COLUMN IF NOT EXISTS stripe_secret_key TEXT,
            ADD COLUMN IF NOT EXISTS stripe_environment TEXT NOT NULL DEFAULT 'live'
        `);
      }
    }
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

    // ── Phase-53: Replace isActive/isSunset booleans with a single `status` enum ─
    // Status values: 'live' (default, visible to subscribers), 'in_progress' (draft),
    // 'sunset' (legacy, no new sign-ups allowed).
    await client.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'live'`);
    // Backfill only if the old boolean columns still exist (safe on re-run)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'plans' AND column_name = 'is_active'
        ) THEN
          UPDATE plans SET status =
            CASE
              WHEN is_sunset = true THEN 'sunset'
              WHEN is_active = false THEN 'in_progress'
              ELSE 'live'
            END
          WHERE status = 'live';
        END IF;
      END;
      $$
    `);
    await client.query(`ALTER TABLE plans DROP COLUMN IF EXISTS is_active`);
    await client.query(`ALTER TABLE plans DROP COLUMN IF EXISTS is_sunset`);
    console.log('[Migration] Phase-53 (plans status enum: live/in_progress/sunset) complete.');

    // ── Phase-54: Add sunset_at timestamp to plans ────────────────────────────
    await client.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS sunset_at TIMESTAMP`);
    console.log('[Migration] Phase-54 (plans sunset_at column) complete.');

    // ── Phase-55: Add is_default flag to plans ────────────────────────────────
    await client.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`);
    // Set the first live plan as default if none is marked yet
    await client.query(`
      UPDATE plans SET is_default = true
      WHERE id = (
        SELECT id FROM plans WHERE status = 'live' ORDER BY id ASC LIMIT 1
      )
      AND NOT EXISTS (SELECT 1 FROM plans WHERE is_default = true)
    `);
    console.log('[Migration] Phase-55 (plans is_default column) complete.');

    console.log('[Migration] Phase-56 (trial→default plan migration) — removed, skipped.');

    // ── Phase-57: Backfill bl_catalog.image_url for all null rows ─────────────
    // Every row gets the canonical BrickLink CDN URL constructed from its own
    // (item_type, item_no, color_id) — the three fields that are ALWAYS present.
    // Protocol-relative URLs (//img.bricklink.com/...) are also normalised to https:.
    // Enrichment jobs (Rebrickable, BL Catalog API) may later overwrite with
    // higher-quality images; this just guarantees the field is never null.
    const backfillResult = await client.query(`
      UPDATE bl_catalog
      SET
        image_url = CASE
          WHEN item_type IN ('P', 'PART')    THEN 'https://img.bricklink.com/ItemImage/PN/' || color_id || '/' || item_no || '.png'
          WHEN item_type IN ('M', 'MINIFIG') THEN 'https://img.bricklink.com/ItemImage/MN/0/' || item_no || '.png'
          WHEN item_type IN ('S', 'SET')     THEN 'https://img.bricklink.com/ItemImage/SN/0/' || item_no || '.png'
          WHEN item_type IN ('G', 'GEAR')    THEN 'https://img.bricklink.com/ItemImage/GN/0/' || item_no || '.png'
          ELSE image_url
        END,
        thumbnail_url = CASE
          WHEN item_type IN ('P', 'PART')    THEN 'https://img.bricklink.com/ItemImage/PN/' || color_id || '/' || item_no || '.png'
          WHEN item_type IN ('M', 'MINIFIG') THEN 'https://img.bricklink.com/ItemImage/MN/0/' || item_no || '.png'
          WHEN item_type IN ('S', 'SET')     THEN 'https://img.bricklink.com/ItemImage/SN/0/' || item_no || '.png'
          WHEN item_type IN ('G', 'GEAR')    THEN 'https://img.bricklink.com/ItemImage/GN/0/' || item_no || '.png'
          ELSE thumbnail_url
        END,
        updated_at = NOW()
      WHERE image_url IS NULL
        AND item_type IN ('P', 'PART', 'M', 'MINIFIG', 'S', 'SET', 'G', 'GEAR')
    `);
    // Also normalise any remaining protocol-relative URLs
    const normaliseResult = await client.query(`
      UPDATE bl_catalog
      SET
        image_url     = 'https:' || image_url,
        thumbnail_url = CASE WHEN thumbnail_url LIKE '//%' THEN 'https:' || thumbnail_url ELSE thumbnail_url END,
        updated_at    = NOW()
      WHERE image_url LIKE '//%'
    `);
    console.log(`[Migration] Phase-57 (bl_catalog image_url backfill) complete — ${backfillResult.rowCount} rows filled, ${normaliseResult.rowCount} protocol-relative URLs normalised.`);

    // ── Phase-58: Add stored_image_key column to bl_catalog ────────────────────
    // Tracks the object-storage key for permanently cached processed PNGs.
    // NULL = not yet stored; non-null = bytes are in object storage at that key.
    await client.query(`
      ALTER TABLE bl_catalog
        ADD COLUMN IF NOT EXISTS stored_image_key text
    `);
    console.log('[Migration] Phase-58 (bl_catalog stored_image_key column) complete.');

    // ── Phase-59: Add image_fetch_failed column to bl_catalog ──────────────────
    // Boolean flag set by the background harvester when all CDN sources 404.
    // Harvester skips rows where this is true to avoid repeated pointless requests.
    await client.query(`
      ALTER TABLE bl_catalog
        ADD COLUMN IF NOT EXISTS image_fetch_failed boolean DEFAULT false
    `);
    console.log('[Migration] Phase-59 (bl_catalog image_fetch_failed column) complete.');

    // ── Phase-60: Add limit_brickspotter_api_calls to plan_configs ─────────────
    // Per-plan daily BrickLink API call limit for BrickSpotter (platform account).
    // 0 = BrickSpotter not included, -1 = unlimited.
    await client.query(`
      ALTER TABLE plan_configs
        ADD COLUMN IF NOT EXISTS limit_brickspotter_api_calls integer NOT NULL DEFAULT 0
    `);
    console.log('[Migration] Phase-60 (plan_configs limit_brickspotter_api_calls column) complete.');

    // ── Phase-61: Add is_brickspotter_only to plan_configs ──────────────────────
    // Flag marking a plan as BrickSpotter-only: no store management UI, no BL/BO
    // credentials required. Multiple BrickSpotter-only plans can be created.
    await client.query(`
      ALTER TABLE plan_configs
        ADD COLUMN IF NOT EXISTS is_brickspotter_only boolean NOT NULL DEFAULT false
    `);
    console.log('[Migration] Phase-61 (plan_configs is_brickspotter_only column) complete.');

    // ── Phase-62: Add BrickSpotter fields to plans table ────────────────────────
    // Moving BS settings from plan_configs to plans so each billing plan owns its BS config.
    await client.query(`
      ALTER TABLE plans
        ADD COLUMN IF NOT EXISTS is_brickspotter_only boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS limit_brickspotter_scans integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS limit_brickspotter_api_calls integer NOT NULL DEFAULT 0
    `);
    console.log('[Migration] Phase-62 (BS fields on plans table) complete.');

    // ── Phase-63: Internal workflow_status on orders ─────────────────────────
    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'new'
    `);
    console.log('[Migration] Phase-63 (workflow_status on orders) complete.');

    // ── Phase-64: Fix orders returned-to-queue with stuck workflow_status='done' ─
    // Orders that have an active orderStatus (awaiting_*) but workflow_status='done'
    // were returned to queue before the automatic reset logic was in place.
    // Reset them to 'new' so they appear in the fulfillment queue.
    const fixedRows = await client.query(`
      UPDATE orders
         SET workflow_status = 'new'
       WHERE order_status IN ('awaiting_payment', 'awaiting_shipment', 'awaiting_fulfillment')
         AND workflow_status = 'done'
    `);
    if (fixedRows.rowCount && fixedRows.rowCount > 0) {
      console.log(`[Migration] Phase-64: reset workflow_status for ${fixedRows.rowCount} stuck order(s).`);
    } else {
      console.log('[Migration] Phase-64 (fix stuck workflow_status on returned orders) complete — no rows needed fixing.');
    }

    // ── Phase-65: is_test flag on shipments ──────────────────────────────────
    await client.query(`
      ALTER TABLE shipments
        ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false
    `);
    console.log('[Migration] Phase-65 (is_test on shipments) complete.');

    // ── Phase-66: ensure sync_sale_percent defaults to true ──────────────────
    await client.query(`
      ALTER TABLE channel_sync_config
        ALTER COLUMN sync_sale_percent SET DEFAULT true
    `);
    console.log('[Migration] Phase-66 (sync_sale_percent default = true) complete.');

    // ── Phase-67/68/69: migrate channel_sync_config stockroom columns ──────────
    // Guard: only run the full transition if the final column (sync_stockroom_modes)
    // does not yet exist. This prevents repeatedly adding/dropping transitional columns
    // on every restart (which exhausts PostgreSQL's 1600 column-slot limit per table).
    {
      const { rows: modesCheck } = await client.query(`
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'channel_sync_config'
           AND column_name = 'sync_stockroom_modes'
         LIMIT 1
      `);
      if (modesCheck.length === 0) {
        // Final state not reached yet — run full transition
        await client.query(`
          ALTER TABLE channel_sync_config
            ADD COLUMN IF NOT EXISTS sync_include_stockroom boolean NOT NULL DEFAULT false
        `);
        console.log('[Migration] Phase-67 (sync_include_stockroom on channel_sync_config) complete.');

        await client.query(`
          ALTER TABLE channel_sync_config
            ADD COLUMN IF NOT EXISTS sync_stockroom_ids text[] NOT NULL DEFAULT '{}'
        `);
        await client.query(`
          UPDATE channel_sync_config
             SET sync_stockroom_ids = ARRAY['A','B','C']::text[]
           WHERE sync_include_stockroom = true
             AND sync_stockroom_ids = '{}'
        `);
        await client.query(`
          ALTER TABLE channel_sync_config
            DROP COLUMN IF EXISTS sync_include_stockroom
        `);
        console.log('[Migration] Phase-68 (sync_stockroom_ids replaces sync_include_stockroom) complete.');

        await client.query(`
          ALTER TABLE channel_sync_config
            ADD COLUMN IF NOT EXISTS sync_stockroom_modes jsonb NOT NULL
              DEFAULT '{"A":"skip","B":"skip","C":"skip"}'::jsonb
        `);
        await client.query(`
          UPDATE channel_sync_config
             SET sync_stockroom_modes = jsonb_build_object(
               'A', CASE WHEN 'A' = ANY(sync_stockroom_ids) THEN 'active' ELSE 'skip' END,
               'B', CASE WHEN 'B' = ANY(sync_stockroom_ids) THEN 'active' ELSE 'skip' END,
               'C', CASE WHEN 'C' = ANY(sync_stockroom_ids) THEN 'active' ELSE 'skip' END
             )
           WHERE sync_stockroom_ids IS NOT NULL
             AND cardinality(sync_stockroom_ids) > 0
        `);
        await client.query(`
          ALTER TABLE channel_sync_config
            DROP COLUMN IF EXISTS sync_stockroom_ids
        `);
        console.log('[Migration] Phase-69 (sync_stockroom_modes replaces sync_stockroom_ids) complete.');
      } else {
        // Final state already in place — clean up any lingering transitional columns
        // that may have been left behind by a crashed previous run, without allocating
        // new column slots (DROP IF EXISTS is always safe).
        await client.query(`
          ALTER TABLE channel_sync_config
            DROP COLUMN IF EXISTS sync_include_stockroom,
            DROP COLUMN IF EXISTS sync_stockroom_ids
        `);
        console.log('[Migration] Phase-67/68/69 (sync_stockroom_modes already present — cleanup only) complete.');
      }
    }

    // ── Phase-70: soft-delete column on bl_inventory ──────────────────────────
    // deleted_at is NULL for active items; set to a timestamp when BL stops returning the item.
    // A subsequent successful full BL sync clears it if the item reappears.
    await client.query(`
      ALTER TABLE bl_inventory
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
    `);
    console.log('[Migration] Phase-70 (bl_inventory soft-delete column) complete.');

    // ── Phase-71: BrickLink catalog lifecycle columns ──────────────────────────
    // is_obsolete: BL has retired this item ID (item will eventually be removed from catalog)
    // alternate_no: the replacement item_no BL created (new ID while old is temporarily kept)
    await client.query(`
      ALTER TABLE bl_catalog
        ADD COLUMN IF NOT EXISTS is_obsolete BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS alternate_no TEXT
    `);
    console.log('[Migration] Phase-71 (bl_catalog lifecycle columns: is_obsolete + alternate_no) complete.');

    // ── Phase-72: Recreate app_settings to reclaim 1,478 ghost column slots ──
    // Years of ADD/DROP COLUMN migrations exhausted PostgreSQL's 1,600 attribute
    // slot budget. This copies all live data to a fresh table (0 ghost slots),
    // renames atomically, and keeps app_settings_old as a safe fallback.
    // Idempotency: skip if app_settings_old already exists (migration ran).
    {
      const { rows: alreadyDone } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings_old' LIMIT 1`
      );
      // Only run when app_settings still has the legacy openai_api_key column.
      // A later migration (Phase-73) moves that column out to platform_settings,
      // so once it's gone this one-time reclaim is obsolete. The original guard
      // relied on app_settings_old existing, but that fallback table was later
      // cleaned up — which made this phase wrongly re-run on every boot, fail
      // copying a column that no longer exists, halt the whole migration chain,
      // and leave behind an empty app_settings_v2 each time.
      const { rows: needsReclaim } = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'openai_api_key' LIMIT 1`
      );
      if (alreadyDone.length === 0 && needsReclaim.length > 0) {
        // Drop any partial v2 table left over from a previous failed attempt
        await client.query(`DROP TABLE IF EXISTS app_settings_v2`);

        await client.query(`
          CREATE TABLE app_settings_v2 (
            id                              VARCHAR PRIMARY KEY DEFAULT 'default',
            org_id                          VARCHAR,
            platform_name                   TEXT,
            ai_enabled                      BOOLEAN NOT NULL DEFAULT true,
            openai_api_key                  TEXT,
            selected_model                  TEXT DEFAULT 'gpt-4o-mini',
            system_prompt                   TEXT,
            bricklink_consumer_key          TEXT,
            bricklink_consumer_secret       TEXT,
            bricklink_token_value           TEXT,
            bricklink_token_secret          TEXT,
            brickowl_api_key                TEXT,
            easypost_api_key                TEXT,
            easypost_test_api_key           TEXT,
            easypost_key_mode               TEXT NOT NULL DEFAULT 'test',
            stripe_secret_key               TEXT,
            stripe_environment              TEXT NOT NULL DEFAULT 'live',
            customs_signer                  TEXT,
            bl_ioss_number                  TEXT,
            bo_ioss_number                  TEXT,
            bl_uk_vat_number                TEXT,
            bo_uk_vat_number                TEXT,
            inventory_sync_enabled          BOOLEAN NOT NULL DEFAULT false,
            inventory_sync_time             TEXT DEFAULT '02:00',
            price_o_matic_enabled           BOOLEAN NOT NULL DEFAULT false,
            orders_sync_enabled             BOOLEAN NOT NULL DEFAULT false,
            orders_sync_frequency           INTEGER NOT NULL DEFAULT 15,
            orders_sync_start_time          TEXT DEFAULT '08:00',
            orders_sync_end_time            TEXT DEFAULT '20:00',
            forum_sync_enabled              BOOLEAN NOT NULL DEFAULT true,
            forum_sync_frequency            INTEGER NOT NULL DEFAULT 60,
            market_news_sync_enabled        BOOLEAN NOT NULL DEFAULT false,
            market_news_sync_frequency      INTEGER NOT NULL DEFAULT 360,
            market_news_queries             TEXT[] DEFAULT ARRAY[
              'LEGO set retirement announcements',
              'LEGO reseller market news pricing trends',
              'BrickLink marketplace updates sellers',
              'LEGO collectible investing value 2026',
              'LEGO supply chain new releases'
            ],
            business_intel_enabled          BOOLEAN NOT NULL DEFAULT false,
            business_intel_frequency        INTEGER NOT NULL DEFAULT 360,
            rebrickable_image_sync_enabled  BOOLEAN NOT NULL DEFAULT true,
            rebrickable_set_sync_enabled    BOOLEAN NOT NULL DEFAULT false,
            rebrickable_set_sync_time       TEXT DEFAULT '04:00',
            pom_tier1_refresh_days          INTEGER NOT NULL DEFAULT 1,
            pom_tier2_refresh_days          INTEGER NOT NULL DEFAULT 3,
            pom_tier3_refresh_days          INTEGER NOT NULL DEFAULT 7,
            pom_tier4_refresh_days          INTEGER NOT NULL DEFAULT 30,
            pom_qty_promote_threshold       INTEGER NOT NULL DEFAULT 5,
            pom_qty_demote_threshold        INTEGER NOT NULL DEFAULT 500,
            pom_revenue_top_pct             INTEGER NOT NULL DEFAULT 20,
            pom_base_premium                INTEGER NOT NULL DEFAULT 10,
            pom_minifig_premium             INTEGER NOT NULL DEFAULT 5,
            pom_scarcity_threshold1         INTEGER NOT NULL DEFAULT 50,
            pom_scarcity_bonus1             INTEGER NOT NULL DEFAULT 15,
            pom_scarcity_threshold2         INTEGER NOT NULL DEFAULT 200,
            pom_scarcity_bonus2             INTEGER NOT NULL DEFAULT 8,
            pom_scarcity_threshold3         INTEGER NOT NULL DEFAULT 500,
            pom_scarcity_bonus3             INTEGER NOT NULL DEFAULT 3,
            pom_too_high_threshold          INTEGER NOT NULL DEFAULT 20,
            pom_too_low_threshold           INTEGER NOT NULL DEFAULT 20,
            pom_underpriced_score           REAL NOT NULL DEFAULT 1.5,
            pom_overpriced_score            REAL NOT NULL DEFAULT 0.8,
            pom_weight_ceiling              REAL NOT NULL DEFAULT 0.4,
            pom_weight_velocity             REAL NOT NULL DEFAULT 0.3,
            pom_weight_scarcity             REAL NOT NULL DEFAULT 0.2,
            pom_weight_undercut             REAL NOT NULL DEFAULT 0.1,
            pom_velocity_high               REAL NOT NULL DEFAULT 2.0,
            pom_velocity_low                REAL NOT NULL DEFAULT 0.3,
            pom_scarcity_high               REAL NOT NULL DEFAULT 0.1,
            pom_scarcity_low                REAL NOT NULL DEFAULT 0.005,
            pom_undercut_high               REAL NOT NULL DEFAULT 1.5,
            pom_undercut_low                REAL NOT NULL DEFAULT 0.8,
            pom_batch_size                  INTEGER NOT NULL DEFAULT 1500,
            pom_api_call_limit              INTEGER NOT NULL DEFAULT 4500,
            bl_api_call_limit               INTEGER NOT NULL DEFAULT 4900,
            pom_cost_floor_pct              INTEGER NOT NULL DEFAULT 0,
            pom_min_price                   DECIMAL(10,4) NOT NULL DEFAULT 0.02,
            pom_trending_enabled            BOOLEAN NOT NULL DEFAULT false,
            pom_trending_days               INTEGER NOT NULL DEFAULT 30,
            pom_trending_threshold          INTEGER NOT NULL DEFAULT 5,
            pom_trending_bonus              INTEGER NOT NULL DEFAULT 5,
            pom_high_supply_enabled         BOOLEAN NOT NULL DEFAULT false,
            pom_high_supply_threshold       INTEGER NOT NULL DEFAULT 5000,
            pom_high_supply_penalty         INTEGER NOT NULL DEFAULT 5,
            pom_schedule_enabled            BOOLEAN NOT NULL DEFAULT false,
            pom_sync_time                   TEXT DEFAULT '14:00',
            pom_schedule_batch_size         INTEGER NOT NULL DEFAULT 1500,
            pom_freshness_days              INTEGER NOT NULL DEFAULT 180,
            pom_zero_stock_skip             BOOLEAN NOT NULL DEFAULT true,
            pom_guide_focus                 TEXT NOT NULL DEFAULT 'both',
            pom_sug_sold_avg_w              REAL NOT NULL DEFAULT 0.5,
            pom_sug_stock_min_w             REAL NOT NULL DEFAULT 0.3,
            pom_sug_sold_max_w              REAL NOT NULL DEFAULT 0.2,
            pom_sug_demand_mult             REAL NOT NULL DEFAULT 0.25,
            pom_sug_comp_cap                REAL NOT NULL DEFAULT 1.15,
            pom_sug_floor                   REAL NOT NULL DEFAULT 0.95,
            pom_sug_store_premium           REAL NOT NULL DEFAULT 1.10,
            pom_sug_prem_threshold          REAL NOT NULL DEFAULT 0.40,
            pom_sug_prem_vel_w              REAL NOT NULL DEFAULT 0.6,
            pom_sug_prem_scarc_w            REAL NOT NULL DEFAULT 0.4,
            pom_sug_prem_mult               REAL NOT NULL DEFAULT 0.5,
            catalog_detail_enabled          BOOLEAN NOT NULL DEFAULT false,
            catalog_detail_frequency_hours  INTEGER NOT NULL DEFAULT 1,
            catalog_detail_batch_size       INTEGER NOT NULL DEFAULT 500,
            catalog_detail_freshness_days   INTEGER NOT NULL DEFAULT 90,
            catalog_detail_zero_stock_skip  BOOLEAN NOT NULL DEFAULT true,
            catalog_scan_enabled            BOOLEAN NOT NULL DEFAULT false,
            catalog_scan_frequency_hours    INTEGER NOT NULL DEFAULT 2,
            catalog_scan_zero_stock_skip    BOOLEAN NOT NULL DEFAULT true,
            pom_api_budget_pct              INTEGER NOT NULL DEFAULT 70,
            catalog_detail_api_budget_pct   INTEGER NOT NULL DEFAULT 20,
            universal_catalog_schedule_enabled BOOLEAN NOT NULL DEFAULT false,
            universal_catalog_refresh_months   INTEGER NOT NULL DEFAULT 1,
            universal_catalog_retry_days       INTEGER NOT NULL DEFAULT 30,
            channel_sync_enabled            BOOLEAN NOT NULL DEFAULT false,
            channel_sync_time               TEXT DEFAULT '03:00',
            channel_sync_mode               TEXT NOT NULL DEFAULT 'analysis',
            timezone                        TEXT DEFAULT 'America/Chicago',
            pom_deep_space_keys             TEXT DEFAULT '[]',
            pom_future_missions_keys        TEXT DEFAULT '[]',
            lom_category_score              INTEGER NOT NULL DEFAULT 25,
            lom_subcategory_score           INTEGER NOT NULL DEFAULT 50,
            lom_finalsort_score             INTEGER NOT NULL DEFAULT 75,
            lom_listing_score               INTEGER NOT NULL DEFAULT 100,
            elfie_mode                      TEXT NOT NULL DEFAULT 'search',
            updated_at                      TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);

        // Copy all live data — explicit column list to avoid touching ghost columns
        await client.query(`
          INSERT INTO app_settings_v2 (
            id, org_id, platform_name, ai_enabled, openai_api_key, selected_model, system_prompt,
            bricklink_consumer_key, bricklink_consumer_secret, bricklink_token_value, bricklink_token_secret,
            brickowl_api_key, easypost_api_key, easypost_test_api_key, easypost_key_mode,
            stripe_secret_key, stripe_environment,
            customs_signer, bl_ioss_number, bo_ioss_number, bl_uk_vat_number, bo_uk_vat_number,
            inventory_sync_enabled, inventory_sync_time, price_o_matic_enabled,
            orders_sync_enabled, orders_sync_frequency, orders_sync_start_time, orders_sync_end_time,
            forum_sync_enabled, forum_sync_frequency,
            market_news_sync_enabled, market_news_sync_frequency, market_news_queries,
            business_intel_enabled, business_intel_frequency,
            rebrickable_image_sync_enabled, rebrickable_set_sync_enabled, rebrickable_set_sync_time,
            pom_tier1_refresh_days, pom_tier2_refresh_days, pom_tier3_refresh_days, pom_tier4_refresh_days,
            pom_qty_promote_threshold, pom_qty_demote_threshold, pom_revenue_top_pct,
            pom_base_premium, pom_minifig_premium,
            pom_scarcity_threshold1, pom_scarcity_bonus1, pom_scarcity_threshold2, pom_scarcity_bonus2,
            pom_scarcity_threshold3, pom_scarcity_bonus3,
            pom_too_high_threshold, pom_too_low_threshold,
            pom_underpriced_score, pom_overpriced_score,
            pom_weight_ceiling, pom_weight_velocity, pom_weight_scarcity, pom_weight_undercut,
            pom_velocity_high, pom_velocity_low, pom_scarcity_high, pom_scarcity_low,
            pom_undercut_high, pom_undercut_low,
            pom_batch_size, pom_api_call_limit, bl_api_call_limit,
            pom_cost_floor_pct, pom_min_price,
            pom_trending_enabled, pom_trending_days, pom_trending_threshold, pom_trending_bonus,
            pom_high_supply_enabled, pom_high_supply_threshold, pom_high_supply_penalty,
            pom_schedule_enabled, pom_sync_time, pom_schedule_batch_size,
            pom_freshness_days, pom_zero_stock_skip, pom_guide_focus,
            pom_sug_sold_avg_w, pom_sug_stock_min_w, pom_sug_sold_max_w, pom_sug_demand_mult,
            pom_sug_comp_cap, pom_sug_floor, pom_sug_store_premium,
            pom_sug_prem_threshold, pom_sug_prem_vel_w, pom_sug_prem_scarc_w, pom_sug_prem_mult,
            catalog_detail_enabled, catalog_detail_frequency_hours, catalog_detail_batch_size,
            catalog_detail_freshness_days, catalog_detail_zero_stock_skip,
            catalog_scan_enabled, catalog_scan_frequency_hours, catalog_scan_zero_stock_skip,
            pom_api_budget_pct, catalog_detail_api_budget_pct,
            universal_catalog_schedule_enabled, universal_catalog_refresh_months, universal_catalog_retry_days,
            channel_sync_enabled, channel_sync_time, channel_sync_mode,
            timezone, pom_deep_space_keys, pom_future_missions_keys,
            lom_category_score, lom_subcategory_score, lom_finalsort_score, lom_listing_score,
            elfie_mode, updated_at
          )
          SELECT
            id, org_id, platform_name, ai_enabled, openai_api_key, selected_model, system_prompt,
            bricklink_consumer_key, bricklink_consumer_secret, bricklink_token_value, bricklink_token_secret,
            brickowl_api_key, easypost_api_key, easypost_test_api_key, easypost_key_mode,
            stripe_secret_key, stripe_environment,
            customs_signer, bl_ioss_number, bo_ioss_number, bl_uk_vat_number, bo_uk_vat_number,
            inventory_sync_enabled, inventory_sync_time, price_o_matic_enabled,
            orders_sync_enabled, orders_sync_frequency, orders_sync_start_time, orders_sync_end_time,
            forum_sync_enabled, forum_sync_frequency,
            market_news_sync_enabled, market_news_sync_frequency, market_news_queries,
            business_intel_enabled, business_intel_frequency,
            rebrickable_image_sync_enabled, rebrickable_set_sync_enabled, rebrickable_set_sync_time,
            pom_tier1_refresh_days, pom_tier2_refresh_days, pom_tier3_refresh_days, pom_tier4_refresh_days,
            pom_qty_promote_threshold, pom_qty_demote_threshold, pom_revenue_top_pct,
            pom_base_premium, pom_minifig_premium,
            pom_scarcity_threshold1, pom_scarcity_bonus1, pom_scarcity_threshold2, pom_scarcity_bonus2,
            pom_scarcity_threshold3, pom_scarcity_bonus3,
            pom_too_high_threshold, pom_too_low_threshold,
            pom_underpriced_score, pom_overpriced_score,
            pom_weight_ceiling, pom_weight_velocity, pom_weight_scarcity, pom_weight_undercut,
            pom_velocity_high, pom_velocity_low, pom_scarcity_high, pom_scarcity_low,
            pom_undercut_high, pom_undercut_low,
            pom_batch_size, pom_api_call_limit, bl_api_call_limit,
            pom_cost_floor_pct, pom_min_price,
            pom_trending_enabled, pom_trending_days, pom_trending_threshold, pom_trending_bonus,
            pom_high_supply_enabled, pom_high_supply_threshold, pom_high_supply_penalty,
            pom_schedule_enabled, pom_sync_time, pom_schedule_batch_size,
            pom_freshness_days, pom_zero_stock_skip, pom_guide_focus,
            pom_sug_sold_avg_w, pom_sug_stock_min_w, pom_sug_sold_max_w, pom_sug_demand_mult,
            pom_sug_comp_cap, pom_sug_floor, pom_sug_store_premium,
            pom_sug_prem_threshold, pom_sug_prem_vel_w, pom_sug_prem_scarc_w, pom_sug_prem_mult,
            catalog_detail_enabled, catalog_detail_frequency_hours, catalog_detail_batch_size,
            catalog_detail_freshness_days, catalog_detail_zero_stock_skip,
            catalog_scan_enabled, catalog_scan_frequency_hours, catalog_scan_zero_stock_skip,
            pom_api_budget_pct, catalog_detail_api_budget_pct,
            universal_catalog_schedule_enabled, universal_catalog_refresh_months, universal_catalog_retry_days,
            channel_sync_enabled, channel_sync_time, channel_sync_mode,
            timezone, pom_deep_space_keys, pom_future_missions_keys,
            lom_category_score, lom_subcategory_score, lom_finalsort_score, lom_listing_score,
            elfie_mode, updated_at
          FROM app_settings
        `);

        // Atomic swap — old table kept as app_settings_old (safe fallback)
        await client.query(`ALTER TABLE app_settings RENAME TO app_settings_old`);
        await client.query(`ALTER TABLE app_settings_v2 RENAME TO app_settings`);

        const { rows: verifyRows } = await client.query(`SELECT COUNT(*) as cnt FROM app_settings`);
        console.log(`[Migration] Phase-72 (app_settings recreated — ${verifyRows[0].cnt} rows migrated, 1,478 ghost column slots reclaimed) complete.`);
      } else {
        console.log('[Migration] Phase-72 (app_settings already reshaped — reclaim obsolete) — skipped.');
      }
    }

    // ── Phase-73: Create platform_settings and move 6 platform-owned columns ──
    // platformName, openaiApiKey, selectedModel, systemPrompt, stripeSecretKey,
    // stripeEnvironment move from app_settings → platform_settings (single row,
    // id='platform'). This keeps app_settings purely org-level.
    // Idempotency: skip if platform_settings table already exists.
    {
      const { rows: platExists } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_settings' LIMIT 1`
      );
      if (platExists.length === 0) {
        await client.query(`
          CREATE TABLE platform_settings (
            id                 VARCHAR PRIMARY KEY DEFAULT 'platform',
            platform_name      TEXT,
            openai_api_key     TEXT,
            selected_model     TEXT DEFAULT 'gpt-4o-mini',
            system_prompt      TEXT,
            stripe_secret_key  TEXT,
            stripe_environment TEXT NOT NULL DEFAULT 'live',
            updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);

        // Copy 6 platform-owned columns from the platform row in app_settings
        await client.query(`
          INSERT INTO platform_settings
            (id, platform_name, openai_api_key, selected_model, system_prompt, stripe_secret_key, stripe_environment)
          SELECT 'platform', platform_name, openai_api_key, selected_model, system_prompt, stripe_secret_key, stripe_environment
          FROM app_settings
          WHERE id = 'platform'
          ON CONFLICT DO NOTHING
        `);

        // Drop the 6 moved columns from app_settings
        await client.query(`
          ALTER TABLE app_settings
            DROP COLUMN IF EXISTS platform_name,
            DROP COLUMN IF EXISTS openai_api_key,
            DROP COLUMN IF EXISTS selected_model,
            DROP COLUMN IF EXISTS system_prompt,
            DROP COLUMN IF EXISTS stripe_secret_key,
            DROP COLUMN IF EXISTS stripe_environment
        `);

        console.log('[Migration] Phase-73 (platform_settings created — 6 platform columns moved from app_settings) complete.');
      } else {
        console.log('[Migration] Phase-73 (platform_settings already exists) — skipped.');
      }
    }

    // ── Phase-74: Move 27 platform-wide enrichment/scheduler cols to platform_settings ──
    // Columns moving: blApiCallLimit, pomApiBudgetPct, catalogDetailApiBudgetPct,
    //   pomScheduleEnabled, pomSyncTime, pomScheduleBatchSize,
    //   catalogDetailEnabled, catalogDetailFrequencyHours, catalogDetailBatchSize,
    //   catalogDetailFreshnessDays, catalogDetailZeroStockSkip,
    //   catalogScanEnabled, catalogScanFrequencyHours, catalogScanZeroStockSkip,
    //   universalCatalogScheduleEnabled, universalCatalogRefreshMonths, universalCatalogRetryDays,
    //   forumSyncEnabled, forumSyncFrequency,
    //   marketNewsSyncEnabled, marketNewsSyncFrequency, marketNewsQueries,
    //   businessIntelEnabled, businessIntelFrequency,
    //   rebrickableSetSyncEnabled, rebrickableSetSyncTime, timezone
    // Idempotency: skip if bl_api_call_limit already exists in platform_settings.
    if (!phase74Ran) {
      // Add 27 columns to platform_settings
      const p74Cols: Array<[string, string]> = [
        ['bl_api_call_limit',                'INTEGER NOT NULL DEFAULT 4900'],
        ['pom_api_budget_pct',               'INTEGER NOT NULL DEFAULT 70'],
        ['catalog_detail_api_budget_pct',    'INTEGER NOT NULL DEFAULT 20'],
        ['pom_schedule_enabled',             'BOOLEAN NOT NULL DEFAULT false'],
        ['pom_sync_time',                    'TEXT DEFAULT \'14:00\''],
        ['pom_schedule_batch_size',          'INTEGER NOT NULL DEFAULT 1500'],
        ['catalog_detail_enabled',           'BOOLEAN NOT NULL DEFAULT false'],
        ['catalog_detail_frequency_hours',   'INTEGER NOT NULL DEFAULT 1'],
        ['catalog_detail_batch_size',        'INTEGER NOT NULL DEFAULT 500'],
        ['catalog_detail_freshness_days',    'INTEGER NOT NULL DEFAULT 90'],
        ['catalog_detail_zero_stock_skip',   'BOOLEAN NOT NULL DEFAULT true'],
        ['catalog_scan_enabled',             'BOOLEAN NOT NULL DEFAULT false'],
        ['catalog_scan_frequency_hours',     'INTEGER NOT NULL DEFAULT 2'],
        ['catalog_scan_zero_stock_skip',     'BOOLEAN NOT NULL DEFAULT true'],
        ['universal_catalog_schedule_enabled','BOOLEAN NOT NULL DEFAULT false'],
        ['universal_catalog_refresh_months', 'INTEGER NOT NULL DEFAULT 1'],
        ['universal_catalog_retry_days',     'INTEGER NOT NULL DEFAULT 30'],
        ['forum_sync_enabled',               'BOOLEAN NOT NULL DEFAULT false'],
        ['forum_sync_frequency',             'INTEGER NOT NULL DEFAULT 60'],
        ['market_news_sync_enabled',         'BOOLEAN NOT NULL DEFAULT false'],
        ['market_news_sync_frequency',       'INTEGER NOT NULL DEFAULT 360'],
        ['market_news_queries',              `TEXT[] DEFAULT ARRAY['LEGO set retirement announcements', 'LEGO reseller market news pricing trends', 'BrickLink marketplace updates sellers', 'LEGO collectible investing value 2026', 'LEGO supply chain new releases']`],
        ['business_intel_enabled',           'BOOLEAN NOT NULL DEFAULT false'],
        ['business_intel_frequency',         'INTEGER NOT NULL DEFAULT 360'],
        ['rebrickable_set_sync_enabled',     'BOOLEAN NOT NULL DEFAULT false'],
        ['rebrickable_set_sync_time',        'TEXT DEFAULT \'04:00\''],
        ['timezone',                         'TEXT DEFAULT \'America/Chicago\''],
      ];
      for (const [col, def] of p74Cols) {
        await client.query(`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
      }

      // Copy current values from app_settings platform row (where columns still exist)
      await client.query(`
        UPDATE platform_settings ps SET
          bl_api_call_limit                = COALESCE((SELECT bl_api_call_limit                FROM app_settings WHERE id = 'platform' LIMIT 1), 4900),
          pom_api_budget_pct               = COALESCE((SELECT pom_api_budget_pct               FROM app_settings WHERE id = 'platform' LIMIT 1), 70),
          catalog_detail_api_budget_pct    = COALESCE((SELECT catalog_detail_api_budget_pct    FROM app_settings WHERE id = 'platform' LIMIT 1), 20),
          pom_schedule_enabled             = COALESCE((SELECT pom_schedule_enabled             FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          pom_sync_time                    = COALESCE((SELECT pom_sync_time                    FROM app_settings WHERE id = 'platform' LIMIT 1), '14:00'),
          pom_schedule_batch_size          = COALESCE((SELECT pom_schedule_batch_size          FROM app_settings WHERE id = 'platform' LIMIT 1), 1500),
          catalog_detail_enabled           = COALESCE((SELECT catalog_detail_enabled           FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          catalog_detail_frequency_hours   = COALESCE((SELECT catalog_detail_frequency_hours   FROM app_settings WHERE id = 'platform' LIMIT 1), 1),
          catalog_detail_batch_size        = COALESCE((SELECT catalog_detail_batch_size        FROM app_settings WHERE id = 'platform' LIMIT 1), 500),
          catalog_detail_freshness_days    = COALESCE((SELECT catalog_detail_freshness_days    FROM app_settings WHERE id = 'platform' LIMIT 1), 90),
          catalog_detail_zero_stock_skip   = COALESCE((SELECT catalog_detail_zero_stock_skip   FROM app_settings WHERE id = 'platform' LIMIT 1), true),
          catalog_scan_enabled             = COALESCE((SELECT catalog_scan_enabled             FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          catalog_scan_frequency_hours     = COALESCE((SELECT catalog_scan_frequency_hours     FROM app_settings WHERE id = 'platform' LIMIT 1), 2),
          catalog_scan_zero_stock_skip     = COALESCE((SELECT catalog_scan_zero_stock_skip     FROM app_settings WHERE id = 'platform' LIMIT 1), true),
          universal_catalog_schedule_enabled = COALESCE((SELECT universal_catalog_schedule_enabled FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          universal_catalog_refresh_months = COALESCE((SELECT universal_catalog_refresh_months FROM app_settings WHERE id = 'platform' LIMIT 1), 1),
          universal_catalog_retry_days     = COALESCE((SELECT universal_catalog_retry_days     FROM app_settings WHERE id = 'platform' LIMIT 1), 30),
          forum_sync_enabled               = COALESCE((SELECT forum_sync_enabled               FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          forum_sync_frequency             = COALESCE((SELECT forum_sync_frequency             FROM app_settings WHERE id = 'platform' LIMIT 1), 60),
          market_news_sync_enabled         = COALESCE((SELECT market_news_sync_enabled         FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          market_news_sync_frequency       = COALESCE((SELECT market_news_sync_frequency       FROM app_settings WHERE id = 'platform' LIMIT 1), 360),
          market_news_queries              = COALESCE((SELECT market_news_queries              FROM app_settings WHERE id = 'platform' LIMIT 1), ARRAY['LEGO set retirement announcements']::TEXT[]),
          business_intel_enabled           = COALESCE((SELECT business_intel_enabled           FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          business_intel_frequency         = COALESCE((SELECT business_intel_frequency         FROM app_settings WHERE id = 'platform' LIMIT 1), 360),
          rebrickable_set_sync_enabled     = COALESCE((SELECT rebrickable_set_sync_enabled     FROM app_settings WHERE id = 'platform' LIMIT 1), false),
          rebrickable_set_sync_time        = COALESCE((SELECT rebrickable_set_sync_time        FROM app_settings WHERE id = 'platform' LIMIT 1), '04:00'),
          timezone                         = COALESCE((SELECT timezone                         FROM app_settings WHERE id = 'platform' LIMIT 1), 'America/Chicago')
        WHERE ps.id = 'platform'
      `);

      // Drop the 27 moved columns from app_settings
      await client.query(`
        ALTER TABLE app_settings
          DROP COLUMN IF EXISTS bl_api_call_limit,
          DROP COLUMN IF EXISTS pom_api_budget_pct,
          DROP COLUMN IF EXISTS catalog_detail_api_budget_pct,
          DROP COLUMN IF EXISTS pom_schedule_enabled,
          DROP COLUMN IF EXISTS pom_sync_time,
          DROP COLUMN IF EXISTS pom_schedule_batch_size,
          DROP COLUMN IF EXISTS catalog_detail_enabled,
          DROP COLUMN IF EXISTS catalog_detail_frequency_hours,
          DROP COLUMN IF EXISTS catalog_detail_batch_size,
          DROP COLUMN IF EXISTS catalog_detail_freshness_days,
          DROP COLUMN IF EXISTS catalog_detail_zero_stock_skip,
          DROP COLUMN IF EXISTS catalog_scan_enabled,
          DROP COLUMN IF EXISTS catalog_scan_frequency_hours,
          DROP COLUMN IF EXISTS catalog_scan_zero_stock_skip,
          DROP COLUMN IF EXISTS universal_catalog_schedule_enabled,
          DROP COLUMN IF EXISTS universal_catalog_refresh_months,
          DROP COLUMN IF EXISTS universal_catalog_retry_days,
          DROP COLUMN IF EXISTS forum_sync_enabled,
          DROP COLUMN IF EXISTS forum_sync_frequency,
          DROP COLUMN IF EXISTS market_news_sync_enabled,
          DROP COLUMN IF EXISTS market_news_sync_frequency,
          DROP COLUMN IF EXISTS market_news_queries,
          DROP COLUMN IF EXISTS business_intel_enabled,
          DROP COLUMN IF EXISTS business_intel_frequency,
          DROP COLUMN IF EXISTS rebrickable_set_sync_enabled,
          DROP COLUMN IF EXISTS rebrickable_set_sync_time,
          DROP COLUMN IF EXISTS timezone
      `);

      console.log('[Migration] Phase-74 (27 enrichment/scheduler cols moved to platform_settings) complete.');
    } else {
      console.log('[Migration] Phase-74 (platform_settings scheduler cols already present) — skipped.');
    }

    // ── Phase-75: BrickLink credentials in platform_settings + org-level ceiling in app_settings ──
    // Idempotency: check for bl_consumer_key in platform_settings.
    const { rows: _p75Chk } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'bl_consumer_key' LIMIT 1`
    );
    if (_p75Chk.length === 0) {
      // Add BrickLink credential columns to platform_settings (for platform background schedulers)
      await client.query(`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS bl_consumer_key TEXT`);
      await client.query(`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS bl_consumer_secret TEXT`);
      await client.query(`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS bl_token_value TEXT`);
      await client.query(`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS bl_token_secret TEXT`);
      // Copy existing platform BrickLink credentials from app_settings platform row (preserve existing setup)
      await client.query(`
        UPDATE platform_settings ps SET
          bl_consumer_key    = (SELECT bricklink_consumer_key    FROM app_settings WHERE id = 'platform' LIMIT 1),
          bl_consumer_secret = (SELECT bricklink_consumer_secret FROM app_settings WHERE id = 'platform' LIMIT 1),
          bl_token_value     = (SELECT bricklink_token_value     FROM app_settings WHERE id = 'platform' LIMIT 1),
          bl_token_secret    = (SELECT bricklink_token_secret    FROM app_settings WHERE id = 'platform' LIMIT 1)
        WHERE ps.id = 'platform'
      `);
      // Add org-level BrickLink API call ceiling to app_settings
      await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS bl_api_call_limit INTEGER NOT NULL DEFAULT 4900`);
      console.log('[Migration] Phase-75 (BrickLink platform creds + org ceiling) complete.');
    } else {
      // Ensure org ceiling column exists even if rest of phase already ran
      await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS bl_api_call_limit INTEGER NOT NULL DEFAULT 4900`);
      console.log('[Migration] Phase-75 (BrickLink platform creds + org ceiling) — skipped, already present.');
    }

    // Phase-76: Remove duplicate bo- BrickOwl orders and restore incorrectly deducted inventory.
    // When the silent-skip date bug was fixed, the sync re-inserted already-existing BrickOwl orders
    // under new bo- prefixed IDs, treating them as fresh orders and wrongly deducting inventory.
    const dupBoCheck = await client.query(`
      SELECT COUNT(*) as cnt
      FROM orders bo
      JOIN orders old_rec ON old_rec.order_number = bo.order_number
        AND LEFT(old_rec.id::text, 3) != 'bo-'
        AND old_rec.marketplace = 'BrickOwl'
      WHERE LEFT(bo.id::text, 3) = 'bo-'
        AND bo.marketplace = 'BrickOwl'
    `);
    const dupBoCount = parseInt(dupBoCheck.rows[0]?.cnt ?? '0', 10);
    if (dupBoCount > 0) {
      // Step 1: Restore bl_inventory quantities for items in duplicate orders
      await client.query(`
        UPDATE bl_inventory bi
        SET quantity = bi.quantity + od.quantity
        FROM order_details od
        WHERE od.bricklink_inventory_id = bi.id
          AND od.order_id IN (
            SELECT bo.id FROM orders bo
            JOIN orders old_rec ON old_rec.order_number = bo.order_number
              AND LEFT(old_rec.id::text, 3) != 'bo-'
              AND old_rec.marketplace = 'BrickOwl'
            WHERE LEFT(bo.id::text, 3) = 'bo-'
              AND bo.marketplace = 'BrickOwl'
          )
      `);
      // Step 2: Delete order_details for duplicate orders
      await client.query(`
        DELETE FROM order_details
        WHERE order_id IN (
          SELECT bo.id FROM orders bo
          JOIN orders old_rec ON old_rec.order_number = bo.order_number
            AND LEFT(old_rec.id::text, 3) != 'bo-'
            AND old_rec.marketplace = 'BrickOwl'
          WHERE LEFT(bo.id::text, 3) = 'bo-'
            AND bo.marketplace = 'BrickOwl'
        )
      `);
      // Step 3: Delete the duplicate orders (order_adjustments + picklist_items cascade)
      await client.query(`
        DELETE FROM orders
        WHERE id IN (
          SELECT bo.id FROM orders bo
          JOIN orders old_rec ON old_rec.order_number = bo.order_number
            AND LEFT(old_rec.id::text, 3) != 'bo-'
            AND old_rec.marketplace = 'BrickOwl'
          WHERE LEFT(bo.id::text, 3) = 'bo-'
            AND bo.marketplace = 'BrickOwl'
        )
      `);
      console.log(`[Migration] Phase-76 (remove ${dupBoCount} duplicate bo- BrickOwl orders + restore inventory) complete.`);
    } else {
      console.log('[Migration] Phase-76 (duplicate bo- BrickOwl orders) — none found, skipped.');
    }

    console.log('[Migration] Phase-77 (old unmatched bo- orders) — removed, skipped.');
    console.log('[Migration] Phase-78 (old numeric-ID BrickOwl orders) — removed, skipped.');

    // ── Phase-79: Copy platform row from app_settings → platform_settings, then delete the platform org row ──
    // Idempotency: only runs while app_settings still has a 'platform' row.
    const { rows: _p79Chk } = await client.query(
      `SELECT 1 FROM app_settings WHERE id = 'platform' LIMIT 1`
    );
    if (_p79Chk.length > 0) {
      // 1. Copy BrickLink credentials (only overwrite if platform_settings value is currently null/empty)
      await client.query(`
        UPDATE platform_settings ps SET
          bl_consumer_key    = COALESCE(NULLIF(ps.bl_consumer_key, ''),    (SELECT bricklink_consumer_key    FROM app_settings WHERE id = 'platform' LIMIT 1)),
          bl_consumer_secret = COALESCE(NULLIF(ps.bl_consumer_secret, ''), (SELECT bricklink_consumer_secret FROM app_settings WHERE id = 'platform' LIMIT 1)),
          bl_token_value     = COALESCE(NULLIF(ps.bl_token_value, ''),     (SELECT bricklink_token_value     FROM app_settings WHERE id = 'platform' LIMIT 1)),
          bl_token_secret    = COALESCE(NULLIF(ps.bl_token_secret, ''),    (SELECT bricklink_token_secret    FROM app_settings WHERE id = 'platform' LIMIT 1))
        WHERE ps.id = 'platform'
      `);
      // 2. Copy platform_name (only if currently null)
      await client.query(`
        UPDATE platform_settings ps SET
          platform_name = COALESCE(ps.platform_name, (SELECT platform_name FROM app_settings WHERE id = 'platform' LIMIT 1))
        WHERE ps.id = 'platform'
      `);
      // 3. Copy stripe_secret_key (only if currently null/empty)
      await client.query(`
        UPDATE platform_settings ps SET
          stripe_secret_key = COALESCE(NULLIF(ps.stripe_secret_key, ''), (SELECT stripe_secret_key FROM app_settings WHERE id = 'platform' LIMIT 1))
        WHERE ps.id = 'platform'
      `);
      // 4. Sync bl_api_call_limit — take the higher of the two values
      await client.query(`
        UPDATE platform_settings ps SET
          bl_api_call_limit = GREATEST(ps.bl_api_call_limit, (SELECT bl_api_call_limit FROM app_settings WHERE id = 'platform' LIMIT 1))
        WHERE ps.id = 'platform'
      `);
      // 5. Delete the platform org row from app_settings — it is fully replaced by platform_settings
      await client.query(`DELETE FROM app_settings WHERE id = 'platform'`);
      console.log('[Migration] Phase-79 (copy platform app_settings → platform_settings + delete platform org row) complete.');
    } else {
      console.log('[Migration] Phase-79 (remove platform org row) — already removed, skipped.');
    }

    // ── Phase-80: inventory_history table ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_history (
        id            SERIAL PRIMARY KEY,
        org_id        VARCHAR(256) NOT NULL,
        inventory_id  INTEGER NOT NULL,
        item_no       TEXT NOT NULL,
        color_id      INTEGER,
        changed_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        source        TEXT NOT NULL,
        source_ref    TEXT,
        field         TEXT NOT NULL,
        old_value     TEXT,
        new_value     TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS inv_history_org_idx ON inventory_history (org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS inv_history_inv_idx ON inventory_history (inventory_id)`);
    // Create index as ascending (no DESC) to match the Drizzle schema definition.
    // If it previously existed as DESC, drop and recreate it so Drizzle no longer
    // detects a diff and generates the same DROP+CREATE migration on every deploy.
    const { rowCount: descCount } = await client.query(`
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'inv_history_at_idx' AND indexdef LIKE '%DESC%'
      LIMIT 1
    `);
    if ((descCount ?? 0) > 0) {
      await client.query(`DROP INDEX IF EXISTS inv_history_at_idx`);
    }
    await client.query(`CREATE INDEX IF NOT EXISTS inv_history_at_idx ON inventory_history (changed_at)`);
    console.log('[Migration] Phase-80 (inventory_history table) complete.');

    // ── Phase-81: deduplicate picklist_items + unique index on order_detail_id ──
    // The race condition in the picklist GET handler could create multiple rows for
    // the same order_detail_id. Delete extras (keep most-progressed), then add the
    // unique index so onConflictDoNothing() actually prevents future duplicates.
    const { rowCount: dupeCount } = await client.query(`
      SELECT 1 FROM (
        SELECT order_detail_id, COUNT(*) AS cnt
        FROM picklist_items
        GROUP BY order_detail_id
        HAVING COUNT(*) > 1
      ) dups
      LIMIT 1
    `);
    if ((dupeCount ?? 0) > 0) {
      await client.query(`
        DELETE FROM picklist_items
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY order_detail_id
                     ORDER BY pulled DESC, created_at ASC
                   ) AS rn
            FROM picklist_items
          ) ranked
          WHERE rn > 1
        )
      `);
      console.log('[Migration] Phase-81 (picklist_items dedup) — removed duplicate rows.');
    }
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS picklist_items_order_detail_unique_idx
      ON picklist_items (order_detail_id)
    `);
    console.log('[Migration] Phase-81 (picklist_items unique index on order_detail_id) complete.');

    // ── Phase-82: inventory_sync_frequency + channel_sync_frequency columns ──────
    await client.query(`
      ALTER TABLE app_settings
        ADD COLUMN IF NOT EXISTS inventory_sync_frequency integer DEFAULT 24,
        ADD COLUMN IF NOT EXISTS channel_sync_frequency   integer DEFAULT 4
    `);
    console.log('[Migration] Phase-82 (inventory_sync_frequency + channel_sync_frequency) complete.');

    // ── Phase-83: platform sync-admin defaults + global pause + plan floors ──
    await client.query(`
      ALTER TABLE platform_settings
        ADD COLUMN IF NOT EXISTS default_inventory_freq_hours integer NOT NULL DEFAULT 24,
        ADD COLUMN IF NOT EXISTS default_orders_freq_mins      integer NOT NULL DEFAULT 30,
        ADD COLUMN IF NOT EXISTS default_channel_freq_hours    integer NOT NULL DEFAULT 4,
        ADD COLUMN IF NOT EXISTS global_sync_paused            boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS sync_floors_by_plan           jsonb
    `);
    console.log('[Migration] Phase-83 (platform sync-admin defaults + floors) complete.');

    // ── Phase-84: merge_detected_at on orders ─────────────────────────────────
    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS merge_detected_at timestamptz
    `);
    console.log('[Migration] Phase-84 (merge_detected_at on orders) complete.');

    // ── Phase-85: insurance_amount on orders ───────────────────────────────────
    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS insurance_amount DECIMAL(10,2)
    `);
    console.log('[Migration] Phase-85 (insurance_amount on orders) complete.');

    // ── Phase-86: backfill orgId on shipments from their linked orders ──────────
    const { rowCount: backfilledShipments } = await client.query(`
      UPDATE shipments s
      SET org_id = o.org_id
      FROM orders o
      WHERE s.order_id = o.id
        AND s.org_id IS NULL
    `);
    console.log(`[Migration] Phase-86 (backfill shipments.org_id) complete — ${backfilledShipments} rows updated.`);

    // ── Phase-87: backfill orgId on split orders that were created without one ──
    // A bug caused split orders (those with parent_order_id set) to be inserted
    // without inheriting the parent's org_id, making them invisible in all org-
    // scoped queries. Fix by copying org_id from the parent order.
    const { rowCount: backfilledSplitOrders } = await client.query(`
      UPDATE orders child
      SET org_id = parent.org_id
      FROM orders parent
      WHERE child.parent_order_id = parent.id
        AND child.org_id IS NULL
        AND parent.org_id IS NOT NULL
    `);
    console.log(`[Migration] Phase-87 (backfill orgId on split orders) complete — ${backfilledSplitOrders ?? 0} rows updated.`);

    // ── Phase-88: pricing_strategy_preset column on ie_strategies ────────────
    await client.query(`
      ALTER TABLE ie_strategies ADD COLUMN IF NOT EXISTS pricing_strategy_preset varchar(50)
    `);
    console.log('[Migration] Phase-88 (pricing_strategy_preset on ie_strategies) complete.');

    console.log('[Migration] Phase-89 (reset lot-count-backfilled sold_quantity / stock_quantity) — removed, skipped.');

    // Phase-90: Add is_public column to plan_configs and plans tables.
    // Private plans (is_public = false) can be assigned by an admin but are hidden from
    // the public pricing page and the self-serve subscription flow.
    await client.query(`ALTER TABLE plan_configs ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true`);
    await client.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true`);
    console.log('[Migration] Phase-90 (is_public column on plan_configs + plans) complete.');

    // Phase-91: Add feedback_prompt column to app_settings for custom AI feedback instructions.
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS feedback_prompt text`);
    console.log('[Migration] Phase-91 (feedback_prompt on app_settings) complete.');

    // Phase-92: Add "Buyer Feedback" L2 capability + L3 features to the capability tree.
    // Uses explicit WHERE NOT EXISTS with separate queries to avoid pg parameter type-inference issues.
    const existingBf = await client.query(
      `SELECT id FROM product_capabilities WHERE title = 'Buyer Feedback' AND level = 2 LIMIT 1`
    );
    if (existingBf.rows.length === 0) {
      const omL1 = await client.query(
        `SELECT id FROM product_capabilities WHERE title = 'Order Management' AND level = 1 LIMIT 1`
      );
      if (omL1.rows.length > 0) {
        await client.query(
          `INSERT INTO product_capabilities (title, level, parent_id, cap_status) VALUES ('Buyer Feedback', 2, $1, 'built')`,
          [omL1.rows[0].id]
        );
      }
    }
    const bfCapRow = await client.query(
      `SELECT id FROM product_capabilities WHERE title = 'Buyer Feedback' AND level = 2 LIMIT 1`
    );
    if (bfCapRow.rows.length > 0) {
      const bfParentId: number = bfCapRow.rows[0].id;
      const bfL3s = [
        ['AI-drafted feedback comments', 'built'],
        ['Custom prompt configuration', 'built'],
        ['BrickLink & BrickOwl channel posting', 'built'],
        ['Bulk send with partial success handling', 'built'],
        ['Feedback prompt in IE strategy onboarding', 'built'],
      ];
      for (const [title, status] of bfL3s) {
        const exists = await client.query(
          `SELECT 1 FROM product_capabilities WHERE title = $1 AND level = 3 AND parent_id = $2 LIMIT 1`,
          [title, bfParentId]
        );
        if (exists.rows.length === 0) {
          await client.query(
            `INSERT INTO product_capabilities (title, level, parent_id, cap_status) VALUES ($1, 3, $2, $3)`,
            [title, bfParentId, status]
          );
        }
      }
    }
    console.log('[Migration] Phase-92 (Buyer Feedback capability tree) complete.');

    // Phase-93: Recreate channel_sync_config with sync_item_types column.
    // The table accumulated 1600+ dropped attribute entries from previous schema iterations,
    // hitting PostgreSQL's hard 1600-attribute limit. We recreate it with a clean attribute table.
    // Guard: only run if sync_item_types is not already present.
    const cscCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'channel_sync_config' AND column_name = 'sync_item_types'
    `);
    if (cscCols.rows.length === 0) {
      await client.query(`
        CREATE TABLE channel_sync_config_new (
          id          serial PRIMARY KEY,
          org_id      varchar NOT NULL UNIQUE,
          sync_price            boolean NOT NULL DEFAULT true,
          sync_remarks          boolean NOT NULL DEFAULT true,
          sync_description      boolean NOT NULL DEFAULT true,
          sync_tier_price       boolean NOT NULL DEFAULT true,
          sync_sale_percent     boolean NOT NULL DEFAULT true,
          updated_at            timestamp NOT NULL DEFAULT now(),
          sync_bulk_qty         boolean NOT NULL DEFAULT true,
          sync_lot_weight       boolean NOT NULL DEFAULT true,
          sync_stockroom_modes  jsonb NOT NULL DEFAULT '{"A":"skip","B":"skip","C":"skip"}',
          sync_item_types       jsonb NOT NULL DEFAULT '{}'
        )
      `);
      await client.query(`
        INSERT INTO channel_sync_config_new
          (id, org_id, sync_price, sync_remarks, sync_description, sync_tier_price,
           sync_sale_percent, updated_at, sync_bulk_qty, sync_lot_weight, sync_stockroom_modes)
        SELECT
          id, org_id, sync_price, sync_remarks, sync_description, sync_tier_price,
          sync_sale_percent, updated_at, sync_bulk_qty, sync_lot_weight, sync_stockroom_modes
        FROM channel_sync_config
      `);
      // Advance the sequence past the highest copied id so future inserts don't collide
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('channel_sync_config_new', 'id'),
          COALESCE((SELECT MAX(id) FROM channel_sync_config_new), 1)
        )
      `);
      await client.query(`DROP TABLE channel_sync_config`);
      await client.query(`ALTER TABLE channel_sync_config_new RENAME TO channel_sync_config`);
      console.log('[Migration] Phase-93 (channel_sync_config recreated + sync_item_types added) complete.');
    } else {
      console.log('[Migration] Phase-93 (sync_item_types already present) — skipped.');
    }

    // Phase-94: User image library tables (user_images, lot_images, item_type_images)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_images (
        id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        varchar NOT NULL,
        storage_key   text    NOT NULL,
        scope         varchar NOT NULL DEFAULT 'user',
        source_channel varchar NOT NULL DEFAULT 'local',
        source_url    text,
        alt_text      text,
        width_px      integer,
        height_px     integer,
        file_size_kb  integer,
        created_at    timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS user_images_org_idx ON user_images(org_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lot_images (
        id               serial  PRIMARY KEY,
        org_id           varchar NOT NULL,
        bl_inventory_id  integer NOT NULL,
        image_id         varchar NOT NULL,
        position         integer NOT NULL DEFAULT 0,
        created_at       timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS lot_images_lot_idx ON lot_images(org_id, bl_inventory_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS lot_images_img_idx ON lot_images(image_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_type_images (
        id          serial  PRIMARY KEY,
        org_id      varchar NOT NULL,
        item_no     varchar NOT NULL,
        item_type   varchar NOT NULL,
        image_id    varchar NOT NULL,
        position    integer NOT NULL DEFAULT 0,
        created_at  timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS item_type_images_item_idx ON item_type_images(org_id, item_no, item_type)`);
    console.log('[Migration] Phase-94 (user_images + lot_images + item_type_images) complete.');

    // Phase-95: Add sync_price_floor column to channel_sync_config
    await client.query(`
      ALTER TABLE channel_sync_config
        ADD COLUMN IF NOT EXISTS sync_price_floor numeric
    `);
    console.log('[Migration] Phase-95 (sync_price_floor on channel_sync_config) complete.');

    // Phase-96: Bulk lots tables for the BundleTron tool
    await client.query(`
      CREATE TABLE IF NOT EXISTS bulk_lots (
        id          serial PRIMARY KEY,
        org_id      varchar NOT NULL,
        name        text NOT NULL,
        description text,
        bulk_type   text NOT NULL,
        unit_price  numeric(10,2),
        status      text NOT NULL DEFAULT 'draft',
        bo_lot_id   text,
        last_synced_at timestamp,
        sync_error  text,
        created_at  timestamp NOT NULL DEFAULT now(),
        updated_at  timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS bulk_lots_org_idx ON bulk_lots(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS bulk_lots_status_idx ON bulk_lots(org_id, status)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bulk_lot_items (
        id               serial PRIMARY KEY,
        bulk_lot_id      integer NOT NULL REFERENCES bulk_lots(id) ON DELETE CASCADE,
        bl_inventory_id  integer NOT NULL REFERENCES bl_inventory(id) ON DELETE CASCADE,
        quantity         integer NOT NULL DEFAULT 1,
        created_at       timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS bulk_lot_items_lot_idx ON bulk_lot_items(bulk_lot_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS bulk_lot_items_inv_idx ON bulk_lot_items(bl_inventory_id)`);
    console.log('[Migration] Phase-96 (bulk_lots + bulk_lot_items tables) complete.');

    // Phase-97: Add feedback_prompt to platform_settings (correct table — Phase-91 mistakenly
    // added it to app_settings instead). Uses IF NOT EXISTS so it is safe to re-run.
    await client.query(`ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS feedback_prompt text`);
    console.log('[Migration] Phase-97 (feedback_prompt on platform_settings) complete.');

    // Phase-98: Add sync_bulk_lots toggle to channel_sync_config.
    // Enables the Bulk Lots group in channel sync — when on, all active bulk lots are included in the sync run.
    await client.query(`ALTER TABLE channel_sync_config ADD COLUMN IF NOT EXISTS sync_bulk_lots boolean NOT NULL DEFAULT false`);
    console.log('[Migration] Phase-98 (sync_bulk_lots on channel_sync_config) complete.');

    // Phase-99: Add quantity and condition to bulk_lots.
    // quantity — how many copies of this bundle are for sale (channel-agnostic).
    // condition — 'N' (New) or 'U' (Used), required by all selling channels.
    await client.query(`ALTER TABLE bulk_lots ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1`);
    await client.query(`ALTER TABLE bulk_lots ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'U'`);
    console.log('[Migration] Phase-99 (quantity + condition on bulk_lots) complete.');

    // Phase-100: Add bo_boid to bulk_lots.
    // bo_boid — generated unique identifier used as the item reference when creating a BO listing.
    // The internal bulk lot ID is stored as external_id on the BO listing for cross-reference.
    await client.query(`ALTER TABLE bulk_lots ADD COLUMN IF NOT EXISTS bo_boid text`);
    console.log('[Migration] Phase-100 (bo_boid on bulk_lots) complete.');

    // Phase-101: Add sale readiness fields to bl_inventory (primarily for sets).
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS has_instructions boolean`);
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS has_box boolean`);
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS pct_complete integer`);
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS completeness_notes text`);
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS missing_pieces integer`);
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS missing_lots integer`);
    await client.query(`ALTER TABLE bl_inventory ADD COLUMN IF NOT EXISTS sale_location varchar(5)`);
    console.log('[Migration] Phase-101 (sale readiness fields on bl_inventory) complete.');

    // Phase-102: Store XML backups in the database for persistence across deploys.
    await client.query(`
      CREATE TABLE IF NOT EXISTS xml_backups (
        id         serial PRIMARY KEY,
        org_id     varchar NOT NULL,
        filename   varchar NOT NULL,
        content    text    NOT NULL,
        size_bytes integer NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS xml_backups_org_idx ON xml_backups (org_id)`);
    console.log('[Migration] Phase-102 (xml_backups table) complete.');

    // Phase-103: Add org_timezone column to app_settings for per-org timezone preference.
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS org_timezone TEXT DEFAULT 'America/Chicago'`);
    console.log('[Migration] Phase-103 (org_timezone on app_settings) complete.');

    // Phase-104: Add channel_key to channel_sync_config to support multiple channels per org.
    // Existing rows default to 'brickowl'. Old single-column unique on org_id is replaced
    // by a composite unique index on (org_id, channel_key).
    await client.query(`ALTER TABLE channel_sync_config ADD COLUMN IF NOT EXISTS channel_key varchar NOT NULL DEFAULT 'brickowl'`);
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        SELECT conname INTO cname FROM pg_constraint
          WHERE conrelid = 'channel_sync_config'::regclass AND contype = 'u'
            AND cardinality(conkey) = 1
            AND conkey[1] = (SELECT attnum FROM pg_attribute
                             WHERE attrelid = 'channel_sync_config'::regclass AND attname = 'org_id');
        IF cname IS NOT NULL THEN
          EXECUTE 'ALTER TABLE channel_sync_config DROP CONSTRAINT ' || quote_ident(cname);
        END IF;
      END $$
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS channel_sync_config_org_channel_unique ON channel_sync_config(org_id, channel_key)`);
    console.log('[Migration] Phase-104 (channel_key on channel_sync_config) complete.');

    // Phase-105: Migrate BrickOwl API key from app_settings → org_integrations.
    // BrickOwl credentials now live at the org level in org_integrations (same as eBay)
    // so they are never conflated with platform-level configuration.
    await client.query(`
      INSERT INTO org_integrations (org_id, channel, type, display_name, credentials, is_connected)
      SELECT
        a.id          AS org_id,
        'brickowl'    AS channel,
        'sales_channel' AS type,
        'BrickOwl'    AS display_name,
        jsonb_build_object('apiKey', a.brickowl_api_key) AS credentials,
        true          AS is_connected
      FROM app_settings a
      WHERE a.brickowl_api_key IS NOT NULL
        AND a.brickowl_api_key <> ''
        AND NOT EXISTS (
          SELECT 1 FROM org_integrations oi
          WHERE oi.org_id = a.id AND oi.channel = 'brickowl'
        )
    `);
    console.log('[Migration] Phase-105 (BrickOwl API key → org_integrations) complete.');

    // Phase-106: Migrate BrickLink credentials from app_settings → org_integrations.
    // BrickLink org credentials (inventory + order sync) now live in org_integrations
    // alongside BrickOwl and eBay. Platform-level BrickLink creds remain in platform_settings.
    await client.query(`
      INSERT INTO org_integrations (org_id, channel, type, display_name, credentials, is_connected)
      SELECT
        a.id            AS org_id,
        'bricklink'     AS channel,
        'data_source'   AS type,
        'BrickLink'     AS display_name,
        jsonb_build_object(
          'consumerKey',    a.bricklink_consumer_key,
          'consumerSecret', a.bricklink_consumer_secret,
          'tokenValue',     a.bricklink_token_value,
          'tokenSecret',    a.bricklink_token_secret
        )               AS credentials,
        true            AS is_connected
      FROM app_settings a
      WHERE a.bricklink_consumer_key IS NOT NULL
        AND a.bricklink_consumer_key <> ''
        AND NOT EXISTS (
          SELECT 1 FROM org_integrations oi
          WHERE oi.org_id = a.id AND oi.channel = 'bricklink'
        )
    `);
    console.log('[Migration] Phase-106 (BrickLink credentials → org_integrations) complete.');

    // Phase-107: Add ebay_notification_token to platform_settings for compliance endpoint.
    await client.query(`
      ALTER TABLE platform_settings
        ADD COLUMN IF NOT EXISTS ebay_notification_token text
    `);
    console.log('[Migration] Phase-107 (ebay_notification_token on platform_settings) complete.');

    // Phase-108: Add print configuration columns to app_settings.
    await client.query(`
      ALTER TABLE app_settings
        ADD COLUMN IF NOT EXISTS print_method        text    DEFAULT 'browser',
        ADD COLUMN IF NOT EXISTS label_printer_ip    text,
        ADD COLUMN IF NOT EXISTS label_printer_port  integer DEFAULT 9100,
        ADD COLUMN IF NOT EXISTS label_size          text    DEFAULT '4x6',
        ADD COLUMN IF NOT EXISTS print_setup_done    boolean DEFAULT false
    `);
    console.log('[Migration] Phase-108 (print configuration on app_settings) complete.');

    // Phase-109: Create wh_zones table and add zone_id to warehouse tables.
    await client.query(`
      CREATE TABLE IF NOT EXISTS wh_zones (
        id          SERIAL PRIMARY KEY,
        org_id      VARCHAR NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        depth       INTEGER NOT NULL DEFAULT 3,
        sort_order  INTEGER DEFAULT 0,
        aisle_format VARCHAR(20) DEFAULT 'numeric',
        shelf_format VARCHAR(20) DEFAULT 'alpha',
        bin_format   VARCHAR(20) DEFAULT 'numeric',
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS wh_zones_org_id_idx ON wh_zones(org_id);
      ALTER TABLE wh_aisles  ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES wh_zones(id) ON DELETE CASCADE;
      ALTER TABLE wh_shelves ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES wh_zones(id) ON DELETE CASCADE;
      ALTER TABLE wh_bins    ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES wh_zones(id) ON DELETE CASCADE;
    `);
    // Drop the old global unique constraint on wh_aisles.name if it still exists
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'wh_aisles_name_unique' AND conrelid = 'wh_aisles'::regclass
        ) THEN
          ALTER TABLE wh_aisles DROP CONSTRAINT wh_aisles_name_unique;
        END IF;
      END $$;
    `).catch(() => {}); // ignore if constraint name differs
    console.log('[Migration] Phase-109 (wh_zones table + zone_id columns) complete.');

    // Phase-110: For each org that has existing warehouse data, create a default
    // "Main Warehouse" zone and assign all existing aisles/shelves/bins to it.
    {
      const orgRows = await client.query(`
        SELECT DISTINCT org_id, (
          SELECT warehouse_depth FROM organizations WHERE id = wa.org_id LIMIT 1
        ) AS depth
        FROM (
          SELECT org_id FROM wh_aisles WHERE zone_id IS NULL
          UNION
          SELECT org_id FROM wh_shelves WHERE zone_id IS NULL
          UNION
          SELECT org_id FROM wh_bins WHERE zone_id IS NULL
        ) AS wa
        WHERE org_id IS NOT NULL
      `);
      for (const row of orgRows.rows) {
        const { org_id, depth } = row;
        const d = depth || 3;
        const af = d >= 3 ? 'numeric' : 'alpha';
        const sf = 'alpha';
        const bf = 'numeric';
        // Check if a default zone already exists for this org
        const existing = await client.query(
          `SELECT id FROM wh_zones WHERE org_id = $1 LIMIT 1`, [org_id]
        );
        let zoneId: number;
        if (existing.rows.length > 0) {
          zoneId = existing.rows[0].id;
        } else {
          const inserted = await client.query(
            `INSERT INTO wh_zones (org_id, name, description, depth, sort_order, aisle_format, shelf_format, bin_format)
             VALUES ($1, 'Main Warehouse', 'Default warehouse zone', $2, 0, $3, $4, $5)
             RETURNING id`,
            [org_id, d, af, sf, bf]
          );
          zoneId = inserted.rows[0].id;
        }
        // Assign all unzoned aisles, shelves, bins to this default zone
        await client.query(`UPDATE wh_aisles  SET zone_id = $1 WHERE org_id = $2 AND zone_id IS NULL`, [zoneId, org_id]);
        await client.query(`UPDATE wh_shelves SET zone_id = $1 WHERE org_id = $2 AND zone_id IS NULL`, [zoneId, org_id]);
        await client.query(`UPDATE wh_bins    SET zone_id = $1 WHERE org_id = $2 AND zone_id IS NULL`, [zoneId, org_id]);
      }
    }
    console.log('[Migration] Phase-110 (default zones for existing warehouse data) complete.');

    // Phase-111: Add EasyPost tracker columns to shipments
    await client.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracker_id TEXT`);
    await client.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_status TEXT`);
    await client.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_status_detail TEXT`);
    await client.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_updated_at TIMESTAMP`);
    console.log('[Migration] Phase-111 (EasyPost tracker columns on shipments) complete.');

    console.log('[Migration] Phase-112 (backfill delivered/voided tracking statuses) — removed, skipped.');

    // Phase-113: Marketing outreach log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_outreach (
        id SERIAL PRIMARY KEY,
        org_id VARCHAR NOT NULL,
        customer_username VARCHAR NOT NULL,
        customer_email VARCHAR,
        signal VARCHAR NOT NULL,
        channel VARCHAR NOT NULL,
        notes TEXT,
        logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
        attributed_order_id VARCHAR,
        attributed_revenue DECIMAL(10,2)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS marketing_outreach_org_idx ON marketing_outreach(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS marketing_outreach_customer_idx ON marketing_outreach(org_id, customer_username)`);
    console.log('[Migration] Phase-113 (marketing_outreach table) complete.');

    // Phase-114: Shipping weight defaults in app_settings
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_weight_mode TEXT DEFAULT 'none'`);
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_weight_plus_amount DECIMAL(10,2) DEFAULT 0`);
    console.log('[Migration] Phase-114 (shipping weight defaults) complete.');

    // Phase-115: Item packaging percentage for shipping weight defaults
    await client.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_weight_items_pct DECIMAL(10,2) DEFAULT 0`);
    console.log('[Migration] Phase-115 (default_weight_items_pct) complete.');

    // Phase-116: Rebrickable part-to-part relationships table
    await client.query(`
      CREATE TABLE IF NOT EXISTS part_relationships (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        rel_type TEXT NOT NULL,
        child_part_num TEXT NOT NULL,
        parent_part_num TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS part_rel_child_idx  ON part_relationships (child_part_num, rel_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS part_rel_parent_idx ON part_relationships (parent_part_num, rel_type)`);
    console.log('[Migration] Phase-116 (part_relationships table) complete.');

    // Phase-117: index inventory_locations.bin_id.
    // /warehouse/bins runs a correlated COUNT(*) WHERE bin_id = ? per bin row,
    // and /warehouse/lots filters by bin_id inside several subqueries. Without
    // this index, every read sequentially scans inventory_locations — which gets
    // worse the more lots are filed.
    await client.query(`CREATE INDEX IF NOT EXISTS inv_locations_bin_idx ON inventory_locations (bin_id)`);
    console.log('[Migration] Phase-117 (inventory_locations.bin_id index) complete.');

    console.log('[Migration] All startup migrations finished successfully.');

  } catch (err: any) {
    console.error('[Migration] Error during startup migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
