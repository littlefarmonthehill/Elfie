# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard designed for LEGO resellers. It integrates with BrickLink and ShipStation to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The platform features a dark-mode, LEGO-inspired user interface and an AI chat assistant (E.L.F.I.E.). Its primary purpose is to enhance efficiency and profitability for LEGO resellers through data-driven decision-making.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Data Flow & System Design
BrickLink serves as the primary source for product catalog data (items, categories, colors), while PlanetBrick manages inventory quantities. Inventory changes within PlanetBrick trigger synchronization to BrickLink and BrickOwl. Orders are pulled from BrickLink, BrickOwl, and ShipStation, leading to automatic inventory adjustments and cross-platform synchronization. ShipStation orders from BrickLink have item metadata embedded in `name` and `sku` fields for parsing. The system employs optimized batch and incremental synchronization for BrickLink (1000-item batches) and ShipStation (modified since last sync), tracked via a `sync_metadata` table. Inventory is adjusted only when orders ship, and restored only when shipped orders are cancelled/returned, preventing incorrect adjustments.

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette. It implements a 3-Tier Responsive Design System for mobile, tablet, and desktop views. The design includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a dismissible notification system on the default dashboard. **E.L.F.I.E. (AI Assistant):** Features PlanetBrick's trademarked robot mascot Elfie (cylindrical body, tank-style wheels, beige face panel with goggles, slate gray color scheme). Clicking the header icon triggers a Jetsons-style animation (~2.9s) where Elfie flies in a zigzag pattern (3 waypoints with rotation) to the upper-right corner, where it opens the AI chat drawer. Elfie remains visible in the upper-right corner while the chat is open, featuring subtle floating animation and gentle arm movements. This position keeps Elfie visible without blocking the chat input field. When chat closes, Elfie retreats back to the header icon. The chat drawer features purple/violet theming with retro-futuristic aesthetics (scan lines, chrome trim, atomic-age circles). Recent UI improvements include mobile-safe area fixes, enhanced date handling, distinct section backgrounds, and a drawer-based Warehouse Management system with hierarchical location tracking (aisles, shelves, bins).

### Technical Implementations
- **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS.
- **Backend:** Express.js with TypeScript and Node.js (ESM modules).
- **Database:** Drizzle ORM with Neon serverless PostgreSQL, including `pgvector`.
- **API:** RESTful endpoints for data and integrations.
- **Data Schema:** Includes tables for `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders`, `order_details`, `sync_metadata`, `app_settings`, `inventory_embeddings`, `order_embeddings`, warehouse management (`wh_aisles`, `wh_shelves`, `wh_bins`, `inventory_locations`), `picklist_items`, `sync_issues`, and shipping (`order_splits`, `order_split_items`, `shipments`).
- **Authentication:** Basic username/password.
- **Order Status & Inventory Automation:** Centralized configuration maps platform-specific statuses and defines inventory impact. Inventory is reduced upon shipping and restored upon cancellation/return of shipped orders. Supports BrickLink, BrickOwl, ShipStation, eBay, and Amazon platforms.
- **Shipping System:** Vendor-agnostic shipping abstraction layer with EasyPost implementation. Supports order splitting for partial shipments, automatic label generation, tracking integration, and automated platform status synchronization. When shipping labels are purchased, order status automatically updates to "shipped" on BrickLink (via OAuth 1.0a two-step API: PUT /orders/{id} for tracking, PUT /orders/{id}/status for status) and BrickOwl (via POST /order/update with status_id=2) with tracking numbers. Split orders are marked local-only and don't sync to sales platforms.

### Feature Specifications
- **AI Assistant (E.L.F.I.E.):** Uses OpenRouter (default GPT-4o-mini) with `localStorage` and a `conversations` table for memory, leveraging RAG with PostgreSQL `pgvector` embeddings and OpenAI `text-embedding-3-small`.
- **Price-o-Matic:** Provides bulk pricing intelligence, including world supply analysis and item type pricing, with intelligent caching.
- **Dashboard Layout:** Features a default dashboard with dismissible notification system, plus dedicated Inventory, Orders, Sales, and Marketing dashboards. Inventory Tools include Listing, Price-o-Matic, Warehouse Management, and Platform Sync. Order Tools include Picklist, Fulfillment, Shipped Orders, and Order Sync Tester. Sales Dashboard offers Year-over-Year and Platform Comparison.
- **Notification System:** Dismissible notification center on the default dashboard displays sync errors and issues from order/inventory synchronization. Notifications are grouped by severity (critical, high, medium, low) with color-coded badges, platform labels, and timestamps. Users can dismiss notifications to mark them as resolved, with auto-refresh every 30 seconds to show new issues.
- **Platform Sync:** Multi-platform inventory synchronization system displaying BrickLink as the source of truth, with target platforms (BrickOwl, eBay, BigCommerce) and features discrepancy detection, and individual or bulk sync capabilities. Uses `external_lot_ids.other` for matching and supports BrickOwl sync with rate limiting.
- **Picklist:** Bin-level picking system for order fulfillment, grouped by Aisle for optimal routes, with optimistic UI updates.
- **Fulfillment:** Order fulfillment system, grouping items by warehouse bin location. Features a consolidated Actions dropdown menu (MoreVertical icon) for operations including: packing slips (multi-select), lot labels (placeholder for future), shipping (single order), and order splitting. The new order splitting workflow assumes all items ship together by default (no initial checkboxes). When "Split Order" is selected from Actions, item checkboxes appear dynamically to select which items to move to a new order. A confirmation dialog displays the original order number, new "-1" suffix order number, and the list of items being moved. The split operation creates a new order and moves selected items while keeping remaining items in the original order. Packing slip system supports bulk print with PlanetBrick branding and order details.
- **Shipped Orders:** Customer support and reprint tool displaying all shipped orders sorted by ship date (most recent first). Features real-time search by order number, customer name/email, or tracking number. Each order shows details including shipping date, carrier, service, and tracking information. Includes Actions dropdown for reprinting packing slips, shipping labels, and lot labels (placeholder). Orders automatically disappear from Fulfillment once shipped and appear in this tool.
- **Order Sync Tester:** Dry-run tool for validating order sync logic from BrickLink and BrickOwl APIs without database writes. Compares ShipStation and platform data for pending orders.
- **Sales Analytics:** Includes Year-over-Year Sales Comparison and Platform Comparison Analysis, and a Platform Performance Dashboard.
- **AI Intelligence & Embeddings Management:** Settings for AI assistant configuration, server-side background jobs for embedding generation, and a semantic search testing interface.
- **Automation & Scheduling:** Centralized controls for automated Inventory Sync, Price-o-Matic, and Orders Sync, stored in `app_settings`.

## External Dependencies

-   **BrickLink API:** LEGO inventory, categories, colors, and market data.
-   **BrickOwl API:** Multi-platform inventory synchronization.
-   **ShipStation API:** Legacy order management (being phased out).
-   **EasyPost API:** Multi-carrier shipping label generation, rate shopping, and tracking.
-   **OpenRouter API:** Powers the E.L.F.I.E. AI chat assistant.
-   **OpenAI API:** Generates vector embeddings.
-   **Neon:** Serverless PostgreSQL database with `pgvector` extension.
-   **Radix UI:** Foundational UI components.
-   **Recharts:** Data visualization.
-   **Embla Carousel:** Image carousels.
-   **date-fns:** Date manipulation and formatting.
-   **Vaul:** Drawer component.
-   **React Hook Form & Zod:** Form management and validation.
-   **Drizzle Kit:** Database schema migrations.