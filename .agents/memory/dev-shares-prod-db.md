---
name: Dev shares the production database
description: The dev server and the autoscale deployment point at the same Neon DB
---

# Dev and the deployment share ONE Neon database

`DATABASE_URL` is identical in dev and in the autoscale deployment. Startup logs
confirm it: `[Dev] Auto-sync schedulers suppressed — dev server shares production
DB/credentials`. Corroborated by row counts matching prod exactly.

**Consequences:**
- Any `executeSql` write (e.g. `CREATE INDEX`) you run from the agent takes effect
  in PRODUCTION immediately — there is no separate dev copy to test against safely.
  Treat all writes as production writes.
- Read-only profiling (EXPLAIN ANALYZE) reflects real prod data and scale.
- A schema/index change still MUST also be added to `runMigrations()` so new
  environments and restores recreate it — but the live DB is already changed the
  moment you run the raw SQL.
- Auto-sync schedulers are intentionally suppressed in dev so dev doesn't fire real
  vendor syncs against the shared prod data.

**Why it matters:** "test it in dev first" is not a safety net here. Be as careful
with dev DB writes as with prod.
