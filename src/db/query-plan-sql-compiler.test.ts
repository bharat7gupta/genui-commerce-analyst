import assert from "node:assert/strict";
import test from "node:test";

import { QueryPlanValidationError } from "../query-plan/query-plan.js";
import {
  compileQueryPlan,
  QueryPlanCompilationError,
} from "./query-plan-sql-compiler.js";

test("compiles all-time net revenue from trusted SQL components", () => {
  const compiled = compileQueryPlan(makePlan());

  assert.equal(
    compiled.sql,
    [
      "SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue",
      "FROM orders;",
    ].join("\n"),
  );
  assert.deepEqual(compiled.parameters, []);
});

test("binds a half-open date interval and region in predicate order", () => {
  const compiled = compileQueryPlan(
    makePlan({
      dateRange: {
        kind: "interval",
        start: "2025-08-01",
        end: "2025-09-01",
      },
      filters: {
        kind: "specified",
        items: [{ field: "region", operator: "eq", value: "North" }],
      },
    }),
  );

  assert.equal(
    compiled.sql,
    [
      "SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue",
      "FROM orders",
      "WHERE order_date >= CAST(? AS DATE) AND order_date < CAST(? AS DATE) AND region = ?;",
    ].join("\n"),
  );
  assert.deepEqual(compiled.parameters, [
    "2025-08-01",
    "2025-09-01",
    "North",
  ]);
  assert.equal(compiled.sql.includes("2025-08-01"), false);
  assert.equal(compiled.sql.includes("2025-09-01"), false);
  assert.equal(compiled.sql.includes("North"), false);
});

test("rejects a grouped plan explicitly", () => {
  assert.throws(
    () =>
      compileQueryPlan(
        makePlan({
          dimensions: { kind: "specified", values: ["region"] },
        }),
      ),
    (error) =>
      error instanceof QueryPlanCompilationError &&
      error.code === "UNSUPPORTED_DIMENSIONS",
  );
});

test("rejects an unspecified date range instead of treating it as all time", () => {
  assert.throws(
    () =>
      compileQueryPlan(
        makePlan({
          dateRange: { kind: "unspecified" },
        }),
      ),
    (error) =>
      error instanceof QueryPlanCompilationError &&
      error.code === "UNSUPPORTED_DATE_RANGE",
  );
});

test("runs existing QueryPlan validation at the compiler boundary", () => {
  assert.throws(
    () =>
      compileQueryPlan(
        makePlan({
          filters: {
            kind: "specified",
            items: [
              {
                field: "region",
                operator: "eq",
                value: "North' OR TRUE --",
              },
            ],
          },
        }),
      ),
    QueryPlanValidationError,
  );
});

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: { kind: "specified", items: [] },
    dateRange: { kind: "all_time" },
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "none" },
    ...overrides,
  };
}
