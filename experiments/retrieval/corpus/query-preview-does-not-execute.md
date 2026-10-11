---
document_id: demo-commerce-query-preview-does-not-execute
version: 1
effective_date: 2025-08-01
source: src/tools/preview-query-plan.ts
tenant: demo-commerce
---
# Query Preview Does Not Run Analytics

The `preview_query_plan` tool validates a proposed QueryPlan and returns a deterministic summary of its metric, grouping, filters, and date range. It does not compile SQL, read DuckDB, or calculate a metric value. Successful preview means that the plan satisfies the contract and business rules, not that the current SQL compiler can execute every requested capability.

For example, preview can summarize a structurally valid grouped request without returning revenue rows. A caller still needs a supported execution path to obtain data, and the current compiler may reject capabilities that the broader QueryPlan contract accepts.
