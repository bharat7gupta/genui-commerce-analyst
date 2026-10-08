import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_RULE_INVALID_QUERY_PLAN_OUTPUT,
  VALID_QUERY_PLAN_OUTPUT,
} from "../query-plan/query-plan-extraction.fixtures.js";
import { queryPlanOutputSchema } from "../query-plan/query-plan-extraction.js";
import { validateQueryPlan } from "../query-plan/query-plan.js";
import { gradeExtractionOutcome, type ExtractionOutcome } from "./extraction-outcome-grader.js";

const clarification = JSON.stringify({
  schemaVersion: "query-plan-output-v1",
  outcome: "clarification_required",
  reason: "Which date interval should be used?",
});
const examples: readonly {
  expected: ExtractionOutcome; raw: string; pass: boolean;
}[] = [
  { expected: "query_plan", raw: VALID_QUERY_PLAN_OUTPUT, pass: true },
  { expected: "query_plan", raw: clarification, pass: false },
  { expected: "clarification_required", raw: clarification, pass: true },
];

for (const example of examples) {
  const observed = queryPlanOutputSchema.parse(JSON.parse(example.raw));
  test(`${example.expected} vs ${observed.outcome}`, (context) => {
    const verdict = gradeExtractionOutcome(observed, example.expected);
    assert.deepEqual(verdict, {
      pass: example.pass,
      reason: `Expected extraction outcome ${example.expected}; observed ${observed.outcome}`,
    });
    context.diagnostic(JSON.stringify(verdict));
  });
}

test("outcome correctness is independent of business-rule validity", () => {
  const envelope = queryPlanOutputSchema.parse(JSON.parse(BUSINESS_RULE_INVALID_QUERY_PLAN_OUTPUT));
  assert.equal(envelope.outcome, "query_plan");
  if (envelope.outcome !== "query_plan") return;
  assert.equal(validateQueryPlan(envelope.queryPlan).success, false);
  assert.equal(gradeExtractionOutcome(envelope, "query_plan").pass, true);
});

test("invalid envelope cannot receive an outcome grade", () => {
  const envelope = queryPlanOutputSchema.safeParse({
    schemaVersion: "query-plan-output-v1", outcome: "clarification_required",
  });
  const verdict = envelope.success
    ? gradeExtractionOutcome(envelope.data, "query_plan")
    : null;
  assert.equal(envelope.success, false);
  assert.equal(verdict, null);
});
