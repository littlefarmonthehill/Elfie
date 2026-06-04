---
name: Date/time display convention
description: How all client-side dates/times are rendered (org timezone + abbreviation) and the date-only day-shift trap.
---

# Date/time display convention (client)

All user-facing dates/times render in the ORG's timezone (from Settings `timezone`),
NOT the device timezone, and time-of-day displays show the zone abbreviation (e.g. "CDT").

**Why:** Industry standard for a shared operations SaaS (ShipStation/Shopify/Stripe) —
the whole team sees the same wall-clock time regardless of their laptop. User explicitly
chose this "everywhere in the app" (dashboards, billing, sync logs, chat, etc.).

**How to apply:**
- In a component: `const tz = useOrgTimezone();` (from `@/hooks/use-org-timezone`, reads
  `useQuery(['/api/settings']).timezone`, falls back to `DEFAULT_ORG_TIMEZONE` = America/Chicago).
- Field names differ: API field (GET /api/settings) is `timezone`; the DB column is `orgTimezone`.
- Format with helpers in `@/lib/utils`: `formatDate(value, tz, opts?)` (date only, no abbr),
  `formatTime(value, tz)` and `formatDateTime(value, tz)` (both include `timeZoneName:'short'`).
  All return "—" for null/invalid. They cache `Intl.DateTimeFormat` keyed by tz+options.
- Non-component helper functions can't call the hook → thread a `tz: string` param from the caller.
- Leave alone: numeric `.toLocaleString()` (counts/currency/qty), and relative-time helpers
  (`formatDistanceToNow`, "Xh ago") — relative durations are timezone-independent.

## Date-only day-shift trap (important)
A **date-only** value (`YYYY-MM-DD`, e.g. a "Sync from" label or a calendar-bucket label) is
NOT an instant. Do NOT parse it at local midnight and reformat in org tz — that shifts the
displayed calendar day for users whose device tz ≠ org tz. Render it in UTC so the stored date
shows exactly: `formatDate(iso + 'T12:00:00Z', 'UTC', opts)`. Same applies to synthetic chart
bucket Dates built from `new Date(year, m, d)` — don't run those through the org-tz formatter.
