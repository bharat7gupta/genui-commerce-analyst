---
document_id: demo-commerce-faq-discounted-item-refund
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: How much can be refunded for a discounted item?

**Experimental fixture:** this is an invented demo-commerce policy answer, not
a refund calculation performed by the application.

The approved refund cannot exceed the amount paid after discounts. For
example, if an item has `100.00` gross amount and a `20.00` discount, the
maximum refundable amount under this fixture is `80.00`. The discount itself
is not cash that can be returned to the customer. Eligibility, including the
30-day window and final-sale exclusion, must still be reviewed before any
amount is approved. The dataset enforces an equivalent numeric ceiling but
does not perform the fictional policy review.
