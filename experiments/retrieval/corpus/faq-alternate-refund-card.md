---
document_id: demo-commerce-faq-alternate-refund-card
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: Can a refund go to a different card?

**Experimental fixture:** this invented answer is not behavior implemented by
the application.

No. Demo-commerce sends an approved refund to the original payment method, not
to a different card selected by the customer. If the original method cannot
accept funds, support contacts the customer before using the fictional demo
store-credit fallback. That fallback does not change eligibility or accelerate
the five-business-day processing target. The commerce dataset has no card,
payment-method, customer-contact, or store-credit fields, so analytics cannot
confirm where a recorded `refund_amount` was delivered.
