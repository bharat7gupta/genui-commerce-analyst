import type { TableRow } from "../application/commerce-analysis-pipeline.js";
import type { QueryPlan } from "../query-plan/query-plan.js";
import { augustNetRevenueCase } from "./august-net-revenue-case.js";
import type { PlanMeaningRequirements } from "./plan-meaning-grader.js";
import type { ScalarExpectation } from "./scalar-numerical-grader.js";

export type SupportedAnalyticsCase = PlanMeaningRequirements & Readonly<{
  id: string;
  category: "explicit_instructions" | "paraphrase" | "date_interval" | "region_filter";
  question: string;
  expectedRoute: "analytics";
  expectedRows: readonly TableRow[];
  numericalExpectation: ScalarExpectation;
  referenceSql: string;
  referenceVerification: string;
}>;

// Omitted preferences may be none or unspecified. Comparison remains none.
const omittedPreferences = {
  comparison: ["none"],
  ordering: ["none", "unspecified"],
  limit: ["none", "unspecified"],
  visualization: ["none", "unspecified"],
} as const;

function expectedPlan(start: string, end: string, region?: "North" | "South"): QueryPlan {
  return {
    ...augustNetRevenueCase.expectedPlan,
    dateRange: { kind: "interval", start, end },
    filters: {
      kind: "specified",
      items: region === undefined ? [] : [{ field: "region", operator: "eq", value: region }],
    },
  };
}

// Exposed development/regression examples, not held-out cases. Evaluator-only
// expectations must never be included in model messages.
export const supportedAnalyticsCases: readonly SupportedAnalyticsCase[] = [
  { ...augustNetRevenueCase, category: "explicit_instructions" },
  {
    id: "day-7-august-net-revenue-paraphrase-v1",
    category: "paraphrase",
    question: "How much net revenue did we earn across all regions and statuses from 2025-08-01 inclusive to 2025-09-01 exclusive?",
    expectedRoute: "analytics",
    expectedPlan: expectedPlan("2025-08-01", "2025-09-01"),
    acceptableAbsentOperationKinds: omittedPreferences,
    expectedRows: [{ net_revenue: "7225.00" }],
    numericalExpectation: { field: "net_revenue", amount: "7225.00" },
    referenceSql: `SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
FROM orders
WHERE order_date >= DATE '2025-08-01' AND order_date < DATE '2025-09-01';`,
    referenceVerification: "15 August seed rows: 8330.00 gross - 530.00 discounts - 575.00 refunds = 7225.00. Integer-cent summation and independent reference SQL in an in-memory seeded DuckDB agree (2026-10-07).",
  },
  {
    id: "day-7-september-net-revenue-v1",
    category: "date_interval",
    question: "What is total net revenue across all regions and statuses from 2025-09-01 inclusive to 2025-10-01 exclusive?",
    expectedRoute: "analytics",
    expectedPlan: expectedPlan("2025-09-01", "2025-10-01"),
    acceptableAbsentOperationKinds: omittedPreferences,
    expectedRows: [{ net_revenue: "8295.00" }],
    numericalExpectation: { field: "net_revenue", amount: "8295.00" },
    referenceSql: `SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
FROM orders
WHERE order_date >= DATE '2025-09-01' AND order_date < DATE '2025-10-01';`,
    referenceVerification: "15 September seed rows: 9680.00 gross - 595.00 discounts - 790.00 refunds = 8295.00. Integer-cent summation and independent reference SQL in an in-memory seeded DuckDB agree (2026-10-07).",
  },
  {
    id: "day-7-august-north-net-revenue-v1",
    category: "region_filter",
    question: "What is total net revenue for the North region across all statuses from 2025-08-01 inclusive to 2025-09-01 exclusive?",
    expectedRoute: "analytics",
    expectedPlan: expectedPlan("2025-08-01", "2025-09-01", "North"),
    acceptableAbsentOperationKinds: omittedPreferences,
    expectedRows: [{ net_revenue: "2275.00" }],
    numericalExpectation: { field: "net_revenue", amount: "2275.00" },
    referenceSql: `SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
FROM orders
WHERE order_date >= DATE '2025-08-01' AND order_date < DATE '2025-09-01'
  AND region = 'North';`,
    referenceVerification: "4 August North seed rows: 2600.00 gross - 175.00 discounts - 150.00 refunds = 2275.00. Integer-cent summation and independent reference SQL in an in-memory seeded DuckDB agree (2026-10-07).",
  },
  {
    id: "day-7-august-south-net-revenue-v1",
    category: "region_filter",
    question: "What is total net revenue for the South region across all statuses from 2025-08-01 inclusive to 2025-09-01 exclusive?",
    expectedRoute: "analytics",
    expectedPlan: expectedPlan("2025-08-01", "2025-09-01", "South"),
    acceptableAbsentOperationKinds: omittedPreferences,
    expectedRows: [{ net_revenue: "1900.00" }],
    numericalExpectation: { field: "net_revenue", amount: "1900.00" },
    referenceSql: `SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
FROM orders
WHERE order_date >= DATE '2025-08-01' AND order_date < DATE '2025-09-01'
  AND region = 'South';`,
    referenceVerification: "4 August South seed rows: 2250.00 gross - 125.00 discounts - 225.00 refunds = 1900.00. Integer-cent summation and independent reference SQL in an in-memory seeded DuckDB agree (2026-10-07).",
  },
];
