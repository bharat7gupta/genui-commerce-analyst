---
document_id: demo-commerce-faq-refund-completion-data
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: Can analytics show when a refund finished?

**Experimental fixture:** this fictional support answer does not add an
application capability.

No. The demo-commerce analytics dataset records the order date, a refund
amount, and the order's refund-related status, but not request, approval,
submission, or settlement timestamps. It therefore cannot establish when a
customer's money became available. In the fictional workflow, a customer must
contact support with the order number for status information, and payment
providers may add time after submission. An order marked `refunded` describes
the recorded order state; it is not a dated bank-settlement event.
