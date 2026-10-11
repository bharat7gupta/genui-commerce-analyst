---
document_id: demo-commerce-metric-net-revenue-nonnegative
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---
# Why Seeded Net Revenue Cannot Be Negative

The seeded orders table constrains every monetary component so an order’s net contribution cannot fall below zero. Gross amount is nonnegative, discount cannot exceed gross, and refund cannot exceed the remaining amount after discount. Because net revenue sums `gross_amount - discount_amount - refund_amount`, every stored row contributes zero or more under this schema.

For example, gross `100.00`, discount `20.00`, and refund `80.00` produce zero net revenue. A refund of `90.00` would violate the table constraint. This guarantee describes valid rows in the seeded schema, not every possible commerce dataset.
