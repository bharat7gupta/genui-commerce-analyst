import assert from "node:assert/strict";
import test from "node:test";
import { QueryPlanValidationError, type QueryPlan } from "../query-plan/query-plan.js";
import type { QueryPlanExecutor, TableRow } from "./commerce-analysis-pipeline.js";
import { compareNetRevenueByRegion } from "./compare-net-revenue-by-region.js";

const baseline = { start: "2025-08-01", end: "2025-09-01" };
const target = { start: "2025-09-01", end: "2025-10-01" };

function fakeExecutor(first: readonly TableRow[], second: readonly TableRow[]) {
  const calls: QueryPlan[] = [];
  const executor: QueryPlanExecutor = {
    async execute(plan) {
      calls.push(plan);
      return calls.length === 1 ? first : second;
    },
  };
  return { executor, calls };
}

test("unions both periods, distinguishes absence from NULL, and preserves exact deltas", async () => {
  const { executor, calls } = fakeExecutor([
    { region: "West", net_revenue: "2.00" },
    { region: "North", net_revenue: "9007199254740993.01" },
    { region: "South", net_revenue: null },
  ], [
    { region: "North", net_revenue: "9007199254740993.02" },
    { region: "East", net_revenue: "0.00" },
    { region: "South", net_revenue: "5.00" },
  ]);
  const result = await compareNetRevenueByRegion(baseline, target, executor);
  assert.deepEqual(result.segments, [
    { region: "East", baselinePresent: false, targetPresent: true,
      baselineValue: null, targetValue: "0.00", absoluteChange: "0.00" },
    { region: "North", baselinePresent: true, targetPresent: true,
      baselineValue: "9007199254740993.01", targetValue: "9007199254740993.02", absoluteChange: "0.01" },
    { region: "South", baselinePresent: true, targetPresent: true,
      baselineValue: null, targetValue: "5.00", absoluteChange: null },
    { region: "West", baselinePresent: true, targetPresent: false,
      baselineValue: "2.00", targetValue: null, absoluteChange: "-2.00" },
  ]);
  assert.deepEqual(result.baseline, baseline);
  assert.deepEqual(result.target, target);
  assert.equal(calls.length, 2);
  for (const [index, plan] of calls.entries()) {
    assert.deepEqual(plan.dimensions, { kind: "specified", values: ["region"] });
    assert.deepEqual(plan.dateRange, { kind: "interval", ...(index === 0 ? baseline : target) });
    assert.deepEqual(plan.comparison, { kind: "none" });
  }
});

test("handles empty periods and a present NULL opposite an absent segment", async () => {
  const empty = fakeExecutor([], []);
  assert.deepEqual((await compareNetRevenueByRegion(baseline, target, empty.executor)).segments, []);
  const nullable = fakeExecutor([], [{ region: "East", net_revenue: null }]);
  assert.deepEqual((await compareNetRevenueByRegion(baseline, target, nullable.executor)).segments, [
    { region: "East", baselinePresent: false, targetPresent: true,
      baselineValue: null, targetValue: null, absoluteChange: null },
  ]);
});

test("rejects malformed or duplicate aggregates instead of silently merging them", async () => {
  for (const rows of [
    [{ region: "East" }], [{ region: null, net_revenue: "1.00" }],
    [{ region: "Unknown", net_revenue: "1.00" }],
    [{ region: "East", net_revenue: "1.001" }],
    [{ region: "East", net_revenue: "1.00" }, { region: "East", net_revenue: "2.00" }],
  ]) {
    const { executor } = fakeExecutor(rows, []);
    await assert.rejects(compareNetRevenueByRegion(baseline, target, executor), /Expected/);
  }
});

test("rejects invalid comparison periods before execution", async () => {
  const { executor, calls } = fakeExecutor([], []);
  await assert.rejects(compareNetRevenueByRegion(baseline,
    { start: "2025-08-31", end: "2025-10-01" }, executor), QueryPlanValidationError);
  assert.equal(calls.length, 0);
});

test("propagates second-query failure without retries", async () => {
  let calls = 0;
  const failure = new Error("Target query failed");
  const executor: QueryPlanExecutor = {
    async execute() {
      calls++;
      if (calls === 2) throw failure;
      return [{ region: "North", net_revenue: "1.00" }];
    },
  };
  await assert.rejects(compareNetRevenueByRegion(baseline, target, executor), (error) => error === failure);
  assert.equal(calls, 2);
});
