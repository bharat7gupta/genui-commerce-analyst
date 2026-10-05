import assert from "node:assert/strict";
import test from "node:test";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
  ModelToolCall,
} from "../ai/provider.js";
import {
  getMetricDefinition,
  getMetricDefinitionToolDefinition,
  type GetMetricDefinitionHandler,
} from "../tools/get-metric-definition.js";
import {
  METRIC_DEFINITION_FINAL_ANSWER_SYSTEM_PROMPT,
  runMetricDefinitionToolWorkflow,
} from "./metric-definition-tool-workflow.js";

test("executes one call and sends the complete history for a follow-up answer", async () => {
  const call = metricCall("call-1", "net_revenue");
  const provider = new ScriptedProvider([
    modelResult({
      text: "I will check the definition.",
      toolCalls: [call],
      finishReason: "tool_calls",
      latencyMs: 11,
      requestId: "request-initial",
    }),
    modelResult({
      text: "Net revenue is gross revenue after discounts and refunds.",
      latencyMs: 22,
      requestId: "request-follow-up",
    }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "What does net revenue mean?",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "answer");
  if (result.outcome !== "answer") return;
  assert.equal(result.source, "follow_up");
  assert.equal(
    result.answer,
    "Net revenue is gross revenue after discounts and refunds.",
  );
  assert.deepEqual(executedMetrics, ["net_revenue"]);
  assert.deepEqual(result.modelCalls, [
    {
      phase: "initial",
      model: "scripted-model",
      latencyMs: 11,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
      requestId: "request-initial",
      finishReason: "tool_calls",
    },
    {
      phase: "follow_up",
      model: "scripted-model",
      latencyMs: 22,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
      requestId: "request-follow-up",
      finishReason: "stop",
    },
  ]);

  assert.deepEqual(provider.requests[0], {
    messages: [{ role: "user", content: "What does net revenue mean?" }],
    tools: [getMetricDefinitionToolDefinition],
  });
  assert.deepEqual(provider.requests[1], {
    messages: [
      {
        role: "system",
        content: METRIC_DEFINITION_FINAL_ANSWER_SYSTEM_PROMPT,
      },
      { role: "user", content: "What does net revenue mean?" },
      {
        role: "assistant",
        content: "I will check the definition.",
        toolCalls: [call],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify(result.toolResults[0]?.result),
      },
    ],
  });
  assert.equal(provider.requests[1]?.tools, undefined);
});

test("returns an initial answer without executing or making a follow-up call", async () => {
  const provider = new ScriptedProvider([
    modelResult({ text: "Net revenue is a defined commerce metric." }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "What is net revenue?",
    countingHandler(executedMetrics),
  );

  assert.deepEqual(result, {
    outcome: "answer",
    answer: "Net revenue is a defined commerce metric.",
    source: "initial",
    modelCalls: [expectedTelemetry("initial")],
    toolResults: [],
  });
  assert.deepEqual(executedMetrics, []);
  assert.equal(provider.requests.length, 1);
});

test("returns malformed JSON as a structured tool result", async () => {
  const provider = twoRoundProvider({
    id: "call-malformed",
    name: "get_metric_definition",
    arguments: "{not-json",
  });
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define revenue",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "answer");
  assert.equal(result.toolResults[0]?.result.success, false);
  const toolResult = result.toolResults[0]?.result;
  if (toolResult?.success !== false) return;
  assert.equal(toolResult.error.code, "MALFORMED_ARGUMENTS_JSON");
  assert.deepEqual(executedMetrics, []);
  assertToolMessageMatches(provider.requests[1], "call-malformed", toolResult);
});

test("returns invalid metric arguments without invoking the handler", async () => {
  const provider = twoRoundProvider({
    id: "call-invalid",
    name: "get_metric_definition",
    arguments: '{"metric":"profit"}',
  });
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define profit",
    countingHandler(executedMetrics),
  );

  const toolResult = result.toolResults[0]?.result;
  assert.equal(toolResult?.success, false);
  if (toolResult?.success !== false) return;
  assert.equal(toolResult.error.code, "INVALID_ARGUMENTS");
  assert.deepEqual(executedMetrics, []);
  assertToolMessageMatches(provider.requests[1], "call-invalid", toolResult);
});

test("returns an unknown tool error without invoking the handler", async () => {
  const provider = twoRoundProvider({
    id: "call-unknown",
    name: "run_arbitrary_sql",
    arguments: '{"sql":"DROP TABLE orders"}',
  });
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Run something",
    countingHandler(executedMetrics),
  );

  const toolResult = result.toolResults[0]?.result;
  assert.equal(toolResult?.success, false);
  if (toolResult?.success !== false) return;
  assert.equal(toolResult.error.code, "UNKNOWN_TOOL");
  assert.deepEqual(executedMetrics, []);
  assertToolMessageMatches(provider.requests[1], "call-unknown", toolResult);
});

test("executes multiple calls sequentially and preserves result association", async () => {
  const calls = [
    metricCall("call-gross", "total_gross_revenue"),
    metricCall("call-refunds", "total_refund_amount"),
  ];
  const provider = new ScriptedProvider([
    modelResult({
      text: "I will retrieve both definitions.",
      toolCalls: calls,
      finishReason: "tool_calls",
    }),
    modelResult({ text: "Here are both definitions." }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define gross revenue and refunds",
    countingHandler(executedMetrics),
  );

  assert.deepEqual(executedMetrics, [
    "total_gross_revenue",
    "total_refund_amount",
  ]);
  assert.deepEqual(
    result.toolResults.map(({ id, result: toolResult }) => ({
      id,
      metric: toolResult.success ? toolResult.data.metric : null,
    })),
    [
      { id: "call-gross", metric: "total_gross_revenue" },
      { id: "call-refunds", metric: "total_refund_amount" },
    ],
  );
  assertToolMessageMatches(
    provider.requests[1],
    "call-gross",
    result.toolResults[0]?.result,
    3,
  );
  assertToolMessageMatches(
    provider.requests[1],
    "call-refunds",
    result.toolResults[1]?.result,
    4,
  );
});

test("rejects duplicate call IDs before executing any handlers", async () => {
  const provider = new ScriptedProvider([
    modelResult({
      text: "",
      toolCalls: [
        metricCall("duplicate", "net_revenue"),
        metricCall("duplicate", "total_refund_amount"),
      ],
      finishReason: "tool_calls",
    }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define two metrics",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "invalid_tool_call_batch");
  if (result.outcome !== "invalid_tool_call_batch") return;
  assert.equal(result.error.code, "DUPLICATE_TOOL_CALL_ID");
  assert.deepEqual(executedMetrics, []);
  assert.equal(provider.requests.length, 1);
});

test("rejects oversized batches before executing any handlers", async () => {
  const provider = new ScriptedProvider([
    modelResult({
      text: "",
      toolCalls: [
        metricCall("call-1", "net_revenue"),
        metricCall("call-2", "net_revenue"),
        metricCall("call-3", "net_revenue"),
        metricCall("call-4", "net_revenue"),
      ],
      finishReason: "tool_calls",
    }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define metrics",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "invalid_tool_call_batch");
  if (result.outcome !== "invalid_tool_call_batch") return;
  assert.equal(result.error.code, "TOO_MANY_TOOL_CALLS");
  assert.deepEqual(executedMetrics, []);
  assert.equal(provider.requests.length, 1);
});

test("rejects a missing call ID before executing any handlers", async () => {
  const provider = new ScriptedProvider([
    modelResult({
      text: "",
      toolCalls: [metricCall("", "net_revenue")],
      finishReason: "tool_calls",
    }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define net revenue",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "invalid_tool_call_batch");
  if (result.outcome !== "invalid_tool_call_batch") return;
  assert.equal(result.error.code, "MISSING_TOOL_CALL_ID");
  assert.deepEqual(executedMetrics, []);
  assert.equal(provider.requests.length, 1);
});

test("reports unexpected tool calls in the second response without executing them", async () => {
  const provider = new ScriptedProvider([
    modelResult({
      text: "First call",
      toolCalls: [metricCall("call-1", "net_revenue")],
      finishReason: "tool_calls",
    }),
    modelResult({
      text: "Another call",
      toolCalls: [metricCall("call-2", "total_refund_amount")],
      finishReason: "tool_calls",
    }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define revenue",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "unexpected_tool_calls");
  if (result.outcome !== "unexpected_tool_calls") return;
  assert.deepEqual(result.toolCalls, [
    metricCall("call-2", "total_refund_amount"),
  ]);
  assert.deepEqual(executedMetrics, ["net_revenue"]);
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[1]?.tools, undefined);
});

test("reports an initial provider failure explicitly", async () => {
  const provider = new ScriptedProvider([new Error("endpoint unavailable")]);

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define revenue",
  );

  assert.equal(result.outcome, "provider_error");
  if (result.outcome !== "provider_error") return;
  assert.equal(result.phase, "initial");
  assert.equal(result.error, "endpoint unavailable");
  assert.equal(result.modelCalls.length, 1);
  assert.equal(result.modelCalls[0]?.tokenUsage, null);
});

test("reports a refusal without executing returned calls", async () => {
  const provider = new ScriptedProvider([
    modelResult({
      text: "",
      toolCalls: [metricCall("call-1", "net_revenue")],
      refusal: "I cannot help with that.",
    }),
  ]);
  const executedMetrics: string[] = [];

  const result = await runMetricDefinitionToolWorkflow(
    provider,
    "Define revenue",
    countingHandler(executedMetrics),
  );

  assert.equal(result.outcome, "refusal");
  if (result.outcome !== "refusal") return;
  assert.equal(result.phase, "initial");
  assert.equal(result.refusal, "I cannot help with that.");
  assert.deepEqual(executedMetrics, []);
  assert.equal(provider.requests.length, 1);
});

class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  private nextIndex = 0;

  constructor(private readonly script: readonly (ModelResult | Error)[]) {}

  async generate(request: ModelRequest): Promise<ModelResult> {
    this.requests.push(request);
    const next = this.script[this.nextIndex];
    this.nextIndex += 1;

    if (next === undefined) {
      throw new Error("Unexpected additional provider request");
    }
    if (next instanceof Error) throw next;
    return next;
  }
}

function modelResult({
  text,
  toolCalls = [],
  refusal = null,
  finishReason = "stop",
  latencyMs = 10,
  requestId = "request-id",
}: {
  text: string;
  toolCalls?: readonly ModelToolCall[];
  refusal?: string | null;
  finishReason?: string | null;
  latencyMs?: number;
  requestId?: string;
}): ModelResult {
  return {
    text,
    toolCalls,
    metadata: {
      model: "scripted-model",
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
      latencyMs,
      requestId,
    },
    finishReason,
    refusal,
  };
}

function metricCall(id: string, metric: string): ModelToolCall {
  return {
    id,
    name: "get_metric_definition",
    arguments: JSON.stringify({ metric }),
  };
}

function countingHandler(executedMetrics: string[]): GetMetricDefinitionHandler {
  return (arguments_) => {
    executedMetrics.push(arguments_.metric);
    return getMetricDefinition(arguments_);
  };
}

function twoRoundProvider(call: ModelToolCall): ScriptedProvider {
  return new ScriptedProvider([
    modelResult({
      text: "I will use a tool.",
      toolCalls: [call],
      finishReason: "tool_calls",
    }),
    modelResult({ text: "I handled the tool result." }),
  ]);
}

function assertToolMessageMatches(
  request: ModelRequest | undefined,
  expectedId: string,
  expectedResult: unknown,
  messageIndex = 3,
): void {
  const message = request?.messages[messageIndex];
  assert.ok(message);
  assert.equal(message.role, "tool");
  if (message.role !== "tool") return;
  assert.equal(message.toolCallId, expectedId);
  assert.deepEqual(JSON.parse(message.content), expectedResult);
}

function expectedTelemetry(
  phase: "initial" | "follow_up",
) {
  return {
    phase,
    model: "scripted-model",
    latencyMs: 10,
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    },
    requestId: "request-id",
    finishReason: "stop",
  };
}
