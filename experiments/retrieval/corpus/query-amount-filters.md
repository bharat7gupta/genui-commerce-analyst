---
document_id: demo-commerce-query-amount-filters
version: 1
effective_date: 2025-08-01
source: src/query-plan/query-plan.ts
tenant: demo-commerce
---
# Monetary Amount Filter Rules

The query-plan schema defines monetary filters for gross amount, discount amount, and refund amount. Each accepts a nonnegative numeric value with one of five comparisons: equal to, greater than, greater than or equal to, less than, or less than or equal to. The schema does not accept negative thresholds, arbitrary expressions, or a filter on a computed metric such as net revenue.

For example, `refund_amount > 0` is a representable amount filter. A condition such as `gross_amount - discount_amount > 50` is not; that expression would require a separately defined field or supported query behavior.
