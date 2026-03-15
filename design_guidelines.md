# E.L.F.I.E. Design Guidelines

## Design Approach
**Reference-Based Approach**: Drawing inspiration from data-dense productivity tools like Linear and Notion, combined with playful LEGO brand aesthetics. This is a utility-focused application where efficiency and information density are paramount.

## Core Design Elements

### A. Color Palette

**Dark Mode (Primary)**
- Background: Jet black (#000000 or 0 0% 0%)
- Dashboard section backgrounds: Soft gradients using LEGO colors
- LEGO Color Palette for Dashboard Tabs:
  - Dashboard: Classic LEGO Red (0 85% 55%)
  - Inventory: LEGO Blue (220 85% 55%)
  - Marketing: LEGO Yellow (48 95% 55%)
  - Sales: LEGO Green (140 70% 50%)

**Text Colors**
- Primary text: White (0 0% 100%)
- Secondary text: Light gray (0 0% 70%)
- Emphasis: Use dashboard-specific LEGO colors

**Gradient Backgrounds**
- Subtle radial or linear gradients using LEGO colors at 10-20% opacity
- Start from jet black, fade to LEGO color, return to jet black
- Example: radial-gradient from center, starting at black, peaking at LEGO color with 15% opacity

### B. Typography

**Font Families**
- Primary: Inter or Roboto (via Google Fonts)
- Monospace for data/metrics: JetBrains Mono or Roboto Mono

**Size Scale (Extra Small/Minimal)**
- Headers: text-sm to text-base (14px-16px)
- Body text: text-xs (12px)
- Metrics/Numbers: text-sm with font-medium
- Labels: text-xs with text-gray-400
- Navigation tabs: text-xs font-semibold

### C. Layout System

**Spacing Primitives**
- Use Tailwind units: 2, 3, 4, 6, 8
- Common patterns: p-2, p-4, gap-4, space-y-3, m-6, h-8

**Application Structure**
- Header: Fixed top, full width, h-12 to h-14
- Dashboard Navigation: Horizontal scrolling bar below header, h-10
- Analytics Section: Top section, approximately 2x header width (roughly 35-40% of viewport height)
- AI Chat Section: Bottom section, fills remaining space

**Grid System**
- Analytics cards: Use grid with gap-4, responsive columns (grid-cols-2 md:grid-cols-3 lg:grid-cols-4)
- Dense information layout with minimal padding

### D. Component Library

**Header**
- Left: E.L.F.I.E. logo/text (text-base font-bold with subtle LEGO color accent)
- Right: Gear icon button for settings modal
- Background: Solid jet black with subtle bottom border (border-gray-800)

**Dashboard Navigation Tabs**
- Horizontal scrollable container (flex overflow-x-auto)
- Each tab: Rounded pill shape (rounded-full or rounded-lg)
- Active state: Background filled with dashboard LEGO color at 100% opacity, white text
- Inactive state: Transparent background, LEGO color text at 60% opacity
- Hover: LEGO color at 30% opacity background
- Clear visual distinction between selected/unselected

**Analytics Cards**
- Dark background (bg-gray-900 or bg-gray-800/50)
- Thin border using dashboard LEGO color at 20% opacity
- Rounded corners (rounded-lg)
- Dense padding (p-3 to p-4)
- Label + Value layout: Label text-xs text-gray-400, Value text-sm font-semibold

**Metrics Display**
- Large numbers with LEGO color accent
- Small labels beneath
- Use monospace font for numerical values
- Group related metrics together

**AI Chat Interface (E.L.F.I.E.)**
- Chat container: Dark background (bg-gray-900)
- Messages: Alternating user/AI with subtle backgrounds
- Input area: Fixed at bottom, text-sm input with dashboard color accent
- E.L.F.I.E. branding/icon at top of chat section

**Settings Modal**
- Centered modal overlay with backdrop blur
- Dark background (bg-gray-900 with border)
- API key management interface
- Close button (X icon) top-right

**Graphs/Charts**
- Use Chart.js or Recharts with dark theme
- Line colors: Dashboard LEGO colors
- Grid lines: Subtle gray (gray-800)
- Tooltips: Dark with LEGO color accents
- Time period selector: Pills matching tab style (MTD, YTD, 1Y, 5Y)

### E. Interactions

**Scrolling**
- Horizontal scroll for dashboard tabs (hide scrollbar or use subtle custom styling)
- Vertical scroll for analytics section if content overflows
- Chat area: Independent scroll

**Hover States**
- Subtle brightening of LEGO colors (+10-20% lightness)
- Smooth transitions (transition-all duration-200)

**Loading States**
- Skeleton screens with gray-800 shimmer
- Spinner using dashboard LEGO color

## Design Principles

1. **Information Density**: Pack maximum useful data while maintaining readability through extra-small text
2. **Playful Professionalism**: Balance serious business analytics with fun LEGO color personality
3. **Contextual Color**: Each dashboard has its own LEGO color identity for quick visual navigation
4. **Minimal Distractions**: No unnecessary animations, focus on data clarity
5. **Dark-First**: Optimized for extended use with reduced eye strain

## Images
No hero images needed - this is a utility dashboard focused on data density and functionality.