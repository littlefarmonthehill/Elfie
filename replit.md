# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard for LEGO reselling, integrating with BrickLink and ShipStation. It offers real-time inventory, order tracking, sales analytics, and marketing insights with a dark-mode, LEGO-inspired UI and an AI chat assistant (E.L.F.I.E.). The project aims to boost efficiency and profitability for LEGO resellers through data-driven decisions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Data Flow Architecture
**BrickLink** serves as the single source of truth for catalog, product, and inventory data. Inventory is synced FROM BrickLink TO multiple selling platforms (BrickOwl, eBay, BigCommerce, etc.). Orders from these selling platforms flow into **ShipStation**, which aggregates all orders and feeds them into this application for fulfillment tracking and analytics.

**Flow:** BrickLink (catalog/inventory) → Selling Platforms (BrickOwl, eBay, etc.) → Orders → ShipStation → This App

**Important Note:** BrickLink orders in ShipStation do not use the ShipStation `options` array to store item metadata (color ID, inventory ID, condition). Instead, all relevant data is embedded in the item `name` and `sku` fields, which the application parses to extract BrickLink part numbers, colors, and conditions for fulfillment display.

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette. It employs Inter/Roboto for UI and JetBrains Mono for metrics. The design includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a purple/violet themed AI chat interface. The application is responsive, with optimizations for mobile displays and iOS keyboard compatibility. Recent improvements include mobile-safe area fixes for the AI chat, enhanced date handling and high-value sales thresholds on the Sales Dashboard, distinct section backgrounds for the Inventory Dashboard, and a drawer-based Warehouse Management system with horizontal tab navigation, alpha-numeric sorting, search, multi-select, location tracking, and enforced hierarchical relationships (aisles required for shelves, shelves required for bins). The Missions section on the Default Dashboard features black background styling with a line separator, matching the visual treatment of Inventory tools for consistent UI patterns.

### Technical Implementations
- **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS.
- **Backend:** Express.js with TypeScript and Node.js (ESM modules).
- **Database:** Drizzle ORM with Neon serverless PostgreSQL, including `pgvector` for embeddings.
- **API:** RESTful endpoints for data and BrickLink/ShipStation integrations.
- **Data Schema:** Includes `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders`, `order_details`, `sync_metadata`, `app_settings`, `inventory_embeddings`, `order_embeddings`, `wh_aisles`, `wh_shelves`, `wh_bins`, `inventory_locations`, and `picklist_items`.
- **Authentication:** Basic username/password.
- **Sync Architecture:** Optimized batch and incremental synchronization for BrickLink (1000-item batches) and ShipStation (modified since last sync), tracked via a `sync_metadata` table.

### Feature Specifications
- **AI Assistant (E.L.F.I.E.):** Uses OpenRouter (default GPT-4o-mini), `localStorage` and a `conversations` table for memory, injecting context into prompts. It provides context-aware responses with direct database access, RAG with PostgreSQL `pgvector` embeddings, and OpenAI `text-embedding-3-small`.
- **Price-o-Matic:** Provides bulk pricing intelligence with a dedicated dashboard, including world supply analysis for scarcity-based pricing adjustments and item type pricing (minifigures reduce base premium by half). Features an intelligent caching system with background syncs and categorizes items based on price variance. Pricing calculation: Base Premium (10%) - Minifigure Adjustment (5% reduction for minifigures) + Supply Impact (0-15% based on scarcity).
- **Dashboard Layout:** Features a default dashboard, with dedicated Inventory, Orders, Sales, and Marketing dashboards. The Inventory Dashboard provides drawer-based Tools section for Listing, Price-o-Matic, Warehouse Management, and Platform Sync. The Orders Dashboard provides drawer-based Tools section for Picklist and Fulfillment. The Sales Dashboard offers Year-over-Year and Platform Comparison features.
- **Platform Sync:** Multi-platform inventory synchronization system located in the Inventory Dashboard Tools section. Displays BrickLink as the source of truth with lot/part counts, showing target platforms (BrickOwl, eBay, BigCommerce) with sync status, discrepancy detection (missing lots/parts, price/quantity differences), and individual or bulk sync capabilities. Features real-time sync progress tracking and requires API credentials configured in Settings. **Simplified Sync Logic:** Uses `external_lot_ids.other` (BrickLink inventory ID) as the primary matching mechanism - if BrickOwl lot has matching `external_lot_ids.other` → UPDATE (quantity, price, remarks), else → CREATE new lot. This eliminates complex BOID+color+condition matching and redundant BOID lookups for updates. BOID lookups only occur when creating new lots. Currently supports BrickOwl platform sync with POST `/api/platform-sync/sync` endpoint that accepts platform name and optional limit parameter. Sync uses 120ms rate limiting between items to respect BrickOwl's 600 req/min API limit. Frontend uses 10-item limit by default for testing to prevent long-running synchronous operations. Success/error states surface via toast notifications with detailed counts (lots created/updated/skipped). Status endpoint builds Map of BrickLink items by inventory ID, then iterates BrickOwl lots using `external_lot_ids.other` for instant discrepancy detection (NO BOID lookups).
- **Picklist:** Bin-level picking system for order fulfillment located in the Orders Dashboard Tools section. Features condensed single-row layout with left checkbox ("Pulled"), center bin info (Shelf › Bin name with optional description below), and right checkbox ("Reshelved"). Filter buttons show bins "To Pull" (not yet pulled) and "To Reshelve" (pulled but not reshelved). Shows pending bin counts as indicator badges. Bins are grouped by Aisle (descending sort) with purple headers for optimal picking routes. Uses optimistic UI updates for instant checkbox responsiveness. Item quantities are not displayed. Bins without warehouse locations are disabled until items are assigned to a warehouse bin.
- **Fulfillment:** Order fulfillment system located in the Orders Dashboard Tools section. Features order filter toggles in a 4-column grid (alphanumeric sort) - clicking an order filters items to show only that order's parts (deselect to show all). Items are grouped by warehouse bin location, showing aisle › shelf › bin hierarchy. Each item displays BrickLink part number on first line, with bold second line showing qty and order number (e.g., "Qty 5 • BL134"). Badge indicator shows count of orders requiring fulfillment. Items persist in the list until the parent order's ShipStation status changes. Uses `selectDistinct` to prevent duplicate rows from multiple inventory records with the same SKU. Fulfillment status tracked via `fulfilled` and `fulfilledAt` fields in the `order_details` table.
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
-   **BrickOwl API:** For multi-platform inventory synchronization from BrickLink to BrickOwl.
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