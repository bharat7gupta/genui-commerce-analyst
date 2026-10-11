---
document_id: demo-commerce-analytics-grouping-compiler-limit
version: 1
effective_date: 2025-08-01
source: src/db/query-plan-sql-compiler.ts
tenant: demo-commerce
---
# Grouped Analytics Are Outside the Current SQL Compiler Slice

Region, category, and status exist as query-plan dimensions, but the current deterministic SQL compiler requires the dimensions list to be empty. Its supported slice produces a scalar net-revenue result rather than grouped rows. A valid-looking grouping request can therefore be outside the behavior this compiler executes.

For example, “Show net revenue by region” needs a region dimension and is rejected by the current compiler. A region equality filter is different: it narrows one scalar total to a single region but does not produce a row for every region. The distinction matters when describing supported analytics.
