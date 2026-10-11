---
document_id: demo-commerce-policy-refund-eligibility
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Refund eligibility policy

**Experimental fixture:** this is an invented demo-commerce business policy,
not behavior implemented or enforced by the application.

For this fictional tenant, a customer may request a refund within 30 calendar
days after delivery when they can provide the order number. Items marked final
sale are not eligible. A request must be reviewed before any refund is
approved, and approval may cover all or only part of an order. Eligibility does
not promise that money has already been returned. The separate processing
timeline begins only after approval. The current repository has no delivery
date, final-sale field, or eligibility workflow with which to apply these rules.
