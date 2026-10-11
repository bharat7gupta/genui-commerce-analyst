---
document_id: demo-commerce-metric-refunds-affect-net-revenue
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# How refunds affect net revenue

Recorded refunds reduce net revenue but do not change total gross revenue.
The implemented net calculation is
`SUM(gross_amount - discount_amount - refund_amount)`, while total refund
amount is calculated separately as `SUM(refund_amount)`. This describes
arithmetic over matching orders, not refund eligibility or payment processing.

For example, an order with `300.00` gross, a `20.00` discount, and an `80.00`
refund contributes `200.00` to net revenue and `80.00` to total refund amount.
It still contributes `300.00` to gross revenue. All order statuses are included
unless the query supplies an explicit supported status filter.
