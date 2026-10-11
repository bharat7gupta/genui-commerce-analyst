---
document_id: demo-commerce-analytics-supported-metric-boundary
version: 1
effective_date: 2025-08-01
source: docs/query-plan-v1.md
tenant: demo-commerce
---
# Supported Analytics Metrics

The query-plan contract recognizes three verified metrics: total gross revenue, net revenue, and total refund amount. Other common commerce calculations—such as order count, average order value, profit, margin, conversion rate, and return rate—are outside this metric vocabulary. A dataset field does not automatically make a related metric supported; the metric still needs an explicit definition and execution path.

For example, “What is our average order value?” cannot be represented as one of the current metric choices. It should be reported as unsupported rather than approximated from another metric or silently interpreted as revenue.
