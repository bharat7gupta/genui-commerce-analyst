---
document_id: demo-commerce-faq-business-days
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# FAQ: What counts as a refund business day?

**Experimental fixture:** this fictional FAQ is not application behavior.

For demo-commerce's five-business-day refund-processing target, Monday through
Friday count unless the day is a tenant holiday. Saturdays, Sundays, and tenant
holidays do not count. The clock begins after a refund is approved, not when
the order was placed or when the customer first contacted support. Time taken
later by a bank or payment provider is outside the five-day submission target.
The repository has no holiday calendar, approval timestamp, or processing
timestamp, so it cannot calculate a real deadline.
