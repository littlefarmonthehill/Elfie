# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a comprehensive business operations and analytics dashboard designed for LEGO reselling businesses. It integrates with BrickLink and ShipStation to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The application features a dark-mode interface with a LEGO-inspired aesthetic and includes an AI chat assistant (E.L.F.I.E.) for operational guidance. The project's vision is to offer a complete operational toolkit that enhances efficiency and profitability for LEGO resellers through data-driven decisions and intelligent automation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack:** React 18+ with TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui (Radix UI), and Tailwind CSS.
- **Design System:** Dark mode with jet black backgrounds and a LEGO-themed color palette (Red, Blue, Orange, Yellow, Green). Typography uses Inter/Roboto for UI and JetBrains Mono for metrics, with a focus on compact spacing and gradient backgrounds.
- **Component Architecture:** Features a modular dashboard with tab-based navigation, reusable metric cards, drawer-based detail modals, and a purple/violet themed AI chat interface. The design is responsive, including dynamic overflow management for iOS keyboard compatibility and optimized chart rendering for mobile displays (3px dots on sales charts for long date ranges).

### Backend
- **Server Framework:** Express.js with TypeScript and Node.js, utilizing ESM modules.
- **Database Layer:** Drizzle ORM with Neon serverless PostgreSQL, and `ws` for WebSockets.
- **API Design:** RESTful endpoints (`/api`) handle data operations and integrations, including syncs for BrickLink and ShipStation. User management for development uses in-memory storage.
- **Data Storage:** The schema includes tables for `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders` (with `marketplace` field for selling platform tracking), `order_details`, and `sync_metadata`.
- **Sync Architecture:** Optimized batch operations and incremental synchronization for BrickLink (1000-item batches, selective updates) and ShipStation (fetching orders modified since the last sync). A `sync_metadata` table tracks sync status and performance. Full sync option available for re-processing all historical orders (10 years) to update marketplace extraction.
- **Settings Management:** Global application settings (AI enablement, API keys, AI model) are stored in a single-row `app_settings` PostgreSQL table.
- **Authentication:** Basic username/password authentication with UUID-based user IDs is implemented, with future plans for session-based authentication and secure password hashing.

### AI Assistant (E.L.F.I.E.)
- **Integration:** Powered by the OpenRouter API for multi-model access (default: GPT-4o-mini).
- **Context & Memory:** Utilizes `localStorage` and a `conversations` table for persistent memory, injecting context into system prompts.
- **Context-Aware Responses:** Provides summary prompts for dashboard insights across Inventory, Orders, Sales, and Marketing.
- **Direct Database Access:** Queries `bl_inventory` and `orders` tables based on user input, supporting part numbers and multi-keyword searches, and formatting results into system prompts.
- **Smart Search:** Category-based search prioritizes theme/category matches (e.g., searching "potter" finds all Harry Potter items) before falling back to keyword search across item fields. Results populate both AI context and grouped display.
- **Interactive Features:** Responses are formatted in markdown with clickable part numbers (opening detail modals) and BrickLink URLs (opening sandboxed iframe dialogs). Inventory displays are grouped with actual LEGO brick colors, proper column alignment, and full-row clickability.
- **BrickLink Catalog Integration:** When items aren't found in local inventory, Elfie suggests checking the BrickLink catalog. Upon user confirmation ("yes", "sure", etc.), searches BrickLink API (tries SET then PART types) and opens catalog item in the detail modal instead of showing text. Modal displays item name, number, type, category, weight, year released, and is clearly labeled as "BrickLink Catalog Item" to distinguish from local inventory. Uses sessionStorage to pass catalog data to modal.
- **Response Principles:** Focuses on concise answers, markdown formatting, inclusion of BrickLink links, avoidance of hallucination, and offers strategic advice when requested.

### Dashboard Features

#### Price-o-Matic with World Supply Analysis
- **Calculation Dialog:** Clicking the suggested price in the Pricing tab opens a detailed breakdown showing:
  - Base Price (stock average from BrickLink)
  - Premium breakdown (base 15% + supply-adjusted scarcity bonus)
  - Final suggested price with comparison to current price
  - Market context (stock avg, sold avg, price ranges)
- **World Supply Analysis Panel:**
  - Displays number of available listings worldwide (lot count from BrickLink)
  - Color-coded supply level classification:
    - Very Low Supply (red, <50 lots): +10% scarcity bonus
    - Low Supply (orange, 50-200 lots): +5% scarcity bonus
    - Medium Supply (yellow, 200-500 lots): +2% scarcity bonus
    - High Supply (green, 500+ lots): base premium only
  - Shows premium breakdown: Base Premium + Scarcity Bonus = Total Premium
  - Contextual explanation of how scarcity affects pricing

#### Price-o-Matic Dashboard (Bulk Pricing Intelligence)
- **Purpose:** Separate dashboard for identifying pricing opportunities across entire inventory without exhausting API limits.
- **UI Design:** Mobile-optimized compact layout with clickable info cards at top for filtering (Too High/Too Low/Well Priced categories). Touch behavior optimized (`touch-pan-y`) to prevent horizontal page dragging. Single item list below updates based on selected card. Items sorted by absolute variance descending to prioritize biggest discrepancies. Ultra-compact item display with reduced padding (p-1.5) and smaller font sizes (9-10px) for maximum information density.
- **Intelligent Caching System:**
  - Background sync processes up to 1,500 items per day (stays under 5,000 API call limit)
  - Rolling 14-day refresh cycle ensures all inventory stays current
  - Stops automatically at 4,500 API calls to preserve quota buffer
  - Priority queue: items without cache → oldest cached items
- **Pricing Insights:**
  - Categorizes items as "Too High" (20%+ above suggested), "Too Low" (20%+ below suggested), or "Well Priced"
  - Displays variance percentage, current vs suggested price, and market data freshness
  - Removed separate Overview tab in favor of unified category-driven list view
  - Shows up to 50 items per category with full inventory details
- **Sync Management:**
  - Real-time status display (Success, Partial, In Progress, Failed, Never Synced)
  - Shows last sync time, items updated count, and error messages
  - Manual "Update Prices" button to trigger on-demand sync
  - Background async sync: endpoint responds immediately, sync runs in background
  - Concurrent sync protection: prevents multiple syncs running simultaneously (10-minute timeout for stale syncs)
  - API safeguards: checks rate limit before starting, every 10 items during sync, stops if approaching limit
- **Technical Implementation:**
  - Endpoints: `POST /api/sync/priceomatic`, `GET /api/sync/priceomatic/status`, `GET /api/priceomatic/insights`
  - Uses `price_guide_cache` table with `nextRefresh` timestamp for rolling updates
  - Sync metadata tracked in `sync_metadata` table (id: 'priceomatic_cache')
  - Calculates pricing variance by comparing `blInventory.unitPrice` with cached `suggestedPrice`

#### Dashboard Layout & Organization
- **Default Dashboard:** Displays "Total Revenue" and "Total Orders" metrics with "Top Pricing Opportunities" section showing items priced too low from Price-o-Matic insights. Each opportunity displays item number, color badge, and item name (truncated) for easy identification. Removed "Inventory Items" and "Total Pieces" metrics for cleaner layout.
- **Inventory Dashboard:** Streamlined view showing top value items, newly added items, and recently updated items. Removed redundant low stock section to reduce duplication.
- **Orders Dashboard:** Features date-based chart (30-60 day rolling window) using "MMM d" format (e.g., "Jan 15") instead of day-of-week labels. Chart intelligently bases date range on actual order dates to handle historical data properly. Includes date range selector for filtering.
- **Marketing Dashboard:** Enhanced with date range selector for customer pattern analysis. Customer metrics (new vs repeat) filter based on selected date range with proper API query integration.
- **Date Range Filtering:** Available on Default, Orders, Sales, and Marketing dashboards with options for 3M, 6M, 1Y, 2Y, and All time periods.

#### Platform Performance Dashboard
- **Sales Dashboard Integration:** Located in the Sales tab after Key Metrics section.
- **Marketplace Tracking:** Orders are automatically tagged with selling platform using an enhanced 8-priority detection system:
  - **Priority 1:** advancedOptions.source (most reliable)
  - **Priority 2:** Custom fields (customField1/2/3)
  - **Priority 3:** Order number patterns (BL., BO., LBS, numeric)
  - **Priority 4:** Order key prefixes (EBAY-, AMZN-, etc.)
  - **Priority 5:** Customer email domains (marketplace notifications)
  - **Priority 6:** Shipping service/carrier codes
  - **Priority 7:** Store ID references
  - **Priority 8:** Internal/customer order notes
  - Supported platforms: BrickLink, BrickOwl, eBay, Amazon, Etsy, Facebook Marketplace, Shopify, and more
  - Database standardization: "Brick Owl" → "BrickOwl" to eliminate duplicate platform entries
  - Full sync option available to re-extract marketplace for all historical orders using enhanced detection
- **Visualizations:**
  - Bar chart showing revenue by marketplace (color-coded by platform)
  - Platform breakdown cards displaying: revenue, order count, percentage of total, average order value
  - Progress bars indicating each platform's share of total revenue
- **Date Range Alignment:** Automatically syncs with dashboard date range selector (3M, 6M, 1Y, 2Y, All).
- **ShipStation Integration:** Marketplace data is captured during order sync and stored in the `orders.marketplace` field for historical tracking and trend analysis.

## External Dependencies

-   **BrickLink API:** Core data source for LEGO inventory, categories, and colors. Uses OAuth 1.0a. Strict rate limit of 5,000 calls per 24 hours. Price-o-Matic consumes 3 API calls per item and is designed for individual item detail views only, not bulk syncs, to manage this limit.
    -   **Price Guide Integration:** Fetches market pricing data for catalog items showing FOR SALE (stock) and SOLD (6mo) averages, min/max prices, and lot counts.
    -   **Supply-Adjusted Pricing:** Price-o-Matic applies tiered premiums based on supply scarcity using `unit_quantity` (number of lots/listings): <50 lots adds +10% premium, 50-200 lots adds +5%, 200-500 lots adds +2%, 500+ lots uses base 15% premium only.
    -   **Critical Implementation:** Uses BrickLink API field `unit_quantity` (lot count) not `total_qty` (total pieces) for accurate scarcity detection.
-   **ShipStation API:** Integrated for order management and fulfillment.
-   **OpenRouter API:** Provides multi-model AI capabilities for the E.L.F.I.E. chat assistant.
-   **Neon:** Serverless PostgreSQL database provider.
-   **Radix UI:** Used for foundational UI components.
-   **Recharts:** Utilized for data visualization.
-   **Embla Carousel:** Provides image carousel functionality.
-   **date-fns:** Library for date manipulation and formatting.
-   **Vaul:** Drawer component for interactive modals.
-   **React Hook Form & Zod:** Employed for form management and validation.
-   **Drizzle Kit:** Used for database schema migrations.