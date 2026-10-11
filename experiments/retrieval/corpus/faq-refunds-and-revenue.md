---
document_id: demo-commerce-faq-refunds-and-revenue
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: Why did a refund change revenue?

**Experimental fixture:** this fictional support answer is not an application
feature or an additional metric definition.

In demo-commerce reporting, a recorded refund lowers net revenue because net
revenue subtracts `refund_amount`. It does not lower total gross revenue, which
continues to sum the original `gross_amount`. The refund also contributes to
the separate total refund amount metric. For example, a `50.00` recorded refund
reduces that order's net contribution by `50.00` while adding `50.00` to refund
totals. This FAQ explains reporting effects only; it does not establish whether
a customer is eligible or when money reaches them.
