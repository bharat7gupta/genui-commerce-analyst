---
document_id: demo-commerce-net-revenue
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# Net revenue

Net revenue is gross revenue after subtracting discounts and refunds. The
implemented metric name is `net_revenue`, and its calculation is
`SUM(gross_amount - discount_amount - refund_amount)`. The calculation is
applied to all matching orders, including every order status, unless an
explicit supported status filter is present. Net revenue is not defined as
profit: the repository has no cost or profit fields in this metric.

For example, seeded order O005 has `450.00` gross amount, `45.00` discount, and
`100.00` refund. If it is the only matching order, net revenue is `305.00`
(`450.00 - 45.00 - 100.00`). The repository does not specify a currency, so
the result remains a decimal amount without a currency label.
