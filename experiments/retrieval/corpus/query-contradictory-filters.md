---
document_id: demo-commerce-query-contradictory-filters
version: 1
effective_date: 2025-08-01
source: src/query-plan/query-plan.ts
tenant: demo-commerce
---
# Contradictory Filters Are Rejected

QueryPlan validation combines repeated constraints on the same field. Categorical value sets are intersected, while numeric lower and upper bounds are tightened. If no value can satisfy every constraint, validation returns a business-rule error instead of executing a query that is known to have an impossible filter range.

For example, requiring region equal to `North` and region equal to `South` is contradictory. Likewise, requiring `gross_amount > 100` and `gross_amount <= 100` defines an empty numeric range. A valid empty result is different: its filters are consistent but happen to match no stored rows.
