---
document_id: demo-commerce-policy-refund-request-withdrawal
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Withdrawing a Refund Request

**Experimental fixture:** This is an invented demo-commerce policy, not application behavior. A customer may ask support to withdraw an approved refund before support submits it for processing. After submission, support may record the request but cannot guarantee that the payment provider will stop the refund. Withdrawing a request does not extend the original 30-day eligibility window or make a final-sale order refundable.

For example, if an eligible refund was approved this morning but has not been submitted, support can cancel the request. If it was already submitted, the customer must wait for the processing outcome.
