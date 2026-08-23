#!/bin/bash
set -euo pipefail

# Database schema changes are applied by the application's idempotent startup
# migrations. Do not run drizzle-kit push here: this project shares its
# production database, and Drizzle can pause on ambiguous table rename prompts
# (or propose destructive changes) even with --force.
npm install --no-audit --no-fund
npm run build
