---
name: Shared route utilities
description: Where canonical shared route helpers live after the code-review refactor; what was duplicated and where it went.
---

## The rule
Never define route helpers locally in a router file. Always import from the shared lib.

## Canonical locations
- `server/lib/routeHelpers.ts` — `reqOrgId`, `asyncRoute`, `getOrgSettings`, `updateOrgSettings`, `getOrgTimezone`, `tzDateBounds`, `resolvedCatalogItemName`, `activeOrderStatusWhere`, `decodeHtmlEntities`, `maskSecret`, `maskSettingsSecrets`, `SECRET_FIELDS`
- `server/lib/platformSettings.ts` — `getPlatformSettings`, `getPlatformOpenAIKey`, `getPlatformBrickLinkCredentials`

## What was duplicated (before fix)
`getOrgSettings` was in 8 routers; `resolvedCatalogItemName` in 6; `maskSecret`/`maskSettingsSecrets` in 3; `decodeHtmlEntities`/`activeOrderStatusWhere`/`tzDateBounds`/`getOrgTimezone` in 2 each.

## Backward compat
`server/routes.ts` re-exports all three platform helpers so any code still importing from `'../routes'` continues to work — but new code should import from `../lib/platformSettings` directly.

## New domain routers (extracted from routes.ts)
- `server/routers/auth.ts` — auth/user, preview-mode, preferences, plans
- `server/routers/org.ts` — org CRUD, logo, factory-reset, integrations
- `server/routers/admin.ts` — admin user/org management, one-off repair tools
- `server/routers/export.ts` — BL XML, inventory CSV, quantity comparison
- `server/routers/marketing.ts` — marketing outreach

**Why:** routes.ts was 1238 lines mixing helpers + routes + orchestration. After refactor: 289 lines (orchestration only).
