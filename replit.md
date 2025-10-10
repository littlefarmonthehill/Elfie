# PlanetBrick - LEGO Business Operations Dashboard

## Overview
PlanetBrick is a comprehensive business operations and analytics dashboard for LEGO reselling businesses. It integrates with BrickLink and ShipStation to offer real-time inventory management, order tracking, sales analytics, and marketing insights. The application features a dark-mode interface with LEGO-inspired colors and an AI chat assistant (E.L.F.I.E.) for operational guidance. The vision is to provide a complete operational toolkit for LEGO resellers, enhancing efficiency and profitability through data-driven decisions and intelligent automation.

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
- **Data Storage:** Schema includes `users`, `bl_categories`, `bl_colors`, `bl_inventory`, `orders`, and `order_details` tables. Features incremental synchronization with timestamp tracking for external APIs.
- **Settings Management:** Global application settings (AI enablement, API keys, selected AI model) stored in a single-row `app_settings` PostgreSQL table, accessible via `/api/settings`.
- **Authentication:** Basic username/password authentication with UUID-based user identification and in-memory storage (for development). Future plans include session-based authentication and secure password hashing.

### AI Assistant (E.L.F.I.E.)
- **Integration:** OpenRouter API for multi-model access (default: GPT-4o-mini).
- **Context & Memory:** Persistent conversation memory via `localStorage` and `conversations` table, injecting context into system prompts.
- **Context-Aware Responses:** Provides summary prompts for dashboard insights (Inventory, Orders, Sales, Marketing).
- **Direct Database Access:** Queries `bl_inventory` and `orders` tables based on user input, using part numbers and multi-keyword search, formatting results into system prompts.
- **Interactive Features:** Formats AI responses as markdown bullet lists with clickable part numbers (opening detail modals) and BrickLink URLs (opening sandboxed iframe dialogs). Includes grouped inventory display with color dots and condition badges.
- **Response Principles:** Concise answers, markdown formatting, includes BrickLink links, avoids hallucination, offers strategic advice when requested.

## External Dependencies

-   **BrickLink API:** Primary data source for LEGO inventory (categories, colors, inventory listings). Uses OAuth 1.0a. Credentials stored in `app_settings` or environment variables. Tracks API call rate limits (warning at 2,500 calls/24h, block at 4,750 calls/24h) and supports paginated inventory sync (1,000 items/page). Does NOT provide cost data; only selling price.
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