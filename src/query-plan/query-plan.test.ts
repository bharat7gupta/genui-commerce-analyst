import assert from "node:assert/strict";
import test from "node:test";

import {
  parseQueryPlan,
  validateQueryPlan,
  type QueryPlanValidationFailure,
} from "./query-plan.js";

test("accepts a plan for the verified August versus September question", () => {
  const plan = parseQueryPlan(makeComparisonPlan());

  assert.equal(plan.metric.kind, "metric");
  assert.equal(
    plan.metric.kind === "metric" ? plan.metric.value : null,
    "net_revenue",
  );
  assert.equal(plan.comparison.kind, "date_intervals");
});

test("reports missing fields and invalid enums as structural errors", () => {
  expectFailure({}, "structural", "invalid_value");
  expectFailure(
    makeAggregatePlan({
      metric: { kind: "metric", value: "profit" },
    }),
    "structural",
    "invalid_value",
  );
});

test("rejects unknown properties at top level and in nested objects", () => {
  expectFailure(
    { ...makeAggregatePlan(), unexpected: true },
    "structural",
    "unrecognized_keys",
  );
  expectFailure(
    makeAggregatePlan({
      ordering: { kind: "none", sql: "ORDER BY gross_amount" },
    }),
    "structural",
    "unrecognized_keys",
  );
});

test("rejects invalid calendar dates and reversed intervals", () => {
  expectFailure(
    makeAggregatePlan({
      dateRange: {
        kind: "interval",
        start: "2025-02-30",
        end: "2025-03-02",
      },
    }),
    "structural",
    "custom",
  );
  expectFailure(
    makeAggregatePlan({
      dateRange: {
        kind: "interval",
        start: "2025-09-30",
        end: "2025-09-01",
      },
    }),
    "business_rule",
    "INVALID_INTERVAL_ORDER",
  );
});

test("rejects contradictory categorical and numeric filters", () => {
  expectFailure(
    makeAggregatePlan({
      filters: {
        kind: "specified",
        items: [
          { field: "region", operator: "eq", value: "North" },
          {
            field: "region",
            operator: "in",
            values: ["South", "East"],
          },
        ],
      },
    }),
    "business_rule",
    "CONTRADICTORY_FILTERS",
  );
  expectFailure(
    makeAggregatePlan({
      filters: {
        kind: "specified",
        items: [
          { field: "gross_amount", operator: "gt", value: 500 },
          { field: "gross_amount", operator: "lte", value: 500 },
        ],
      },
    }),
    "business_rule",
    "CONTRADICTORY_FILTERS",
  );
});

test("preserves unspecified date intent separately from explicit all-time", () => {
  const unspecified = parseQueryPlan(
    makeAggregatePlan({ dateRange: { kind: "unspecified" } }),
  );
  const allTime = parseQueryPlan(
    makeAggregatePlan({ dateRange: { kind: "all_time" } }),
  );

  assert.deepEqual(unspecified.dateRange, { kind: "unspecified" });
  assert.deepEqual(allTime.dateRange, { kind: "all_time" });
});

test("enforces conservative comparison, ordering, limit, and chart rules", () => {
  expectFailure(
    makeAggregatePlan({
      dimensions: { kind: "specified", values: [] },
      ordering: { kind: "metric", direction: "desc" },
    }),
    "business_rule",
    "ORDERING_REQUIRES_DIMENSION",
  );
  expectFailure(
    makeAggregatePlan({ limit: { kind: "value", value: 10 } }),
    "business_rule",
    "LIMIT_REQUIRES_ORDERING",
  );
  expectFailure(
    makeComparisonPlan({
      comparison: {
        kind: "date_intervals",
        baseline: { start: "2025-08-01", end: "2025-09-15" },
        target: { start: "2025-09-01", end: "2025-10-01" },
      },
    }),
    "business_rule",
    "COMPARISON_INTERVALS_OVERLAP",
  );
  expectFailure(
    makeAggregatePlan({
      dimensions: { kind: "specified", values: [] },
      visualization: { kind: "type", value: "bar" },
    }),
    "business_rule",
    "BAR_REQUIRES_ONE_DIMENSION",
  );
});

function makeAggregatePlan(overrides: Record<string, unknown> = {}) {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "total_gross_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: { kind: "specified", items: [] },
    dateRange: { kind: "all_time" },
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "type", value: "single_value" },
    ...overrides,
  };
}

function makeComparisonPlan(overrides: Record<string, unknown> = {}) {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: { kind: "specified", items: [] },
    dateRange: { kind: "unspecified" },
    comparison: {
      kind: "date_intervals",
      baseline: { start: "2025-08-01", end: "2025-09-01" },
      target: { start: "2025-09-01", end: "2025-10-01" },
    },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "type", value: "table" },
    ...overrides,
  };
}

function expectFailure(
  input: unknown,
  category: QueryPlanValidationFailure["category"],
  code: string,
): QueryPlanValidationFailure {
  const result = validateQueryPlan(input);

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error("Expected QueryPlan validation to fail");
  }

  assert.equal(result.category, category);
  assert.ok(
    result.issues.some((issue) => issue.code === code),
    `Expected issue code ${code}, received ${result.issues.map((issue) => issue.code).join(", ")}`,
  );
  return result;
}
