---
document_id: demo-commerce-date-ranges
version: 1
effective_date: 2025-08-01
source: src/query-plan/query-plan.ts
tenant: demo-commerce
---

# Date ranges

Explicit date ranges use half-open intervals: the start date is included and
the end date is excluded, written `[start, end)`. The SQL compiler implements
this as `order_date >= start` and `order_date < end`. Dates must be real
calendar dates in `YYYY-MM-DD` form, and the start must be earlier than the
end. An `all_time` range adds no date predicate. An unspecified range remains
unspecified; it is not silently treated as all time. The DuckDB executor's
default maximum explicit interval is 366 days.

For example, `[2025-08-02, 2025-08-04)` includes seeded order O001 dated
2025-08-02 but excludes O002 dated exactly 2025-08-04. The verified net revenue
for that range is therefore `1100.00`.
