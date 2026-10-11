---
document_id: demo-commerce-query-region-filter-execution
version: 1
effective_date: 2025-08-01
source: src/db/query-plan-sql-compiler.ts
tenant: demo-commerce
---
# Region Filtering in the Current SQL Compiler

The current deterministic SQL compiler accepts at most one filter, and that filter must be region equality. It converts the chosen region to a SQL parameter instead of interpolating the value into the query. Other filters that the wider query-plan schema can validate—such as category, status, membership lists, or amount comparisons—are rejected by this executable slice.

For example, net revenue where region equals `North` can be compiled with `North` supplied as a parameter. Net revenue where region is in two regions, or where status equals `refunded`, cannot be compiled by this implementation.
