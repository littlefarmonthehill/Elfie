---
name: Super-admin gating is scattered, not centralized
description: Where super-admin access is enforced server-side, and why session-level suppression must touch every spot.
---

Super-admin access is NOT gated in one place. Any session-level suppression
(the "view as regular user" preview flag `session.previewAsUser`, or
impersonation) must be applied at EVERY one of these independent checks, or it
leaks:

- `isSuperAdmin` middleware (`server/auth.ts`).
- `resolveSuperAdmin()` in `server/services/feature-gate.ts` (drives `/api/features` visibility).
- Direct `user.superAdmin` checks inside route handlers that are NOT behind the
  middleware — e.g. per-org routes that allow "own org OR super admin" cross-org
  reads in `server/routers/platformAdmin.ts`.
- Ad-hoc `req.user.superAdmin` reads in feature routers (e.g. `server/routers/ai.ts`).

**Why:** preview mode initially only patched the middleware + feature-gate; a
direct `!user.superAdmin` check in a platform-admin route still granted
cross-org access while previewing (an IDOR-like leak caught in review).

**How to apply:** when adding/changing any session-level access suppression,
grep `user\.superAdmin|req\.user.*superAdmin|sessionUser\?\.superAdmin` across
`server/` and make each gating use preview-aware logic
(`user.superAdmin && !req.session?.previewAsUser`). Ignore non-gating matches
(console.logs, body params like `parsed.data.superAdmin`). `/api/auth/user`
returns EFFECTIVE `superAdmin` (false while previewing) plus `actualSuperAdmin`
+ `previewAsUser` so the client toggle/banner can still recover.
