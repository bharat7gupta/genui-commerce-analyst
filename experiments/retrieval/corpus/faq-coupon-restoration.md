---
document_id: demo-commerce-faq-coupon-restoration
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Is a Discount Coupon Restored After a Refund?

**Experimental fixture:** This FAQ is invented for demo-commerce and is not application behavior. No coupon is automatically restored when an order is refunded. The recorded discount remains part of the original order’s analytics, and the approved refund cannot exceed what the customer paid after that discount. Any replacement promotion would require a separate support decision.

For example, refunding an order that used a `20.00` coupon does not create a new `20.00` coupon. The repository records only the discount amount, not a coupon code, campaign, redemption, or reissue status.
