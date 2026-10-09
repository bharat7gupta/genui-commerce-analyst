---
document_id: demo-commerce-refunds
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# Refunds

The refund metric totals the `refund_amount` values of the matching orders.
Its implemented metric name is `total_refund_amount`, and its calculation is
`SUM(refund_amount)`. It includes all order statuses unless an explicit
supported status filter is applied. In the seeded data, completed orders have
zero refunds, partially refunded orders have a positive refund smaller than
their post-discount amount, and refunded orders have a refund equal to their
post-discount amount.

For example, seeded order O005 is partially refunded and has a `refund_amount`
of `100.00`. If O005 is the only matching order, total refund amount is
`100.00`. This metric counts the recorded refund amount; it does not subtract
refunds from gross revenue or define a refund rate. No currency is specified.
