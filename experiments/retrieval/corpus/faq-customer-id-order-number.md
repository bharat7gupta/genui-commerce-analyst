---
document_id: demo-commerce-faq-customer-id-order-number
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Can I Use My Customer ID Instead of an Order Number?

**Experimental fixture:** This FAQ is invented for the demo tenant and is not application behavior. No. A customer ID may identify an account, but support still requires the order number to review a refund request. The order number identifies the specific purchase whose eligibility, payment destination, and refund status must be checked. Providing both identifiers can help support, but the customer ID alone is insufficient.

For example, a customer with several purchases cannot request “refund my latest order” using only an account ID. They should locate and provide the order number for the purchase in question.
