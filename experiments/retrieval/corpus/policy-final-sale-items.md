---
document_id: demo-commerce-policy-final-sale-items
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Final-sale item policy

**Experimental fixture:** this is an invented demo-commerce policy, not
behavior implemented by the application.

For this fictional tenant, an item clearly marked final sale before purchase
is not eligible for a refund. Providing an order number and submitting a
request within 30 calendar days does not override the final-sale exclusion.
Items that were not marked final sale continue through the normal eligibility
review, where approval may cover all or part of an order. The repository has no
line-item, final-sale, delivery, or eligibility fields, so it cannot determine
whether this policy applies to an actual order.
