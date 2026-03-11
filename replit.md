# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard designed for LEGO resellers. It integrates with BrickLink, BrickOwl, and EasyPost to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The platform aims to enhance efficiency and profitability for LEGO resellers and includes an AI chat assistant (E.L.F.I.E.). PlanetBrick also offers a customer portal with a retro-futuristic design, showroom, and community features, positioning itself as a comprehensive solution for the LEGO reseller market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette and a 3-Tier Responsive Design System. It includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a dismissible notification system. E.L.F.I.E., the AI Assistant, features an animated mascot and retro-futuristic chat drawer theming. The UI incorporates layered sticky navigation controls and comprehensive scaling optimization for tablet and desktop views, maintaining a cohesive aesthetic with distinct gradient backgrounds for different sections. The public-facing customer portal features a Spotify-style product display for its showroom, emphasizing dense grids and compact product cards for maximum product visibility.

### Technical Implementations
The frontend is built with React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, and Tailwind CSS. The backend uses Express.js with TypeScript and Node.js. Data is managed with Drizzle ORM and Neon serverless PostgreSQL, including `pgvector`. Authentication is handled via an email/password system with bcrypt, passport-local, and PostgreSQL session storage, supporting multi-role access and Zod validation. The system employs a comprehensive data schema covering users, inventory, orders, and various operational metadata. SKU standardization ensures cross-platform data integrity, with BrickLink inventory IDs as the primary identifier. A vendor-agnostic shipping system integrates with EasyPost.

**Catalog/Inventory Split:** `bl_inventory` holds per-org commercial data only (id, itemNo, itemType, colorId, quantity, pricing, lot metadata, orgId). Shared catalog data (itemName, colorName, categoryId, blCatalogWeight, dimensions, imageUrl, thumbnailUrl) lives in `bl_catalog` (composite PK: itemNo+itemType+colorId, no orgId). All read paths JOIN bl_catalog; write paths upsert to bl_catalog. This means enrichment runs once per unique part, and all orgs share image/weight data automatically.

### Feature Specifications
PlanetBrick's core functionality revolves around BrickLink as the primary product catalog source, managing inventory, synchronizing changes to BrickLink and BrickOwl, and adjusting inventory based on orders with a global sync lock to prevent race conditions. The AI Assistant, E.L.F.I.E., is powered by OpenAI (GPT-4o-mini) and features step-by-step reasoning, conversation memory synthesis, and strategic insight generation using advanced function calling and tool chaining, integrating historical data context. Tools include BrickLink catalog search, price guides, local inventory search, order analytics, and semantic search of BrickLink forums. Price-o-Matic provides bulk pricing intelligence with a proprietary time-series price database. Rebrickable data is integrated for set-part relationships. The platform includes dedicated dashboards for Inventory, Orders, Sales, and Marketing, a comprehensive multi-platform inventory synchronization system, and a bin-level picklist and order fulfillment system. Sales analytics offer Year-over-Year Sales Comparison, Platform Comparison Analysis, and a Platform Performance Dashboard. AI intelligence and embeddings management include server-side background jobs for embedding generation using `text-embedding-3-small` and semantic search. Automation and scheduling controls are provided for inventory, pricing, orders, and BrickLink forum synchronization. A backup and restore system with Neon PITR ensures disaster recovery. The Brickanalyzer (Brick Spotter 3000) is a multi-piece LEGO scanning tool that uses contour-based segmentation, Brickognize API for classification, and CLIP visual embeddings for similarity search.

## External Dependencies

-   **BrickLink API:** For LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** For multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Used for LEGO set-part relationship data.
-   **EasyPost API:** For multi-carrier shipping label generation, rate shopping, and tracking.
-   **Stripe API:** For processing payments, managing subscriptions, and pulling refund data.
-   **PayPal Webhooks & Capture Polling:** For processing payment refunds and reversals, and syncing capture details.
-   **OpenAI API:** Powers E.L.F.I.E. (GPT-4o-mini completions + tool calling) and embeddings (`text-embedding-3-small`). Platform-wide key stored in `app_settings` under `org_planetbrick`. Elfie agent runs as a platform cost (orgId=null). Usage tracked locally in `ai_usage_log` table (not via OpenAI billing API). Per-org cost attribution via `org_id` column — tracks which org triggered each embedding call. Admin dashboard shows per-org breakdown at `/api/platform-admin/platform-services/openai-billing/by-org`. Replit Anthropic AI integration is installed but no longer used by the app.
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

### Debug Logging Cleaned
Removed ~30 debug `console.log` calls with emojis from routes.ts, ChatInterface.tsx, home.tsx, and SettingsModal.tsx. Retained legitimate `console.error` calls and operational diagnostics for the Brickanalyzer CV pipeline, CLIP embedding system, and Platform Sync.

## Platform Admin — Plans & Pricing

Plan configurations are stored in the `planConfigs` DB table (seeded once from `shared/tierConfig.ts` on first startup). Super admins can edit plan configs via the Platform Admin → Plans & Pricing section in the SettingsModal.

- **Enforcement**: `server/services/tierEnforcement.ts` reads limits/features from DB via `getPlanConfigByKey()` (5-min cache) instead of static config
- **Lock rule**: Once any org is on a plan, its config is read-only except for the `isSunset` toggle
- **Sunset**: Marks a plan so it cannot be offered to new signups; existing customers are unaffected
- **Plan service**: `server/services/planConfigService.ts` — `seedPlanConfigsIfEmpty()`, `getAllPlanConfigsWithCounts()`, `updatePlanConfig()`, `setPlanSunset()`
- **API routes**: `GET /api/platform-admin/plans`, `PATCH /api/platform-admin/plans/:planKey`, `PATCH /api/platform-admin/plans/:planKey/sunset`

## System Health — Database Vacuum & Cleanup

The Database tab in System Health (super admin only) includes a **Vacuum & Cleanup Tools** panel:

- **Vacuum**: `POST /api/platform-admin/db-vacuum` — runs VACUUM ANALYZE on specified tables (validated table names via regex allowlist)
- **Cleanup**: `POST /api/platform-admin/db-cleanup` — purges stale rows from known targets with configurable age (0–3650 days, parameterized SQL)
- **Cleanup targets**: `bl_api_calls` (14d), `embedding_jobs` (7d), `restore_jobs` (7d), `sync_issues` (30d), `price_guide_cache` (30d), `sessions` (expired), `brickanalyzer_scans` (60d), `conversations` (90d), `universal_catalog_queue` (14d)
- **UI**: Two vacuum buttons (flagged tables / all tables) + 8 individual purge buttons with row counts, located in SettingsModal Database tab