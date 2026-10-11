---
document_id: demo-commerce-metric-additive-disjoint-scopes
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---
# Adding Metrics Across Disjoint Scopes

All three verified metrics are sums over matching orders. Results for nonoverlapping sets can therefore be added when they use the same metric definition. This is safe only when an order cannot appear in both sets; overlapping scopes would count shared orders twice. It also does not make different metrics interchangeable.

For example, North net revenue plus South net revenue equals net revenue for the combined North-or-South set when both calculations cover the same dates and other filters. Adding gross revenue to net revenue would have no defined analytical meaning, because those totals answer different questions.
