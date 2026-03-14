# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard designed for LEGO resellers. It integrates with BrickLink, BrickOwl, and EasyPost to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The platform aims to enhance efficiency and profitability for LEGO resellers and includes an AI chat assistant (E.L.F.I.E.). PlanetBrick also offers a customer portal with a retro-futuristic design, showroom, and community features, positioning itself as a comprehensive solution for the LEGO reseller market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette. The layout is unified across all screen sizes — a single tabbed navigation (DashboardNav) always visible, with the same dashboard experience on mobile and desktop (no cockpit/panel mode). The "Dashboard" tab is a clean Launchpad hub with headline metrics, urgent alerts, running jobs, and quick-action cards to jump to each section. Individual dashboards (Inventory, Orders, Sales, Marketing) are full-width tabbed views with responsive scaling. It includes drawer-based detail modals, a dismissible notification system, and E.L.F.I.E., the AI Assistant with animated mascot and retro-futuristic chat drawer theming. The public-facing customer portal features a Spotify-style product display for its showroom.

### Technical Implementations
The frontend is built with React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, and Tailwind CSS. The backend uses Express.js with TypeScript and Node.js. Data is managed with Drizzle ORM and Neon serverless PostgreSQL, including `pgvector`. Authentication is handled via an email/password system with bcrypt, passport-local, and PostgreSQL session storage, supporting multi-role access and Zod validation. The system employs a comprehensive data schema covering users, inventory, orders, and various operational metadata. SKU standardization ensures cross-platform data integrity, with BrickLink inventory IDs as the primary identifier. A vendor-agnostic shipping system integrates with EasyPost.

**Catalog/Inventory Split:** `bl_inventory` holds per-org commercial data only (id, itemNo, itemType, colorId, quantity, pricing, lot metadata, orgId). Shared catalog data (itemName, colorName, categoryId, blCatalogWeight, dimensions, imageUrl, thumbnailUrl) lives in `bl_catalog` (composite PK: itemNo+itemType+colorId, no orgId). All read paths JOIN bl_catalog; write paths upsert to bl_catalog. This means enrichment runs once per unique part, and all orgs share image/weight data automatically.

### Feature Specifications
PlanetBrick's core functionality revolves around BrickLink as the primary product catalog source, managing inventory, synchronizing changes to BrickLink and BrickOwl, and adjusting inventory based on orders with a global sync lock to prevent race conditions. The AI Assistant, E.L.F.I.E., is powered by OpenAI (GPT-4o-mini) and features step-by-step reasoning, conversation memory synthesis, and strategic insight generation using advanced function calling and tool chaining, integrating historical data context. Tools include BrickLink catalog search, price guides, local inventory search (with auto-aggregation for large result sets), order analytics, semantic inventory search via pgvector embeddings, and semantic search of BrickLink forums. Tool calls execute in parallel when possible (parallel_tool_calls: true). Price-o-Matic provides bulk pricing intelligence with a proprietary time-series price database. Rebrickable data is integrated for set-part relationships. The platform includes dedicated dashboards for Inventory, Orders, Sales, and Marketing, a comprehensive multi-platform inventory synchronization system, and a bin-level picklist and order fulfillment system. Sales analytics offer Year-over-Year Sales Comparison, Platform Comparison Analysis, and a Platform Performance Dashboard. AI intelligence and embeddings management include server-side background jobs for embedding generation using `text-embedding-3-small` and semantic search. Automation and scheduling controls are provided for inventory, pricing, orders, and BrickLink forum synchronization. A backup and restore system with Neon PITR ensures disaster recovery. The Brickanalyzer (Brick Spotter 3000) is a multi-piece LEGO scanning tool that uses contour-based segmentation, Brickognize API for classification, and CLIP visual embeddings for similarity search.

## External Dependencies

-   **BrickLink API:** For LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** For multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Used for LEGO set-part relationship data.
-   **EasyPost API:** For multi-carrier shipping label generation, rate shopping, and tracking.
-   **Stripe API:** For processing payments, managing subscriptions, and pulling refund data.
-   **PayPal Webhooks & Capture Polling:** For processing payment refunds and reversals, and syncing capture details.
-   **OpenAI API:** Powers E.L.F.I.E. (GPT-4o-mini completions + tool calling) and embeddings (`text-embedding-3-small`). Platform-wide key stored in `app_settings` under `id='platform'` (separate from any customer org). Elfie agent runs as a platform cost (orgId=null). Usage tracked locally in `ai_usage_log` table (not via OpenAI billing API). Per-org cost attribution via `org_id` column — tracks which org triggered each embedding call. Admin dashboard shows per-org breakdown at `/api/platform-admin/platform-services/openai-billing/by-org`. Replit Anthropic AI integration is installed but no longer used by the app.
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
- ChatInterface.tsx: removed unused lucide imports (ChevronUp, ChevronDown, X, Image, Bot), unused Dialog imports, unused useQuery/AppSettings imports, dead `groupedItems` computed variable, dead `elfieMode` state, dead `onBrickLinkClick` prop chain.
- ElfieCharacter.tsx: removed dead `isThinking` prop (and its entire chain: `elfieThinking` state in home.tsx, `onThinkingChange` prop in ChatInterface).
- ai-tools.ts: fixed misleading `search_bricklink_catalog` tool description — was "NOT in local inventory", now correctly says "local BrickLink catalog (bl_catalog table)".

### Debug Logging Cleaned
Removed ~30 debug `console.log` calls with emojis from routes.ts, ChatInterface.tsx, home.tsx, and SettingsModal.tsx. Retained legitimate `console.error` calls and operational diagnostics for the Brickanalyzer CV pipeline, CLIP embedding system, and Platform Sync.

## Platform Admin — Plans & Pricing

Plan configurations are stored in the `planConfigs` DB table (seeded once from `shared/tierConfig.ts` on first startup). Super admins can edit plan configs via the Platform Admin → Plans & Pricing section in the SettingsModal.

- **Enforcement**: `server/services/tierEnforcement.ts` reads limits/features from DB via `getPlanConfigByKey()` (5-min cache) instead of static config
- **Lock rule**: Once any org is on a plan, its config is read-only except for the `isSunset` toggle
- **Sunset**: Marks a plan so it cannot be offered to new signups; existing customers are unaffected
- **Plan service**: `server/services/planConfigService.ts` — `seedPlanConfigsIfEmpty()`, `getAllPlanConfigsWithCounts()`, `updatePlanConfig()`, `setPlanSunset()`
- **API routes**: `GET /api/platform-admin/plans`, `PATCH /api/platform-admin/plans/:planKey`, `PATCH /api/platform-admin/plans/:planKey/sunset`

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
- **UI**: Two vacuum buttons (flagged tables / all tables) + 8 individual purge buttons with row counts, located in SettingsModal Database tab

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

## Elfie Chat — Progressive Reveal & AI Overviews

- **Streaming reveal**: Character-level reveal at 3 chars/25ms, 80ms pause at newlines, 200ms pause before `###` headers. `StreamingMessage` wrapper progressively reveals content through `MessageContent`. Only the latest response streams; older messages render fully. Streaming flags are cleared when the chat is minimized to prevent background interval leaks. Messages use `messageId` for stable React keys and callback targeting.
- **AI article overviews**: Expanding an `InlineNewsCard` auto-triggers a call to `POST /api/ai/summarize` which uses `gpt-4o-mini` to generate a 1-2 sentence business-relevant overview. Results are cached in component state (no re-fetch on re-expand). Falls back to raw snippet on error.
- **Theme-based card assignment**: Market news articles are assigned to their best-fit theme using `themeMatchScore()` with expanded keyword maps (`THEME_KEYWORD_MAP`) covering retirement, pricing, releases, supply, investing, and market categories. Each article belongs to exactly one theme. Community Buzz section exclusively shows BrickLink forum posts — never news articles. "Impact on Your Inventory" section is suppressed (header, body text, bullets, and cards all skipped).
- **Forum cards**: All forum cards have expandable detail with AI analysis. Fallback text "Click to view discussion thread and AI analysis" shown when excerpt is missing.