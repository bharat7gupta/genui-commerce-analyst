import assert from "node:assert/strict";
import test from "node:test";

import { queryPlanOutputSchema } from "../query-plan/query-plan-extraction.js";
import { parseQueryPlan } from "../query-plan/query-plan.js";
import { augustNetRevenueCase } from "./august-net-revenue-case.js";
import { gradePlanMeaning } from "./plan-meaning-grader.js";
import { gradeScalarNumericalResult } from "./scalar-numerical-grader.js";
import { supportedAnalyticsCases } from "./supported-analytics-cases.js";

test("five unique cases preserve the original first case", () => {
  assert.equal(supportedAnalyticsCases.length, 5);
  assert.equal(new Set(supportedAnalyticsCases.map(({ id }) => id)).size, 5);
  const first = supportedAnalyticsCases[0];
  assert.ok(first);
  const { category, ...firstCase } = first;
  assert.equal(category, "explicit_instructions");
  assert.deepEqual(firstCase, augustNetRevenueCase);
});

for (const evaluationCase of supportedAnalyticsCases) {
  test(`${evaluationCase.id}: validation and both graders accept expectations`, () => {
    const envelope = queryPlanOutputSchema.parse({
      schemaVersion: "query-plan-output-v1",
      outcome: "query_plan",
      queryPlan: evaluationCase.expectedPlan,
    });
    assert.equal(envelope.outcome, "query_plan");
    const plan = parseQueryPlan(evaluationCase.expectedPlan);
    assert.equal(gradePlanMeaning(plan, evaluationCase).pass, true);
    assert.equal(gradeScalarNumericalResult(evaluationCase.expectedRows,
      evaluationCase.numericalExpectation).pass, true);

    // Verify all declared optional representations, preserving exact scope.
    for (const ordering of evaluationCase.acceptableAbsentOperationKinds.ordering) {
      for (const limit of evaluationCase.acceptableAbsentOperationKinds.limit) {
        for (const visualization of evaluationCase.acceptableAbsentOperationKinds.visualization) {
          const variant = parseQueryPlan({
            ...plan, ordering: { kind: ordering }, limit: { kind: limit },
            visualization: { kind: visualization },
          });
          assert.equal(gradePlanMeaning(variant, evaluationCase).pass, true);
        }
      }
    }
    for (const field of ["metric", "dateRange", "dimensions", "filters"] as const) {
      const variant = parseQueryPlan({ ...plan, [field]: { kind: "unspecified" } });
      const verdict = gradePlanMeaning(variant, evaluationCase);
      assert.equal(verdict.pass, false);
      assert.deepEqual(verdict.mismatches.map(({ field: mismatch }) => mismatch), [field]);
    }
  });
}
