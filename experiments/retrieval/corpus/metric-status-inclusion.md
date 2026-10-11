---
document_id: demo-commerce-metric-status-inclusion
version: 1
effective_date: 2025-08-01
source: src/tools/get-metric-definition.ts
tenant: demo-commerce
---

# Order status inclusion in metrics

The three implemented metrics include every order status by default. Completed,
partially refunded, and refunded orders all participate in total gross revenue,
net revenue, and total refund amount when they otherwise match the query. A
status is excluded only when an explicit supported status filter requests that
restriction.

This means “net revenue for all statuses” uses the normal net formula across
the entire matching set; it does not silently remove fully refunded orders.
Likewise, total gross revenue still counts their `gross_amount`. This document
describes metric scope only. It does not define which customers qualify for a
refund or how an order receives its status.
