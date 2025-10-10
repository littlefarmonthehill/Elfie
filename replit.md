# PlanetBrick - LEGO Business Operations Dashboard

## Overview

PlanetBrick is a comprehensive business operations and analytics dashboard designed for LEGO reselling businesses. It integrates with BrickLink and ShipStation to provide real-time inventory management, order tracking, sales analytics, and marketing insights. The application features a dark-mode interface with LEGO-inspired color schemes and an AI chat assistant (E.L.F.I.E.) for operational guidance.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- **Framework:** React 18+ with TypeScript
- **Build Tool:** Vite for fast development and optimized production builds
- **Routing:** Wouter for lightweight client-side routing
- **State Management:** TanStack Query (React Query) for server state management
- **UI Framework:** Shadcn/ui components built on Radix UI primitives
- **Styling:** Tailwind CSS with custom LEGO-themed color palette

**Design System:**
- Dark mode as primary theme with jet black backgrounds (#000000)
- LEGO brand colors for dashboard sections:
  - Dashboard: Red (0 85% 55%)
  - Inventory: Blue (220 85% 55%)
  - Orders: Orange (25 95% 55%)
  - Marketing: Yellow (48 95% 55%)
  - Sales: Green (140 70% 50%)
- Typography: Inter/Roboto for UI, JetBrains Mono for metrics
- Compact spacing using minimal size scale (text-xs to text-base)
- Gradient backgrounds with LEGO colors at 10-20% opacity

**Component Architecture:**
- Modular dashboard system with tab-based navigation
- Reusable metric cards for data visualization
- Detail modals (drawer-based) for in-depth item views
- Chat interface with purple/violet theme for AI assistant
- Responsive design with mobile breakpoint at 768px
- **iOS Keyboard Fix (Dynamic Overflow Management):** Chat interface uses JavaScript to temporarily adjust overflow properties
  - **ChatInterface Component:** Replaced Radix ScrollArea (overflow-hidden) with `<div className="overflow-y-auto">`
  - **Parent Containers:** Keep `overflow-hidden` for layout integrity, but dynamically adjust on iOS when input focused
  - **iOS Detection:** Detects iPad/iPhone/iPod via user agent or MacIntel with touch support
  - **On Input Focus:** Walks parent tree, temporarily changes `overflow: hidden` to `overflow: visible`, stores original in `data-original-overflow`
  - **On Input Blur:** Restores original overflow values from data attributes, removes attributes
  - Uses `-webkit-overflow-scrolling: touch` and `touch-action: manipulation` for smooth iOS interaction
  - Tracks input focus state (`isInputFocused`) to prevent scroll-triggered keyboard dismissal
  - `scrollToBottom()` completely disabled when input has focus
  - Auto-scroll only occurs when input is not focused (after sending message)
  - **Critical:** Layout preserved when input not focused, iOS can scroll input into view when keyboard appears
  - **Critical:** Never trigger scroll events (scrollIntoView, etc.) while input is focused on mobile

### Backend Architecture

**Server Framework:**
- Express.js with TypeScript running on Node.js
- ESM module system throughout the application

**Database Layer:**
- Drizzle ORM for type-safe database operations
- Neon serverless PostgreSQL as the database provider
- WebSocket support via ws library for real-time connections
- Schema-driven design with separate tables for:
  - User authentication
  - BrickLink data (categories, colors, inventory)
  - ShipStation orders and order details

**API Design:**
- RESTful endpoints under `/api` prefix
- Sync endpoints for external service integration:
  - `/api/sync/bricklink/inventory` - Syncs BrickLink inventory data
  - `/api/sync/shipstation/orders` - Syncs ShipStation order data
- In-memory storage implementation (MemStorage) for user management
- Incremental sync strategy planned for external APIs

**Development Features:**
- Hot Module Replacement (HMR) via Vite in development
- Request logging middleware with response time tracking
- Error handling middleware for consistent error responses
- Replit-specific plugins for development experience

### Data Storage Solutions

**Database Schema:**
- `users` table: User authentication with UUID primary keys
- `bl_categories` table: BrickLink product categories with sync timestamps
- `bl_colors` table: BrickLink color definitions with RGB values
- `bl_inventory` table: Inventory items with pricing, quantities, and metadata
- `orders` table: Customer orders from multiple platforms
- `order_details` table: Line items for orders

**Data Synchronization:**
- Incremental sync approach with timestamp tracking
- Differential updates (added vs. updated records)
- API call counting for rate limit management
- Background sync capability via dedicated endpoints

### App Settings & Configuration

**Settings Management:**
- PostgreSQL table `app_settings` stores application configuration
- Single-row design for global settings
- Fields: `aiEnabled` (boolean), `openrouterApiKey` (text), `selectedModel` (text), `updatedAt` (timestamp)
- API routes: GET/POST `/api/settings` for reading and updating configuration
- Settings auto-initialize with environment variable OPENROUTER_API_KEY on first access

**AI Configuration:**
- Toggle to enable/disable E.L.F.I.E. AI assistant
- OpenRouter API integration for multi-model access
- Custom OpenRouter API key storage (password-protected input)
- Dynamic model selection from available OpenRouter models
- Settings persist across sessions
- Chat endpoint enforces enabled flag and uses stored API key and selected model
- Specific error messages when AI disabled or key missing

### Authentication & Authorization

**Current Implementation:**
- Basic user authentication structure in place
- Username/password based authentication schema
- UUID-based user identification
- In-memory user storage (development phase)

**Planned Enhancements:**
- Session-based authentication with connect-pg-simple
- Secure password hashing (schema prepared)
- Protected API routes with user context

### External Dependencies

**Third-Party APIs:**
- **BrickLink API:** Primary data source for LEGO inventory
  - Categories and color definitions
  - Inventory listings with pricing
  - OAuth 1.0a authentication implemented with consumer key/secret and token
  - **Credentials Storage:** BrickLink credentials (Consumer Key, Consumer Secret, Token Value, Token Secret) are stored in the database (`app_settings` table) and can be configured via Settings UI > Platforms tab
  - Credentials fallback to environment variables if not set in database
  - **Important Limitation:** BrickLink API does NOT provide cost data (`my_cost` field). The API only returns: inventory_id, item details, color, quantity, condition, unit_price (selling price), and other metadata. Cost tracking must be implemented separately in this app.
  - **Rate Limiting:** Tracks all API calls in `bl_api_calls` table
    - Warning threshold: 2,500 calls per 24 hours (yellow UI alert)
    - Block threshold: 4,750 calls per 24 hours (red alert, sync disabled)
    - Real-time usage display in Settings modal
    - Rolling 24-hour window for call counting
  - **Pagination Support:** BrickLink inventory sync uses paginated requests
    - Fetches 1,000 items per page to handle large inventories (20,000+ lots, 775,000+ parts)
    - Automatically continues fetching until all inventory is synced
    - Respects rate limits between pages (checks before each API call)
    - Console logging for sync progress tracking
    - GET /api/bricklink/rate-limit endpoint provides current usage status
  
- **ShipStation API:** Order management and fulfillment
  - Order synchronization with customer details
  - Shipping status tracking
  - Basic authentication (API key + secret, not yet implemented)

**AI Integration:**
- OpenRouter API for E.L.F.I.E. chat assistant (multi-model support)
- Default model: GPT-4o-mini (openai/gpt-4o-mini)
- Context-aware responses based on active dashboard
- Action prompts for common operations
- Full conversation history management
- **Direct Database Access:** E.L.F.I.E. queries actual database tables to answer questions
  - **Inventory Queries:** Detects part numbers in messages (regex: `/\b(\d{4,5})\b/`), queries `bl_inventory` with joins to `bl_colors` and `bl_categories`
  - **Order Queries:** Detects "order" keyword, fetches recent orders from `orders` table with line items from `order_details`
  - **Database Context Injection:** Query results formatted and injected into system prompt for AI to use
  - **Query Filtering:** Uses `LIKE` operator for flexible part number matching (e.g., "3021" matches "30212", "3021", "30210")
  - **Performance:** Limits inventory results to 50 items, order details to 5 items per order, queries 20 most recent orders
  - **Drizzle ORM:** Uses immutable query builder pattern (reassign variables when filtering)
- **Response format:** Concise answers (under 5 sentences) with actionable guidance
- **Always includes BrickLink links** for referenced parts/sets
- **Never hallucinates data:** Uses actual database query results; acknowledges when no data found
- **Strategic advice:** Available when explicitly requested (analyze, optimize, improve, strategy keywords)
- **Custom System Prompts:** Supports user-defined system prompts stored in database; database context appended automatically
- Dynamic model selection from OpenRouter's model catalog
- Requires valid OPENROUTER_API_KEY environment variable or user-provided key

**UI Libraries:**
- Radix UI: Comprehensive component primitives (dialogs, dropdowns, tooltips, etc.)
- Recharts: Data visualization for sales and order trends
- Embla Carousel: Image carousels for product displays
- date-fns: Date formatting and manipulation
- Vaul: Drawer component for mobile-friendly modals

**Development Tools:**
- Drizzle Kit: Database migrations and schema management
- tsx: TypeScript execution for development server
- esbuild: Production server bundling
- Replit plugins: Development banner, cartographer, runtime error overlay

**Form Handling:**
- React Hook Form with Zod validation
- @hookform/resolvers for schema integration
- drizzle-zod for database schema validation

**Utility Libraries:**
- clsx & tailwind-merge: Class name management
- class-variance-authority: Component variant styling
- nanoid: Unique ID generation