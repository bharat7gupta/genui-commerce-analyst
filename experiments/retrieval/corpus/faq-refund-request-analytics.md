---
document_id: demo-commerce-faq-refund-request-analytics
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Does Requesting a Refund Change Revenue Analytics?

**Experimental fixture:** This FAQ describes an invented support workflow, not an application feature. Merely requesting or approving a refund does not create a separate pending-refund value in the analytics dataset. The implemented revenue calculations use the refund amount recorded on an order, and the dataset has no request, approval, or payment-provider timestamp fields. Analytics therefore cannot show a pending support request unless its monetary effect has been recorded.

For example, opening a refund case without changing the order’s refund amount leaves the calculated net revenue unchanged. This explains dataset behavior, not when support must update an order.
