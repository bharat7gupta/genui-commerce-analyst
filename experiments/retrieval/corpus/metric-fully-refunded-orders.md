---
document_id: demo-commerce-metric-fully-refunded-orders
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# Fully refunded orders in revenue metrics

A fully refunded order is not automatically removed from revenue calculations.
Its gross amount still contributes to total gross revenue, its recorded refund
contributes to total refund amount, and its net contribution follows the normal
formula: gross minus discount minus refund. The metric definitions include all
statuses unless an explicit status filter is present.

For example, if gross is `320.00`, discount is `20.00`, and refund is `300.00`,
the order contributes `320.00` gross revenue, `300.00` refund amount, and
`0.00` net revenue. Zero net contribution is different from excluding the
order from the matching set.
