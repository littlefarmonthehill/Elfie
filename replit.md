# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard for LEGO resellers, integrating with BrickLink, BrickOwl, and EasyPost. Its purpose is to enhance efficiency and profitability through real-time inventory management, order tracking, sales analytics, marketing insights, and an AI chat assistant (E.L.F.I.E.). The platform features a dark-mode, LEGO-inspired UI and a customer portal with a Jetsons-style retro-futuristic landing page, showroom, and community features, aiming to be a comprehensive solution for the LEGO reseller market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette and a 3-Tier Responsive Design System. It includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a dismissible notification system. E.L.F.I.E., the AI Assistant, features an animated mascot and retro-futuristic chat drawer theming. The UI incorporates layered sticky navigation controls and comprehensive scaling optimization for tablet and desktop views, maintaining a cohesive aesthetic with distinct gradient backgrounds for different sections. The customer portal features a retro-futuristic design with neon signage navigation, starfield backgrounds, and themed sections for showroom, events, deals, and community. The showroom offers part-number-based product grouping, category navigation, and view modes (gallery/list) with specific product card and detail modal designs.

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
-   **Price-o-Matic:** Bulk pricing intelligence with caching.
-   **Set-Part Relationships:** Integrates Rebrickable data to display LEGO set-part relationships.
-   **Dashboard Layout:** Default dashboard with notifications, plus dedicated Inventory, Orders, Sales, and Marketing dashboards.
-   **Customer Shopping Platform:** Mobile-first brand showcase and showroom at `/showroom` featuring part-number-based product grouping, category-based navigation, and dual sales approach (external marketplace links and internal cart for curated bundles).
-   **Notification System:** Dismissible, severity-grouped notification center for sync errors.
-   **Platform Sync:** Multi-platform inventory synchronization system with BrickLink as the source of truth, offering manual sync, real-time progress, and discrepancy detection.
-   **Picklist & Fulfillment:** Bin-level picking system and an order fulfillment system with actions for packing slips, shipping, and order splitting.
-   **Shipped Orders:** Customer support tool for searching and reprinting documents.
-   **Order Sync Tester:** Dry-run tool for validating order sync logic.
-   **Sales Analytics:** Year-over-Year Sales Comparison, Platform Comparison Analysis, and Platform Performance Dashboard.
-   **AI Intelligence & Embeddings Management:** Settings for AI configuration, server-side background jobs for embedding generation (inventory, orders, order details, set-parts using `text-embedding-3-small`), and a semantic search testing interface. Includes analytical tools for inventory aging, margin analysis, SKU performance, and sales by category, with automatic re-embedding triggers.
-   **Automation & Scheduling:** Centralized controls for automated Inventory Sync, Price-o-Matic, Orders Sync, and BrickLink Forum Sync, with automatic purging of stale forum posts.
-   **Backup & Restore System:** Production-ready disaster recovery with manual and automatic restore options, including Neon PITR.

## External Dependencies

-   **BrickLink API:** LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** Multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Set-part relationship data.
-   **EasyPost API:** Multi-carrier shipping label generation, rate shopping, and tracking.
-   **OpenAI API:** Powers E.L.F.I.E. (GPT-4o-mini for completions, `text-embedding-3-small` for embeddings).
-   **Brickognize API:** LEGO part image recognition.
-   **Neon:** Serverless PostgreSQL database with `pgvector` extension.