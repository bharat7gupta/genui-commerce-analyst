---
document_id: demo-commerce-faq-split-refund-destinations
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Can One Refund Be Split Across Destinations?

**Experimental fixture:** This FAQ is invented for the demo tenant and is not application behavior. No. One approved refund cannot be divided between a payment card and store credit. The refund goes to the original payment method; if that method is unavailable, support may issue store credit under the existing fallback policy. Customers also cannot redirect part of the refund to a different card.

For example, a $40 refund cannot be sent as $20 to the original card and $20 as store credit. Support uses one permitted destination for the entire approved amount.
