import assert from "node:assert/strict";
import { investigateMetricChange } from "../application/investigate-metric-change.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";

const baseline = { start: "2025-08-01", end: "2025-09-01" };
const target = { start: "2025-09-01", end: "2025-10-01" };
const realExecutor = new DuckDBQueryPlanExecutor();
let sqlExecutions = 0;
const executor: QueryPlanExecutor = {
  async execute(plan) {
    sqlExecutions++;
    return realExecutor.execute(plan);
  },
};

const clarification = await investigateMetricChange({ baseline, target, dimension: "region" }, { executor });
assert.equal(clarification.outcome, "clarification_required");
assert.equal(sqlExecutions, 0);
console.log(JSON.stringify({ demonstration: "missing_metric", sqlExecutions, ...clarification }, null, 2));

const result = await investigateMetricChange({ metric: "net_revenue", baseline, target, dimension: "region" }, { executor });
assert.equal(result.outcome, "completed");
if (result.outcome !== "completed") throw new Error(JSON.stringify(result));
assert.equal(sqlExecutions, 4);
assert.equal(result.overall.baselineValue, "7225.00");
assert.equal(result.overall.targetValue, "8295.00");
assert.equal(result.overall.absoluteChange, "1070.00");
assert.equal(result.overall.percentageChange, "14.81");
assert.deepEqual(result.regional.segments.map(({ region, absoluteChange }) => [region, absoluteChange]),
  [["East", "300.00"], ["North", "575.00"], ["South", "0.00"], ["West", "195.00"]]);
console.log(JSON.stringify({ demonstration: "august_vs_september", sqlExecutions, ...result }, null, 2));
