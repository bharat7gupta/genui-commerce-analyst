---
document_id: demo-commerce-analytics-date-comparison-compiler-limit
version: 1
effective_date: 2025-08-01
source: src/db/query-plan-sql-compiler.ts
tenant: demo-commerce
---
# Date Comparisons Are Outside the Current SQL Compiler Slice

The broader query-plan format can describe comparisons, but the current deterministic SQL compiler accepts only plans whose comparison is `none`. It does not generate SQL that compares two named date intervals. This is an execution limitation, not evidence that two periods have equal results.

For example, a plan asking to compare January net revenue with February net revenue is rejected by this compiler. Running two independent interval queries would be a separate workflow and would not make the existing compiler a comparison engine. Applications should surface this boundary rather than claim a period-over-period result.
