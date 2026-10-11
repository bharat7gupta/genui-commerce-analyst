---
document_id: demo-commerce-policy-refund-bank-delay-escalation
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Escalating a Bank Refund Delay

**Experimental fixture:** This is an invented demo-commerce policy, not application behavior. The existing five-business-day target covers submitting an approved refund, not the bank’s posting time. If a refund is still absent ten business days after support confirms submission, the customer should contact support with the order number and also ask the bank to trace the credit. A delay alone does not authorize a duplicate refund.

For example, a refund submitted on Monday may still be processing at the bank. Support begins a delay review only after ten business days have passed without the credit appearing.
