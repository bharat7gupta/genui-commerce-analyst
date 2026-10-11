---
document_id: demo-commerce-analytics-multi-metric-requests
version: 1
effective_date: 2025-08-01
source: docs/query-plan-v1.md
tenant: demo-commerce
---
# Multi-Metric Requests Need Separate Plans

QueryPlan v1 has one metric field, and the repository explicitly leaves multi-metric queries undefined. A single plan can select total gross revenue, net revenue, or total refund amount, but it cannot request several of them together. This is a contract limitation even though each individual metric has a verified definition.

For example, “Show gross revenue and refunds together” cannot be represented as one current QueryPlan. Two plans could represent the metric selections separately, but each would still need a supported execution path, and combining results would be orchestration outside this contract. The application should not silently choose only one requested metric.
