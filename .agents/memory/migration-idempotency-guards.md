---
name: Migration idempotency guard drift
description: Why startup-migration "skip if X exists" guards break, and how to guard correctly
---

# Startup migration idempotency guards must key on the migration's real precondition

This project builds much of its schema via numbered runtime startup migrations in
`server/db.ts` / `server/index.ts` (Phase-N), NOT in `shared/schema.ts`.

## Rule
A one-time migration's idempotency guard must check the **actual precondition the
migration consumes** (e.g. "does the source column still exist"), not a transient
sentinel/fallback table the migration happens to create.

**Why:** A "reclaim ghost column slots" phase guarded itself with "skip if
`app_settings_old` exists". That fallback table was later cleaned up, so the guard
stopped detecting completion and the phase re-ran on every boot. It then failed at
`INSERT ... SELECT openai_api_key FROM app_settings` because a later phase had moved
that column to `platform_settings`. The thrown error halted the ENTIRE migration
chain every boot (later phases silently stopped running) and left an empty
`app_settings_v2` table behind each boot — which made Replit's publish flow propose a
destructive DROP. Fix was to also require the legacy `openai_api_key` column to still
exist on `app_settings` before running; absent column => reclaim obsolete => skip.

**How to apply:** When the migration chain "stops at Phase-N" or a publish diff wants
to DROP runtime-created objects, suspect a sentinel-based guard whose sentinel was
cleaned up. Re-key the guard on the data/column the migration reads. Verify the chain
runs to completion in logs ("All startup migrations finished successfully") for BOTH a
fresh DB (precondition present => runs) and an already-migrated DB (absent => skips).

## Root-cause caveat
Runtime DDL (instead of `shared/schema.ts`) is the underlying source of recurring
destructive publish diffs here. User constraint: NEVER db:push/db:drop (dev shares the
LIVE prod DB); schema changes additive-only. Do not add startup DDL to "self-heal"
prod and do not run DDL against prod — the supported fix path is the schema source of
truth, gated on user approval.
