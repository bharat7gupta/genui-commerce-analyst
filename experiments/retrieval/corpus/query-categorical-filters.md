---
document_id: demo-commerce-query-categorical-filters
version: 1
effective_date: 2025-08-01
source: src/query-plan/query-plan.ts
tenant: demo-commerce
---
# Categorical and Identifier Filter Rules

The query-plan schema permits filters on order ID, customer ID, region, category, and order status. These fields use equality or membership operators: `eq` tests one value, while `in` accepts a nonempty list. Region, category, and status values must come from their defined enumerations; arbitrary field names and free-form operators are not accepted.

For example, a plan may request orders whose status is in `completed` and `refunded`. A condition such as “status contains fund” is not part of the schema. These rules describe plan validation; the narrower SQL compiler may support fewer filters at execution time.
