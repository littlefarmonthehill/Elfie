# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard for LEGO resellers, integrating with BrickLink, BrickOwl, and EasyPost. Its purpose is to enhance efficiency and profitability through real-time inventory management, order tracking, sales analytics, marketing insights, and an AI chat assistant (E.L.F.I.E.). The platform features a dark-mode, LEGO-inspired UI and a customer portal with a Jetsons-style retro-futuristic landing page, showroom, and community features, aiming to be a comprehensive solution for the LEGO reseller market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette and a 3-Tier Responsive Design System. It includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a dismissible notification system. E.L.F.I.E., the AI Assistant, features an animated mascot and retro-futuristic chat drawer theming. The UI incorporates layered sticky navigation controls and comprehensive scaling optimization for tablet and desktop views, maintaining a cohesive aesthetic with distinct gradient backgrounds for different sections.

**Public-Facing Customer Portal** (as of October 2025):
- **Routing:** `/showroom` is the default home page for all users (replaces previous landing page)
- **SharedPublicHeader:** Consistent navigation across Showroom, Deals, Events, and Community pages with:
  - Mobile-responsive single-row layout with horizontal scrolling support
  - Navigation order: Showroom, Deals, Events, Community
  - LEGO-themed color-coded tabs matching operations dashboard style: Showroom (lego-blue), Deals (lego-red), Events (lego-orange), Community (lego-green)
  - Rounded pill buttons with solid backgrounds for active tabs and semi-transparent backgrounds with hover states for inactive tabs
  - Larger font sizes (text-sm/base/lg) for better readability
  - Sticky top banner (logo, stats, cart/login) that stays frozen while navigation tabs scroll with page content
- **Spotify-Style Product Display:** Compact, high-density showroom inspired by Spotify's mobile UX:
  - Dense grids: 3-8 columns (mobile to desktop) showing 40+ products per section
  - Compact cards: 12px images in list view, tiny fonts (text-[10px]), minimal padding
  - Gallery view optimized for maximum product visibility
  - Product details: Simple comma-separated color list with small dots (w-2 h-2)
  - Simplified badges showing essential info only
  - Product detail dialog: Enhanced close button with white background, backdrop blur, larger icon (5x5), drop shadow, and proper spacing to prevent overlap with title
- **Content Strategy:** Showroom is a product showcase (not a shopping cart) emphasizing breadth and depth of inventory to drive traffic to BrickLink/BrickOwl stores

### Technical Implementations
-   **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS.
-   **Backend:** Express.js with TypeScript and Node.js.
-   **Database:** Drizzle ORM with Neon serverless PostgreSQL, including `pgvector`.
-   **API:** RESTful endpoints.
-   **Authentication:** Email/password system with bcrypt, passport-local, and PostgreSQL session storage, supporting multi-role access with role-based routing and Zod validation.
-   **Data Schema:** Comprehensive schema for users, inventory, orders, sync metadata, app settings, embeddings, BrickLink forum posts, warehouse management, picklists, sync issues, and shipping.
-   **SKU Standardization:** `order_details.sku` and `order_details.bricklink_inventory_id` are standardized to BrickLink inventory IDs for cross-platform data integrity, with automatic migration for historical BrickOwl orders.
-   **Shipping System:** Vendor-agnostic abstraction with EasyPost integration for label generation, tracking, and platform status synchronization.
-   **Service Worker & PWA:** Intelligent update system with auto-reload.

### Feature Specifications
-   **Data Flow & System Design:** BrickLink acts as the primary product catalog source. PlanetBrick manages inventory, synchronizes changes to BrickLink and BrickOwl, and adjusts inventory based on orders. A global sync lock prevents race conditions. The system includes a comprehensive sync pipeline for inventory, Rebrickable data, and AI embeddings.
-   **AI Assistant (E.L.F.I.E.):** Powered by OpenAI (GPT-4o-mini with optimized parameters), E.L.F.I.E. features step-by-step reasoning, conversation memory synthesis, and strategic insight generation. It operates with a multi-department architecture (Product, Orders, Marketing, Sales) for cross-departmental collaboration, emphasizing granular part-level analysis first, then category summaries. It uses advanced function calling with date awareness and tool chaining, and integrates historical data context without fabricating recent information. Tools include BrickLink catalog search, price guides, local inventory search, order analytics, category throughput, customer loyalty metrics, business customer lists, geographic sales analysis, set-part details, web search, and semantic search of BrickLink forums. It also includes clickable prompts for user interaction, image recognition via Brickognize API, and memory management using `localStorage` and a `conversations` table leveraging RAG with `pgvector` embeddings.
-   **Price-o-Matic:** Bulk pricing intelligence with caching. Every sync also appends an append-only snapshot to the `part_price_history` table (item_no, item_type, color_id, new_or_used, snapshot_date, stock/sold aggregates + p10/p25/p50/p75/p85/p95 percentiles from the full price_detail distribution). This builds a proprietary time-series price database beyond BrickLink's 6-month rolling cap. Indexed on (item_no, item_type, color_id, new_or_used, snapshot_date) for efficient time-series queries.
-   **Set-Part Relationships:** Integrates Rebrickable data to display LEGO set-part relationships.
-   **Dashboard Layout:** Default dashboard with notifications, plus dedicated Inventory, Orders, Sales, and Marketing dashboards.
-   **Customer Shopping Platform:** Mobile-first brand showcase at `/showroom` (default home page) featuring:
  - Spotify-inspired compact product cards with dense grid layouts
  - Part-number-based product grouping with simplified presentation
  - Category-based navigation with selected categories displayed as removable pills below filters (no scrolling needed)
  - Dual sales approach: external marketplace links (BrickLink/BrickOwl) for individual parts, internal cart reserved for future curated bundles
  - View modes: Gallery (dense grid) and List (compact rows)
  - Default state on first visit: New Items and Discounts toggles ON, no item type filter selected (shows all inventory), New Items displayed first
  - "Newly listed" items show last 10 products added (by dateCreated DESC), regardless of age
  - "Hot items" use 30-day order trending logic
-   **Notification System:** Dismissible, severity-grouped notification center for sync errors.
-   **Platform Sync:** Multi-platform inventory synchronization system with BrickLink as the source of truth, offering manual sync, real-time progress, and discrepancy detection.
-   **Picklist & Fulfillment:** Bin-level picking system and an order fulfillment system with actions for packing slips, shipping, and order splitting.
-   **Shipped Orders:** Customer support tool for searching and reprinting documents. Supports "Mark as Test Order" toggle (via Print dropdown) for shipped orders that have a refund and $0 net total — hides the order and customer from all dashboards and analytics.
-   **Order Sync Tester:** Dry-run tool for validating order sync logic.
-   **Sales Analytics:** Year-over-Year Sales Comparison, Platform Comparison Analysis, and Platform Performance Dashboard.
-   **AI Intelligence & Embeddings Management:** Settings for AI configuration, server-side background jobs for embedding generation (inventory, orders, order details, set-parts using `text-embedding-3-small`), and a semantic search testing interface. Includes analytical tools for inventory aging, margin analysis, SKU performance, and sales by category, with automatic re-embedding triggers.
-   **Automation & Scheduling:** Centralized controls for automated Inventory Sync, Price-o-Matic, Orders Sync, and BrickLink Forum Sync, with automatic purging of stale forum posts.
-   **Backup & Restore System:** Production-ready disaster recovery with manual and automatic restore options, including Neon PITR.
-   **Brickanalyzer (Brick Spotter 3000):** Multi-piece LEGO scanning tool accessible from the Inventory tab. Contour-based segmentation isolates individual pieces, then runs two recognition paths in parallel: (1) Brickognize API for part/fig classification, and (2) CLIP ViT-B/32 visual embedding against `scan_embeddings` pgvector table for visual similarity search (512-dim). CLIP embeddings are built from BrickLink CDN reference images (`/api/brickspotter/build-catalog`) and improve over time as confirmed scans are stored via `/api/brickspotter/confirm-embedding`. Results include `clipMatches[]` (itemNo, colorId, similarity) alongside Brickognize results. Each scan result is cross-referenced against live POM inventory for pricing. Data is ephemeral — stored temporarily in `brickanalyzer_scans` DB table and permanently deleted when the user dismisses or closes the scan. Python segment_service.py hosts CLIP at `/embed` and `/embed-url` endpoints; model warmed up at startup alongside SAM.

## Subscription Tier System

PlanetBrick is a multi-tenant SaaS with two subscription tiers:

### Foundation ($39/mo, $390/yr)
- BrickLink sync, full inventory management, PayPal/Stripe payment sync
- E.L.F.I.E. Search Mode only (no AI mode)
- 2 users, 1 year order history, 25 BrickSpotter scans/month, 1 automation rule
- No BrickOwl, no Price-o-Matic, EasyPost manual only

### Core ($99/mo, $990/yr)
- Everything in Foundation + BrickOwl sync, E.L.F.I.E. AI Mode, Price-o-Matic
- 5 users, full order history, unlimited BrickSpotter scans, unlimited automation rules
- EasyPost with automated rules, full data enrichment

### Infrastructure
- **shared/tierConfig.ts**: `TIER_CONFIG`, `getEffectiveLimits()`, `isFeatureEnabled()`, `checkLimit()` (nudge levels: none/warning/critical/blocked at 80%/90%/100%)
- **server/services/tierEnforcement.ts**: `checkBrickspotterLimit()`, `incrementBrickspotterScan()`, `checkSeatLimit()`, `checkAutomationLimit()`, `isFeatureAllowed()`
- **server/services/stripe.ts**: Lazy Stripe client (requires `STRIPE_SECRET_KEY`), `createCheckoutSession()`, `createPortalSession()`, `handleStripeWebhook()`
- **Billing routes**: `POST /api/billing/checkout`, `POST /api/billing/portal`, `GET /api/billing/status`, `POST /api/billing/webhook`
- **Platform admin routes** (superAdmin only): `GET /api/platform-admin/orgs`, `GET /api/platform-admin/stats`, `POST /api/admin/organizations/:id/plan`, `PATCH /api/admin/organizations/:id/overrides`
- **Schema additions**: `organizations.plan` ('foundation'|'core'), Stripe fields, `brickspotterScansThisMonth`, `brickspotterScansResetDate`, override columns; `users.superAdmin` boolean
- **Super admin panel**: `/platform-admin` page — accessible only if `user.superAdmin === true` (APPROVED_ADMINS in server/auth.ts auto-set to true)
- **Settings → Billing & Plan**: Usage meters (BrickSpotter, team seats), current plan, interval toggle, Upgrade/Manage buttons
- **Stripe env vars needed**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_FOUNDATION_MONTHLY_PRICE_ID`, `STRIPE_FOUNDATION_ANNUAL_PRICE_ID`, `STRIPE_CORE_MONTHLY_PRICE_ID`, `STRIPE_CORE_ANNUAL_PRICE_ID`

## External Dependencies

-   **BrickLink API:** LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** Multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Set-part relationship data.
-   **EasyPost API:** Multi-carrier shipping label generation, rate shopping, and tracking.
-   **Stripe API:** Restricted key (`rk_live_`) used to pull refund data. Refunds are automatically matched to orders by exact amount + date and stored as `order_adjustments` records. Runs as step 5 of the order sync scheduler. Currently has `Refunds: read` permission; needs `Balance: read` added to also pull merchant processing fees. Per-org Stripe key configurable via Settings → Payments; falls back to `STRIPE_SECRET_KEY` env var.

-   **Onboarding Wizard:** Full-screen multi-step overlay shown to new org owners who haven't completed setup (`organizations.onboarding_completed = false`). Steps: 1) Company info (name, address), 2) BrickLink credentials (skippable), 3) Payments / PayPal + Stripe (skippable), 4) Completion. Calls `PATCH /api/org {onboardingCompleted: true}` on finish. Non-admin approved users now routed to Home (routing fix in App.tsx). Setup action items appear in the GeneralDashboard after onboarding for any missing core integrations (BrickLink, PayPal, Stripe, address), each linking to the appropriate Settings section.
-   **PayPal Webhooks:** `POST /api/webhooks/paypal` receives `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED` events. Signature verified via `POST /v1/notifications/verify-webhook-signature`. `PAYPAL_WEBHOOK_ID` env var must be set to the webhook ID from the PayPal Developer Dashboard. Orders are matched first by `paypal_order_id` (stored on the order when T0006 fee sync detects reference type "ODR"), then by refund amount + date proximity. The `orders.paypal_order_id` column is populated automatically over time as sales are fee-synced.
-   **PayPal Capture Polling:** `POST /api/paypal/poll-captures` queries `GET /v2/payments/captures/{capture_id}` for every order with a stored `paypal_capture_id`. If status is `PARTIALLY_REFUNDED` or `REFUNDED`, follows HATEOAS links to get exact refund amounts and records them. Runs automatically after each order sync as a catch-up mechanism alongside webhooks. `paypal_capture_id` = T0006 `transaction_id` from Transaction Search API (same ID, different API surface). `paypal_order_id` = T0006 `paypal_reference_id` when reference type is "ODR".
-   **OpenAI API:** Powers E.L.F.I.E. (GPT-4o-mini for completions, `text-embedding-3-small` for embeddings).
-   **Brickognize API:** LEGO part image recognition.
-   **Neon:** Serverless PostgreSQL database with `pgvector` extension.