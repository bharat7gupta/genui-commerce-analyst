import type { QueryPlan } from "../query-plan/query-plan.js";

// Evaluator-only data: never include these expectations in model messages.
export const augustNetRevenueCase = {
  id: "day-7-august-net-revenue-v1",
  question:
    "What is net revenue from 2025-08-01 inclusive to 2025-09-01 exclusive, across all regions and statuses? Do not group, compare, order, limit, or visualize.",
  expectedRoute: "analytics",
  expectedPlan: {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: { kind: "specified", items: [] },
    dateRange: {
      kind: "interval",
      start: "2025-08-01",
      end: "2025-09-01",
    },
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "none" },
  } satisfies QueryPlan,
  // The question explicitly forbids these operations; unspecified is not none.
  acceptableAbsentOperationKinds: {
    comparison: ["none"],
    ordering: ["none"],
    limit: ["none"],
    visualization: ["none"],
  },
  expectedRows: [{ net_revenue: "7225.00" }],
  numericalExpectation: { field: "net_revenue", amount: "7225.00" },
  referenceSql: `SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
FROM orders
WHERE order_date >= DATE '2025-08-01'
  AND order_date < DATE '2025-09-01';`,
  referenceVerification:
    "Reuses Day 5 august-all-regions. Independently summed the 15 August seed rows in integer cents: gross 8330.00 - discounts 530.00 - refunds 575.00 = 7225.00. Handwritten reference SQL agreed in an in-memory seeded DuckDB and the existing read-only database on 2026-10-07.",
} as const;
