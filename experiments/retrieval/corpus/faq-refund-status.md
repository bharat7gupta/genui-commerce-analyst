---
document_id: demo-commerce-faq-refund-status
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: How can a customer check refund status?

**Experimental fixture:** this is an invented demo-commerce support workflow,
not functionality implemented in the repository.

A customer should contact the fictional support desk with their order number
to ask whether a request is awaiting review, approved, submitted for processing,
or settled. Once approved, the fixture policy targets submission within five
business days; payment-provider time may follow. These customer-facing stages
are different from the dataset's `completed`, `partially_refunded`, and
`refunded` order statuses. The application has no support-desk integration,
refund-tracking endpoint, or fields for approval and settlement, so it cannot
answer a real customer's status question.
