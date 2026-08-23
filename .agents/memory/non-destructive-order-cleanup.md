---
name: Non-destructive order cleanup
description: Safety rules for reviewing historical order records that look duplicated.
---

Never delete historical orders merely because a legacy identifier resembles a canonical record. Treat the identifier as a candidate lead only: require matching order key, source, date, and total; reject split/reship and reused-number records; then preserve an immutable review archive rather than removing original rows.

**Why:** Historical imports contain legitimate zero-value, split, and reused-number orders that can match a narrow legacy pattern. A bulk cleanup can silently erase fulfillment and reporting history.

**How to apply:** Revalidate every candidate immediately before archival inside a transaction that prevents source records, lines, or split links changing during the review. Record both snapshots, comparison evidence, reviewer, and timestamp in a read-only review surface. Any new physical retention/deletion workflow needs separate explicit approval and audit design.