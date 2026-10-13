import assert from "node:assert/strict";
import test from "node:test";
import { gradeInvestigationDevelopmentCase, type InvestigationDevelopmentCase, type InvestigationNumericalReference } from "./investigation-development.js";
import { investigateMetricChangeFromText } from "../application/natural-language-investigation.js";
import type { ModelProvider } from "../ai/provider.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";

const inputs = { metric: "net_revenue", dimension: "region",
  baseline: { start: "2025-01-01", end: "2025-02-01" }, target: { start: "2025-02-01", end: "2025-03-01" } };
const item: InvestigationDevelopmentCase = { id: "synthetic", category: "supported", question: "Synthetic request",
  expectedOutcome: "completed", expectedInputs: inputs, expectUnresolvedQuestions: false,
  numericalReference: "synthetic", requireEvidence: false, note: "" };
const numeric: InvestigationNumericalReference = { baseline: inputs.baseline, target: inputs.target,
  baselineValue: "10.00", targetValue: "15.00", absoluteChange: "5.00", percentageChange: "50.00",
  segments: [{ region: "East", baselinePresent: true, targetPresent: true,
    baselineValue: "10.00", targetValue: "15.00", absoluteChange: "5.00" }] };
function provider(fields: unknown): ModelProvider {
  return { async generate() { return { text: JSON.stringify(fields), toolCalls: [], finishReason: "stop",
    metadata: { model: "fake", tokenUsage: null, latencyMs: 1, requestId: null } }; } };
}

test("grades numerical values, extraction, and SQL count independently", async () => {
  let count = 0;
  const executor: QueryPlanExecutor = { async execute() {
    const value = ++count % 2 === 1 ? "10.00" : "15.00";
    return count <= 2 ? [{ net_revenue: value }] : [{ region: "East", net_revenue: value }];
  } };
  const result = await investigateMetricChangeFromText(provider({ ...inputs, unresolvedQuestions: [] }), "Test", { executor });
  assert.equal(gradeInvestigationDevelopmentCase(item, result, count, numeric).endToEnd.status, "pass");
  const wrong = gradeInvestigationDevelopmentCase(item, result, count, { ...numeric, absoluteChange: "6.00" });
  assert.equal(wrong.outcome.status, "pass");
  assert.equal(wrong.extraction.status, "pass");
  assert.equal(wrong.numerical.status, "fail");
  assert.equal(wrong.endToEnd.status, "fail");
});

test("numerical not reached is distinct from an incorrect result", async () => {
  const result = await investigateMetricChangeFromText(provider({ ...inputs, metric: null, unresolvedQuestions: ["Which metric?"] }), "Test");
  const grades = gradeInvestigationDevelopmentCase(item, result, 0, numeric);
  assert.equal(grades.numerical.status, "not_reached");
  assert.equal(grades.outcome.status, "fail");
  assert.equal(grades.extraction.status, "fail");
  assert.equal(grades.endToEnd.status, "fail");
});

test("question wording is ungraded but null scope and question presence are required", async () => {
  const expected = { ...item, category: "ambiguous" as const, expectedOutcome: "clarification_required" as const,
    expectedInputs: { ...inputs, metric: null }, expectUnresolvedQuestions: true, numericalReference: null };
  const result = await investigateMetricChangeFromText(provider({ ...inputs, metric: null, unresolvedQuestions: ["Choose your metric"] }), "Test");
  const grades = gradeInvestigationDevelopmentCase(expected, result, 0, null);
  assert.equal(grades.extraction.status, "pass");
  assert.equal(grades.numerical.status, "not_applicable");
  assert.equal(grades.endToEnd.status, "pass");
});
