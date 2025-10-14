# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard for LEGO reselling, integrating with BrickLink and ShipStation. It offers real-time inventory, order tracking, sales analytics, and marketing insights with a dark-mode, LEGO-inspired UI and an AI chat assistant (E.L.F.I.E.). The project aims to boost efficiency and profitability for LEGO resellers through data-driven decisions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette. It employs Inter/Roboto for UI and JetBrains Mono for metrics. The design includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a purple/violet themed AI chat interface. The application is responsive, with optimizations for mobile displays and iOS keyboard compatibility. Recent improvements include mobile-safe area fixes for the AI chat, enhanced date handling and high-value sales thresholds on the Sales Dashboard, distinct section backgrounds for the Inventory Dashboard, and a drawer-based Warehouse Management system with horizontal tab navigation, alpha-numeric sorting, search, multi-select, location tracking, and enforced hierarchical relationships (aisles required for shelves, shelves required for bins). The Missions section on the Default Dashboard features black background styling with a line separator, matching the visual treatment of Inventory tools for consistent UI patterns.

### Technical Implementations
- **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS.
- **Backend:** Express.js with TypeScript and Node.js (ESM modules).
- **Database:** Drizzle ORM with Neon serverless PostgreSQL, including `pgvector` for embeddings.
- **API:** RESTful endpoints for data and BrickLink/ShipStation integrations.
- **Data Schema:** Includes `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders`, `order_details`, `sync_metadata`, `app_settings`, `inventory_embeddings`, `order_embeddings`, `wh_aisles`, `wh_shelves`, `wh_bins`, and `inventory_locations`.
- **Authentication:** Basic username/password.
- **Sync Architecture:** Optimized batch and incremental synchronization for BrickLink (1000-item batches) and ShipStation (modified since last sync), tracked via a `sync_metadata` table.

### Feature Specifications
- **AI Assistant (E.L.F.I.E.):** Uses OpenRouter (default GPT-4o-mini), `localStorage` and a `conversations` table for memory, injecting context into prompts. It provides context-aware responses with direct database access, RAG with PostgreSQL `pgvector` embeddings, and OpenAI `text-embedding-3-small`.
- **Price-o-Matic:** Provides bulk pricing intelligence with a dedicated dashboard, including world supply analysis for scarcity-based pricing adjustments and item type pricing (minifigures reduce base premium by half). Features an intelligent caching system with background syncs and categorizes items based on price variance. Pricing calculation: Base Premium (10%) - Minifigure Adjustment (5% reduction for minifigures) + Supply Impact (0-15% based on scarcity).
- **Dashboard Layout:** Features a default dashboard with a "Missions" section for actionable tasks (Listing, Picklist, Fulfillment), with dedicated Inventory, Orders, Sales, and Marketing dashboards. Orders and Marketing dashboards include date range selectors. The Sales Dashboard offers Year-over-Year and Platform Comparison features. The Inventory Dashboard provides drawer-based tool access for Price-o-Matic, Warehouse Management, and Platform Sync.
- **Picklist (Warehouse Missions):** Bin-level picking system for order fulfillment located in the Default Dashboard's "Missions" section. Each bin has two checkboxes: "Pulled" (for picking) and "Reshelved" (for restocking). Filter buttons show bins "To Pull" (not yet pulled) and "To Reshelve" (pulled but not reshelved). Shows pending bin counts as indicator badges. Bins are organized by Aisle (desc) → Shelf (asc) → Bin (asc) for optimal picking routes. Bins without warehouse locations are displayed as disabled with "Assign Location First" badge until items are assigned to a warehouse bin.
- **Year-over-Year Sales Comparison:** Allows comparison of current year revenue against multiple previous years with a multi-line chart and dynamic growth metrics.
- **Platform Comparison Analysis:** Compares month-by-month revenue across various selling platforms (BrickLink, eBay, Amazon, Etsy, Facebook) with platform-branded colors and metrics.
- **Platform Performance Dashboard:** Tracks and categorizes orders by selling platform, displaying revenue, order counts, and average order values.
- **AI Intelligence & Embeddings Management:** Settings section for AI assistant configuration and embeddings management. Features server-side background jobs for embedding generation (inventory and orders) with real-time progress polling and a semantic search testing interface.
- **Automation & Scheduling:** Centralized controls for automated Inventory Sync (daily), Price-o-Matic (after inventory sync), and Orders Sync (configurable frequency). Settings are stored in the `app_settings` table.

### System Design Choices
- **Modular Component Architecture:** For reusability and maintainability.
- **Optimized Data Sync:** Incremental and batch processing for data freshness and API limit management.
- **Semantic Search:** Leveraging vector embeddings for intelligent item searches.
- **Single-Row App Settings Table:** For global application configuration.
- **Mobile-Optimized UI:** Compact layouts and touch behavior optimizations.
- **Server-Side Background Jobs:** Long-running tasks like embedding generation execute on the server, persisting through browser closure.

## External Dependencies

-   **BrickLink API:** Core data source for LEGO inventory, categories, colors, and market data.
-   **ShipStation API:** For order management and fulfillment.
-   **OpenRouter API:** Powers the E.L.F.I.E. AI chat assistant.
-   **OpenAI API:** For generating vector embeddings (text-embedding-3-small).
-   **Neon:** Serverless PostgreSQL database with `pgvector` extension.
-   **Radix UI:** Provides foundational UI components.
-   **Recharts:** For data visualization.
-   **Embla Carousel:** For image carousels.
-   **date-fns:** For date manipulation and formatting.
-   **Vaul:** Drawer component.
-   **React Hook Form & Zod:** For form management and validation.
-   **Drizzle Kit:** For database schema migrations.