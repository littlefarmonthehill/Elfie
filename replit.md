# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard for LEGO resellers, integrating with BrickLink, BrickOwl, and EasyPost. Its core purpose is to enhance efficiency and profitability through real-time inventory management, order tracking, sales analytics, marketing insights, and an AI chat assistant (E.L.F.I.E.). The platform features a dark-mode, LEGO-inspired user interface. A recent strategic expansion includes a customer-facing shopping platform at `/shop` on the PlanetBrick.com domain, complementing existing sales channels with a custom storefront for enhanced control and cost savings.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette and a 3-Tier Responsive Design System. It includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a dismissible notification system. E.L.F.I.E., the AI Assistant, features an animated mascot and retro-futuristic chat drawer theming, displaying AI-generated text and supplementary data. The UI incorporates layered sticky navigation controls and comprehensive scaling optimization for tablet and desktop views, maintaining a cohesive aesthetic with distinct gradient backgrounds for different sections. A streamlined Settings modal includes cache management and version display.

### Technical Implementations
-   **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS.
-   **Backend:** Express.js with TypeScript and Node.js.
-   **Database:** Drizzle ORM with Neon serverless PostgreSQL, including `pgvector`.
-   **API:** RESTful endpoints.
-   **Authentication:** Email/password system with bcrypt, passport-local, and PostgreSQL session storage. It supports a multi-role system ('customer', 'employee', 'admin') with role-based routing and secure session management, including Zod validation and password change functionality. Authentication pages feature consistent PlanetBrick branding and mobile optimization.
-   **Data Schema:** Comprehensive schema for users, inventory, orders, sync metadata, app settings, embeddings, BrickLink forum posts, warehouse management, picklists, sync issues, and shipping.
-   **Order Status & Inventory Automation:** Centralized configuration for platform-specific order statuses and automated inventory adjustments.
-   **Shipping System:** Vendor-agnostic abstraction with EasyPost integration for label generation, tracking, and platform status synchronization.
-   **Service Worker & PWA:** Intelligent update system with auto-reload that respects user activity.

### Feature Specifications
-   **Data Flow & System Design:** BrickLink serves as the primary product catalog source. PlanetBrick manages inventory, synchronizes changes to BrickLink and BrickOwl, and adjusts inventory based on orders. A global sync lock prevents race conditions. The system includes a comprehensive sync pipeline for inventory, Rebrickable data, and AI embeddings.
-   **AI Assistant (E.L.F.I.E.):** Powered by OpenAI (GPT-4o-mini), E.L.F.I.E. uses advanced function calling with date awareness and an agent loop architecture. Tools include searching BrickLink catalog, fetching price guides, local inventory search, order analytics, set-part details, web search for market trends, and semantic search of BrickLink forums. It integrates image recognition via Brickognize API and uses `localStorage` and a `conversations` table for memory, leveraging RAG with `pgvector` embeddings.
-   **Price-o-Matic:** Bulk pricing intelligence with caching.
-   **Set-Part Relationships:** Integrates Rebrickable data to display LEGO set-part relationships.
-   **Dashboard Layout:** Features a default dashboard with notifications, plus dedicated Inventory, Orders, Sales, and Marketing dashboards with specialized tools.
-   **Customer Shopping Platform (Oct 2025):** Mobile-first storefront at `/shop` featuring **part-number-based product grouping** and **category-based navigation** (Oct 22, 2025). Products are grouped by unique part number (itemNo), with all color/condition variations aggregated into a single product. Card width w-52/w-80 prevents text wrapping of badges. Scoring formula: `(total_value * 0.7) + (log10(total_qty + 1) * 0.3)`. **Category-Based Navigation (Oct 22, 2025):** Interactive category pill selector with multi-select capability allows customers to choose which categories to browse. Active (selected) categories automatically move to the left of the pill bar with cyan-to-blue gradient highlighting and checkmarks, while inactive categories remain alphabetically sorted. Each category pill displays lot count badge. Selected categories appear as collapsible horizontal scrolling sections below special groups, showing all products in that category (lazy loaded). **Special Groupings:** Three permanent sections always visible at top: (1) New Items - products added in last 30 days based on `dateCreated`, (2) Hot Items - trending products based on order velocity from last 30 days (queried from `orderDetails`), (3) Discounted Items - products with `saleRate > 0`. All sections collapsible with click-to-expand/collapse. **Redesigned Header:** Stark black background with centered PlanetBrick logo, cart and login buttons in top-right. Stats (Unique Lots/Total Parts) below logo with animated comet trail effects on hover. **Navigation:** Sticky header, sticky search bar, sticky category pill selector. **Product Display:** Horizontal scrolling rows per section with gradient band backgrounds (emerald/teal/cyan for New, red/orange/yellow for Hot, violet/fuchsia/pink for Discounted, varied gradients for categories). Product cards show color count, emerald "New" badge (total qty), amber "Used" badge (total qty). Detail modal: compact layout, color-grouped variations, interactive quantity controls, gradient buttons. Jetsons retro-futuristic aesthetic: pure black background with blue/cyan/white gradients. Strategic Shopify alternative with full BrickLink/BrickOwl integration control.
-   **Notification System:** Dismissible, severity-grouped notification center for sync errors.
-   **Platform Sync:** Multi-platform inventory synchronization system with BrickLink as the source of truth, offering manual sync, real-time progress, and discrepancy detection.
-   **Picklist & Fulfillment:** Bin-level picking system and an order fulfillment system with actions for packing slips, shipping, and order splitting.
-   **Shipped Orders:** Customer support tool for searching and reprinting documents for shipped orders.
-   **Order Sync Tester:** Dry-run tool for validating order sync logic.
-   **Sales Analytics:** Year-over-Year Sales Comparison, Platform Comparison Analysis, and Platform Performance Dashboard.
-   **AI Intelligence & Embeddings Management:** Settings for AI configuration, server-side background jobs for embedding generation (inventory, orders, order details, set-parts using `text-embedding-3-small`), and a semantic search testing interface. Includes analytical tools for inventory aging, margin analysis, SKU performance, and sales by category. Automatic re-embedding triggers are integrated into sync pipelines, processed in batches by a background worker.
-   **Automation & Scheduling:** Centralized controls for automated Inventory Sync, Price-o-Matic, Orders Sync, and BrickLink Forum Sync, with automatic purging of stale forum posts.
-   **Backup & Restore System:** Production-ready disaster recovery with manual and automatic restore options, including Neon PITR, fraud detection, and sync lock integration.

## External Dependencies

-   **BrickLink API:** LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** Multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Set-part relationship data.
-   **EasyPost API:** Multi-carrier shipping label generation, rate shopping, and tracking.
-   **OpenAI API:** Powers E.L.F.I.E. (GPT-4o-mini for completions, text-embedding-3-small for embeddings).
-   **Brickognize API:** LEGO part image recognition.
-   **Neon:** Serverless PostgreSQL database with `pgvector` extension.