# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a comprehensive business operations and analytics dashboard for LEGO reselling businesses. It integrates with BrickLink and ShipStation to offer real-time inventory management, order tracking, sales analytics, and marketing insights. The application features a dark-mode interface with LEGO-inspired colors and an AI chat assistant (E.L.F.I.E.) for operational guidance. The vision is to provide a complete operational toolkit for LEGO resellers, enhancing efficiency and profitability through data-driven decisions and intelligent automation.

## Recent Changes (October 2025)
- **Instant Modal Loading UX**: Improved user experience with instant modal feedback:
  - Drawer opens immediately when clicking any inventory or order item, showing skeleton loading state
  - Data loads progressively: base data → Price-o-Matic → Analytics
  - No more waiting for network before visual response
  - Smooth transitions from skeleton to actual content
  - All detail components (InventoryDetail, OrderDetail) support loading states
- **Price-o-Matic Calculation Popup**: Added transparency to pricing suggestions:
  - Suggested price is now clickable with visual hint ("Tap to see calculation")
  - Dialog shows complete calculation breakdown:
    - Base Price (Stock Average)
    - Premium Applied (% and dollar amount)
    - Final Suggested Price
    - Market Context (stock/sold averages, price range)
    - Formula explanation
  - Helps users understand and trust the AI pricing recommendations
- **Date Range Analytics Selector**: Flexible historical data analysis for businesses that were closed or dormant:
  - Date range selector in Analytics tab with options: 3M, 6M, 1Y, 2Y, All
  - Default: "All" (all-time data)
  - Backend filters order data by selected range before calculating metrics
  - Perfect for businesses reopening after closures - can compare historical vs recent performance
  - All analytics metrics (sales, velocity, customers) recalculate based on selected period
- **Alternative IDs Verification**: Confirmed complete identifier display in Details tab:
  - All identifiers shown: Inventory ID, Part Number, Item Type, Color ID, Bind ID
  - Helpful note warns users that part numbers may change, recommends using Inventory ID
  - Inventory settings clearly displayed: Completeness, Bulk, Retain, Stock Room, Date Created
  - Proper null handling - optional fields only show when available
- **Inventory Analytics System**: Comprehensive sales analytics and movement insights for data-driven inventory management:
  - **Backend Analytics API** (`/api/inventory/:id/analytics`): Joins order history with inventory by SKU matching (order_details.sku = bl_inventory.itemNo) to calculate sales velocity, revenue, customer patterns, and time-based trends. Now supports date range filtering via `?range=` query parameter
  - **Analytics Tab**: Fourth tab added to inventory detail drawer showing:
    - **Sales Performance**: Total units sold, revenue, sales velocity (units/month), average selling price, total orders
    - **Movement Insights**: Days since last sold (color-coded: green <30 days, yellow 30-90, red >90), days in inventory, best selling month with units
    - **Recent Activity**: Last 3 months sales with percentage of total
    - **Top Customers**: List of buyers with units purchased, orders count, and revenue
    - **Movement Strategies**: AI-powered recommendations for inventory optimization (price reductions for slow items >90 days, restocking alerts for high velocity >5/mo, bulk offer opportunities for repeat customers, seasonal promotion planning)
  - Gracefully handles items with zero sales history, showing "No sales data available" message
- **Fixed Inventory Detail Data Flow** (Critical Bug Fix): Resolved issue where chat-triggered inventory details showed blank fields. The `handleItemClick` function was incorrectly transforming API data to wrong field names (partNumber/name/color instead of itemNo/itemName/colorName). Now uses unified `handleDashboardItemClick` handler for both chat and dashboard clicks, ensuring correct data flow to InventoryDetail component. All fields now display properly.
- **Comprehensive Inventory Details**: Redesigned inventory detail drawer with four-tab interface and fixed height (85vh) that stays constant when switching tabs:
  - **Overview Tab**: Description/remarks (priority), key metrics (quantity, price, value), cost/profit analysis, physical specifications (weight, dimensions, year released), and placeholder for "Appears in Sets" (future feature)
  - **Pricing Tab**: Price-o-Matic suggested pricing with market data (stock/sold averages), tier pricing/bulk discounts, and sale rates
  - **Analytics Tab**: Sales analytics, movement insights, customer data, and strategic recommendations for inventory optimization
  - **Details Tab**: Complete identifiers (inventory ID, part number, item type, color ID, bind ID) with note about part number changes, plus inventory settings (completeness, bulk, retain, stock room status)
- **Enhanced Font Sizes**: Increased all font sizes in inventory detail drawer for better readability while maintaining compact layout
- **Enhanced Data Fields**: Backend now returns all available inventory fields including description, remarks, bindId, cost, tier pricing, completeness, stock room settings, and creation dates
- **API Usage Documentation**: Documented BrickLink's 5,000 API call limit per 24 hours. Price-o-Matic consumes 3 API calls per item (details + 2 price guides), so it should ONLY be called for individual item detail views, NOT during bulk sync operations
- **Price-o-Matic Feature**: Integrated BrickLink Catalog API to fetch real-time item details and price guides. Displays suggested pricing with configurable premium (default 15%), market data (stock/sold prices), item images, weights, and dimensions. Uses 24-hour caching via `price_guide_cache` table. Auto-updates inventory weights from BrickLink
- **Engaging Detail Modals**: Redesigned order and inventory detail drawers with vibrant LEGO-colored gradients, ultra-compact layouts showing maximum info without scrolling, full item names visible, and internal scrolling for long item lists
- **Scrolling Order Pills**: Customer order details now display all orders as clickable, scrollable pills - clicking a pill instantly updates the drawer to show that order's details while maintaining customer context
- **Customer Data Fix**: ShipStation sync now properly extracts customer names from shipping addresses to populate `customerUsername` field
- **Interactive Drawers**: All dashboard list items (orders, inventory) now open detail drawers on click, showing comprehensive information in a right-side slider
- **Typography Consistency**: Standardized all dashboard fonts to text-[10px] for headers/primary text and text-[9px] for secondary details
- **Chat Interface Cleanup**: Removed prompt buttons from chat interface for streamlined UX
- **ID Handling**: Improved order ID handling to support both numeric and string formats (e.g., "ss-12345", "bl-98765")

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack:** React 18+ with TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui (Radix UI), Tailwind CSS.
- **Design System:** Dark mode with jet black backgrounds, LEGO-themed color palette for sections (Red, Blue, Orange, Yellow, Green), Inter/Roboto typography for UI, JetBrains Mono for metrics, compact spacing, gradient backgrounds.
- **Component Architecture:** Modular dashboard with tab-based navigation, reusable metric cards, drawer-based detail modals, purple/violet themed AI chat interface, responsive design.
- **iOS Keyboard Fix:** Dynamic overflow management in chat interface for iOS devices, detecting focus and adjusting parent container `overflow` properties to ensure smooth scrolling and input visibility, while maintaining layout integrity.

### Backend
- **Server Framework:** Express.js with TypeScript and Node.js, using ESM modules.
- **Database Layer:** Drizzle ORM, Neon serverless PostgreSQL, `ws` library for WebSockets.
- **API Design:** RESTful endpoints (`/api`), including sync endpoints for BrickLink and ShipStation. Uses in-memory storage for development user management.
- **Data Storage:** Schema includes `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders`, `order_details`, and `sync_metadata` tables. Features efficient batch operations and incremental synchronization.
- **Sync Architecture:** 
  - **BrickLink Sync:** Batch operations for categories/colors (single query fetch, batch insert/update). Inventory sync already optimized with 1000-item batch inserts and selective updates.
  - **ShipStation Sync:** Batch operations eliminate 8000+ individual queries. Incremental sync using `sync_metadata` table - first sync fetches 10 years of history, subsequent syncs fetch only orders modified since last successful sync (via `modifyDateStart` parameter).
  - **Sync Metadata Table:** Tracks last successful sync time, status (success/failed/in_progress), records added/updated, and error messages for each sync type.
  - **Performance:** First sync processes ~2,500 orders, subsequent syncs typically 0-50 orders (100-500x faster).
- **Settings Management:** Global application settings (AI enablement, API keys, selected AI model) stored in a single-row `app_settings` PostgreSQL table, accessible via `/api/settings`.
- **Authentication:** Basic username/password authentication with UUID-based user identification and in-memory storage (for development). Future plans include session-based authentication and secure password hashing.

### AI Assistant (E.L.F.I.E.)
- **Integration:** OpenRouter API for multi-model access (default: GPT-4o-mini).
- **Context & Memory:** Persistent conversation memory via `localStorage` and `conversations` table, injecting context into system prompts.
- **Context-Aware Responses:** Provides summary prompts for dashboard insights (Inventory, Orders, Sales, Marketing).
- **Direct Database Access:** Queries `bl_inventory` and `orders` tables based on user input, using part numbers and multi-keyword search, formatting results into system prompts.
- **Interactive Features:** Formats AI responses as markdown bullet lists with clickable part numbers (opening detail modals) and BrickLink URLs (opening sandboxed iframe dialogs). Includes grouped inventory display with actual LEGO brick colors, proper column alignment, and full-row clickability.
- **Inventory Display:** 
  - **Clean Design:** Transparent background with border-only styling, no gray shading on inventory groups
  - **Color Accuracy:** Color dots display actual LEGO brick colors parsed from hex RGB database format (e.g., "FF0000" → red)
  - **Layout:** Grid-based layout with column headers ("NEW" and "USED"), color dot (16px), color name (80px), and two-column grid for conditions
  - **Column Headers:** Small uppercase headers clearly label New and Used columns, separated by purple border
  - **Clean Values:** Quantities and prices display without prefixes (e.g., "194@$0.45" instead of "N: 194@$0.45")
  - **Full Row Interaction:** Entire color row is clickable to show item-level details
  - **Vertical Alignment:** New and Used values align vertically in their respective columns
- **Response Principles:** Concise answers, markdown formatting, includes BrickLink links, avoids hallucination, offers strategic advice when requested.

## External Dependencies

-   **BrickLink API:** Primary data source for LEGO inventory (categories, colors, inventory listings). Uses OAuth 1.0a. Credentials stored in `app_settings` or environment variables. **IMPORTANT: 5,000 API call limit per 24-hour period.** Tracks rate limits (warning at 2,500 calls, block at 4,750 calls). Supports paginated inventory sync (1,000 items/page). 
    - **Price-o-Matic API Usage**: Item detail calls (catalog item info + price guides) consume **3 API calls per item** (item details + stock price guide + sold price guide). Therefore, Price-o-Matic should ONLY be called when viewing individual item details in drawers, NOT during bulk sync operations. This prevents exceeding the 5,000 call daily limit.
    - Does NOT provide cost data; only selling price.
-   **ShipStation API:** Order management and fulfillment.
-   **OpenRouter API:** Powers the E.L.F.I.E. AI chat assistant, enabling multi-model access and dynamic model selection. Requires `OPENROUTER_API_KEY`.
-   **Neon:** Serverless PostgreSQL database provider.
-   **Radix UI:** UI component primitives.
-   **Recharts:** Data visualization library.
-   **Embla Carousel:** Image carousel component.
-   **date-fns:** Date utility library.
-   **Vaul:** Drawer component for modals.
-   **React Hook Form & Zod:** Form management and validation.
-   **Drizzle Kit:** Database migrations.