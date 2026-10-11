---
document_id: demo-commerce-policy-store-credit-expiration
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Store-Credit Expiration

**Experimental fixture:** This is an invented demo-commerce policy, not application behavior. Store credit issued under the unavailable-payment-method fallback expires 12 months after its issue date. Support must tell the customer the expiration date when issuing the credit. Expiration does not change refund eligibility, the approved amount, or the five-business-day submission target; it governs only later use of the fallback credit.

For example, store credit issued on 2025-08-15 expires on 2026-08-15. The repository has no store-credit balance or issue-date fields, so it cannot calculate or enforce this deadline.
