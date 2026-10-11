---
document_id: demo-commerce-policy-return-shipping-authorization
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Return Shipping Requires Authorization

**Experimental fixture:** This is an invented demo-commerce policy, not application behavior. A customer seeking a refund for a physical item must wait for support’s return instructions before shipping it. Mailing an item without authorization does not approve the refund, waive the 30-day request window, or override the final-sale exclusion. Support uses the order number to connect an authorized return with the refund request.

For example, sending an eligible item to an address found online does not start refund processing. The customer should first provide the order number, receive approval and instructions, and then follow the authorized shipping process.
