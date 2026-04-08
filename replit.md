# E.L.F.I.E. — Electronic Lifeform For Intelligent Elements

## Overview
E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) is a business operations and analytics SaaS platform designed for LEGO resellers. It integrates with BrickLink, BrickOwl, and EasyPost to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The platform aims to enhance efficiency and profitability for LEGO resellers and includes an AI chat assistant (also named E.L.F.I.E.). The app also offers a customer portal with a retro-futuristic design, showroom, and community features, positioning itself as a comprehensive solution for the LEGO reseller market. Version 2.3.0.

**BrickSpotter-only plan support:** The platform supports a BrickSpotter-only subscription mode (`isBrickspotterOnly` on `plan_configs`). Users on such plans see only the BrickSpotter 3000 scanner — store management tabs, the DashboardNav, and the OnboardingWizard are hidden. A dedicated signup path ("Become a BrickSpotter 3000 Member") on the signup page routes new users to the first active BS-only plan. A `BrickSpotterWelcome` overlay shows once on first login (tracked via localStorage). New BS-only signups have `onboardingCompleted: true` and `tosAcceptedAt` set immediately at signup.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette. The layout is unified across all screen sizes — a single tabbed navigation (DashboardNav) always visible, with the same dashboard experience on mobile and desktop (no cockpit/panel mode). The "Dashboard" tab is a clean Launchpad hub with headline metrics, urgent alerts, running jobs, and quick-action cards to jump to each section. Individual dashboards (Inventory, Orders, Sales, Marketing) are full-width tabbed views with responsive scaling. It includes drawer-based detail modals, a dismissible notification system, and the E.L.F.I.E. AI Assistant with animated mascot and retro-futuristic chat drawer theming. The public-facing customer portal features a Spotify-style product display for its showroom.

### Technical Implementations
The frontend is built with React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, and Tailwind CSS. The backend uses Express.js with TypeScript and Node.js. Data is managed with Drizzle ORM and Neon serverless PostgreSQL, including `pgvector`. Authentication is handled via an email/password system with bcrypt, passport-local, and PostgreSQL session storage, supporting multi-role access and Zod validation. The system employs a comprehensive data schema covering users, inventory, orders, and various operational metadata. SKU standardization ensures cross-platform data integrity, with BrickLink inventory IDs as the primary identifier. A vendor-agnostic shipping system integrates with EasyPost.

**Settings Architecture (Two Tables):** `platform_settings` (single row, id=`'platform'`) holds all platform-wide configuration: OpenAI/Stripe credentials, platform branding, BrickLink API call ceiling (`bl_api_call_limit`), POM/catalog-detail/catalog-scan/universal-catalog/forum/market-news/business-intel/rebrickable scheduler toggles and their config, and `timezone`. `app_settings` (one row per org, id=orgId) holds org-level configuration: BrickLink/BrickOwl/EasyPost credentials, inventory/order/channel sync settings, POM pricing weights & tiers, LOM scores, `elfieMode`, org-scoped freshness days, and `rebrickableImageSyncEnabled`. Phase-73 moved 6 credential/branding cols to `platform_settings`; Phase-74 moved 27 enrichment/scheduler cols. All scheduler services (`catalog-detail-scheduler`, `universal-catalog-scheduler`, `bl-forum-scheduler`, `market-news-scheduler`, `business-intel-scheduler`, `rebrickable-sets-scheduler`, `pom-scheduler`, `catalog-scan-scheduler`) read from `platformSettings WHERE id='platform'`.

**User Image Management (Phase-94):** Operators can upload custom images for inventory lots and item types. Three new tables: `user_images` (central image library, scope='user'|'catalog'), `lot_images` (lot-specific overrides, highest priority), `item_type_images` (item-type defaults, fallback when no lot images). Processing pipeline: raw upload → Sharp resize (max 2000px longest edge, JPEG 85%, progressive) → object storage (`user-images/{orgId}/{uuid}.jpg`) → DB record. Images served auth-gated at `GET /api/user-images/:id/img` (no presigned URLs). InventoryDetail has a new IMAGES tab (5th tab, teal accent) with two sections: "THIS LOT" (lot-specific) and "ALL [itemNo] LOTS" (item-type defaults). Each section shows a thumbnail grid with delete-on-hover and an upload zone/add button. Images load lazily (only when the IMAGES tab is active). Service: `server/services/user-image-store.ts`. Routes: `POST /api/user-images/upload`, `GET /api/user-images/for-lot/:lotId`, `POST|DELETE /api/user-images/assign/lot|item-type`, `PUT /api/user-images/lot-reorder`, `DELETE /api/user-images/:id`.

**Inventory Change History (Phase-80):** `inventory_history` table records one row per changed field per event. Sources: `bricklink_sync` (BL sync detected a quantity/price/stockroom/remarks change), `order` (order arrival reduced qty), `order_restore` (cancellation/return restored qty). `server/services/inventory-history.ts` provides `recordInventoryChanges()` and `buildChanges()` helpers. BrickLink sync batches all changes and inserts them at the end of each update batch. Order adjustments do a SELECT before each update to capture before/after values. Exposed at `GET /api/inventory/history` (filterable by `source`, `inventoryId`; paginated). Surfaced in the Inventory Health panel as a "Change History" section (after health categories) with source filter chips, relative timestamps, old→new value display, and pagination.

**Connector Registry Architecture:** `server/services/provider-registry.ts` is the single source of truth for all integrations (channels + shipping). `PROVIDER_REGISTRY` contains metadata (name, type, status: live/beta/coming_soon, `credentialFields`) for every provider: BrickOwl (live), eBay (beta), Amazon (coming_soon), EasyPost (live), ShipStation (live), Pirateship (coming_soon). Helpers: `getAllProviders(type?)`, `getLiveProviders(type?)`, `getProviderDefinition(key)`. `GET /api/providers` returns the full catalogue. `GET /api/providers/active` enriches registry entries with the org's `orgIntegrations` connection status.

**Channel Adapter Interface:** `server/services/channel-sync-interface.ts` defines `IChannelSync` (`syncFromBrickLink(orgId, options)`, `testConnection()`). `BrickOwlChannelAdapter` in `brickowl-channel-adapter.ts` and `EbayChannelAdapter` in `ebay-channel-adapter.ts` implement this interface. `channel-factory.ts` provides `getChannelAdapter(channelKey)` — registered channels: `brickowl`, `bricklink`, `ebay`. To add more channels: create an adapter, add a case in the factory, add an entry in the registry.

**Universal Channel Order Sync (registry-driven):** A registry-based pattern for inbound order sync from any selling channel. Three files form the system: (1) `channel-order-sync-interface.ts` — `IChannelOrderSync` interface (`channelKey`, `label`, `marketplaceName`, `isConfigured(orgSettings)`, `syncOrders(settings, orgId, options, onProgress)`). (2) `channel-order-registry.ts` — `CHANNEL_ORDER_SYNCS: IChannelOrderSync[]` array with adapters for BrickLink, BrickOwl, and eBay. Adding a new channel = create an adapter + push to this array. (3) `order-sync-core.ts` and `order-sync-scheduler.ts` drive entirely from the registry — no hardcoded per-channel logic. The `OrderSyncResult` is `Record<string, ChannelSyncOutcome>` (also typed with named `bricklink`/`brickowl`/`ebay` fields for backward compat). Progress tracking is keyed by `channelKey`. The scheduler staggers each channel's first run by 30s to avoid lock contention. Channels whose credentials live in `org_integrations` (like eBay) return `isConfigured=true` always and handle the "not configured" case inside `syncOrders` with a graceful skip. All channels call `adjustInventoryForOrder` which: atomically claims the order (prevents double-deduction), reduces local BL stock, and triggers `syncMultipleItemsAcrossPlatforms` (which excludes the source channel from the push). Sync metadata IDs: `bricklink_orders`, `brickowl_orders`, `ebay_orders`.

**eBay Channel Integration (Beta):** `server/services/ebay.ts` implements BrickLink→eBay synchronization using the eBay Sell Inventory API. **Two listing models run in parallel:** (A) PART items use a **Variation Listing model** — Group key `GRP-{itemNo}-{condition}` (one eBay listing per part+condition), Variant SKU `VAR-{itemNo}-{colorId}-{condition}` (one per color). Groups are published via `POST /offer/publish_by_inventory_item_group`. Price is variant-specific (lowest BL price × uplift) so each color has its own price. Images per variant = color-specific catalog image. Group description includes a pricing disclaimer about color/condition variation. (B) Non-PART items (sets, minifigs, gear, etc.) use the existing **1:1 model** — SKU `BL-{blInventoryId}`. All offers include `merchantLocationKey: "MAIN_WAREHOUSE"`. (2) OAuth 2.0 with refresh token stored in `org_integrations` (channel='ebay'); access tokens cached in-memory. (3) Images resolved from Image Center (lot-level → item-type-level → catalog fallback); served via `/api/user-images/:key` proxy. (4) Cleanup phase: migrates old `BL-{lotId}` PART offers → withdraws them (replaced by variation model); withdraws groups with no active lots; withdraws non-PART offers filtered out by config. (5) eBay Business Policies required for publishing (user must opt-in at bizpolicy.ebay.com). Merchant location `MAIN_WAREHOUSE` (New York, NY) created. **eBay Order Ingest:** `server/services/ebay-order-sync.ts` implements inbound order sync via the eBay Sell Fulfillment API. Uses `lastmodifieddate:[{ISO}..]` filter for incremental sync (30-min lookback buffer). Status mapping: `cancelState=CANCELED`→cancelled, `FULFILLED`→completed, `NOT_STARTED|IN_PROGRESS`→paid. Order ID format: `ebay-{ebayOrderId}`. Sync metadata key: `ebay_orders`. Manual trigger: POST `/api/sync/ebay/orders`. Scheduled automatically — see Universal Channel Order Sync below.

**Shipping Factory:** `server/services/shipping-factory.ts` provides `getShippingProvider(orgId)` — reads `orgIntegrations` (type='shipping', isConnected=true) and dispatches to the right `IShippingVendor` implementation. Falls back to legacy `appSettings` EasyPost credentials if no integration row exists (backward compatible). All shipping label and address-validation routes use this factory — `easypost.ts` is no longer imported directly outside the factory and registry.

**Channel Lot Links (BL↔Channel Mapping):** `channel_lot_links` is the global, channel-agnostic mapping table linking BrickLink inventory lots (SOT) to their counterparts on any external channel. Composite PK: `(blInvId, orgId, channel)`. Supported channel values: `'brickowl'` (more to follow). Indexed for both forward lookup (BL inv ID → channel lot ID) and reverse (channel lot ID → BL inv ID). Populated/refreshed in three ways: (1) batch upsert after each channel sync run from the `taggedLotMap`; (2) immediately on lot adoption (pre-existing untagged BO lot claimed by a BL item); (3) on lot creation if the API returns the new `lot_id`. `cross-platform-sync.ts` queries this table first (single DB lookup per batch, no API call) and falls back to a live BO inventory fetch only for lots not yet in the table. `order_details.bo_lot_id` stores the BO lot_id at the time of purchase (point-in-time fact, not a live link — kept separate from `channel_lot_links`).

**Catalog/Inventory Split:** `bl_inventory` holds per-org commercial data only (id, itemNo, itemType, colorId, quantity, pricing, lot metadata, orgId). Shared catalog data (itemName, colorName, categoryId, blCatalogWeight, dimensions, imageUrl, thumbnailUrl) lives in `bl_catalog` (composite PK: itemNo+itemType+colorId, no orgId). All read paths JOIN bl_catalog; write paths upsert to bl_catalog. This means enrichment runs once per unique part, and all orgs share image/weight data automatically.

### Feature Specifications
E.L.F.I.E.'s core functionality revolves around BrickLink as the primary product catalog source, managing inventory, synchronizing changes to BrickLink and BrickOwl, and adjusting inventory based on orders with a global sync lock to prevent race conditions. The AI Assistant, E.L.F.I.E., is powered by OpenAI (GPT-4o-mini) and features step-by-step reasoning, conversation memory synthesis, and strategic insight generation using advanced function calling and tool chaining, integrating historical data context. Tools include BrickLink catalog search, price guides, local inventory search (with auto-aggregation for large result sets), order analytics, semantic inventory search via pgvector embeddings, and semantic search of BrickLink forums. Tool calls execute in parallel when possible (parallel_tool_calls: true). Price-o-Matic provides bulk pricing intelligence with a proprietary time-series price database. Rebrickable data is integrated for set-part relationships. The platform includes dedicated dashboards for Inventory, Orders, Sales, and Marketing, a comprehensive multi-platform inventory synchronization system, and a bin-level picklist and order fulfillment system. Sales analytics offer Year-over-Year Sales Comparison, Platform Comparison Analysis, and a Platform Performance Dashboard. AI intelligence and embeddings management include server-side background jobs for embedding generation using `text-embedding-3-small` and semantic search. Automation and scheduling controls are provided for inventory, pricing, orders, and BrickLink forum synchronization. A backup and restore system with Neon PITR ensures disaster recovery. The Brickanalyzer (Brick Spotter 3000) is a multi-piece LEGO scanning tool that uses contour-based segmentation, Brickognize API for classification, and CLIP visual embeddings for similarity search. **CLIP Fallback (E.L.F.I.E. detection):** After Brickognize identification, unrecognized crops (partNo === '') are automatically run through CLIP ViT-B/32 visual search against the catalog embeddings database. Matched pieces receive `detectionSource: 'elfie'` and show a purple Elfie robot badge on both the heatmap overlay (top-left corner of the crop box) and in the results card list. Concurrency is limited to 2 parallel CLIP calls to match Python service throughput. The feature is skipped during calibration scans and when no embeddings exist in the database.

## External Dependencies

-   **BrickLink API:** For LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** For multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Used for LEGO set-part relationship data.
-   **EasyPost API:** For multi-carrier shipping label generation, rate shopping, and tracking.
-   **Stripe API:** For processing payments, managing subscriptions, and pulling refund data.
-   **PayPal Webhooks & Capture Polling:** For processing payment refunds and reversals, and syncing capture details.
-   **OpenAI API:** Powers E.L.F.I.E. (GPT-4o-mini completions + tool calling) and embeddings (`text-embedding-3-small`). Platform-wide key stored in `platform_settings` (Phase-73 moved it from `app_settings`). Elfie agent runs as a platform cost (orgId=null). Usage tracked locally in `ai_usage_log` table (not via OpenAI billing API). Per-org cost attribution via `org_id` column — tracks which org triggered each embedding call. Admin dashboard shows per-org breakdown at `/api/platform-admin/platform-services/openai-billing/by-org`. Replit Anthropic AI integration is installed but no longer used by the app.
    - **Embedding Architecture (Two Levels):**
      - **Platform-level embeddings** (shared across all orgs): `bl_catalog` CLIP visual embeddings, inventory text embeddings (`inventory_embeddings`), Rebrickable set-part data, BrickLink forum embeddings (`bl_forum_embeddings`). These power cross-org catalog search, visual similarity (Brickanalyzer), and forum semantic search.
      - **Org-level embeddings** (scoped per org): Org inventory embeddings and order embeddings. These are org-specific and filtered by `org_id` in queries. `searchInventorySemantic()` and `searchOrders()` in `embeddings.ts` accept optional `orgId` parameter for tenant scoping.
    - **Elfie API Usage Policy (Local-First):** All Elfie AI tools query local data only (bl_catalog, price_guide_cache, inventory, orders). Zero BrickLink API calls by default. If data is missing or stale, Elfie informs the user and offers to fetch fresh data from BrickLink API — but only with explicit user consent since it uses their API quota.
-   **Brickognize API:** For LEGO part image recognition within the Brickanalyzer tool.
-   **Neon:** Serverless PostgreSQL database with the `pgvector` extension for vector embeddings.

## Performance & Code Quality Notes

### Database Indexes (Applied)
All 19 tables with `orgId` columns now have indexes. This is critical for multi-tenant query performance — without these, every tenant-scoped query was a full table scan. Composite indexes were added for high-frequency access patterns (e.g., `orgId + orderDate`, `orgId + status`).

### routes.ts Architecture Note
`server/routes.ts` is a single 11,200-line file containing all ~200 route handlers. It is kept as a monolith intentionally for now to minimize refactor risk. When splitting, the recommended approach is to create `server/routes/` domain files using Express Router, sharing utilities from `server/routes/shared.ts` (for `reqOrgId`, `getOrgSettings`, `decodeHtmlEntities`, `activeOrderStatusWhere`). A global error handler now exists at the bottom of `registerRoutes()` to catch any unhandled errors.

### Dashboard Stats Optimization
`GET /api/dashboard/stats` was previously 5 sequential queries. Now runs 2 parallel queries: one for `orders` (count + sum) and one for `blInventory` (count + qty + value). This is a ~60% reduction in round-trips for the most frequently loaded endpoint.

### Dead Code Removed
- `client/src/components/examples/` (9 files, ~40KB) — confirmed zero imports anywhere in the codebase.
- ChatInterface.tsx: removed unused lucide imports (ChevronUp, X, Image, Bot, UserPlus, Scan, DollarSign, ListChecks, PackageCheck, BarChart3, TrendingUp), unused Dialog/Input imports, unused useQuery/AppSettings imports, dead `groupedItems` computed variable, dead `elfieMode` state, dead `onBrickLinkClick` prop chain, dead `toolChestItems` array and render strip, dead `prompts` render section (toolbar replaced with 3 fixed pills). Dead `historyContext`/`recentHistory`/`conversationHistory` removed from `/api/chat` route (frontend sends full messages array; DB history injection caused duplication).
- ElfieCharacter.tsx: removed dead `isThinking` prop (and its entire chain: `elfieThinking` state in home.tsx, `onThinkingChange` prop in ChatInterface).
- ai-tools.ts: fixed misleading `search_bricklink_catalog` tool description — was "NOT in local inventory", now correctly says "local BrickLink catalog (bl_catalog table)".

### Shared Constants
`client/src/lib/constants.ts` centralizes repeated UI data: `CAPABILITY_STATUS_STYLES` (filter pill colors), `CAPABILITY_STATUS_LABELS`, `CAPABILITY_STATUS_DOT_COLORS` (roadmap dots), `TOS_SECTIONS` (13-section structured TOS array), and `TOS_LAST_UPDATED`. Used by SettingsModal (roadmap, backlog, legal) and OnboardingWizard (TOS).

### ErrorBoundary
`client/src/components/ErrorBoundary.tsx` — top-level React error boundary wrapping the entire app in `App.tsx`. Catches render errors and displays a recovery UI instead of a white screen.

### Debug Logging Cleaned
Removed ~30 debug `console.log` calls with emojis from routes.ts, ChatInterface.tsx, home.tsx, and SettingsModal.tsx. Retained legitimate `console.error` calls and operational diagnostics for the Brickanalyzer CV pipeline, CLIP embedding system, and Platform Sync.

## Platform Admin — Plans & Pricing (Pay As You Grow)

Pricing uses a single **Pay As You Grow** model instead of multiple tier plans. Stored in the `pricing_model` singleton table (Phase-37 migration, auto-seeded with defaults). Super admins configure it via Platform Admin → Plans & Pricing in SettingsModal.

- **Base price**: $39/mo flat (configurable). All features included — no feature gating per tier.
- **Overage bumps**: When a usage dimension exceeds its base threshold, +$5/mo bump per dimension.
- **Usage dimensions**: Inventory Lots (base 5k), Orders/mo (base 100), Connected Stores (base 2), AI Calls/mo (base 200), BrickSpotter Scans/mo (base 50). Each has configurable base allowance and bump increment.
- **Monthly cap**: Hard ceiling (default $99/mo) prevents runaway billing.
- **Unlimited seats**: No per-seat licensing.
- **Free trial**: Configurable trial period (default 14 days).
- **API routes**: `GET /api/platform-admin/pricing-model`, `PUT /api/platform-admin/pricing-model` (Zod-validated, superAdmin only)
- **Schema**: `shared/schema.ts` → `pricingModel` table. Type: `PricingModel`.
- **Legacy tier system**: `planConfigs` table and `shared/tierConfig.ts` still exist for backward compatibility with existing org assignments. `server/services/tierEnforcement.ts` reads limits/features from DB via `getPlanConfigByKey()` (5-min cache). The admin UI no longer exposes the old tier comparison grid.
- **Plan service**: `server/services/planConfigService.ts` — `seedPlanConfigsIfEmpty()`, `getAllPlanConfigsWithCounts()`, `updatePlanConfig()`, `setPlanSunset()`

## Platform vs Customer Org Architecture

Platform services and customer orgs are fully separated in `app_settings`:
- **Platform row** (`id='platform'`, `org_id='platform'`): Stores platform-wide settings — OpenAI API key, platform BrickLink credentials (used for catalog enrichment, Price-o-Matic, forum sync), and the configurable platform name. The constant `PLATFORM_ORG_ID` in `shared/schema.ts` is used throughout the codebase.
- **Customer org rows** (e.g., `id='org_planetbrick'`): Store org-specific settings — their own BrickLink API credentials for inventory/order syncs, PayPal credentials, shipping vendor configs, etc.
- **Platform schedulers** (universal-catalog, rebrickable, pom, catalog-detail, bl-forum) read settings from the platform row.
- **Org schedulers** (inventory-sync, order-sync, channel-sync) read settings from the org's own row. Org inventory sync is lean — just pulls inventory from BrickLink (1 API call) + XML backup. Categories, colors, embeddings, and rebrickable syncs are handled at the platform level.
- **Inventory Catalog Scan** (`catalog-scan-scheduler.ts`): Platform-level gap-finder that scans all `bl_inventory` rows, creates missing `bl_catalog` stubs, and counts stale detail / missing+stale price guides. Zero API calls — database scan only. Feeds work to Catalog Detail Completion and Market Price Guides. Live progress tracking via `getCatalogScanProgress()`.
- **Catalog Detail Completion** (`catalog-detail-scheduler.ts`): Platform-level job that refreshes BL categories (1 call), colors (1 call), then enriches individual catalog items missing detail or stale (1 call each). Settings: frequency, batch size, freshness days, zero-stock skip. Live progress tracking via `getCatalogDetailProgress()`.
- **API Budget Allocation** (`pomApiBudgetPct` default 70%, `catalogDetailApiBudgetPct` default 20% in `app_settings`): Each API-calling job computes its ceiling as `floor(blApiCallLimit * budgetPct / 100)`. Remaining 10% reserved for org-level syncs. Budget bar shown in Catalog Coverage dashboard; per-job % editable in expanded settings.
- **Migration Phase-10** copies platform-level credentials from `org_planetbrick` to the new `platform` row on first run.
- **Migration Phase-12** adds `pom_api_budget_pct` and `catalog_detail_api_budget_pct` columns to `app_settings`.
- **Migration Phase-13** adds repricing score weight and threshold columns: `pom_weight_ceiling/velocity/scarcity/undercut` (combined score weights, default 0.4/0.3/0.2/0.1), `pom_velocity_high/low` (demand velocity thresholds), `pom_scarcity_high/low` (market scarcity thresholds), `pom_undercut_high/low` (undercut ratio thresholds).

## Repricing Score System

Five on-the-fly scores are computed in `/api/priceomatic/insights` from `price_guide_cache` + `bl_inventory` data:

1. **Price Ceiling Ratio** = `sold_max_price / unit_price` (historical upside; >1 = room to raise)
2. **Demand Velocity** = `sold_total_lots / stock_total_lots` (demand vs supply turnover)
3. **Market Scarcity Index** = `1 / stock_total_lots` (fewer sellers = scarcer)
4. **Undercut Ratio** = `unit_price / stock_min_price` (>1 = being undercut by competitors)
5. **Combined Repricing Score** = weighted sum: `ceiling*w1 + velocity*w2 + scarcity*w3 + (1/undercut)*w4`

All weights and thresholds are user-configurable in Settings > Price-o-Matic > Scoring. Scores are never stored — computed fresh from the latest market data each time the dashboard loads.

## API Credential Security

`GET /api/settings` and `POST /api/settings` mask all secret fields (API keys, tokens, secrets) before returning them to the frontend. The `maskSettingsSecrets()` function in `routes.ts` replaces secret values with `first4····last4` format and adds `has_fieldName` boolean flags. The frontend uses these flags for connection status indicators and shows "Key saved — leave blank to keep" as placeholder text. Empty inputs on blur do NOT overwrite saved keys. The server-side guard strips any field containing `····` to prevent masked values from being persisted. Secret fields covered: openaiApiKey, bricklinkConsumerKey/Secret, bricklinkTokenValue/Secret, brickowlApiKey, easypostApiKey/TestApiKey, paypalClientId/Secret, stripeSecretKey, shipstationApiKey/Secret.

## System Health — Database Vacuum & Cleanup

The Database tab in System Health (super admin only) includes a **Vacuum & Cleanup Tools** panel:

- **Vacuum**: `POST /api/platform-admin/db-vacuum` — runs VACUUM ANALYZE on specified tables (validated table names via regex allowlist)
- **Cleanup**: `POST /api/platform-admin/db-cleanup` — purges stale rows from known targets with configurable age (0–3650 days, parameterized SQL)
- **Cleanup targets**: `bl_api_calls` (14d), `embedding_jobs` (7d), `restore_jobs` (7d), `sync_issues` (30d), `price_guide_cache` (30d), `sessions` (expired), `brickanalyzer_scans` (60d), `conversations` (90d), `universal_catalog_queue` (14d)
- **UI**: Two vacuum buttons (flagged tables / all tables) + 8 individual purge buttons with row counts, located in SettingsModal Audit Log > Platform > Database tab

### Settings Modal — Platform Admin Navigation
- **Product**: Vision of Success, OKRs, Roadmap, Backlog (product management tools)
- **Platform Health**: Overview only (sync jobs, embedding counts, system metrics)
- **Audit Log**: Two top-level tabs:
  - **Organization**: Per-org sync status overview (inventory, orders, BrickSpotter summaries)
  - **Platform**: Four sub-tabs:
    - **Enrichment**: 9-job overview (POM, Catalog Detail, CLIP, Inventory Scan, etc.)
    - **BrickLink**: API usage metrics, endpoint breakdown, org allocation schedule
    - **Logs**: Server warnings/errors with live refresh
    - **Database**: Table stats, vacuum/cleanup tools, purge actions
- **Data Enrichment**: Sidebar + scheduling content (catalog, embeddings, market tabs) — unchanged

## Market News — Data Enrichment

Scheduled web searches that fetch LEGO market news articles (retirements, pricing trends, collectible values, reseller insights) and embed them for AI semantic search alongside BrickLink forum posts.

- **Tables**: `market_news` (id, query, title, snippet, url, source, publishedAt, fetchedAt) + `market_news_embeddings` (articleId FK, 1536-dim vector, content)
- **Settings columns**: `market_news_sync_enabled` (bool, default false), `market_news_sync_frequency` (int, default 360 min), `market_news_queries` (text array, 5 default queries)
- **Migration**: Phase-20 in `server/db.ts`
- **Service**: `server/services/market-news-scraper.ts` — uses Brave search as primary (reliable), DuckDuckGo HTML as fallback. If Brave gets rate-limited (429/empty), `braveBlocked` flag routes all remaining queries through DDG. 3s delay between Brave queries, 2s for DDG. Functions: `fetchMarketNews`, `saveMarketNews` (upsert by URL), `generateMarketNewsEmbeddings`, `purgeStaleMarketNews` (6-month retention), `syncMarketNews` (orchestrator).
- **Scheduler**: `server/services/market-news-scheduler.ts` — follows forum scheduler pattern. Reads `marketNewsSyncEnabled`/`marketNewsSyncFrequency`/`marketNewsQueries` from platform `app_settings`. Uses `syncMetadata` id='market_news_sync'. Checks every 5 min, runs if frequency elapsed.
- **AI tool**: `search_market_news` in `ai-tools.ts` — vector similarity search over `market_news_embeddings` joined to `market_news`. Registered in `elfieTools` array and `executeToolCall` switch.
- **Trigger route**: `POST /api/platform-admin/scheduler/market_news_sync/trigger` (super admin)
- **UI**: Settings > Platform Scheduler > Market tab — two job cards: Forum Sync (existing) and Market News (new). Market News card has enabled toggle, frequency input, and editable search query list (add/remove/edit).

## Business Intelligence Engine

Scheduled background job that cross-references each org's inventory, sales, and pricing data against shared market news and forum data to generate org-specific actionable insights using AI analysis.

- **Table**: `business_insights` (id UUID, org_id, category, urgency, title, summary, details JSONB, source_type, source_ref, dismissed, expires_at, created_at, updated_at). Indexes on org_id, category, created_at.
- **Settings columns**: `business_intel_enabled` (bool, default false), `business_intel_frequency` (int, default 360 min) — on platform `app_settings` row.
- **Migration**: Phase-21 in `server/db.ts`
- **Service**: `server/services/business-intel-engine.ts` — `generateOrgInsights(orgId)` pulls top inventory (100 items), 30-day sales velocity (50 items), pricing gaps (50 items vs price_guide_cache), recent market news (20), forum topics (20). Builds analysis prompt and calls `gpt-4o-mini` (temperature 0.3). Parses JSON-per-line response into insight records. Deduplicates by title+orgId. Insights expire after 7 days. `purgeExpiredInsights()` also removes dismissed insights older than 3 days. `syncBusinessIntel()` orchestrates across all orgs.
- **Scheduler**: `server/services/business-intel-scheduler.ts` — follows standard pattern. Uses `syncMetadata` id='business_intel_sync'. Checks every 5 min, runs if frequency elapsed.
- **Insight categories**: `pricing` (price gaps), `acquisition` (items to stock), `risk` (declining items), `opportunity` (high-velocity/trending), `trend` (patterns)
- **Urgency levels**: `high`, `medium`, `low`
- **API routes**: `GET /api/business-intel` (org-scoped, returns non-dismissed insights), `POST /api/business-intel/:id/dismiss` (org-scoped)
- **Trigger route**: `POST /api/platform-admin/scheduler/business_intel_sync/trigger` (super admin)
- **Toggle route**: `POST /api/platform-admin/scheduler/business_intel_sync/toggle` (super admin) — maps to `businessIntelEnabled` column
- **UI (Settings)**: Platform Scheduler > Market tab — Business Intel job card below Market News. Enabled toggle, frequency input.
- **UI (Dashboard)**: Sales Dashboard > Business Intel drawer (cyan Radar button). Shows insight cards grouped by category with filter chips. Each card shows category icon, urgency badge, title, summary. Expandable detail shows affected items and price gap. Dismiss button per insight.

## Agent Team — Domain Background Intelligence Agents

Five specialized AI agents that run independently in the background, each owning a single domain. Their signals are written to `business_insights` table (tagged with `agent_id`) and can be retrieved by E.L.F.I.E. via the `get_agent_signals` tool call.

- **Schema**: `business_insights.agent_id` column (text, nullable) — added via startup fix `4a-fix-4` in `server/index.ts`. Existing rows with `agent_id IS NULL` are legacy general insights from `business-intel-engine.ts`.
- **Service**: `server/services/agent-team.ts`
  - **InventoryAgent** (`runInventoryAgent`): stock health, dead stock (qty>50, no 90d sales), reorder pressure (sold>20/90d, qty<5), capital concentration
  - **PricingAgent** (`runPricingAgent`): pricing gaps >20% vs market sold avg, POM decision patterns, repricing opportunities
  - **MarketAgent** (`runMarketAgent`): BrickLink forum hot topics, market news, high price spread items
  - **OrdersAgent** (`runOrdersAgent`): order velocity (30d vs prior 30d), channel breakdown, top SKUs
  - **CustomerAgent** (`runCustomerAgent`): top buyers, dormant high-value buyers (2+ orders, 90-180d inactive), new buyers
  - `upsertSignals()`: deduplicates by title+orgId+agentId, updates if exists, inserts if new. Signals expire after 12h.
  - `getAgentSignals(orgId, agentIds?, limit?)`: fetches non-dismissed, non-expired signals for E.L.F.I.E.
  - `runAllAgents(orgId)`: runs all 5 agents in parallel, returns per-agent signal counts
- **Scheduler**: `server/services/agent-team-scheduler.ts` — staggered starts after app boot to avoid API bursts
  - Inventory: runs at startup+5min, then every 6h
  - Pricing: startup+8min, every 6h
  - Market: startup+11min, every 8h
  - Orders: startup+14min, every 8h
  - Customer: startup+17min, every 12h
- **E.L.F.I.E. tool**: `get_agent_signals` in `server/services/ai-tools.ts` switch
  - Params: `agents` (array of agent IDs to filter, optional), `limit` (default 20, max 40)
  - Returns: `{ totalSignals, byAgent: { [agentId]: [ { urgency, category, title, summary, details, age } ] } }`
  - `_orgId` is injected automatically by `ai-agent.ts` from the request context
- **Registration**: `startAgentTeamSchedulers()` called in `server/index.ts` after `startBusinessIntelScheduler`

## Elfie Live Support / Escalation System

- **Feature gating**: `elfieLiveSupport` tier feature — Core + Flagship only. Controlled via `feature_elfie_live_support` column in `plan_configs`.
- **DB table**: `supportTickets` (id serial PK, orgId, userId, sessionId, status enum escalated/active/resolved, createdAt, updatedAt). Phase-25+ migration in `server/db.ts`.
- **User flow**: Escalate button (UserPlus icon) in ChatInterface appears after 3+ messages. Creates ticket via `POST /api/support/escalate`. Polling (`GET /api/support/messages?sessionId=&since=`) fetches new support/system messages every 5s. Ticket status shown inline (Headphones icon + status text). Button disabled while ticket is active/escalated; shows "Resolved" when done.
- **Admin flow**: Support Queue in SettingsModal (Platform Admin nav). Lists open/active tickets with org name, user email, message count, timestamps. Click to view full conversation. Reply textarea sends via `POST /api/platform-admin/support-queue/:id/reply`. Resolve button closes ticket. Badge shows open ticket count.
- **Message roles**: `support` role for admin replies (agent email stored in `context` field), `system` role for status change notifications. Both rendered distinctly in ChatInterface (green avatar for support, amber banner for system).
- **API routes**: `POST /api/support/escalate`, `GET /api/support/ticket-status`, `GET /api/support/messages` (user-facing). `GET /api/platform-admin/support-queue` (list), `GET /api/platform-admin/support-queue/:id/messages`, `POST /api/platform-admin/support-queue/:id/reply`, `POST /api/platform-admin/support-queue/:id/resolve`, `GET /api/platform-admin/support-queue/count`, `GET /api/platform-admin/support-queue/:id/history` (admin).

## Product Management System (Platform Admin)

Internal product management tools for the platform admin (superAdmin only). Located under the "Product" nav group in SettingsModal.

- **Tables**: `product_vision`, `product_okrs`, `product_key_results`, `product_roadmap_items`, `product_backlog_items`, `product_capabilities`. Migration Phase-28 (core tables), Phase-30 (vision_statement column + capabilities table), Phase-31 (capability status `cap_status` + backlog `capability_id` link) in `server/db.ts`.
- **Vision of Success**: Three-field form (whatChanges, howIFeel, whatPeopleSay) with auto-save on blur (no Save button). AI-generated vision statement via `POST /api/platform-admin/product/vision/generate` using GPT-4o-mini. Statement is editable and also auto-saves on blur. Single row, upserted.
- **OKRs**: Max 3 active objectives, each with up to 3 key results. Progress is manual 0-100%. Objectives can be archived/restored. Average KR progress shown per objective.
- **Capabilities**: Three-level hierarchy — L1 Capability → L2 Sub-capability → Features (level 3). Self-referencing `parent_id` column. Inline editing (click to edit, blur/Enter to save). Add items via inline inputs at each level. Each feature has a `cap_status` column (Drizzle field `status`) with values: `built`, `now`, `next`, `later`. Status badges are clickable to cycle through values. L2 status is derived from its children (worst-case: if any child is `now`, L2 shows `now`; if `next`, shows `next`; etc.). Summary counts shown at top of panel and per L1.
- **Roadmap**: Items in 4 lanes: `now`, `next`, `later`, `done`. Each item can optionally link to an active OKR for strategic alignment. Move between lanes with one click.
- **Backlog**: Individual work items with priority (high/medium/low), effort (S/M/L), status (open/in-progress/done). Each item can link to an L2 capability via `capability_id` and optionally to a roadmap item. L2 capability picker shown in add form and inline on each item row. Sorted by priority order. Filterable by status.
- **API routes**: All under `/api/platform-admin/product/*` — `GET/PUT /vision`, `POST /vision/generate`, `GET/POST /okrs`, `PATCH/DELETE /okrs/:id`, `POST /key-results`, `PATCH/DELETE /key-results/:id`, `GET/POST /capabilities`, `PATCH/DELETE /capabilities/:id`, `GET/POST /roadmap`, `PATCH/DELETE /roadmap/:id`, `GET/POST /backlog`, `PATCH/DELETE /backlog/:id`.
- **Traceability chain**: Vision → OKRs → Capabilities → Roadmap → Backlog. Each level can reference its parent for end-to-end alignment. Backlog items link to L2 capabilities; features have status badges showing build state or roadmap lane.

## Elfie Chat — Conversation History

ChatGPT-style conversation management with thread persistence and auto-expiry.

- **Table**: `conversation_threads` (id, session_id UNIQUE, org_id, title, created_at, updated_at). Migration Phase-34.
- **Thread lifecycle**: Threads are auto-created when first message is saved in `/api/chat`. Title auto-generated via GPT-4o-mini from first user messages (3-6 word summary). Falls back to first 40 chars if AI unavailable.
- **Auto-expiry**: If 24+ hours have passed since last activity (tracked in `localStorage` as `elfie-last-activity`), a new session is auto-started on next visit.
- **UI**: Header has "+" (new chat) and clock (history) buttons. History opens an overlay panel listing past threads sorted by most recent, with date/time stamps. Current thread is highlighted. Delete button (trash icon) appears on hover per thread. "New Conversation" button at bottom.
- **Context window**: Last 20 messages sent to AI per request (`.slice(-20)`), preventing unbounded token usage in long conversations.
- **API routes**: `GET /api/conversations/threads` (list, limit 50), `POST /api/conversations/threads` (create/ensure), `PATCH /api/conversations/threads/:sessionId/title`, `DELETE /api/conversations/threads/:sessionId` (deletes thread + messages), `POST /api/conversations/threads/:sessionId/generate-title` (AI title generation).

## Elfie Chat — Feature Requests & Toolbar

- **Feature Request Mode**: Users click "Feature Request" in the chat toolbar to enter feature request mode. They describe a feature; Elfie AI rephrases it for clarity via `POST /api/feature-request/rephrase`. A green "Submit" button appears in the toolbar for confirmation. On submit, it's saved as a level-3 capability with `status='new'` via `POST /api/feature-request/submit`, auto-classified into the best-matching L2 capability.
- **Chat toolbar** (below title): Three pills — "Agent Request" (escalation), "Idea/Request" (enters feature request mode), "View Roadmap" (opens public roadmap drawer).
- **Public Roadmap drawer**: Overlay in chat showing all L3 capability features with status filters (All/New/Now/Next/Later/Built). Each feature tile shows title, description, status badge, L2 category, vote count, and a thumbs-up vote toggle. Features sorted by vote count (highest first). One vote per user per feature (toggle on/off).
- **Feature Voting**: `feature_votes` table (id, capability_id, user_id, org_id, created_at) with unique constraint on (capability_id, user_id). Migration Phase-35. Toggle vote via `POST /api/feature-votes/:capabilityId`. Vote counts shown on admin Roadmap and Backlog panels via `GET /api/feature-votes/counts`. Public roadmap via `GET /api/public-roadmap?status=all|new|now|next|later|built`.
- **Support ticket status**: Shown inline above the input area when a ticket is active/escalated.

## Terms of Service

- **Onboarding**: Step 1 (Company Info) includes a required "I agree to the Terms of Service" checkbox. Users can expand/collapse the full TOS inline before accepting. The Continue button is disabled until TOS is accepted. Acceptance timestamp saved as `tosAcceptedAt` on the organization record.
- **Settings**: Full TOS text displayed inline in the "Legal & Terms" section (last item in company settings). Shows acceptance date if TOS was accepted, or a notice if not yet formally accepted.
- **Schema**: `tos_accepted_at` column on `organizations` table. Migration Phase-36.
- **Content**: 13-section Terms covering acceptance, description, accounts, acceptable use, data & privacy, third-party integrations, subscription & billing, AI disclaimer, catalog images, limitation of liability, termination, changes, and contact.

## Elfie Chat — Progressive Reveal & AI Overviews

- **Streaming reveal**: Character-level reveal at 3 chars/25ms, 80ms pause at newlines, 200ms pause before `###` headers. `StreamingMessage` wrapper progressively reveals content through `MessageContent`. Only the latest response streams; older messages render fully. Streaming flags are cleared when the chat is minimized to prevent background interval leaks. Messages use `messageId` for stable React keys and callback targeting.
- **AI article overviews**: Expanding an `InlineNewsCard` auto-triggers a call to `POST /api/ai/summarize` which uses `gpt-4o-mini` to generate a 1-2 sentence business-relevant overview. Results are cached in component state (no re-fetch on re-expand). Falls back to raw snippet on error.
- **Theme-based card assignment**: Market news articles are assigned to their best-fit theme using `themeMatchScore()` with expanded keyword maps (`THEME_KEYWORD_MAP`) covering retirement, pricing, releases, supply, investing, and market categories. Each article belongs to exactly one theme. Community Buzz section exclusively shows BrickLink forum posts — never news articles. "Impact on Your Inventory" section is suppressed (header, body text, bullets, and cards all skipped).
- **Forum cards**: All forum cards have expandable detail with AI analysis. Fallback text "Click to view discussion thread and AI analysis" shown when excerpt is missing.

## Part Images — Source & Pipeline

### Three-layer persistent image store (`server/services/image-store.ts`)
Every image consumer goes through the same pipeline — UI, PDF, CLIP catalog, BrickSpotter:

| Layer | What | Lifetime |
|---|---|---|
| L1 | In-memory Map cache (500 entries, 24 h TTL) | Process lifetime |
| L2 | Replit Object Storage (processed PNG, white-bg removed) | Permanent |
| L3 | BrickLink CDN (canonical URL fetched once, promoted to L2) | Fallback only |

`getOrFetchImage(itemType, itemNo, colorId)` checks L1 → L2 → L3. On a L3 hit it processes the image (removes white background via `sharp`) and promotes to L2 asynchronously, updating `bl_catalog.stored_image_key`.

### `bl_catalog` image columns (as of March 2026)
- **`image_url`**: populated for all P/PART/MINIFIG/SET/GEAR rows after Phase-57 migration with canonical BL CDN URL `https://img.bricklink.com/ItemImage/{code}/{colorId}/{itemNo}.png`
- **`stored_image_key`**: object-storage key for the permanent processed PNG (null = not yet stored, populated on first fetch via image store). Added in Phase-58.
- **`thumbnail_url`**: same as `image_url` (kept for legacy compatibility)

### Canonical BrickLink CDN URL patterns
- Parts: `https://img.bricklink.com/ItemImage/PN/{colorId}/{itemNo}.png`
- Minifigs: `https://img.bricklink.com/ItemImage/MN/0/{itemNo}.png`
- Sets: `https://img.bricklink.com/ItemImage/SN/0/{itemNo}.png`
- Gear: `https://img.bricklink.com/ItemImage/GN/0/{itemNo}.png`
- **NEVER use** the old `//img.bricklink.com/P/{colorId}/{itemNo}.jpg` pattern (legacy, protocol-relative)

### On-screen images (`PartImage` component)
`client/src/components/PartImage.tsx` uses `partImageSources()` from `client/src/lib/part-image.ts`:
1. `/api/images/parts/:partNum/:colorId` — server proxy → image store (object storage → CDN → processed PNG)
2. DB `imageUrl` (proxied if Rebrickable, direct if BrickLink) — secondary
3. `https://img.bricklink.com/ItemImage/PN/{colorId}/{partNum}.png` — direct CDN fallback
4. `https://img.bricklink.com/PL/{partNum}.jpg` — legacy last resort

### PDF / print images (`PackingSlip.tsx`)
Uses `/api/images/parts/:partNum/:colorId` — same server proxy as #1 above. BrickLink CDN cannot be used directly in a canvas context (no CORS headers → `canvas.toDataURL()` throws SecurityError). The proxy returns a same-origin PNG processed through the image store.

### CLIP catalog worker (`universal-clip-catalog.ts`)
Replaced `embedUrl(url)` (Flask downloads from CDN directly) with `getOrFetchImage()` + `embedCrop(buffer)`. CLIP now trains on the same processed PNG bytes stored in object storage — identical to what the PDF renders.

### BrickSpotter confirm-embedding fallback (`routes.ts`)
When the scan crop is no longer in memory, falls back to `getOrFetchImage()` + `embedCrop()` instead of `embedUrl(cdnUrl)`. Consistent with CLIP catalog bytes.

### Scheduler hooks
- **Catalog Detail Scheduler**: calls `enqueueImageStore()` after each BL API item enrichment
- **Rebrickable Images**: calls `enqueueImageStore()` after writing each Rebrickable URL to `bl_catalog`
- Images accumulate in object storage passively as enrichment jobs run

### Background image harvester (`startImageHarvester` in `image-store.ts`)
Proactive background walker that runs on boot alongside all other schedulers:
- Queries `bl_catalog WHERE stored_image_key IS NULL AND image_fetch_failed IS NOT TRUE AND item_type IN ('P','PART','MINIFIG','SET','GEAR')` in batches of 20
- Rate-limited to 2 req/sec (500 ms between requests) to avoid hammering BrickLink CDN
- On CDN 404: sets `image_fetch_failed = true` — row permanently skipped on future sweeps (Phase-59 column)
- On success: promotes to object storage, sets `stored_image_key`, clears `image_fetch_failed`
- Between full sweeps: 60-second pause; logs stored/failed counts per sweep
- Idempotent: `_harvesterRunning` guard prevents duplicate instances on re-import