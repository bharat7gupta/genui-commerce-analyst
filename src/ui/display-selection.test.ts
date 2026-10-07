import assert from "node:assert/strict";
import test from "node:test";

import type { ModelProvider, ModelRequest, ModelResult } from "../ai/provider.js";
import { selectDisplay } from "./display-selection.js";

function response(text: string): ModelResult {
  return {
    text, toolCalls: [], finishReason: "stop", refusal: null,
    metadata: { model: "fake", latencyMs: 42, requestId: null,
      tokenUsage: { inputTokens: 50, outputTokens: 12, totalTokens: 62 } },
  };
}

test("requests strict structured output without results and validates both types", async () => {
  for (const type of ["kpi", "table"]) {
    let calls = 0;
    const provider: ModelProvider = { async generate(request: ModelRequest) {
      calls++;
      assert.equal(request.responseFormat?.type, "json_schema");
      assert.equal(request.responseFormat?.strict, true);
      assert.equal(request.responseFormat?.schema.additionalProperties, false);
      assert.deepEqual(request.messages.map(({ role }) => role), ["system", "user"]);
      assert.equal(request.messages[1]?.content, `Display as ${type}`);
      assert.ok(!JSON.stringify(request).includes("7225"));
      return response(JSON.stringify({ type, resultField: "net_revenue" }));
    } };
    const result = await selectDisplay(provider, `Display as ${type}`);
    assert.equal(calls, 1);
    assert.equal(result.outcome, "validated");
    if (result.outcome === "validated") assert.equal(result.specification.type, type);
    assert.equal(result.latencyMs, 42);
    assert.equal(result.metadata?.tokenUsage?.totalTokens, 62);
  }
});

test("malformed, unknown, and extra-value outputs fail without repair or retry", async () => {
  for (const text of [
    "```json\n{}\n```", '{"type":"chart","resultField":"net_revenue"}',
    '{"type":"kpi","resultField":"profit"}',
    '{"type":"kpi","resultField":"net_revenue","value":7225}',
  ]) {
    let calls = 0;
    const result = await selectDisplay({ async generate() { calls++; return response(text); } }, "Display revenue");
    assert.equal(calls, 1);
    assert.equal(result.outcome, "validation_error");
    assert.equal(result.rawOutput, text);
    assert.ok(!("specification" in result));
    assert.match(result.error, /Invalid UI specification/);
  }
});

test("provider failure, refusal, and truncated generation cannot produce specifications", async () => {
  const providers: ModelProvider[] = [
    { async generate() { throw new Error("Endpoint unavailable"); } },
    { async generate() { return { ...response('{"type":"kpi","resultField":"net_revenue"}'), refusal: "Refused" }; } },
    { async generate() { return { ...response('{"type":"table","resultField":"net_revenue"}'), finishReason: "length" }; } },
  ];
  for (const provider of providers) {
    const result = await selectDisplay(provider, "Display revenue");
    assert.equal(result.outcome, "generation_error");
    assert.ok(!("specification" in result));
    assert.match(result.error, /Display generation failed/);
  }
});
