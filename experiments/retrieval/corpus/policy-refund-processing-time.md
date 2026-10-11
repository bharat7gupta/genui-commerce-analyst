---
document_id: demo-commerce-policy-refund-processing-time
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Refund processing timeline

**Experimental fixture:** this invented timeline is not implemented by the
application and cannot be inferred from the commerce dataset.

For demo-commerce, an approved refund is submitted for processing within five
business days. Weekends and tenant holidays do not count toward that period.
After submission, a customer's bank or payment provider may take additional
time to make the money visible. The five-day target starts at approval, not at
the original order date or the customer's initial request. The dataset records
only `order_date`, `refund_amount`, and order status, so it cannot verify
request, approval, submission, or settlement timing.
