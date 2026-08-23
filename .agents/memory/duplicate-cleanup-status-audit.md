---
name: Duplicate cleanup status audit
description: Safety rule for marketplace-status verification of a fixed historical reconciliation batch.
---

Use an immutable manifest of the reviewed local/source-order identity pairs for a historical cleanup batch. Do not regenerate its membership from mutable values such as current status, timestamps, or whether it still has missing lines.

**Why:** A successful correction changes the very fields that a dynamic filter uses, causing a reviewed record to vanish from the audit queue. That makes the original review scope unverifiable and permits unrelated rows to drift into the batch.

**How to apply:** Derive marketplace evidence only from the canonical local ID/key binding and require the returned source record to repeat that immutable source ID. Keep all manifest entries visible with their audit record after review; before a status-only correction, recheck the original zero-line eligibility inside the write transaction.