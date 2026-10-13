import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResult, ModelToolCall } from "../ai/provider.js";
import type { QueryPlanExecutor } from "./commerce-analysis-pipeline.js";
import { comparePeriodsToolDefinition } from "../tools/compare-periods.js";
import { runComparePeriodsToolOnce, runComparePeriodsAgent, reserveComparisonInputTokens } from "./compare-periods-tool-once.js";
import { COMPARE_PERIODS_AGENT_SYSTEM_PROMPT } from "./compare-periods-agent-v1-prompt.js";
import { comparePeriodsV2ToolDefinition } from "./compare-periods-agent-v2-prompt.js";

const arguments_ = { metric: "net_revenue", baseline: { start: "2025-08-01", end: "2025-09-01" }, target: { start: "2025-09-01", end: "2025-10-01" } };
const call: ModelToolCall = { id: "call-1", name: "compare_periods", arguments: JSON.stringify(arguments_) };
function fixture(calls: readonly ModelToolCall[], overrides: Partial<ModelResult> = {}) {
  const requests: ModelRequest[] = [];
  let sqlCount = 0;
  const provider: ModelProvider = { async generate(request) {
    requests.push(request);
    return { text: "Preserve this assistant text", toolCalls: calls, finishReason: "tool_calls",
      metadata: { model: "fake", latencyMs: 3, tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, requestId: "request-1" }, ...overrides };
  } };
  const executor: QueryPlanExecutor = { async execute() { return [{ net_revenue: ++sqlCount === 1 ? "7225.00" : "8295.00" }]; } };
  return { provider, executor, requests, sqlCount: () => sqlCount };
}

test("executes one chosen tool and ends with matching assistant/tool history and existing telemetry", async () => {
  const setup = fixture([call]);
  const result = await runComparePeriodsToolOnce(setup.provider, "Test", setup.executor);
  assert.equal(result.outcome, "tool_result");
  assert.equal(setup.requests.length, 1);
  assert.deepEqual(setup.requests[0]?.tools, [comparePeriodsToolDefinition]);
  assert.equal(setup.requests[0]?.messages.length, 2);
  assert.deepEqual(result.validatedArguments, arguments_);
  assert.deepEqual(result.conversation[2], { role: "assistant", content: "Preserve this assistant text", toolCalls: [call] });
  const toolMessage = result.conversation[3];
  assert.ok(toolMessage?.role === "tool");
  assert.equal(toolMessage.toolCallId, call.id);
  assert.deepEqual(JSON.parse(toolMessage.content), result.toolResult);
  assert.equal(result.conversation.length, 4);
  assert.equal(setup.sqlCount(), 2);
  assert.equal(result.modelCall.latencyMs, 3);
  assert.equal(result.modelCall.tokenUsage?.totalTokens, 30);
  assert.equal(result.modelCall.requestId, "request-1");
  assert.ok(result.toolResult?.success);
  assert.equal(result.toolResult.data.absoluteChange, "1070.00");
});

function scripted(responses: readonly ModelResult[]) {
  const requests: ModelRequest[] = [];
  let sqlCount = 0;
  const provider: ModelProvider = { async generate(request) {
    requests.push(request);
    const result = responses[requests.length - 1];
    assert.ok(result, "No unplanned model turn");
    return result;
  } };
  const executor: QueryPlanExecutor = { async execute(plan, options) {
    assert.ok(options?.signal, "Overall deadline must reach the executor");
    const row = { net_revenue: ++sqlCount % 2 === 1 ? "7225.00" : "8295.00" };
    return plan.dimensions.kind === "specified" && plan.dimensions.values[0] === "region" ? [{ region: "East", ...row }] : [row];
  } };
  return { provider, executor, requests, sqlCount: () => sqlCount };
}
function reply(toolCalls: readonly ModelToolCall[], text = "", inputTokens = 100, outputTokens = 30): ModelResult {
  return { text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop",
    metadata: { model: "fake", latencyMs: 1, tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, requestId: null } };
}

test("agent returns preserved tool history to the model and charges repeated input", async () => {
  const setup = scripted([reply([call]), reply([], "Observed increase: 1070.00 (14.81%)", 300, 20)]);
  const result = await runComparePeriodsAgent(setup.provider, "Test", { executor: setup.executor });
  assert.equal(result.stopReason, "answer");
  assert.equal(result.completed, true);
  assert.equal(result.answerClaimsVerified, false);
  assert.equal(result.cumulativeInputTokens, 400);
  assert.equal(result.cumulativeOutputTokens, 50);
  assert.equal(result.cumulativeTokens, 450);
  assert.ok(result.turns.every((turn) => turn.inputTokenReservation > 450));
  assert.equal(result.turns[0]?.cumulativeTokens, 130, "Reservation must never be charged as actual usage");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(setup.sqlCount(), 2);
  assert.deepEqual(setup.requests[1]?.messages.slice(2), result.conversation.slice(2, 4));
  assert.ok(setup.requests.every((request) => request.signal instanceof AbortSignal));
});

test("agent detects repeated normalized arguments despite reordered keys and whitespace", async () => {
  const repeated = { ...call, id: "repeat-2", arguments: ' { "target": {"end":"2025-10-01", "start":"2025-09-01"}, "baseline": {"end":"2025-09-01", "start":"2025-08-01"}, "metric":"net_revenue" } ' };
  const setup = scripted([reply([call]), reply([repeated])]);
  const result = await runComparePeriodsAgent(setup.provider, "Test", { executor: setup.executor });
  assert.equal(result.stopReason, "repeated_tool_call");
  assert.equal(result.completed, false);
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(setup.sqlCount(), 2);
  assert.equal(result.turns[1]?.tools[0]?.executed, false);
  const message = result.conversation.at(-1);
  assert.ok(message?.role === "tool");
  assert.equal(message.toolCallId, repeated.id);
});

test("agent stops at two executions and three model turns", async () => {
  const second = { ...call, id: "second", arguments: JSON.stringify({ ...arguments_,
    baseline: { start: "2025-06-01", end: "2025-07-01" }, target: { start: "2025-07-01", end: "2025-08-01" } }) };
  const third = { ...call, id: "third", arguments: JSON.stringify({ ...arguments_,
    baseline: { start: "2025-01-01", end: "2025-02-01" }, target: { start: "2025-02-01", end: "2025-03-01" } }) };
  const setup = scripted([reply([call]), reply([second]), reply([third])]);
  const result = await runComparePeriodsAgent(setup.provider, "Test", { executor: setup.executor });
  assert.equal(result.stopReason, "tool_execution_budget");
  assert.equal(result.completed, false);
  assert.equal(result.modelTurnCount, 3);
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(setup.sqlCount(), 4);
});

test("agent reserves next repeated input and stops before another unaffordable request", async () => {
  const setup = scripted([reply([call], "", 5500, 100)]);
  const result = await runComparePeriodsAgent(setup.provider, "Test", { executor: setup.executor });
  assert.equal(result.stopReason, "token_budget");
  assert.equal(result.completed, false);
  assert.equal(result.cumulativeTokens, 5600);
  assert.equal(setup.requests.length, 1);
});

test("agent caps output inside the remaining input/output allowance", async () => {
  const reservation = (length: number) => reserveComparisonInputTokens([
    { role: "system", content: COMPARE_PERIODS_AGENT_SYSTEM_PROMPT }, { role: "user", content: "x".repeat(length) },
  ]);
  let low = 0, high = 30_000;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (reservation(middle) < 5800) low = middle + 1; else high = middle; }
  const question = "x".repeat(low);
  const setup = scripted([reply([call], "", 5500, 100)]);
  const result = await runComparePeriodsAgent(setup.provider, question, { executor: setup.executor });
  assert.equal(setup.requests[0]?.maxTokens, 6000 - reservation(low));
  assert.ok((setup.requests[0]?.maxTokens ?? 0) > 0 && (setup.requests[0]?.maxTokens ?? 0) <= 200);
  assert.equal(result.stopReason, "token_budget");
  assert.equal(setup.requests.length, 1);
  const tooLarge = scripted([]);
  const blocked = await runComparePeriodsAgent(tooLarge.provider, "x".repeat(30_000), { executor: tooLarge.executor });
  assert.equal(blocked.modelTurnCount, 0);
  assert.equal(blocked.stopReason, "token_budget");
  assert.equal(tooLarge.requests.length, 0, "Insufficient estimated capacity must stop before dispatch");
  assert.equal(blocked.cumulativeTokens, 0);
});

test("missing usage or an exhausted reported budget cannot succeed or execute tools", async () => {
  for (const response of [
    { ...reply([call]), metadata: { model: "fake", latencyMs: 1, tokenUsage: null, requestId: null } },
    reply([call], "", 5990, 10),
  ]) {
    const setup = scripted([response]);
    const result = await runComparePeriodsAgent(setup.provider, "Test", { executor: setup.executor });
    assert.ok(["token_usage_unavailable", "token_budget"].includes(result.stopReason));
    assert.equal(result.completed, false);
    assert.equal(setup.sqlCount(), 0);
  }
});

test("agent deadline aborts a pending model request and is not successful completion", async () => {
  let signal: AbortSignal | undefined;
  const provider: ModelProvider = { async generate(request) {
    signal = request.signal;
    return new Promise((_, reject) => request.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
  } };
  const result = await runComparePeriodsAgent(provider, "Test", { deadlineMs: 20 });
  assert.equal(result.stopReason, "timeout");
  assert.equal(result.completed, false);
  assert.equal(signal?.aborted, true);
  assert.equal(result.tokenUsageComplete, false);
});

test("agent requires an observed result before accepting an answer", async () => {
  const setup = scripted([reply([], "Invented answer")]);
  const result = await runComparePeriodsAgent(setup.provider, "Test", { executor: setup.executor });
  assert.equal(result.stopReason, "answer_without_tool_result");
  assert.equal(result.completed, false);
  assert.equal(setup.sqlCount(), 0);
});

test("development revision selects the versioned interface and preserves valid partial periods", async () => {
  const partial = { metric: "net_revenue", baseline: { start: "2032-02-02", end: "2032-02-04" },
    target: { start: "2032-03-02", end: "2032-03-04" } };
  const setup = scripted([reply([{ ...call, arguments: JSON.stringify(partial) }]), reply([], "Observed comparison")]);
  const result = await runComparePeriodsAgent(setup.provider, "Explicit partial intervals", { executor: setup.executor, revision: "v2" });
  assert.equal(result.promptVersion, "compare-periods-agent-v2");
  assert.equal(result.toolDefinitionVersion, "compare-periods-tool-definition-v2");
  assert.deepEqual(setup.requests[0]?.tools, [comparePeriodsV2ToolDefinition]);
  assert.deepEqual(result.turns[0]?.tools[0]?.validatedArguments, partial);
  assert.equal(result.stopReason, "answer");
  assert.equal(setup.sqlCount(), 2);
});

test("three-tool revision executes the model-selected order and preserves definition provenance", async () => {
  const region = { id: "region-1", name: "compare_net_revenue_by_region", arguments: JSON.stringify({ baseline: arguments_.baseline, target: arguments_.target }) };
  const definition = { id: "definition-1", name: "get_metric_definition", arguments: '{"metric":"net_revenue"}' };
  const setup = scripted([reply([region, definition, call]), reply([], "Observed increase: 1070.00")]);
  const result = await runComparePeriodsAgent(setup.provider, "Investigate", { executor: setup.executor, revision: "v3" });
  assert.deepEqual(setup.requests[0]?.tools?.map((tool) => tool.name), ["compare_periods", "compare_net_revenue_by_region", "get_metric_definition"]);
  assert.deepEqual(result.turns[0]?.tools.map((tool) => tool.call.name), [region.name, definition.name, call.name]);
  assert.equal(result.toolExecutionCount, 3);
  assert.equal(setup.sqlCount(), 4);
  const observed = result.turns[0]?.tools[1]?.result;
  assert.ok(observed?.success && "sourceId" in observed.data);
  assert.equal(observed.data.sourceId, "src/tools/get-metric-definition.ts#METRIC_DEFINITIONS.net_revenue");
  assert.equal(observed.data.sourceVersion, null);
  assert.equal(result.stopReason, "answer");
  assert.equal(result.completed, true);
});

test("three-tool revision enforces four total executions across static and SQL tools", async () => {
  const definitions = ["net_revenue", "total_gross_revenue", "total_refund_amount"].map((metric, index) => ({
    id: `definition-${index}`, name: "get_metric_definition", arguments: JSON.stringify({ metric }),
  }));
  const region = { id: "region", name: "compare_net_revenue_by_region", arguments: JSON.stringify({ baseline: arguments_.baseline, target: arguments_.target }) };
  const setup = scripted([reply([...definitions, call, region])]);
  const result = await runComparePeriodsAgent(setup.provider, "Investigate", { executor: setup.executor, revision: "v3" });
  assert.equal(result.stopReason, "tool_execution_budget");
  assert.equal(result.toolExecutionCount, 4);
  assert.equal(setup.sqlCount(), 2);
  assert.equal(result.turns[0]?.tools[4]?.executed, false);
});

test("added tool argument errors stop before execution", async () => {
  for (const tool of [
    { id: "region", name: "compare_net_revenue_by_region", arguments: JSON.stringify({ baseline: arguments_.baseline }) },
    { id: "definition", name: "get_metric_definition", arguments: '{"metric":"profit"}' },
  ]) {
    const setup = scripted([reply([tool])]);
    const result = await runComparePeriodsAgent(setup.provider, "Investigate", { executor: setup.executor, revision: "v3" });
    assert.equal(result.stopReason, "invalid_arguments");
    assert.equal(setup.sqlCount(), 0);
    assert.equal(result.toolExecutionCount, 0);
  }
});

test("regional repeated calls are blocked after argument normalization", async () => {
  const region = { id: "region-1", name: "compare_net_revenue_by_region", arguments: JSON.stringify({ baseline: arguments_.baseline, target: arguments_.target }) };
  const repeated = { ...region, id: "region-2", arguments: JSON.stringify({ target: arguments_.target, baseline: arguments_.baseline }) };
  const setup = scripted([reply([region, repeated])]);
  const result = await runComparePeriodsAgent(setup.provider, "Investigate", { executor: setup.executor, revision: "v3" });
  assert.equal(result.stopReason, "repeated_tool_call");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(setup.sqlCount(), 2);
});

test("invalid arguments yield a matching error tool result without SQL or another model request", async () => {
  for (const raw of ["{", JSON.stringify({ ...arguments_, metric: "total_gross_revenue" }),
    JSON.stringify({ ...arguments_, target: arguments_.baseline }),
    JSON.stringify({ ...arguments_, baseline: { start: "2025-02-30", end: "2025-03-01" } }),
    JSON.stringify({ ...arguments_, target: { start: "2025-09-01", end: "2027-01-01" } }),
    JSON.stringify({ ...arguments_, sql: "SELECT * FROM orders" }), "{}"]) {
    const setup = fixture([{ ...call, arguments: raw }]);
    const result = await runComparePeriodsToolOnce(setup.provider, "Test", setup.executor);
    assert.equal(result.outcome, "invalid_arguments");
    assert.equal(setup.sqlCount(), 0);
    assert.equal(setup.requests.length, 1);
    assert.equal(result.validatedArguments, null);
    assert.equal(result.conversation.at(-1)?.role, "tool");
    assert.equal(result.rawToolCalls[0]?.arguments, raw);
  }
});

test("no call, missing IDs and multi-call batches stop without SQL", async () => {
  for (const calls of [[], [{ ...call, id: "" }], [call, { ...call, id: "call-2" }], [call, call]]) {
    const setup = fixture(calls);
    const result = await runComparePeriodsToolOnce(setup.provider, "Test", setup.executor);
    assert.equal(result.outcome, calls.length === 0 ? "no_tool_call" : "invalid_tool_call");
    assert.equal(setup.sqlCount(), 0);
    assert.equal(setup.requests.length, 1);
  }
});

test("unknown tool, refusal and incomplete generation never execute SQL", async () => {
  for (const [calls, overrides] of [
    [[{ ...call, name: "unsafe_tool" }], {}], [[call], { refusal: "Refused" }], [[call], { finishReason: "length" }],
  ] as const) {
    const setup = fixture(calls, overrides);
    await runComparePeriodsToolOnce(setup.provider, "Test", setup.executor);
    assert.equal(setup.sqlCount(), 0);
    assert.equal(setup.requests.length, 1);
  }
});

test("SQL failure is returned as a tool result without retry", async () => {
  const setup = fixture([call]);
  let attempts = 0;
  const executor: QueryPlanExecutor = { async execute() { attempts++; throw new Error("SQL unavailable"); } };
  const result = await runComparePeriodsToolOnce(setup.provider, "Test", executor);
  assert.equal(result.outcome, "execution_failed");
  assert.equal(attempts, 1);
  assert.equal(setup.requests.length, 1);
  assert.deepEqual(result.validatedArguments, arguments_);
  assert.equal(result.conversation.at(-1)?.role, "tool");
});
