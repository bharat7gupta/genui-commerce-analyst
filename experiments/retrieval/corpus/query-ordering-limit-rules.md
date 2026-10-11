---
document_id: demo-commerce-query-ordering-limit-rules
version: 1
effective_date: 2025-08-01
source: docs/query-plan-v1.md
tenant: demo-commerce
---
# Ordering and Limit Validation Rules

In the query-plan contract, metric ordering is meaningful only when the result has a dimension. A numeric limit must be between 1 and 100 and may be used only when ordering is also requested. These constraints prevent plans such as “top five” without saying what determines “top” or asking to rank a single scalar value.

For example, a request for the top five regions by net revenue can pair a region dimension, descending metric order, and limit 5 at the contract level. A scalar net-revenue query with limit 5 is invalid. Execution support can still be narrower than these validation rules.
