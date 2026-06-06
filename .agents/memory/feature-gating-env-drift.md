---
name: Feature gating must not depend on per-environment DB rows
description: Why feature gates default in code, and the dev/prod DB-separation gotcha that hid gated dashboards in the published app
---

# Feature gating & the dev/prod database split

The deployed (published) app reads a DIFFERENT database than the dev server, even
though a dev startup log line claims "dev server shares production DB/credentials."
That comment is about credentials/intent, not a guarantee — do not trust it.

**Symptom that proved it:** deployment logs showed `GET /api/features` returning
`{"visible":[],"beta":[],"stages":{}}` while the dev DB had 8 keyed capabilities.
The published DB simply had `feature_key` unset on every `product_capabilities`
row (keyed=0), so the runtime gate set was empty and all gated dashboards were
hidden for everyone — including super admins.

**Rule:** runtime feature gates must have a code-level source of truth
(`FEATURE_GATE_DEFAULTS` in `server/services/feature-gate.ts`) so behaviour is
identical in every environment. A DB roadmap row carrying the same `featureKey`
may OVERRIDE the stage per-environment, but the gate must still resolve when the
DB has no matching row.

**Why:** feature keys/stages live in `product_capabilities`, which is
per-environment data. Publishing code does not copy that data, and the prod DB is
read-only via tooling (cannot be seeded by script). Relying on DB rows alone means
a fresh/unseeded prod DB silently breaks all gating.

**How to apply:** when adding a new gated feature, add its key + default stage to
`FEATURE_GATE_DEFAULTS`, not just a DB row. To verify prod, check deployment logs
for the `/api/features` response shape rather than assuming the dev DB reflects
prod. Note: `executeSql({environment:"production"})` hits a Replit-managed replica
that may itself differ from the deployed app's actual DB — corroborate with
deployment logs.
