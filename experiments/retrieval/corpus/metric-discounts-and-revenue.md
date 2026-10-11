---
document_id: demo-commerce-metric-discounts-and-revenue
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# How discounts affect revenue metrics

Discounts affect net revenue but not total gross revenue. Gross revenue sums
`gross_amount`. Net revenue subtracts both `discount_amount` and
`refund_amount` from gross amount for every matching order. Total refund amount
sums only `refund_amount`, so a discount is not itself counted as a refund.

For example, an order with `500.00` gross, a `50.00` discount, and no refund
contributes `500.00` to total gross revenue, `450.00` to net revenue, and
`0.00` to total refund amount. These calculations include all statuses unless
an explicit supported status filter is applied.
