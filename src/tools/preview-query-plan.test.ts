import assert from "node:assert/strict";
import test from "node:test";

import {
  executePreviewQueryPlan,
  previewQueryPlanToolDefinition,
} from "./preview-query-plan.js";

test("returns a validated plan and deterministic summary", () => {
  const plan = makePlan();
  const result = executePreviewQueryPlan({ plan });

  assert.deepEqual(result, {
    success: true,
    data: {
      plan,
      summary: {
        metric: "net_revenue",
        grouping: "region",
        filters: 'region eq "North"; gross_amount gte 100',
        dateRange: "[2025-08-01, 2025-09-01)",
      },
    },
  });
  assert.equal(previewQueryPlanToolDefinition.name, "preview_query_plan");
  assert.equal(
    previewQueryPlanToolDefinition.parameters.additionalProperties,
    false,
  );
  assert.deepEqual(previewQueryPlanToolDefinition.parameters.required, [
    "plan",
  ]);
  assert.ok(previewQueryPlanToolDefinition.parameters.properties?.plan);
});

test("rejects an impossible interval date", () => {
  const result = executePreviewQueryPlan({
    plan: makePlan({
      dateRange: {
        kind: "interval",
        start: "2025-02-30",
        end: "2025-03-02",
      },
    }),
  });

  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.category, "structural");
  assert.ok(
    result.error.issues.some(
      ({ path, code }) => path === "plan.dateRange.start" && code === "custom",
    ),
  );
});

test("rejects an unsupported filter value", () => {
  const result = executePreviewQueryPlan({
    plan: makePlan({
      filters: {
        kind: "specified",
        items: [{ field: "region", operator: "eq", value: "Central" }],
      },
    }),
  });

  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.category, "structural");
  assert.ok(
    result.error.issues.some(
      ({ path, code }) =>
        path.includes("plan.filters.items.0") && code === "invalid_union",
    ),
  );
});

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: ["region"] },
    filters: {
      kind: "specified",
      items: [
        { field: "region", operator: "eq", value: "North" },
        { field: "gross_amount", operator: "gte", value: 100 },
      ],
    },
    dateRange: {
      kind: "interval",
      start: "2025-08-01",
      end: "2025-09-01",
    },
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "type", value: "table" },
    ...overrides,
  };
}
