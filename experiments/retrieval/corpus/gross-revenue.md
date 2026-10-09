---
document_id: demo-commerce-gross-revenue
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# Gross revenue

Gross revenue is the sum of `gross_amount` across the matching orders. Its
implemented metric name is `total_gross_revenue`, and its calculation is
`SUM(gross_amount)`. Discounts and refunds are not subtracted from this metric.
Every order status—`completed`, `partially_refunded`, and `refunded`—is included
unless the request supplies an explicit supported status filter.

For example, seeded order O005 has a gross amount of `450.00`, a discount of
`45.00`, and a refund of `100.00`. When O005 is the only matching order, gross
revenue is `450.00`; the discount and refund do not change that result. The
repository does not define a currency for these amounts, so the value should
not be labeled with an invented currency.
