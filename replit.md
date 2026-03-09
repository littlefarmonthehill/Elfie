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

### Feature Specifications
PlanetBrick's core functionality revolves around BrickLink as the primary product catalog source, managing inventory, synchronizing changes to BrickLink and BrickOwl, and adjusting inventory based on orders with a global sync lock to prevent race conditions. The AI Assistant, E.L.F.I.E., is powered by OpenAI (GPT-4o-mini) and features step-by-step reasoning, conversation memory synthesis, and strategic insight generation using advanced function calling and tool chaining, integrating historical data context. Tools include BrickLink catalog search, price guides, local inventory search, order analytics, and semantic search of BrickLink forums. Price-o-Matic provides bulk pricing intelligence with a proprietary time-series price database. Rebrickable data is integrated for set-part relationships. The platform includes dedicated dashboards for Inventory, Orders, Sales, and Marketing, a comprehensive multi-platform inventory synchronization system, and a bin-level picklist and order fulfillment system. Sales analytics offer Year-over-Year Sales Comparison, Platform Comparison Analysis, and a Platform Performance Dashboard. AI intelligence and embeddings management include server-side background jobs for embedding generation using `text-embedding-3-small` and semantic search. Automation and scheduling controls are provided for inventory, pricing, orders, and BrickLink forum synchronization. A backup and restore system with Neon PITR ensures disaster recovery. The Brickanalyzer (Brick Spotter 3000) is a multi-piece LEGO scanning tool that uses contour-based segmentation, Brickognize API for classification, and CLIP visual embeddings for similarity search.

## External Dependencies

-   **BrickLink API:** For LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** For multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Used for LEGO set-part relationship data.
-   **EasyPost API:** For multi-carrier shipping label generation, rate shopping, and tracking.
-   **Stripe API:** For processing payments, managing subscriptions, and pulling refund data.
-   **PayPal Webhooks & Capture Polling:** For processing payment refunds and reversals, and syncing capture details.
-   **OpenAI API:** Powers E.L.F.I.E. for completions (GPT-4o-mini) and embeddings (`text-embedding-3-small`).
-   **Brickognize API:** For LEGO part image recognition within the Brickanalyzer tool.
-   **Neon:** Serverless PostgreSQL database with the `pgvector` extension for vector embeddings.

## Platform Admin — Plans & Pricing

Plan configurations are stored in the `planConfigs` DB table (seeded once from `shared/tierConfig.ts` on first startup). Super admins can edit plan configs via the Platform Admin → Plans & Pricing section in the SettingsModal.

- **Enforcement**: `server/services/tierEnforcement.ts` reads limits/features from DB via `getPlanConfigByKey()` (5-min cache) instead of static config
- **Lock rule**: Once any org is on a plan, its config is read-only except for the `isSunset` toggle
- **Sunset**: Marks a plan so it cannot be offered to new signups; existing customers are unaffected
- **Plan service**: `server/services/planConfigService.ts` — `seedPlanConfigsIfEmpty()`, `getAllPlanConfigsWithCounts()`, `updatePlanConfig()`, `setPlanSunset()`
- **API routes**: `GET /api/platform-admin/plans`, `PATCH /api/platform-admin/plans/:planKey`, `PATCH /api/platform-admin/plans/:planKey/sunset`