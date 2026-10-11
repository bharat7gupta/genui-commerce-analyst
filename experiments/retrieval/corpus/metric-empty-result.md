---
document_id: demo-commerce-metric-empty-result
version: 1
effective_date: 2025-08-01
source: src/experiments/day-05-deterministic-numerical-evaluation.ts
tenant: demo-commerce
---

# Net revenue when no orders match

The verified DuckDB net-revenue aggregate distinguishes no matching orders from
a genuine total of zero. When an interval and supported filter match no rows,
`SUM(gross_amount - discount_amount - refund_amount)` returns one result row
whose `net_revenue` value is SQL `NULL`. The application does not replace that
value with zero.

For example, the deterministic evaluation queried North orders in
`[2025-10-01, 2025-10-02)` and found none. Its result was
`[{"net_revenue": null}]`. By contrast, matching orders whose arithmetic sums
to zero produce a decimal zero value, so callers can tell the cases apart.
