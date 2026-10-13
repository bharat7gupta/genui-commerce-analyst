import assert from "node:assert/strict";
import test from "node:test";
import { getMetricDefinition } from "../tools/get-metric-definition.js";
import type { QueryPlanExecutor, TableRow } from "./commerce-analysis-pipeline.js";
import { investigateMetricChange } from "./investigate-metric-change.js";

const input = {
  metric: "net_revenue", dimension: "region",
  baseline: { start: "2025-08-01", end: "2025-09-01" },
  target: { start: "2025-09-01", end: "2025-10-01" },
};

function fixture(failAt?: number, inconsistent = false) {
  const events: string[] = [];
  const rows: readonly (readonly TableRow[])[] = [
    [{ net_revenue: "10.00" }], [{ net_revenue: "15.00" }],
    [{ region: "East", net_revenue: "10.00" }],
    [{ region: "East", net_revenue: inconsistent ? "16.00" : "15.00" }],
  ];
  const executor: QueryPlanExecutor = {
    async execute(plan) {
      events.push(plan.dimensions.kind === "specified" && plan.dimensions.values.length > 0
        ? "region_query" : "scalar_query");
      if (events.length === failAt) throw new Error("Simulated SQL failure");
      const result = rows[events.length - 1];
      assert.ok(result);
      return result;
    },
  };
  return { executor, events };
}

test("runs fixed stages in order and cites the authoritative definition", async () => {
  const { executor, events } = fixture();
  const result = await investigateMetricChange(input, { executor,
    definitionHandler: (arguments_) => {
      events.push("definition");
      return getMetricDefinition(arguments_);
    },
  });
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;
  assert.deepEqual(events, ["scalar_query", "scalar_query", "region_query", "region_query", "definition"]);
  assert.deepEqual(result.trace.map(({ stage, status }) => [stage, status]), [
    ["validate_inputs", "completed"], ["compare_periods", "completed"],
    ["compare_regions", "completed"], ["get_metric_definition", "completed"],
    ["produce_summary", "completed"],
  ]);
  assert.ok(result.trace.every(({ elapsedMs }) => Number.isFinite(elapsedMs) && elapsedMs >= 0));
  assert.match(result.summary, /increased by 5.00 \(50.00%\)/);
  assert.match(result.summary, /East: 5.00/);
  assert.match(result.summary, /Business causes are not established/);
  assert.ok(result.summary.includes(result.definition.sourceId));
  assert.equal(result.definition.sourceVersion, null);
});

test("missing inputs require clarification without SQL or definition lookup", async () => {
  for (const field of ["metric", "dimension", "baseline", "target"]) {
    const candidate: Record<string, unknown> = { ...input };
    delete candidate[field];
    const { executor, events } = fixture();
    const result = await investigateMetricChange(candidate, { executor,
      definitionHandler: () => { throw new Error("Must not retrieve a definition"); },
    });
    assert.equal(result.outcome, "clarification_required");
    if (result.outcome !== "clarification_required") return;
    assert.deepEqual(result.missingInputs, [field]);
    assert.equal(result.trace.length, 1);
    assert.equal(result.trace[0]?.status, "clarification_required");
    assert.deepEqual(events, []);
  }
});

test("missing interval boundaries and blank metric require clarification", async () => {
  const { executor, events } = fixture();
  const result = await investigateMetricChange({ ...input, metric: " ", baseline: { start: "2025-08-01" } }, { executor });
  assert.equal(result.outcome, "clarification_required");
  if (result.outcome !== "clarification_required") return;
  assert.deepEqual(result.missingInputs, ["metric", "baseline.end"]);
  assert.deepEqual(events, []);
});

test("unsupported and malformed inputs are rejected before queries", async () => {
  for (const [candidate, code] of [
    [{ ...input, metric: "profit" }, "UNSUPPORTED_METRIC"],
    [{ ...input, dimension: "category" }, "UNSUPPORTED_DIMENSION"],
    [{ ...input, baseline: { start: "2025-02-30", end: "2025-03-01" } }, "INVALID_INPUT"],
    [{ ...input, target: input.baseline }, "INVALID_INPUT"],
    [{ ...input, target: { start: "2025-09-01", end: "2027-01-01" } }, "INVALID_INPUT"],
    [{ ...input, extra: true }, "INVALID_INPUT"],
  ] as const) {
    const { executor, events } = fixture();
    const result = await investigateMetricChange(candidate, { executor });
    assert.equal(result.outcome, "rejected");
    if (result.outcome !== "rejected") return;
    assert.equal(result.failedStage, "validate_inputs");
    assert.equal(result.error.code, code);
    assert.deepEqual(events, []);
  }
});

test("comparison failures identify the stage and stop without retries", async () => {
  for (const [failAt, failedStage] of [[1, "compare_periods"], [3, "compare_regions"]] as const) {
    const { executor, events } = fixture(failAt);
    const result = await investigateMetricChange(input, { executor,
      definitionHandler: () => { throw new Error("Must not retrieve a definition"); },
    });
    assert.equal(result.outcome, "failed");
    if (result.outcome !== "failed") return;
    assert.equal(result.failedStage, failedStage);
    assert.equal(result.error.message, "Simulated SQL failure");
    assert.equal(result.trace.at(-1)?.status, "failed");
    assert.equal(events.length, failAt);
  }
});

test("definition failure prevents the summary stage", async () => {
  const { executor } = fixture();
  const result = await investigateMetricChange(input, { executor,
    definitionHandler: () => { throw new Error("Definition unavailable"); },
  });
  assert.equal(result.outcome, "failed");
  if (result.outcome !== "failed") return;
  assert.equal(result.failedStage, "get_metric_definition");
  assert.equal(result.trace.length, 4);
  assert.equal(result.error.message, "Definition unavailable");
});

test("unreconciled results fail the summary stage instead of producing claims", async () => {
  const { executor } = fixture(undefined, true);
  const result = await investigateMetricChange(input, { executor });
  assert.equal(result.outcome, "failed");
  if (result.outcome !== "failed") return;
  assert.equal(result.failedStage, "produce_summary");
  assert.match(result.error.message, /do not reconcile/);
});

test("no matching data produces a summary with unavailable change", async () => {
  let calls = 0;
  const executor: QueryPlanExecutor = {
    async execute() { return ++calls <= 2 ? [{ net_revenue: null }] : []; },
  };
  const result = await investigateMetricChange(input, { executor });
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;
  assert.match(result.summary, /Change is unavailable/);
  assert.match(result.summary, /no matching regions/);
});
