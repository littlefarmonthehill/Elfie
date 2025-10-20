# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a business operations and analytics dashboard for LEGO resellers, integrating with BrickLink, BrickOwl, and EasyPost. Its purpose is to enhance efficiency and profitability through real-time inventory management, order tracking, sales analytics, marketing insights, and an AI chat assistant (E.L.F.I.E.). The platform features a dark-mode, LEGO-inspired user interface.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, Shadcn/ui, and Tailwind CSS, featuring a dark mode with a LEGO-themed color palette and a 3-Tier Responsive Design System. It includes modular dashboards with tab-based navigation, reusable metric cards, drawer-based detail modals, and a dismissible notification system. The AI Assistant, E.L.F.I.E., features a distinctive animated mascot and retro-futuristic chat drawer theming with intelligent function calling that displays both AI-generated text responses and supplementary data (inventory items, orders) simultaneously. Recent UI improvements include mobile-safe area fixes, enhanced date handling, distinct section backgrounds, and a drawer-based Warehouse Management system with hierarchical location tracking. The Settings modal has been streamlined, relocating BrickLink manual sync to the Inventory Dashboard's Platform Sync tool. Settings/General includes a Cache & Storage section with automatic device detection (iOS/iPadOS/Android/Desktop), one-click cache clearing, and device-specific manual instructions for clearing PWA cache and website data.

### Technical Implementations
- **Frontend:** React 18+, TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS.
- **Backend:** Express.js with TypeScript and Node.js.
- **Database:** Drizzle ORM with Neon serverless PostgreSQL, including `pgvector`.
- **API:** RESTful endpoints.
- **Authentication:** Basic username/password.
- **Data Schema:** Comprehensive schema covering users, inventory, orders, sync metadata, app settings, embeddings (inventory, order, set-part, forum), BrickLink forum posts, warehouse management, picklists, sync issues, and shipping.
- **Order Status & Inventory Automation:** Centralized configuration for platform-specific statuses and inventory impact, reducing inventory on shipment and restoring on cancellation/return. Supports BrickLink, BrickOwl, eBay, and Amazon.
- **Shipping System:** Vendor-agnostic abstraction with EasyPost integration, supporting order splitting, automatic label generation, tracking, and automated platform status synchronization.
- **Service Worker & PWA:** Intelligent update system that checks for new versions every 30 minutes (not every 60 seconds), with smart auto-reload that waits for safe moments (no open drawers/modals, page visible) before applying updates to prevent interruptions during critical user interactions like camera usage or settings changes.

### Feature Specifications
- **Data Flow & System Design:** BrickLink is the primary source for product catalog data, with PlanetBrick managing inventory and synchronizing changes to BrickLink and BrickOwl. Orders from sales platforms trigger inventory adjustments. A global sync lock manager prevents race conditions. The comprehensive inventory sync pipeline includes syncing BrickLink data, Rebrickable set-part relationships, generating AI embeddings, and syncing inventory to sales platforms. Order syncs also generate embeddings.
- **AI Assistant (E.L.F.I.E.):** Intelligent AI assistant powered by OpenAI (GPT-4o-mini) with advanced function calling capabilities and date awareness (system prompt includes current date for seasonal context). Features agent loop architecture (max 5 iterations) that can proactively call tools: search_bricklink_catalog (lookup items not in inventory), get_bricklink_price_guide (market pricing data), search_local_inventory (enhanced filtering), get_inventory_stats, get_order_analytics, search_orders_by_item (sales history for specific parts with quantity/price/date/customer details), get_set_parts (complete parts lists for any LEGO set with quantities), search_web (internet research for current trends, news, and market information), and search_forum_discussions (semantic search of BrickLink community forum for seller tips, buyer experiences, marketplace insights, and LEGO collecting wisdom). When a part is not found in local inventory, E.L.F.I.E. automatically searches BrickLink catalog and opens the item detail drawer with catalog data for immediate viewing. The get_set_parts tool queries the set_part_relationships table with no limits, returning comprehensive parts data for sets of any size. The search_orders_by_item tool queries orderDetails joined with orders, filtering by SKU pattern and optional color/condition, returning chronological sales history with aggregate statistics. The search_web tool uses DuckDuckGo to find current information about LEGO market trends, industry news, and relevant topics, providing up-to-date context beyond the AI's training data. The search_forum_discussions tool uses vector embeddings to semantically search BrickLink forum posts, enabling E.L.F.I.E. to answer questions about community knowledge, common seller practices, marketplace trends, and peer experiences. Includes image recognition via Brickognize API for identifying LEGO parts from camera/uploaded photos with confidence scores. Features animated thinking indicator (bouncing E.L.F.I.E. sprite) during AI processing. All web links open in in-app browser to prevent external Safari navigation on mobile. Uses `localStorage` and a `conversations` table for memory, leveraging RAG with PostgreSQL `pgvector` embeddings and OpenAI `text-embedding-3-small`. Includes comprehensive error handling with defensive JSON parsing and structured error messages.
- **Price-o-Matic:** Provides bulk pricing intelligence with caching.
- **Set-Part Relationships:** Integrates Rebrickable CSV data to show LEGO set-part relationships, accessible from item detail drawers.
- **Dashboard Layout:** Default dashboard with notifications, plus dedicated Inventory, Orders, Sales, and Marketing dashboards. Inventory Tools include Listing, Price-o-Matic, Warehouse Management, and Platform Sync. Order Tools include Picklist, Fulfillment, Shipped Orders, and Order Sync Tester.
- **Notification System:** Dismissible notification center on the default dashboard for sync errors and issues, grouped by severity with auto-refresh.
- **Platform Sync:** Multi-platform inventory synchronization system with BrickLink as the source of truth, offering manual sync, real-time progress tracking, and rate limit display. Supports discrepancy detection and individual/bulk sync for target platforms.
- **Picklist:** Bin-level picking system for order fulfillment, grouped by Aisle.
- **Fulfillment:** Order fulfillment system grouping items by warehouse bin location, with actions for packing slips, shipping, and order splitting.
- **Shipped Orders:** Customer support and reprint tool for shipped orders, with search and actions for reprinting documents.
- **Order Sync Tester:** Dry-run tool for validating order sync logic from BrickLink and BrickOwl APIs without database writes.
- **Sales Analytics:** Year-over-Year Sales Comparison, Platform Comparison Analysis, and Platform Performance Dashboard.
- **AI Intelligence & Embeddings Management:** Settings for AI assistant configuration, server-side background jobs for embedding generation, and a semantic search testing interface. Generates Inventory, Order, and Set-part embeddings using OpenAI's `text-embedding-3-small` model stored in PostgreSQL with `pgvector`.
- **Automation & Scheduling:** Centralized controls for automated Inventory Sync, Price-o-Matic, Orders Sync, and BrickLink Forum Sync. Forum sync automatically scrapes BrickLink discussion forum posts, stores them with metadata (title, author, timestamps, URLs), and generates vector embeddings for AI-powered semantic search. Stale posts (no activity for 6 months) are automatically purged to maintain database performance.
- **Backup & Restore System:** Production-ready disaster recovery with Manual Restore (CSV export, BrickLink XML download/upload) and an Automatic Restore (guided wizard with Neon PITR, platform sync, differential recovery with fraud detection, batch updates to BrickLink API, and verification). Includes fraud detection heuristics and backend orchestration with sync lock integration.

## External Dependencies

-   **BrickLink API:** LEGO inventory, categories, colors, orders, and market data.
-   **BrickOwl API:** Multi-platform inventory synchronization and order management.
-   **Rebrickable CSV:** Set-part relationship data.
-   **EasyPost API:** Multi-carrier shipping label generation, rate shopping, and tracking.
-   **OpenAI API:** Powers the E.L.F.I.E. AI chat assistant (GPT-4o-mini for completions, text-embedding-3-small for embeddings).
-   **Brickognize API:** LEGO part image recognition from camera/uploaded photos (no API key required).
-   **Neon:** Serverless PostgreSQL database with `pgvector` extension.