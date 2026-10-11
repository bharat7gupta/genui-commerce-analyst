---
document_id: demo-commerce-field-order-identifiers
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# Order and customer identifiers

Every row has an `order_id` and a `customer_id`, both stored as non-null text.
`order_id` is the table's primary key, so it uniquely identifies an order.
`customer_id` is required but is not declared unique, meaning the schema does
not promise one order per customer.

For example, seeded order O001 uses `order_id` `O001` and `customer_id` `C001`.
These values identify records; they do not encode order dates, regions,
categories, payment methods, or refund decisions. The seed uses readable test
identifiers, but the schema does not define a business format beyond non-null
text and order-key uniqueness.
