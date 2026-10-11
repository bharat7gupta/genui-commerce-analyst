---
document_id: demo-commerce-policy-partial-refunds
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Partial refund policy

**Experimental fixture:** these are fictional demo-commerce rules, not
application behavior.

An approved request may receive a partial refund when the customer keeps part
of an order or accepts a price adjustment for a damaged item. The approved
amount cannot exceed the amount paid after discounts. Partial refunds follow
the same eligibility review and processing timeline as full refunds. A partial
approval does not make the remaining items refundable beyond the original
30-day eligibility window. The seeded database can represent a positive refund
smaller than the post-discount amount, but it does not decide or enforce these
customer-service reasons.
