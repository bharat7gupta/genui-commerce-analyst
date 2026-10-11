---
document_id: demo-commerce-policy-store-credit-fallback
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Store-credit fallback for refunds

**Experimental fixture:** this invented fallback is not implemented by the
application.

Demo-commerce normally sends an approved refund to the original payment method.
If that method cannot accept the refund, the support desk contacts the customer
before issuing demo store credit instead. Store credit is a fallback, not the
default destination, and it does not bypass eligibility review or change the
five-business-day processing target after approval. The dataset has no payment
method, delivery destination, contact record, or store-credit balance, so its
`refund_amount` cannot show which destination was used.
