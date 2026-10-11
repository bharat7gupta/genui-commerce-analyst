---
document_id: demo-commerce-analytics-discount-total-limitation
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---
# Total Discounts Are Not a Supported Metric

The dataset records a discount amount, and that amount participates in the implemented net-revenue formula. However, the metric-definition tool exposes no separate total-discount metric. Gross revenue ignores discounts, while net revenue subtracts them together with refunds. A discount field is therefore usable inside a defined calculation without being an independently supported reported metric.

For example, “How much discount did customers receive in total?” is not answered by the current metric catalog. Returning net revenue would answer a different question, so the request should be treated as unsupported until a total-discount definition is added.
