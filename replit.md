# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a comprehensive business operations and analytics dashboard designed for LEGO reselling businesses. It integrates with BrickLink and ShipStation to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The application features a dark-mode interface with a LEGO-inspired aesthetic and includes an AI chat assistant (E.L.F.I.E.) for operational guidance. The project's vision is to offer a complete operational toolkit that enhances efficiency and profitability for LEGO resellers through data-driven decisions and intelligent automation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack:** React 18+ with TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui (Radix UI), and Tailwind CSS.
- **Design System:** Dark mode with jet black backgrounds and a LEGO-themed color palette (Red, Blue, Orange, Yellow, Green). Typography uses Inter/Roboto for UI and JetBrains Mono for metrics, with a focus on compact spacing and gradient backgrounds.
- **Component Architecture:** Features a modular dashboard with tab-based navigation, reusable metric cards, drawer-based detail modals, and a purple/violet themed AI chat interface. The design is responsive, including dynamic overflow management for iOS keyboard compatibility.

### Backend
- **Server Framework:** Express.js with TypeScript and Node.js, utilizing ESM modules.
- **Database Layer:** Drizzle ORM with Neon serverless PostgreSQL, and `ws` for WebSockets.
- **API Design:** RESTful endpoints (`/api`) handle data operations and integrations, including syncs for BrickLink and ShipStation. User management for development uses in-memory storage.
- **Data Storage:** The schema includes tables for `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders`, `order_details`, and `sync_metadata`.
- **Sync Architecture:** Optimized batch operations and incremental synchronization for BrickLink (1000-item batches, selective updates) and ShipStation (fetching orders modified since the last sync). A `sync_metadata` table tracks sync status and performance.
- **Settings Management:** Global application settings (AI enablement, API keys, AI model) are stored in a single-row `app_settings` PostgreSQL table.
- **Authentication:** Basic username/password authentication with UUID-based user IDs is implemented, with future plans for session-based authentication and secure password hashing.

### AI Assistant (E.L.F.I.E.)
- **Integration:** Powered by the OpenRouter API for multi-model access (default: GPT-4o-mini).
- **Context & Memory:** Utilizes `localStorage` and a `conversations` table for persistent memory, injecting context into system prompts.
- **Context-Aware Responses:** Provides summary prompts for dashboard insights across Inventory, Orders, Sales, and Marketing.
- **Direct Database Access:** Queries `bl_inventory` and `orders` tables based on user input, supporting part numbers and multi-keyword searches, and formatting results into system prompts.
- **Interactive Features:** Responses are formatted in markdown with clickable part numbers (opening detail modals) and BrickLink URLs (opening sandboxed iframe dialogs). Inventory displays are grouped with actual LEGO brick colors, proper column alignment, and full-row clickability.
- **BrickLink Catalog Integration:** When items aren't found in local inventory, Elfie suggests checking the BrickLink catalog. Upon user confirmation ("yes", "sure", etc.), searches BrickLink API (tries SET then PART types) and opens catalog item in the detail modal instead of showing text. Modal displays item name, number, type, category, weight, year released, and is clearly labeled as "BrickLink Catalog Item" to distinguish from local inventory. Uses sessionStorage to pass catalog data to modal.
- **Response Principles:** Focuses on concise answers, markdown formatting, inclusion of BrickLink links, avoidance of hallucination, and offers strategic advice when requested.

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