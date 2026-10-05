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
import {
  executeGetSchema,
  getSchema,
  getSchemaToolDefinition,
  type GetSchemaHandler,
  type GetSchemaResult,
} from "../tools/get-schema.js";
import {
  executePreviewQueryPlan,
  previewQueryPlan,
  previewQueryPlanToolDefinition,
  type PreviewQueryPlanHandler,
  type PreviewQueryPlanResult,
} from "../tools/preview-query-plan.js";

export const MAX_MODEL_REQUESTS = 4;
export const MAX_TOTAL_TOOL_CALLS = 6;

export const TOOL_WORKFLOW_SYSTEM_PROMPT = `You may call the available tools across multiple turns before giving a final answer.
Follow each tool's argument schema exactly, including every required field and tagged variant.
If the user requests a preview, do not give a final answer until preview_query_plan returns a successful result.
When a tool returns validation errors, use those errors to correct the next tool call.
Previewing validates a query plan; it does not calculate revenue or execute a query.

Complete valid preview_query_plan arguments example:
{"plan":{"version":"query-plan-v1","metric":{"kind":"metric","value":"total_gross_revenue"},"dimensions":{"kind":"specified","values":["category"]},"filters":{"kind":"specified","items":[]},"dateRange":{"kind":"all_time"},"comparison":{"kind":"none"},"ordering":{"kind":"none"},"limit":{"kind":"none"},"visualization":{"kind":"type","value":"table"}}}

Answer the user's original question using application-owned tool results as authoritative.
Preserve metric calculations and inclusion and exclusion rules exactly.
Treat the returned schema as the complete set of supported query capabilities.
Do not make assumptions about external platforms, database contents, or underlying row values.
Do not describe revenue as profit or earnings.
Answer briefly only when giving the final answer; do not abbreviate or omit required tool arguments. If the tool results do not contain information needed to answer, acknowledge that limitation.`;

export const standaloneToolDefinitions = Object.freeze([
  getMetricDefinitionToolDefinition,
  getSchemaToolDefinition,
  previewQueryPlanToolDefinition,
]);

export type WorkflowModelCall = Readonly<{
  requestIndex: number;
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

export type StandaloneToolResult =
  | GetMetricDefinitionResult
  | GetSchemaResult
  | PreviewQueryPlanResult
  | UnknownToolResult
  | MalformedArgumentsResult;

export type ProcessedToolCall = Readonly<{
  id: string;
  name: string;
  arguments: string;
  result: StandaloneToolResult;
}>;

export type StandaloneToolHandlers = Readonly<{
  getMetricDefinition: GetMetricDefinitionHandler;
  getSchema: GetSchemaHandler;
  previewQueryPlan: PreviewQueryPlanHandler;
}>;

const defaultHandlers: StandaloneToolHandlers = {
  getMetricDefinition,
  getSchema,
  previewQueryPlan,
};

type WorkflowBase = Readonly<{
  modelCalls: readonly WorkflowModelCall[];
  toolResults: readonly ProcessedToolCall[];
}>;

export type StandaloneToolWorkflowResult =
  | (WorkflowBase &
      Readonly<{
        outcome: "answer";
        answer: string;
        modelRequestCount: number;
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "invalid_tool_call_batch";
        requestIndex: number;
        error: Readonly<{
          code: "MISSING_TOOL_CALL_ID" | "DUPLICATE_TOOL_CALL_ID";
          message: string;
        }>;
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "budget_exhausted";
        requestIndex: number;
        limit: "model_requests" | "tool_calls";
        message: string;
        responseText: string;
        pendingToolCalls: readonly ModelToolCall[];
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "refusal";
        requestIndex: number;
        refusal: string;
        responseText: string;
      }>)
  | (WorkflowBase &
      Readonly<{
        outcome: "provider_error";
        requestIndex: number;
        error: string;
      }>);

export async function runStandaloneToolWorkflow(
  provider: ModelProvider,
  question: string,
  handlers: StandaloneToolHandlers = defaultHandlers,
): Promise<StandaloneToolWorkflowResult> {
  const conversation: ModelMessage[] = [{ role: "user", content: question }];
  const modelCalls: WorkflowModelCall[] = [];
  const toolResults: ProcessedToolCall[] = [];
  const seenCallIds = new Set<string>();

  for (let requestIndex = 1; requestIndex <= MAX_MODEL_REQUESTS; requestIndex += 1) {
    const requestMessages: readonly ModelMessage[] = [
      { role: "system", content: TOOL_WORKFLOW_SYSTEM_PROMPT },
      ...conversation,
    ];
    const attempt = await callProvider(provider, requestIndex, {
      messages: requestMessages,
      tools: standaloneToolDefinitions,
    });
    modelCalls.push(attempt.telemetry);

    if (!attempt.success) {
      return {
        outcome: "provider_error",
        requestIndex,
        error: attempt.error,
        modelCalls,
        toolResults,
      };
    }

    const result = attempt.result;
    if (result.refusal !== null && result.refusal !== undefined) {
      return {
        outcome: "refusal",
        requestIndex,
        refusal: result.refusal,
        responseText: result.text,
        modelCalls,
        toolResults,
      };
    }

    if (result.toolCalls.length === 0) {
      return {
        outcome: "answer",
        answer: result.text,
        modelRequestCount: requestIndex,
        modelCalls,
        toolResults,
      };
    }

    const batchError = validateToolCallBatch(result.toolCalls, seenCallIds);
    if (batchError !== null) {
      return {
        outcome: "invalid_tool_call_batch",
        requestIndex,
        error: batchError,
        modelCalls,
        toolResults,
      };
    }

    if (toolResults.length + result.toolCalls.length > MAX_TOTAL_TOOL_CALLS) {
      return {
        outcome: "budget_exhausted",
        requestIndex,
        limit: "tool_calls",
        message: `Executing this batch would exceed the limit of ${MAX_TOTAL_TOOL_CALLS} total tool calls`,
        responseText: result.text,
        pendingToolCalls: result.toolCalls,
        modelCalls,
        toolResults,
      };
    }

    if (requestIndex === MAX_MODEL_REQUESTS) {
      return {
        outcome: "budget_exhausted",
        requestIndex,
        limit: "model_requests",
        message: `The requested tools cannot be executed because producing a subsequent answer would exceed the limit of ${MAX_MODEL_REQUESTS} model requests`,
        responseText: result.text,
        pendingToolCalls: result.toolCalls,
        modelCalls,
        toolResults,
      };
    }

    conversation.push({
      role: "assistant",
      content: result.text,
      toolCalls: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      const toolResult = executeToolCall(toolCall, handlers);
      toolResults.push({ ...toolCall, result: toolResult });
      seenCallIds.add(toolCall.id);
      conversation.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  throw new Error("Unreachable workflow state");
}

// Retained as a compatibility entry point for the original Day 4 workflow.
export function runMetricDefinitionToolWorkflow(
  provider: ModelProvider,
  question: string,
  handler: GetMetricDefinitionHandler = getMetricDefinition,
): Promise<StandaloneToolWorkflowResult> {
  return runStandaloneToolWorkflow(provider, question, {
    ...defaultHandlers,
    getMetricDefinition: handler,
  });
}

export type MetricDefinitionWorkflowResult = StandaloneToolWorkflowResult;
export const METRIC_DEFINITION_FINAL_ANSWER_SYSTEM_PROMPT =
  TOOL_WORKFLOW_SYSTEM_PROMPT;

function executeToolCall(
  toolCall: ModelToolCall,
  handlers: StandaloneToolHandlers,
): StandaloneToolResult {
  if (
    toolCall.name !== "get_metric_definition" &&
    toolCall.name !== "get_schema" &&
    toolCall.name !== "preview_query_plan"
  ) {
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

  switch (toolCall.name) {
    case "get_metric_definition":
      return executeGetMetricDefinition(
        parsedArguments,
        handlers.getMetricDefinition,
      );
    case "get_schema":
      return executeGetSchema(parsedArguments, handlers.getSchema);
    case "preview_query_plan":
      return executePreviewQueryPlan(
        parsedArguments,
        handlers.previewQueryPlan,
      );
  }
}

function validateToolCallBatch(
  toolCalls: readonly ModelToolCall[],
  priorCallIds: ReadonlySet<string>,
): Extract<
  StandaloneToolWorkflowResult,
  { outcome: "invalid_tool_call_batch" }
>["error"] | null {
  const batchIds = new Set<string>();
  for (const [index, toolCall] of toolCalls.entries()) {
    if (toolCall.id.length === 0) {
      return {
        code: "MISSING_TOOL_CALL_ID",
        message: `Tool call at index ${index} is missing an ID`,
      };
    }

    if (batchIds.has(toolCall.id) || priorCallIds.has(toolCall.id)) {
      return {
        code: "DUPLICATE_TOOL_CALL_ID",
        message: `Duplicate tool call ID: ${JSON.stringify(toolCall.id)}`,
      };
    }

    batchIds.add(toolCall.id);
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
  requestIndex: number,
  request: ModelRequest,
): Promise<ProviderCallAttempt> {
  const startedAt = performance.now();

  try {
    const result = await provider.generate(request);
    return {
      success: true,
      result,
      telemetry: toTelemetry(
        requestIndex,
        result.metadata,
        result.finishReason,
      ),
    };
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error),
      telemetry: {
        requestIndex,
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
  requestIndex: number,
  metadata: ModelMetadata,
  finishReason: string | null | undefined,
): WorkflowModelCall {
  return {
    requestIndex,
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
