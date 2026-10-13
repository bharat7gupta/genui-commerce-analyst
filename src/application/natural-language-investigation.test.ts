import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResult } from "../ai/provider.js";
import type { QueryPlanExecutor } from "./commerce-analysis-pipeline.js";
import { investigateMetricChangeFromText, investigationExtractionJsonSchema } from "./natural-language-investigation.js";
import { INVESTIGATION_SYSTEM_PROMPT } from "./investigation-extraction-v1-prompt.js";

const fields = { metric: "net_revenue", dimension: "region",
  baseline: { start: "2025-08-01", end: "2025-09-01" },
  target: { start: "2025-09-01", end: "2025-10-01" }, unresolvedQuestions: [] };
function provider(value: unknown, override: Partial<ModelResult> = {}, observe?: (request: ModelRequest) => void): ModelProvider {
  return { async generate(request) {
    observe?.(request);
    return { text: JSON.stringify(value), toolCalls: [], finishReason: "stop",
      metadata: { model: "fake", latencyMs: 2, tokenUsage: null, requestId: null }, ...override };
  } };
}

test("uses separate roles and strict structured output then executes deterministic workflow", async () => {
  let calls = 0;
  const executor: QueryPlanExecutor = { async execute() {
    calls++;
    const value = calls % 2 === 1 ? "10.00" : "15.00";
    return calls <= 2 ? [{ net_revenue: value }] : [{ region: "East", net_revenue: value }];
  } };
  const question = "Explicit test request";
  const result = await investigateMetricChangeFromText(provider(fields, {}, (request) => {
    assert.deepEqual(request.messages, [{ role: "system", content: INVESTIGATION_SYSTEM_PROMPT }, { role: "user", content: question }]);
    assert.deepEqual(request.responseFormat?.schema, investigationExtractionJsonSchema);
    assert.equal(request.responseFormat?.strict, true);
    assert.equal(request.tools, undefined);
  }), question, { executor });
  assert.equal(result.outcome, "completed");
  assert.equal(calls, 4);
  assert.equal(result.investigation?.outcome, "completed");
});

test("ambiguity, unsupported choices and invalid dates never execute SQL", async () => {
  let calls = 0;
  const executor: QueryPlanExecutor = { async execute() { calls++; throw new Error("Must not execute SQL"); } };
  for (const [value, outcome] of [
    [{ ...fields, metric: null, baseline: null, target: null, dimension: null, unresolvedQuestions: ["Which revenue metric?"] }, "clarification_required"],
    [{ ...fields, metric: "total_gross_revenue" }, "unsupported"],
    [{ ...fields, dimension: "category" }, "unsupported"],
    [{ ...fields, unresolvedQuestions: ["Which year?"] }, "clarification_required"],
    [{ ...fields, baseline: { start: "2025-02-30", end: "2025-03-01" } }, "clarification_required"],
    [{ ...fields, target: fields.baseline }, "clarification_required"],
  ] as const) {
    const result = await investigateMetricChangeFromText(provider(value), "Test", { executor });
    assert.equal(result.outcome, outcome);
    assert.equal(result.investigation, null);
  }
  assert.equal(calls, 0);
});

test("raw malformed/incomplete/refused/extra-field outputs are retained and fail closed", async () => {
  let calls = 0;
  const executor: QueryPlanExecutor = { async execute() { calls++; return []; } };
  for (const [value, override] of [
    [fields, { text: "{" }],
    [fields, { finishReason: "length" }],
    [fields, { refusal: "Refused" }],
    [{ ...fields, sql: "SELECT * FROM orders" }, {}],
    [{ ...fields, baseline: { start: "2025-08-01T00:00:00Z", end: "2025-09-01" } }, {}],
  ] as const) {
    const result = await investigateMetricChangeFromText(provider(value, override), "Test", { executor });
    assert.equal(result.outcome, "extraction_failed");
    assert.ok(result.extraction.rawOutput);
  }
  assert.equal(calls, 0);
});

test("provider errors are recorded without retry or SQL", async () => {
  let calls = 0;
  const fake: ModelProvider = { async generate() { calls++; throw new Error("Unavailable"); } };
  const result = await investigateMetricChangeFromText(fake, "Test");
  assert.equal(result.outcome, "extraction_failed");
  assert.equal(result.extraction.rawOutput, null);
  assert.equal(calls, 1);
});
