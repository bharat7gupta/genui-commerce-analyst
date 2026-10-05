import type {
  ModelMessage,
  ModelMetadata,
  ModelProvider,
  ModelRequest,
  ModelResult,
  ModelToolCall,
  TokenUsage,
} from "../ai/provider.js";
import {
  executeGetMetricDefinition,
  getMetricDefinition,
  getMetricDefinitionToolDefinition,
  type GetMetricDefinitionHandler,
  type GetMetricDefinitionResult,
} from "../tools/get-metric-definition.js";

const MAX_TOOL_CALLS = 3;

export const METRIC_DEFINITION_FINAL_ANSWER_SYSTEM_PROMPT = `Answer the user's original question using the application-owned metric definition in the tool result as authoritative.
Preserve its calculation and its inclusion and exclusion rules exactly.
Do not make assumptions about external platforms or underlying row values.
Do not describe revenue as profit or earnings.
Answer briefly. If the definition does not contain information needed to answer, acknowledge that limitation.`;

type ModelCallPhase = "initial" | "follow_up";

export type WorkflowModelCall = Readonly<{
  phase: ModelCallPhase;
  model: string | null;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  requestId: string | null;
  finishReason: string | null;
}>;

type UnknownToolResult = Readonly<{
  success: false;
  error: Readonly<{
    code: "UNKNOWN_TOOL";
    message: string;
  }>;
}>;

type MalformedArgumentsResult = Readonly<{
  success: false;
  error: Readonly<{
    code: "MALFORMED_ARGUMENTS_JSON";
    message: string;
  }>;
}>;

export type MetricDefinitionToolResult =
  | GetMetricDefinitionResult
  | UnknownToolResult
  | MalformedArgumentsResult;

export type ProcessedToolCall = Readonly<{
  id: string;
  name: string;
  arguments: string;
  result: MetricDefinitionToolResult;
}>;

type WorkflowBase = Readonly<{
  modelCalls: readonly WorkflowModelCall[];
  toolResults: readonly ProcessedToolCall[];
}>;

export type MetricDefinitionWorkflowResult =
  | (WorkflowBase &
      Readonly<{
        outcome: "answer";
        answer: string;
        source: "initial" | "follow_up";
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "invalid_tool_call_batch";
        error: Readonly<{
          code:
            | "MISSING_TOOL_CALL_ID"
            | "DUPLICATE_TOOL_CALL_ID"
            | "TOO_MANY_TOOL_CALLS";
          message: string;
        }>;
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "unexpected_tool_calls";
        responseText: string;
        toolCalls: readonly ModelToolCall[];
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "refusal";
        phase: ModelCallPhase;
        refusal: string;
        responseText: string;
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "provider_error";
        phase: ModelCallPhase;
        error: string;
      }>);

export async function runMetricDefinitionToolWorkflow(
  provider: ModelProvider,
  question: string,
  handler: GetMetricDefinitionHandler = getMetricDefinition,
): Promise<MetricDefinitionWorkflowResult> {
  const initialMessages: readonly ModelMessage[] = [
    { role: "user", content: question },
  ];
  const initialAttempt = await callProvider(provider, "initial", {
    messages: initialMessages,
    tools: [getMetricDefinitionToolDefinition],
  });

  if (!initialAttempt.success) {
    return {
      outcome: "provider_error",
      phase: "initial",
      error: initialAttempt.error,
      modelCalls: [initialAttempt.telemetry],
      toolResults: [],
    };
  }

  const initialResult = initialAttempt.result;
  const initialTelemetry = initialAttempt.telemetry;
  const initialRefusal = initialResult.refusal ?? null;

  if (initialRefusal !== null) {
    return {
      outcome: "refusal",
      phase: "initial",
      refusal: initialRefusal,
      responseText: initialResult.text,
      modelCalls: [initialTelemetry],
      toolResults: [],
    };
  }

  if (initialResult.toolCalls.length === 0) {
    return {
      outcome: "answer",
      answer: initialResult.text,
      source: "initial",
      modelCalls: [initialTelemetry],
      toolResults: [],
    };
  }

  const batchError = validateToolCallBatch(initialResult.toolCalls);
  if (batchError !== null) {
    return {
      outcome: "invalid_tool_call_batch",
      error: batchError,
      modelCalls: [initialTelemetry],
      toolResults: [],
    };
  }

  const toolResults: ProcessedToolCall[] = [];
  const toolResultMessages: ModelMessage[] = [];

  for (const toolCall of initialResult.toolCalls) {
    const result = executeToolCall(toolCall, handler);
    toolResults.push({ ...toolCall, result });
    toolResultMessages.push({
      role: "tool",
      toolCallId: toolCall.id,
      content: JSON.stringify(result),
    });
  }

  const assistantMessage: ModelMessage = {
    role: "assistant",
    content: initialResult.text,
    toolCalls: initialResult.toolCalls,
  };
  const followUpAttempt = await callProvider(provider, "follow_up", {
    messages: [
      {
        role: "system",
        content: METRIC_DEFINITION_FINAL_ANSWER_SYSTEM_PROMPT,
      },
      ...initialMessages,
      assistantMessage,
      ...toolResultMessages,
    ],
  });

  if (!followUpAttempt.success) {
    return {
      outcome: "provider_error",
      phase: "follow_up",
      error: followUpAttempt.error,
      modelCalls: [initialTelemetry, followUpAttempt.telemetry],
      toolResults,
    };
  }

  const followUpResult = followUpAttempt.result;
  const modelCalls = [initialTelemetry, followUpAttempt.telemetry];
  const followUpRefusal = followUpResult.refusal ?? null;

  if (followUpRefusal !== null) {
    return {
      outcome: "refusal",
      phase: "follow_up",
      refusal: followUpRefusal,
      responseText: followUpResult.text,
      modelCalls,
      toolResults,
    };
  }

  if (followUpResult.toolCalls.length > 0) {
    return {
      outcome: "unexpected_tool_calls",
      responseText: followUpResult.text,
      toolCalls: followUpResult.toolCalls,
      modelCalls,
      toolResults,
    };
  }

  return {
    outcome: "answer",
    answer: followUpResult.text,
    source: "follow_up",
    modelCalls,
    toolResults,
  };
}

function executeToolCall(
  toolCall: ModelToolCall,
  handler: GetMetricDefinitionHandler,
): MetricDefinitionToolResult {
  if (toolCall.name !== getMetricDefinitionToolDefinition.name) {
    return {
      success: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `Unknown tool: ${JSON.stringify(toolCall.name)}`,
      },
    };
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(toolCall.arguments);
  } catch (error) {
    return {
      success: false,
      error: {
        code: "MALFORMED_ARGUMENTS_JSON",
        message: `Tool arguments are not valid JSON: ${toErrorMessage(error)}`,
      },
    };
  }

  return executeGetMetricDefinition(parsedArguments, handler);
}

function validateToolCallBatch(
  toolCalls: readonly ModelToolCall[],
): Extract<
  MetricDefinitionWorkflowResult,
  { outcome: "invalid_tool_call_batch" }
>["error"] | null {
  if (toolCalls.length > MAX_TOOL_CALLS) {
    return {
      code: "TOO_MANY_TOOL_CALLS",
      message: `At most ${MAX_TOOL_CALLS} tool calls are allowed in one response`,
    };
  }

  const seenIds = new Set<string>();
  for (const [index, toolCall] of toolCalls.entries()) {
    if (toolCall.id.length === 0) {
      return {
        code: "MISSING_TOOL_CALL_ID",
        message: `Tool call at index ${index} is missing an ID`,
      };
    }

    if (seenIds.has(toolCall.id)) {
      return {
        code: "DUPLICATE_TOOL_CALL_ID",
        message: `Duplicate tool call ID: ${JSON.stringify(toolCall.id)}`,
      };
    }

    seenIds.add(toolCall.id);
  }

  return null;
}

type ProviderCallAttempt =
  | Readonly<{
      success: true;
      result: ModelResult;
      telemetry: WorkflowModelCall;
    }>
  | Readonly<{
      success: false;
      error: string;
      telemetry: WorkflowModelCall;
    }>;

async function callProvider(
  provider: ModelProvider,
  phase: ModelCallPhase,
  request: ModelRequest,
): Promise<ProviderCallAttempt> {
  const startedAt = performance.now();

  try {
    const result = await provider.generate(request);
    return {
      success: true,
      result,
      telemetry: toTelemetry(phase, result.metadata, result.finishReason),
    };
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error),
      telemetry: {
        phase,
        model: null,
        latencyMs: Math.round(performance.now() - startedAt),
        tokenUsage: null,
        requestId: null,
        finishReason: null,
      },
    };
  }
}

function toTelemetry(
  phase: ModelCallPhase,
  metadata: ModelMetadata,
  finishReason: string | null | undefined,
): WorkflowModelCall {
  return {
    phase,
    model: metadata.model,
    latencyMs: metadata.latencyMs,
    tokenUsage: metadata.tokenUsage,
    requestId: metadata.requestId,
    finishReason: finishReason ?? null,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
