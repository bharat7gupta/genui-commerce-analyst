---
document_id: demo-commerce-faq-refund-destination
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: Where is refunded money sent?

**Experimental fixture:** this invented demo-commerce answer is not behavior
implemented by the application.

After approval, the fictional tenant returns money to the original payment
method. If that method cannot accept a refund, the support desk contacts the
customer before issuing demo store credit. Processing is targeted within five
business days after approval, although a bank may need more time to display the
funds. The commerce dataset has no payment-method, bank, store-credit, approval,
or settlement fields. Its `refund_amount` records an amount for analytics but
does not reveal where the money was sent or when it arrived.
