import assert from "node:assert/strict";
import test from "node:test";

import { DuckDBDateIntervalLimitError } from "../db/duckdb-query-plan-executor.js";
import { QueryPlanCompilationError } from "../db/query-plan-sql-compiler.js";
import { QueryPlanValidationError, type QueryPlan } from "../query-plan/query-plan.js";
import type { QueryPlanExecutor, TableRow } from "./commerce-analysis-pipeline.js";
import { comparePeriods } from "./compare-periods.js";

const baseline = { start: "2025-08-01", end: "2025-09-01" };
const target = { start: "2025-09-01", end: "2025-10-01" };

function fakeExecutor(baselineRows: readonly TableRow[], targetRows: readonly TableRow[]) {
  const calls: QueryPlan[] = [];
  const executor: QueryPlanExecutor = {
    async execute(plan) {
      calls.push(plan);
      return calls.length === 1 ? baselineRows : targetRows;
    },
  };
  return { executor, calls };
}

test("compares two validated scalar plans with exact application arithmetic", async () => {
  const { executor, calls } = fakeExecutor(
    [{ net_revenue: "7225.00" }], [{ net_revenue: "8295.00" }],
  );
  assert.deepEqual(await comparePeriods("net_revenue", baseline, target, executor), {
    metric: "net_revenue", baseline, target,
    baselineValue: "7225.00", targetValue: "8295.00",
    absoluteChange: "1070.00", percentageChange: "14.81",
  });
  assert.equal(calls.length, 2);
  for (const [index, plan] of calls.entries()) {
    assert.deepEqual(plan.dateRange, { kind: "interval", ...(index === 0 ? baseline : target) });
    assert.deepEqual(plan.comparison, { kind: "none" });
    assert.deepEqual(plan.filters, { kind: "specified", items: [] });
    assert.deepEqual(plan.dimensions, { kind: "specified", values: [] });
  }
});

test("distinguishes zero baseline and SQL NULL from ordinary values", async () => {
  for (const [first, second, change] of [
    ["0.00", "5.00", "5.00"],
    ["0.00", "0.00", "0.00"],
    [null, "5.00", null],
    ["5.00", null, null],
  ] as const) {
    const { executor } = fakeExecutor([{ net_revenue: first }], [{ net_revenue: second }]);
    const result = await comparePeriods("net_revenue", baseline, target, executor);
    assert.equal(result.baselineValue, first);
    assert.equal(result.targetValue, second);
    assert.equal(result.absoluteChange, change);
    assert.equal(result.percentageChange, null);
  }
});

test("preserves large amounts, signs, and rounds percentages half away from zero", async () => {
  for (const [first, second, delta, percentage] of [
    ["9007199254740993.01", "9007199254740993.02", "0.01", "0.00"],
    ["7225.00", "0.00", "-7225.00", "-100.00"],
    ["-2.00", "-1.00", "1.00", "-50.00"],
    ["200.00", "200.01", "0.01", "0.01"],
    ["200.00", "199.99", "-0.01", "-0.01"],
  ] as const) {
    const { executor } = fakeExecutor([{ net_revenue: first }], [{ net_revenue: second }]);
    const result = await comparePeriods("net_revenue", baseline, target, executor);
    assert.equal(result.absoluteChange, delta);
    assert.equal(result.percentageChange, percentage);
  }
});

test("validates both periods and rejects unsupported metrics before executing", async () => {
  const { executor, calls } = fakeExecutor([], []);
  for (const invalidTarget of [
    { start: "2025-09-01", end: "2025-09-01" },
    { start: "2025-09-30", end: "2025-09-01" },
    { start: "2025-02-30", end: "2025-10-01" },
    { start: "2025-08-31", end: "2025-10-01" },
  ]) {
    await assert.rejects(comparePeriods("net_revenue", baseline, invalidTarget, executor), QueryPlanValidationError);
  }
  await assert.rejects(comparePeriods("total_gross_revenue", baseline, target, executor), QueryPlanCompilationError);
  await assert.rejects(comparePeriods("net_revenue", baseline,
    { start: "2025-09-01", end: "2027-01-01" }, executor), DuckDBDateIntervalLimitError);
  assert.equal(calls.length, 0);
});

test("rejects malformed aggregates rather than treating them as zero", async () => {
  for (const rows of [[], [{ wrong: "1.00" }], [{ net_revenue: "1e2" }],
    [{ net_revenue: 1.01 }], [{ net_revenue: "1.001" }],
    [{ net_revenue: "1.00" }, { net_revenue: "2.00" }]]) {
    const { executor } = fakeExecutor(rows, [{ net_revenue: "2.00" }]);
    await assert.rejects(comparePeriods("net_revenue", baseline, target, executor), /Expected/);
  }
});

test("propagates execution errors without retries or a partial comparison", async () => {
  let calls = 0;
  const failure = new Error("Database unavailable");
  const executor: QueryPlanExecutor = {
    async execute() {
      calls++;
      throw failure;
    },
  };
  await assert.rejects(comparePeriods("net_revenue", baseline, target, executor), (error) => error === failure);
  assert.equal(calls, 1);
});
