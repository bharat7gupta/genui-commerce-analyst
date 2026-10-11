---
document_id: demo-commerce-metric-profit-not-defined
version: 1
effective_date: 2025-08-01
source: docs/query-plan-v1.md
tenant: demo-commerce
---

# Profit and margin are not defined metrics

The verified metric set contains total gross revenue, net revenue, and total
refund amount. It does not define profit, gross margin, contribution margin,
average order value, return rate, conversion, or cost-based measures. In
particular, net revenue must not be relabeled as profit because no product cost,
operating expense, or other profitability input is part of its formula.

A request such as “What was our profit?” therefore lacks a repository-backed
metric definition. It requires a product definition and supporting data before
it can be answered safely; subtracting discounts and refunds alone does not
create a profit calculation.
