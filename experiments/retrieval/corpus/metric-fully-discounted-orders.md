---
document_id: demo-commerce-metric-fully-discounted-orders
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---
# Fully Discounted Orders in Revenue Metrics

The schema permits a discount equal to an order’s gross amount. In that case, the refund ceiling becomes zero, so the row must have no recorded refund. The status check permits either `completed` or `refunded` in this edge case because a zero refund both satisfies the completed rule and equals the zero post-discount amount. The order still contributes its gross amount to gross revenue but zero to net revenue and refund totals.

For example, an order with `100.00` gross, `100.00` discount, and `0.00` refund contributes `100.00` gross and `0.00` net. Its status alone does not resolve this edge case.
