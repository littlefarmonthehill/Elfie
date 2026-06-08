---
name: Build & check commands
description: The real typecheck script name vs. what replit.md documents
---

# Typecheck command

Run `npm run check` to typecheck (it runs `tsc`).

**Why:** `replit.md` documents `npm run typecheck`, but **that script does not exist** in this repo — it will fail. The actual script is `check`.

**How to apply:** Whenever you need to typecheck this project, use `npm run check`. Do not trust the `npm run typecheck` line in replit.md.
