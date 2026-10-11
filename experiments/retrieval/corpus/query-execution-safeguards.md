---
document_id: demo-commerce-query-execution-safeguards
version: 1
effective_date: 2025-08-01
source: src/db/duckdb-query-plan-executor.ts
tenant: demo-commerce
---
# DuckDB Query Execution Safeguards

The QueryPlan executor opens DuckDB in read-only mode and applies a default execution deadline of 2,000 milliseconds. If the deadline expires, it interrupts the connection and reports a timeout error. Explicit date intervals also have a separate default maximum of 366 days, while `all_time` has no interval-length cap but remains subject to the execution deadline.

For example, an otherwise supported 400-day explicit interval is rejected by the date-limit safeguard before its result is returned. These defaults are application-owned controls and can be configured; they are not facts about how much commerce data exists.
