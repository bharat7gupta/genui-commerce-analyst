import assert from "node:assert/strict";
import test from "node:test";

import { parseQueryPlan, type QueryPlan } from "../query-plan/query-plan.js";
import { augustNetRevenueCase } from "./august-net-revenue-case.js";
import { gradePlanMeaning, type PlanMeaningRequirements } from "./plan-meaning-grader.js";

const expected = augustNetRevenueCase.expectedPlan;
const requirements = augustNetRevenueCase;

test("correct validated plan passes", (context) => {
  const verdict = gradePlanMeaning(parseQueryPlan(expected), requirements);
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.mismatches, []);
  context.diagnostic(verdict.reason);
});

const variations: readonly {
  name: string;
  field: keyof QueryPlan;
  value: QueryPlan[keyof QueryPlan];
}[] = [
  { name: "wrong metric", field: "metric", value: { kind: "metric", value: "total_gross_revenue" } },
  { name: "wrong start boundary", field: "dateRange", value: { kind: "interval", start: "2025-08-02", end: "2025-09-01" } },
  { name: "wrong end boundary", field: "dateRange", value: { kind: "interval", start: "2025-08-01", end: "2025-09-02" } },
  { name: "added East filter", field: "filters", value: { kind: "specified", items: [{ field: "region", operator: "eq", value: "East" }] } },
  { name: "added region grouping", field: "dimensions", value: { kind: "specified", values: ["region"] } },
  { name: "unspecified dimensions", field: "dimensions", value: { kind: "unspecified" } },
  { name: "unspecified filters", field: "filters", value: { kind: "unspecified" } },
  { name: "unspecified dates", field: "dateRange", value: { kind: "unspecified" } },
  { name: "all-time dates", field: "dateRange", value: { kind: "all_time" } },
  { name: "unspecified comparison", field: "comparison", value: { kind: "unspecified" } },
  { name: "unspecified ordering", field: "ordering", value: { kind: "unspecified" } },
  { name: "unspecified limit", field: "limit", value: { kind: "unspecified" } },
  { name: "unspecified visualization", field: "visualization", value: { kind: "unspecified" } },
  { name: "added table visualization", field: "visualization", value: { kind: "type", value: "table" } },
];

for (const variation of variations) {
  test(`${variation.name} fails only its field`, (context) => {
    const plan = parseQueryPlan({ ...expected, [variation.field]: variation.value });
    const verdict = gradePlanMeaning(plan, requirements);
    assert.equal(verdict.pass, false);
    assert.deepEqual(verdict.mismatches.map(({ field }) => field), [variation.field]);
    context.diagnostic(verdict.reason);
  });
}

// Active comparison/ordering/limit need prerequisite fields to pass business
// rules. Each pair changes only its target field and adds only that mismatch.
const activeOperations: readonly {
  field: "comparison" | "ordering" | "limit";
  baseline: QueryPlan;
  value: QueryPlan["comparison"] | QueryPlan["ordering"] | QueryPlan["limit"];
}[] = [
  {
    field: "comparison",
    baseline: { ...expected, dateRange: { kind: "unspecified" } },
    value: {
      kind: "date_intervals",
      baseline: { start: "2025-08-01", end: "2025-09-01" },
      target: { start: "2025-09-01", end: "2025-10-01" },
    },
  },
  {
    field: "ordering",
    baseline: { ...expected, dimensions: { kind: "specified", values: ["region"] } },
    value: { kind: "metric", direction: "desc" },
  },
  {
    field: "limit",
    baseline: {
      ...expected,
      dimensions: { kind: "specified", values: ["region"] },
      ordering: { kind: "metric", direction: "desc" },
    },
    value: { kind: "value", value: 3 },
  },
];

for (const operation of activeOperations) {
  test(`added ${operation.field} adds its own mismatch to a validated prerequisite plan`, (context) => {
    const baseline = parseQueryPlan(operation.baseline);
    const changed = parseQueryPlan({ ...baseline, [operation.field]: operation.value });
    const before = gradePlanMeaning(baseline, requirements);
    const after = gradePlanMeaning(changed, requirements);
    assert.equal(after.pass, false);
    assert.deepEqual(after.mismatches.filter(({ field }) => field !== operation.field), before.mismatches);
    const added = after.mismatches.filter(({ field }) => field === operation.field);
    assert.equal(added.length, 1);
    context.diagnostic(`Baseline mismatches: ${before.mismatches.map(({ field }) => field).join(", ")}; added: ${added[0]?.reason}`);
  });
}

// Synthetic contracts, independent of frozen evaluation datasets.
const scalar: QueryPlan = {
  version: "query-plan-v1", metric: { kind: "metric", value: "total_gross_revenue" },
  dateRange: { kind: "unspecified" }, dimensions: { kind: "specified", values: [] },
  filters: { kind: "specified", items: [] }, comparison: { kind: "none" },
  ordering: { kind: "none" }, limit: { kind: "none" }, visualization: { kind: "none" },
};
const requestedOperations: readonly {
  field: "ordering" | "limit" | "dimensions";
  expected: QueryPlan; wrong: QueryPlan;
}[] = [
  {
    field: "ordering",
    expected: { ...scalar, dimensions: { kind: "specified", values: ["region"] }, ordering: { kind: "metric", direction: "desc" } },
    wrong: { ...scalar, dimensions: { kind: "specified", values: ["region"] }, ordering: { kind: "metric", direction: "asc" } },
  },
  {
    field: "limit",
    expected: { ...scalar, dimensions: { kind: "specified", values: ["region"] }, ordering: { kind: "metric", direction: "desc" }, limit: { kind: "value", value: 3 } },
    wrong: { ...scalar, dimensions: { kind: "specified", values: ["region"] }, ordering: { kind: "metric", direction: "desc" }, limit: { kind: "value", value: 4 } },
  },
  {
    field: "dimensions",
    expected: { ...scalar, dimensions: { kind: "specified", values: ["region"] } },
    wrong: { ...scalar, dimensions: { kind: "specified", values: ["category"] } },
  },
];
for (const example of requestedOperations) {
  const requirements: PlanMeaningRequirements = {
    expectedPlan: example.expected,
    acceptableAbsentOperationKinds: { comparison: ["none"], ordering: ["none"], limit: ["none"], visualization: ["none"] },
  };
  test(`requested ${example.field}: correct validated plan passes`, () => {
    assert.equal(gradePlanMeaning(parseQueryPlan(example.expected), requirements).pass, true);
  });
  test(`requested ${example.field}: wrong validated requirement fails only that field`, (context) => {
    const grade = gradePlanMeaning(parseQueryPlan(example.wrong), requirements);
    assert.equal(grade.pass, false);
    assert.deepEqual(grade.mismatches.map(item => item.field), [example.field]);
    context.diagnostic(grade.reason);
  });
}
