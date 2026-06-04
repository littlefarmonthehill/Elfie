---
name: Org timezone display
description: How org timezone is exposed/named and why timestamps must render in org tz, not device tz
---

# Org timezone display

- **Field naming differs by layer (easy to get wrong):**
  - DB column: `appSettings.orgTimezone` (schema), default `America/Chicago`.
  - API response: `GET /api/settings` returns it as `timezone` (NOT `orgTimezone`).
  - Frontend reference pattern (working): `useQuery(['/api/settings'])` then `appSettings?.timezone || 'America/Chicago'` (see InventoryDashboard).
  - SettingsModal reads/writes the raw `timezone` field too.

- **Rule:** Order timestamps (e.g. `ship_date`) are stored as `timestamp` (no tz) holding the UTC wall-clock from `new Date()`. Any calendar-day/time DISPLAY must format in the org timezone, e.g. `new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone: orgTz })`. Do NOT use bare `date-fns format(new Date(...))` — that renders in the viewing device's timezone.

- **Why:** Bug — evening shipments in Central time get stamped past midnight UTC, so device-tz (or UTC) formatting rolled them to "the next day" on the Sales → Shipped list. Confirmed in prod (e.g. shipped ~7pm Central stored as `00:19Z` next day).

- **How to apply:** When showing any stored timestamp's date/time to users, pull org tz from `/api/settings` (`timezone`) and pass `timeZone` to the Intl formatter. A code reviewer once flagged `timezone` as wrong and insisted on `orgTimezone` — that's the DB name, not the API name; trust the InventoryDashboard pattern.
