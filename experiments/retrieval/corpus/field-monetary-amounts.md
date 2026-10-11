---
document_id: demo-commerce-field-monetary-amounts
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# Monetary amount fields

Each order has `gross_amount`, `discount_amount`, and `refund_amount` fields.
They are non-null `DECIMAL(12, 2)` values. Gross amount must be non-negative.
Discount amount must range from zero through gross amount, and refund amount
must range from zero through the post-discount amount
`gross_amount - discount_amount`.

For example, seeded order O005 stores `450.00` gross, `45.00` discount, and
`100.00` refund. Those fields support gross revenue, net revenue, and refund
totals. The schema does not attach a currency code, distinguish tax or shipping,
or record multiple refund transactions for one order.
