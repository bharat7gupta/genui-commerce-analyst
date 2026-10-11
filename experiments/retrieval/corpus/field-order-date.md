---
document_id: demo-commerce-field-order-date
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# The order_date field

`order_date` is the required calendar date stored for each order. The dataset
defines it as a non-null DuckDB `DATE`, and analytics intervals filter this
field. The dataset does not contain separate refund-request, approval, payment,
shipment, or refund-completion dates.

For example, seeded order O005 has `order_date` 2025-08-09 and a partial
refund. A report covering `[2025-08-01, 2025-09-01)` includes that order because
its order date falls within the interval. The date does not establish when its
refund was requested or returned to a customer; that timing is absent from the
implemented dataset.
