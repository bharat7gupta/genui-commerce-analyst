import assert from "node:assert/strict";
import test from "node:test";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
  ModelToolCall,
} from "../ai/provider.js";
import { getMetricDefinition } from "../tools/get-metric-definition.js";
import { getSchema } from "../tools/get-schema.js";
import { previewQueryPlan } from "../tools/preview-query-plan.js";
import {
  MAX_MODEL_REQUESTS,
  MAX_TOTAL_TOOL_CALLS,
  TOOL_WORKFLOW_SYSTEM_PROMPT,
  runStandaloneToolWorkflow,
  standaloneToolDefinitions,
  type StandaloneToolHandlers,
} from "./metric-definition-tool-workflow.js";

test("chains get_schema to preview_query_plan and then returns the final answer", async () => {
  const schemaCall = toolCall("schema-1", "get_schema", {});
  const previewCall = toolCall("preview-1", "preview_query_plan", {
    plan: makePlan(),
  });
  const provider = new ScriptedProvider([
    modelResult("I will inspect the supported schema.", [schemaCall]),
    modelResult("I will validate the proposed plan.", [previewCall]),
    modelResult("The plan is valid and groups net revenue by region."),
  ]);

  const result = await runStandaloneToolWorkflow(
    provider,
    "Create a valid regional net revenue plan.",
  );

  assert.equal(result.outcome, "answer");
  if (result.outcome !== "answer") return;
  assert.equal(
    result.answer,
    "The plan is valid and groups net revenue by region.",
  );
  assert.equal(result.modelRequestCount, 3);
  assert.deepEqual(
    result.toolResults.map(({ id, name, result: toolResult }) => ({
      id,
      name,
      success: toolResult.success,
    })),
    [
      { id: "schema-1", name: "get_schema", success: true },
      { id: "preview-1", name: "preview_query_plan", success: true },
    ],
  );

  assert.deepEqual(
    provider.requests.map(({ tools }) => tools?.map(({ name }) => name)),
    [
      ["get_metric_definition", "get_schema", "preview_query_plan"],
      ["get_metric_definition", "get_schema", "preview_query_plan"],
      ["get_metric_definition", "get_schema", "preview_query_plan"],
    ],
  );
  assert.deepEqual(provider.requests[0]?.messages, [
    { role: "system", content: TOOL_WORKFLOW_SYSTEM_PROMPT },
    { role: "user", content: "Create a valid regional net revenue plan." },
  ]);
  assert.deepEqual(provider.requests[1]?.messages.slice(0, 3), [
    { role: "system", content: TOOL_WORKFLOW_SYSTEM_PROMPT },
    { role: "user", content: "Create a valid regional net revenue plan." },
    {
      role: "assistant",
      content: "I will inspect the supported schema.",
      toolCalls: [schemaCall],
    },
  ]);
  assertToolMessage(provider.requests[1], 3, "schema-1");
  assert.deepEqual(provider.requests[2]?.messages.slice(4, 5), [
    {
      role: "assistant",
      content: "I will validate the proposed plan.",
      toolCalls: [previewCall],
    },
  ]);
  assertToolMessage(provider.requests[2], 5, "preview-1");
  assert.equal(standaloneToolDefinitions.length, 3);
});

test("returns immediately when the model makes no tool call", async () => {
  const provider = new ScriptedProvider([modelResult("Hello!")]);

  const result = await runStandaloneToolWorkflow(provider, "Hello!");

  assert.equal(result.outcome, "answer");
  if (result.outcome !== "answer") return;
  assert.equal(result.answer, "Hello!");
  assert.equal(result.modelRequestCount, 1);
  assert.deepEqual(result.toolResults, []);
  assert.equal(provider.requests.length, 1);
});

test("keeps malformed JSON and unknown tools as structured tool results", async () => {
  const provider = new ScriptedProvider([
    modelResult("Checking.", [
      { id: "bad-json", name: "get_schema", arguments: "{" },
      toolCall("unknown", "run_sql", {}),
    ]),
    modelResult("Neither call could be completed."),
  ]);

  const result = await runStandaloneToolWorkflow(provider, "Check this.");

  assert.equal(result.outcome, "answer");
  assert.deepEqual(
    result.toolResults.map(({ result: toolResult }) =>
      toolResult.success ? "success" : toolResult.error.code,
    ),
    ["MALFORMED_ARGUMENTS_JSON", "UNKNOWN_TOOL"],
  );
});

test("rejects a duplicate call ID across rounds before executing that batch", async () => {
  const executions: string[] = [];
  const provider = new ScriptedProvider([
    modelResult("First.", [metricCall("reused", "net_revenue")]),
    modelResult("Again.", [metricCall("reused", "total_refund_amount")]),
  ]);

  const result = await runStandaloneToolWorkflow(
    provider,
    "Define metrics.",
    countingHandlers(executions),
  );

  assert.equal(result.outcome, "invalid_tool_call_batch");
  if (result.outcome !== "invalid_tool_call_batch") return;
  assert.equal(result.error.code, "DUPLICATE_TOOL_CALL_ID");
  assert.deepEqual(executions, ["metric:net_revenue"]);
});

test("rejects a missing call ID before executing its batch", async () => {
  const executions: string[] = [];
  const provider = new ScriptedProvider([
    modelResult("Calls.", [
      metricCall("", "net_revenue"),
      metricCall("not-executed", "total_refund_amount"),
    ]),
  ]);

  const result = await runStandaloneToolWorkflow(
    provider,
    "Define metrics.",
    countingHandlers(executions),
  );

  assert.equal(result.outcome, "invalid_tool_call_batch");
  if (result.outcome !== "invalid_tool_call_batch") return;
  assert.equal(result.error.code, "MISSING_TOOL_CALL_ID");
  assert.deepEqual(executions, []);
  assert.deepEqual(result.toolResults, []);
});

test("stops before executing fourth-round calls when the model-request budget is exhausted", async () => {
  const executions: string[] = [];
  const provider = new ScriptedProvider(
    Array.from({ length: MAX_MODEL_REQUESTS }, (_, index) =>
      modelResult(`Call ${index + 1}.`, [
        metricCall(`metric-${index + 1}`, "net_revenue"),
      ]),
    ),
  );

  const result = await runStandaloneToolWorkflow(
    provider,
    "Keep looking up the metric.",
    countingHandlers(executions),
  );

  assert.equal(result.outcome, "budget_exhausted");
  if (result.outcome !== "budget_exhausted") return;
  assert.equal(result.limit, "model_requests");
  assert.equal(result.modelCalls.length, MAX_MODEL_REQUESTS);
  assert.equal(result.toolResults.length, MAX_MODEL_REQUESTS - 1);
  assert.equal(result.pendingToolCalls[0]?.id, "metric-4");
  assert.equal(executions.length, MAX_MODEL_REQUESTS - 1);
  assert.equal(provider.requests.length, MAX_MODEL_REQUESTS);
});

test("rejects a batch that would exceed the total-tool-call budget", async () => {
  const executions: string[] = [];
  const firstBatch = Array.from({ length: MAX_TOTAL_TOOL_CALLS - 1 }, (_, index) =>
    metricCall(`accepted-${index + 1}`, "net_revenue"),
  );
  const provider = new ScriptedProvider([
    modelResult("First batch.", firstBatch),
    modelResult("Too many more.", [
      metricCall("pending-1", "net_revenue"),
      metricCall("pending-2", "net_revenue"),
    ]),
  ]);

  const result = await runStandaloneToolWorkflow(
    provider,
    "Use several calls.",
    countingHandlers(executions),
  );

  assert.equal(result.outcome, "budget_exhausted");
  if (result.outcome !== "budget_exhausted") return;
  assert.equal(result.limit, "tool_calls");
  assert.equal(result.toolResults.length, MAX_TOTAL_TOOL_CALLS - 1);
  assert.equal(result.pendingToolCalls.length, 2);
  assert.equal(executions.length, MAX_TOTAL_TOOL_CALLS - 1);
});

test("reports provider failures and refusals explicitly", async (t) => {
  await t.test("provider failure", async () => {
    const result = await runStandaloneToolWorkflow(
      new ScriptedProvider([new Error("endpoint unavailable")]),
      "Question",
    );
    assert.equal(result.outcome, "provider_error");
    if (result.outcome !== "provider_error") return;
    assert.equal(result.requestIndex, 1);
    assert.equal(result.error, "endpoint unavailable");
  });

  await t.test("refusal", async () => {
    const result = await runStandaloneToolWorkflow(
      new ScriptedProvider([
        modelResult("", [metricCall("ignored", "net_revenue")], "No."),
      ]),
      "Question",
    );
    assert.equal(result.outcome, "refusal");
    if (result.outcome !== "refusal") return;
    assert.equal(result.requestIndex, 1);
    assert.equal(result.refusal, "No.");
    assert.deepEqual(result.toolResults, []);
  });
});

class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  private nextIndex = 0;

  constructor(private readonly script: readonly (ModelResult | Error)[]) {}

  async generate(request: ModelRequest): Promise<ModelResult> {
    this.requests.push(request);
    const next = this.script[this.nextIndex];
    this.nextIndex += 1;
    if (next === undefined) throw new Error("Unexpected provider request");
    if (next instanceof Error) throw next;
    return next;
  }
}

function modelResult(
  text: string,
  toolCalls: readonly ModelToolCall[] = [],
  refusal: string | null = null,
): ModelResult {
  return {
    text,
    toolCalls,
    metadata: {
      model: "scripted-model",
      tokenUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      latencyMs: 10,
      requestId: "request-id",
    },
    finishReason: toolCalls.length === 0 ? "stop" : "tool_calls",
    refusal,
  };
}

function toolCall(id: string, name: string, arguments_: unknown): ModelToolCall {
  return { id, name, arguments: JSON.stringify(arguments_) };
}

function metricCall(id: string, metric: string): ModelToolCall {
  return toolCall(id, "get_metric_definition", { metric });
}

function countingHandlers(executions: string[]): StandaloneToolHandlers {
  return {
    getMetricDefinition: (arguments_) => {
      executions.push(`metric:${arguments_.metric}`);
      return getMetricDefinition(arguments_);
    },
    getSchema: (arguments_) => {
      executions.push("schema");
      return getSchema(arguments_);
    },
    previewQueryPlan: (plan) => {
      executions.push("preview");
      return previewQueryPlan(plan);
    },
  };
}

function assertToolMessage(
  request: ModelRequest | undefined,
  index: number,
  expectedCallId: string,
): void {
  const message = request?.messages[index];
  assert.ok(message);
  assert.equal(message.role, "tool");
  if (message.role !== "tool") return;
  assert.equal(message.toolCallId, expectedCallId);
  assert.equal(typeof JSON.parse(message.content), "object");
}

function makePlan() {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: ["region"] },
    filters: { kind: "specified", items: [] },
    dateRange: { kind: "all_time" },
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "type", value: "table" },
  };
}
