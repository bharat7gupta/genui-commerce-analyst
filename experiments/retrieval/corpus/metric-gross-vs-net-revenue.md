---
document_id: demo-commerce-metric-gross-vs-net-revenue
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# Gross revenue compared with net revenue

Gross and net revenue answer different questions. Total gross revenue sums
`gross_amount` without subtracting anything. Net revenue sums each order's
gross amount after subtracting its `discount_amount` and `refund_amount`.
Neither metric excludes refunded or partially refunded orders automatically;
all statuses remain included unless an explicit supported status filter is
applied.

For an order with `500.00` gross, a `50.00` discount, and a `100.00` refund,
gross revenue contributes `500.00` while net revenue contributes `350.00`.
The repository does not define either value as profit and does not specify a
currency.
