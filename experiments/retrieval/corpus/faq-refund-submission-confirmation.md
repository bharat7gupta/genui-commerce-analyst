---
document_id: demo-commerce-faq-refund-submission-confirmation
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# When Is Refund Submission Confirmed?

**Experimental fixture:** This FAQ is invented for demo-commerce and is not application behavior. Support sends a confirmation after an approved refund is submitted to the payment provider. An eligibility-review message or approval notice is not the submission confirmation. Bank posting time may continue after that message, and the customer should retain the order number when asking about a delay.

For example, approval on Monday does not itself prove that processing was submitted on Monday. The repository has no contact records, approval timestamps, submission timestamps, or notification delivery data, so it cannot produce or verify this confirmation.
