---
document_id: demo-commerce-policy-order-number-verification
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Order-number verification for refunds

**Experimental fixture:** this fictional verification rule is not enforced by
the application.

A demo-commerce customer must provide the order number when requesting a
refund. The support desk verifies that the number identifies the purchase
before beginning the eligibility review. Verification alone does not approve a
refund: the 30-day window, final-sale exclusion, and any partial-refund review
still apply. A missing or unverified number pauses the fictional support
process rather than creating a refund record. Although the dataset has an
`order_id`, it contains no request, identity-verification, or support-workflow
fields that implement this policy.
