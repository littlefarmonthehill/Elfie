# E.L.F.I.E.

E.L.F.I.E. is a business operations and analytics SaaS platform for LEGO resellers, integrating with BrickLink, BrickOwl, and EasyPost to manage inventory, track orders, analyze sales, and provide marketing insights, including an AI chat assistant.

## Run & Operate

- **Run:** `npm start`
- **Build:** `npm run build`
- **Typecheck:** `npm run typecheck`
- **Codegen:** `npm run codegen`
- **DB Push:** `npm run db:push`
- **Required ENV Vars:**
    - `DATABASE_URL`
    - `BRICKLINK_CONSUMER_KEY`
    - `BRICKLINK_CONSUMER_SECRET`
    - `BRICKLINK_TOKEN_VALUE`
    - `BRICKLINK_TOKEN_SECRET`
    - `BRICKOWL_API_KEY`
    - `EASYPOST_API_KEY`
    - `EASYPOST_WEBHOOK_SECRET` (for real-time tracking updates via `/api/easypost/webhook`; must match the secret configured in EasyPost dashboard → Webhooks)
    - `OPENAI_API_KEY`
    - `STRIPE_SECRET_KEY`
    - `PAYPAL_CLIENT_ID`
    - `PAYPAL_SECRET`

## Stack

- **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS
- **Backend:** Express.js, Node.js, TypeScript
- **ORM:** Drizzle ORM
- **Database:** Neon serverless PostgreSQL with `pgvector`
- **Validation:** Zod
- **Authentication:** Email/password with bcrypt, passport-local, PostgreSQL session storage
- **Build Tool:** Vite

## Where things live

- **Frontend Source:** `client/src/`
- **Backend Source:** `server/`
- **Database Schema:** `shared/schema.ts`
- **API Routes:** `server/routes.ts` (monolithic, shared utilities in `server/routes/shared.ts`)
- **UI Constants:** `client/src/lib/constants.ts`
- **AI Tools Definitions:** `server/services/ai-tools.ts`
- **Channel Adapters Interface:** `server/services/channel-sync-interface.ts`
- **Provider Registry:** `server/services/provider-registry.ts`
- **Shipping Factory:** `server/services/shipping-factory.ts`
- **Image Store:** `server/services/image-store.ts`

## Architecture decisions

- **Unified UI/UX:** Single tabbed navigation and dashboard experience across all devices; no separate mobile/desktop layouts.
- **Settings Segregation:** Platform-wide settings in `platform_settings` table (`id='platform'`), and org-specific settings in `app_settings` (one row per organization).
- **Catalog/Inventory Split:** Shared catalog data (name, color, images) in `bl_catalog`, per-org commercial data (quantity, pricing) in `bl_inventory`.
- **Connector Registry:** `PROVIDER_REGISTRY` in `server/services/provider-registry.ts` is the single source of truth for all integrations, driving channel and shipping adapter instantiation.
- **Image Pipeline:** Three-layer persistent image store (in-memory cache → object storage → BrickLink CDN fallback) with automatic background processing (white-background removal, PNG conversion) for consistency across UI, PDF, and AI models.

## Product

- **Inventory Management:** Real-time inventory tracking, SKU standardization, cross-platform synchronization (BrickLink, BrickOwl, eBay).
- **Order Fulfillment:** Bin-level picklist, order tracking, and multi-carrier shipping label generation (EasyPost).
- **Sales Analytics:** Dashboards for Year-over-Year Sales Comparison, Platform Comparison, and Platform Performance.
- **AI Assistant (E.L.F.I.E.):** OpenAI-powered chat with step-by-step reasoning, conversation memory, and strategic insights using various tools (catalog search, price guides, inventory search, forum search, semantic search via `pgvector`).
- **Brickanalyzer (Brick Spotter 3000):** Multi-piece LEGO scanner with image recognition (Brickognize API) and CLIP visual embeddings for similarity search.
- **Pricing Intelligence:** Price-o-Matic for bulk pricing based on a proprietary time-series database and dynamic repricing scores.
- **Warehouse Management System:** Physical bin location tracking, QR/barcode scanning for filing and locating inventory, configurable zone depths and filing modes.
- **Product Management System (Admin):** Internal tools for Vision of Success, OKRs, Capabilities (Roadmap/Backlog), with traceability and feature voting.
- **Business Intelligence Engine:** Scheduled AI analysis generating org-specific insights from inventory, sales, pricing, market news, and forum data.
- **Agent Team:** Five specialized AI agents (Inventory, Pricing, Market, Orders, Customer) generating signals written to `business_insights`.
- **E.L.F.I.E. Live Support:** In-app escalation system for users to create support tickets, with admin tools for managing and replying to tickets.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

- **Multi-tenant DB performance:** All 19 tables with `orgId` columns have indexes; tenant-scoped queries require `orgId` for performance.
- **API Credential Security:** `GET /api/settings` and `POST /api/settings` mask secret fields with `first4····last4`; empty inputs do not overwrite saved keys.
- **E.L.F.I.E. API Usage Policy:** AI tools query local data first. BrickLink API calls for fresh data require explicit user consent due to API quota usage.
- **eBay Integration:** Requires user to opt-in to eBay Business Policies and creates a `MAIN_WAREHOUSE` merchant location.
- **Warehouse Filing Mode:** The `oneLotPerBin` setting (`true` for strict one-to-one, `false` for one-to-many) is visible in the warehouse UI and dictates how lots are assigned to bins.

## Pointers

- **Drizzle ORM Docs:** _Populate as you build_
- **Tailwind CSS Docs:** _Populate as you build_
- **Shadcn/ui Docs:** _Populate as you build_
- **TanStack Query Docs:** _Populate as you build_
- **Wouter Docs:** _Populate as you build_
- **OpenAI API Docs:** _Populate as you build_
- **BrickLink API Docs:** _Populate as you build_
- **BrickOwl API Docs:** _Populate as you build_
- **EasyPost API Docs:** _Populate as you build_
- **Rebrickable API Docs:** _Populate as you build_
- **Stripe API Docs:** _Populate as you build_
- **PayPal API Docs:** _Populate as you build_
- **pgvector Docs:** _Populate as you build_
- **Brickognize API:** _Populate as you build_