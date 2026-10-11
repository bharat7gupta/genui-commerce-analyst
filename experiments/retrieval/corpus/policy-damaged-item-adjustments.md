---
document_id: demo-commerce-policy-damaged-item-adjustments
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---

# Damaged-item price adjustments

**Experimental fixture:** this is an invented demo-commerce customer-service
policy, not application behavior.

When an eligible customer keeps a damaged item, support may approve a partial
refund as a price adjustment. The approved amount cannot exceed what the
customer paid after discounts. It follows the same eligibility review and the
same five-business-day post-approval processing target as other refunds. The
adjustment does not extend the original 30-day eligibility window for remaining
items. The current dataset can store a partial `refund_amount`, but it has no
damage reason, line item, evidence, approval, or adjustment field.
