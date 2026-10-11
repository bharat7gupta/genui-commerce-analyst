---
document_id: demo-commerce-field-refund-granularity
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# Refund transaction granularity

The dataset stores one `refund_amount` value on each order row. It does not
store separate refund transactions, refund identifiers, line-item allocations,
reasons, request timestamps, approval timestamps, or settlement timestamps.
An order's status constrains the single recorded amount, but it does not reveal
how many events produced that amount.

For example, O005 records a `100.00` refund and a `partially_refunded` status.
The data cannot show whether that value came from one action or several, which
items were affected, why the refund occurred, or when money moved. Those
questions are outside the implemented schema.
