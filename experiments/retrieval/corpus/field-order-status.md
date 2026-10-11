---
document_id: demo-commerce-field-order-status
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# The order status field

The required `status` field allows `completed`, `partially_refunded`, or
`refunded`. The database ties each value to `refund_amount`. A completed order
has zero refund. A partially refunded order has a positive refund smaller than
its post-discount amount. A refunded order has a refund equal to its full
post-discount amount.

For example, O010 has `250.00` gross, a `25.00` discount, and a `225.00`
refund, so its status is `refunded`. Status describes the seeded order's refund
state; it does not encode eligibility rules, processing dates, payment methods,
or a separate pending-refund state.
