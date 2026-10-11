---
document_id: demo-commerce-policy-cumulative-refund-cap
version: 1
effective_date: 2025-08-01
source: synthetic-fixture
tenant: demo-commerce
fixture: true
---
# Cumulative Refund Limit

**Experimental fixture:** This is an invented demo-commerce policy, not application behavior. Multiple approved adjustments for one order may not total more than the amount originally paid after discounts. Support checks earlier approved refunds before authorizing another amount. The rule prevents repeated requests from returning more money than the customer paid and does not extend the original 30-day eligibility window.

For example, an order with `100.00` gross and a `20.00` discount has an `80.00` cumulative ceiling. If `30.00` was already refunded, later approved refunds may total no more than the remaining `50.00`.
