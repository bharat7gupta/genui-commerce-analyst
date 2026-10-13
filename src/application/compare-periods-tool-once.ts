import type { ModelMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from "../ai/provider.js";
import { comparePeriodsToolDefinition, executeComparePeriods, validateComparePeriodsArguments, executeComparisonAgentTool, validateComparisonAgentArguments, type ComparisonAgentArguments, type ComparisonAgentToolResult, type ComparePeriodsArguments, type ComparePeriodsToolResult } from "../tools/compare-periods.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import type { QueryPlanExecutor } from "./commerce-analysis-pipeline.js";
import { callProvider, validateToolCallBatch, type WorkflowModelCall } from "./metric-definition-tool-workflow.js";
import { COMPARE_PERIODS_TOOL_PROMPT_VERSION, COMPARE_PERIODS_TOOL_SYSTEM_PROMPT } from "./compare-periods-tool-v1-prompt.js";
import { COMPARE_PERIODS_AGENT_PROMPT_VERSION, COMPARE_PERIODS_AGENT_SYSTEM_PROMPT } from "./compare-periods-agent-v1-prompt.js";
import { COMPARE_PERIODS_AGENT_V2_PROMPT_VERSION, COMPARE_PERIODS_AGENT_V2_SYSTEM_PROMPT, comparePeriodsV2ToolDefinition, COMPARE_PERIODS_TOOL_V2_VERSION } from "./compare-periods-agent-v2-prompt.js";
import { COMPARISON_AGENT_V3_PROMPT_VERSION, COMPARISON_AGENT_V3_SYSTEM_PROMPT, COMPARISON_AGENT_V3_TOOLS, COMPARISON_AGENT_V3_TOOL_VERSIONS } from "./compare-periods-agent-v3-prompt.js";

export const COMPARE_PERIODS_TOOL_MODEL_SETTINGS = Object.freeze({ temperature: 0, maxTokens: 512 });
type LocalToolFailure = Readonly<{ success: false; error: Readonly<{ code: "UNKNOWN_TOOL" | "MALFORMED_ARGUMENTS_JSON"; message: string }> }>;
export type ComparePeriodsOnceResult = Readonly<{
  outcome: "tool_result" | "no_tool_call" | "invalid_tool_call" | "invalid_arguments" | "execution_failed" | "provider_error" | "refusal" | "incomplete";
  promptVersion: typeof COMPARE_PERIODS_TOOL_PROMPT_VERSION;
  modelCall: WorkflowModelCall;
  conversation: readonly ModelMessage[];
  rawToolCalls: readonly ModelToolCall[];
  validatedArguments: ComparePeriodsArguments | null;
  toolResult: ComparePeriodsToolResult | LocalToolFailure | null;
  error: string | null;
}>;

/** One model request, at most one selected tool, then stop with its result in history. */
export async function runComparePeriodsToolOnce(
  provider: ModelProvider,
  question: string,
  executor?: QueryPlanExecutor,
): Promise<ComparePeriodsOnceResult> {
  const conversation: ModelMessage[] = [
    { role: "system", content: COMPARE_PERIODS_TOOL_SYSTEM_PROMPT },
    { role: "user", content: question },
  ];
  const attempt = await callProvider(provider, 1, {
    messages: [...conversation], tools: [comparePeriodsToolDefinition], ...COMPARE_PERIODS_TOOL_MODEL_SETTINGS,
  });
  const base = { promptVersion: COMPARE_PERIODS_TOOL_PROMPT_VERSION, modelCall: attempt.telemetry,
    conversation, rawToolCalls: [], validatedArguments: null, toolResult: null };
  if (!attempt.success) return { ...base, outcome: "provider_error", error: attempt.error };
  const response = attempt.result;
  conversation.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
  const observed = { ...base, rawToolCalls: response.toolCalls };
  if (response.refusal != null) return { ...observed, outcome: "refusal", error: response.refusal };
  if (response.finishReason != null && response.finishReason !== "stop" && response.finishReason !== "tool_calls") {
    return { ...observed, outcome: "incomplete", error: `Finish reason: ${response.finishReason}` };
  }
  if (response.toolCalls.length === 0) return { ...observed, outcome: "no_tool_call", error: null };
  const batchError = validateToolCallBatch(response.toolCalls, new Set());
  if (batchError !== null) return { ...observed, outcome: "invalid_tool_call", error: batchError.message };
  const call = response.toolCalls[0];
  if (response.toolCalls.length !== 1 || call === undefined) {
    return { ...observed, outcome: "invalid_tool_call", error: "This task permits exactly one tool call; the batch was not executed" };
  }
  const callId = call.id;
  function finishFailure(result: LocalToolFailure): ComparePeriodsOnceResult {
    conversation.push({ role: "tool", toolCallId: callId, content: JSON.stringify(result) });
    return { ...observed, outcome: "invalid_arguments", toolResult: result, error: result.error.message };
  }
  if (call.name !== "compare_periods") {
    return finishFailure({ success: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${call.name}` } });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(call.arguments); }
  catch { return finishFailure({ success: false, error: { code: "MALFORMED_ARGUMENTS_JSON", message: "Tool arguments are not valid JSON" } }); }
  const execution = await executeComparePeriods(parsed, executor);
  conversation.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(execution.result) });
  return { ...observed, validatedArguments: execution.validatedArguments, toolResult: execution.result,
    outcome: execution.result.success ? "tool_result" : execution.result.error.code === "INVALID_ARGUMENTS" ? "invalid_arguments" : "execution_failed",
    error: execution.result.success ? null : execution.result.error.message };
}

export const COMPARE_PERIODS_AGENT_LIMITS = Object.freeze({ modelTurns: 3, toolExecutions: 2, tokens: 6000, deadlineMs: 90_000 });
export const INVESTIGATION_AGENT_LIMITS = Object.freeze({ ...COMPARE_PERIODS_AGENT_LIMITS, modelTurns: 5, toolExecutions: 4 });
export const COMPARISON_INPUT_ESTIMATOR = Object.freeze({
  version: "comparison-input-reservation-v2-approx",
  kind: "approximate",
  asciiBytesPerToken: 3,
  nonAsciiBytesPerToken: 1,
  proportionalAllowance: 0.2,
  perMessageAllowance: 32,
  fixedAllowance: 128,
  method: "Serialize provider-neutral messages/tools as compact JSON. Estimate ASCII bytes / 3 plus non-ASCII UTF-8 bytes, rounded up; add ceil(20% of that estimate), 32 per message and 128 fixed.",
  uncertainty: "Heuristic for English prose and JSON, not a model tokenizer or hard token guarantee. Code, identifiers, multilingual text and the provider chat/tool template can differ. Allowances are policy choices, not calibrated error bounds; not fitted to recorded usage. Actual reported usage alone is charged, including repeated input.",
});
export type AgentStopReason = "answer" | "model_turn_budget" | "tool_execution_budget" | "token_budget" |
  "timeout" | "repeated_tool_call" | "invalid_tool_call" | "invalid_arguments" | "tool_execution_failed" |
  "provider_error" | "refusal" | "incomplete" | "token_usage_unavailable" | "invalid_token_usage" | "answer_without_tool_result";
type AgentToolResult = ComparisonAgentToolResult;
export type AgentTurnTrace = {
  turn: number;
  inputTokenReservation: number;
  maxOutputTokens: number;
  modelCall: WorkflowModelCall | null;
  assistantText: string | null;
  toolCalls: readonly ModelToolCall[];
  tools: { call: ModelToolCall; validatedArguments: ComparisonAgentArguments | null; executed: boolean;
    elapsedMs: number; result: AgentToolResult }[];
  cumulativeTokens: number;
  decision: string;
};
export type ComparePeriodsAgentResult = Readonly<{
  stopReason: AgentStopReason;
  completed: boolean;
  answer: string | null;
  answerClaimsVerified: false;
  error: string | null;
  promptVersion: typeof COMPARE_PERIODS_AGENT_PROMPT_VERSION | typeof COMPARE_PERIODS_AGENT_V2_PROMPT_VERSION | typeof COMPARISON_AGENT_V3_PROMPT_VERSION;
  toolDefinitionVersions: Readonly<Record<string, string>>;
  toolDefinitionVersion: "compare-periods-tool-definition-v1" | typeof COMPARE_PERIODS_TOOL_V2_VERSION;
  conversation: readonly ModelMessage[];
  turns: readonly AgentTurnTrace[];
  modelTurnCount: number;
  toolExecutionCount: number;
  cumulativeTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  tokenUsageComplete: boolean;
  totalLatencyMs: number;
  inputEstimatorVersion: typeof COMPARISON_INPUT_ESTIMATOR.version;
}>;

/** Approximate preflight reservation, not a hard bound; never charged as usage. */
export function reserveComparisonInputTokens(messages: readonly ModelMessage[], tools: readonly ModelToolDefinition[] = [comparePeriodsToolDefinition]): number {
  // Three ASCII bytes/token is a deliberately cautious prose/JSON heuristic,
  // not the old run's observed ratio. Non-ASCII bytes receive no compression.
  // JSON includes escaping/structure, but does not reproduce the chat template.
  const bytes = Buffer.from(JSON.stringify({ messages, tools }), "utf8");
  let asciiBytes = 0;
  for (const byte of bytes) if (byte < 128) asciiBytes++;
  const policy = COMPARISON_INPUT_ESTIMATOR;
  const estimate = Math.ceil(asciiBytes / policy.asciiBytesPerToken +
    (bytes.length - asciiBytes) / policy.nonAsciiBytesPerToken);
  return estimate + Math.ceil(estimate * policy.proportionalAllowance) +
    policy.perMessageAllowance * messages.length + policy.fixedAllowance;
}

/** Bounded application loop over the same tool; final claims remain unverified. */
export async function runComparePeriodsAgent(
  provider: ModelProvider,
  question: string,
  options: Readonly<{ executor?: QueryPlanExecutor; deadlineMs?: number; revision?: "v1" | "v2" | "v3" }> = {},
): Promise<ComparePeriodsAgentResult> {
  const deadlineMs = options.deadlineMs ?? COMPARE_PERIODS_AGENT_LIMITS.deadlineMs;
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > COMPARE_PERIODS_AGENT_LIMITS.deadlineMs) {
    throw new Error("deadlineMs must be a positive integer no greater than 90000");
  }
  const started = performance.now();
  const revision = options.revision ?? "v1";
  const limits = revision === "v3" ? INVESTIGATION_AGENT_LIMITS : COMPARE_PERIODS_AGENT_LIMITS;
  const promptVersion = revision === "v3" ? COMPARISON_AGENT_V3_PROMPT_VERSION : revision === "v2" ? COMPARE_PERIODS_AGENT_V2_PROMPT_VERSION : COMPARE_PERIODS_AGENT_PROMPT_VERSION;
  const tool = revision === "v1" ? comparePeriodsToolDefinition : comparePeriodsV2ToolDefinition;
  const tools = revision === "v3" ? COMPARISON_AGENT_V3_TOOLS : [tool];
  const toolDefinitionVersions = revision === "v3" ? COMPARISON_AGENT_V3_TOOL_VERSIONS : { compare_periods: revision === "v2" ? COMPARE_PERIODS_TOOL_V2_VERSION : "compare-periods-tool-definition-v1" };
  const toolDefinitionVersion = revision === "v1" ? "compare-periods-tool-definition-v1" : COMPARE_PERIODS_TOOL_V2_VERSION;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("Overall agent deadline exceeded")), deadlineMs);
  const conversation: ModelMessage[] = [
    { role: "system", content: revision === "v3" ? COMPARISON_AGENT_V3_SYSTEM_PROMPT : revision === "v2" ? COMPARE_PERIODS_AGENT_V2_SYSTEM_PROMPT : COMPARE_PERIODS_AGENT_SYSTEM_PROMPT }, { role: "user", content: question },
  ];
  const turns: AgentTurnTrace[] = [];
  const callIds = new Set<string>();
  const executedCalls = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let tokenUsageComplete = true;
  let modelTurns = 0;
  let toolExecutions = 0;
  let hasObservedResult = false;
  const underlying = options.executor ?? new DuckDBQueryPlanExecutor();
  const executor: QueryPlanExecutor = { async execute(plan) {
    return operation(() => underlying.execute(plan, { signal: deadline.signal }));
  } };
  function expired(): boolean {
    if (performance.now() - started >= deadlineMs && !deadline.signal.aborted) deadline.abort(new Error("Overall agent deadline exceeded"));
    return deadline.signal.aborted;
  }
  async function operation<T>(work: () => Promise<T>): Promise<T> {
    if (expired()) throw deadline.signal.reason;
    let onAbort: () => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => reject(deadline.signal.reason);
      deadline.signal.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([work(), abort]); }
    finally { deadline.signal.removeEventListener("abort", onAbort); }
  }
  function stop(reason: AgentStopReason, error: string | null = null, answer: string | null = null): ComparePeriodsAgentResult {
    const last = turns.at(-1);
    if (last !== undefined) last.decision = reason;
    return { stopReason: reason, completed: reason === "answer", answer, answerClaimsVerified: false, error,
      promptVersion, toolDefinitionVersion, toolDefinitionVersions, conversation, turns,
      modelTurnCount: modelTurns, toolExecutionCount: toolExecutions,
      cumulativeTokens: inputTokens + outputTokens, cumulativeInputTokens: inputTokens, cumulativeOutputTokens: outputTokens,
      tokenUsageComplete, totalLatencyMs: performance.now() - started,
      inputEstimatorVersion: COMPARISON_INPUT_ESTIMATOR.version };
  }
  try {
    while (true) {
      if (expired()) return stop("timeout", "Overall deadline exceeded");
      if (modelTurns >= limits.modelTurns) return stop("model_turn_budget");
      const remaining = limits.tokens - inputTokens - outputTokens;
      const reservation = reserveComparisonInputTokens(conversation, tools);
      const maxTokens = Math.min(COMPARE_PERIODS_TOOL_MODEL_SETTINGS.maxTokens, remaining - reservation);
      if (maxTokens <= 0) return stop("token_budget", "Remaining tokens cannot cover the next input reservation and output");
      const trace: AgentTurnTrace = { turn: ++modelTurns, inputTokenReservation: reservation, maxOutputTokens: maxTokens,
        modelCall: null, assistantText: null, toolCalls: [], tools: [], cumulativeTokens: inputTokens + outputTokens, decision: "pending" };
      turns.push(trace);
      const attempt = await operation(() => callProvider(provider, modelTurns, {
        messages: [...conversation], tools, temperature: 0, maxTokens, signal: deadline.signal,
      }));
      trace.modelCall = attempt.telemetry;
      if (!attempt.success) {
        tokenUsageComplete = false;
        return stop(expired() ? "timeout" : "provider_error", attempt.error);
      }
      const response = attempt.result;
      trace.assistantText = response.text;
      trace.toolCalls = response.toolCalls;
      conversation.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
      const usage = response.metadata.tokenUsage;
      if (usage === null) { tokenUsageComplete = false; return stop("token_usage_unavailable", "Cannot enforce cumulative usage without provider token counts"); }
      if (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
        tokenUsageComplete = false; return stop("invalid_token_usage", "Provider usage is not consistent nonnegative integer counts");
      }
      // Charge each reported input, including the entire repeated history.
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      trace.cumulativeTokens = inputTokens + outputTokens;
      if (expired()) return stop("timeout");
      if (trace.cumulativeTokens >= COMPARE_PERIODS_AGENT_LIMITS.tokens) return stop("token_budget");
      if (usage.outputTokens > maxTokens) return stop("invalid_token_usage", "Provider output usage exceeded the requested cap");
      if (response.refusal != null) return stop("refusal", response.refusal);
      if (response.finishReason != null && response.finishReason !== "stop" && response.finishReason !== "tool_calls") {
        return stop("incomplete", `Finish reason: ${response.finishReason}`);
      }
      if (response.toolCalls.length === 0) {
        if (!hasObservedResult) return stop("answer_without_tool_result", "No successful comparison was observed", response.text);
        if (response.text.length === 0) return stop("incomplete", "Empty final answer");
        return stop("answer", null, response.text);
      }
      const batchError = validateToolCallBatch(response.toolCalls, callIds);
      if (batchError !== null) return stop("invalid_tool_call", batchError.message);
      for (const call of response.toolCalls) callIds.add(call.id);
      function record(call: ModelToolCall, result: AgentToolResult, args: ComparisonAgentArguments | null, executed: boolean, elapsedMs: number) {
        trace.tools.push({ call, result, validatedArguments: args, executed, elapsedMs });
        conversation.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
      }
      function rejectPending(index: number, reason: AgentStopReason, message: string): ComparePeriodsAgentResult {
        for (const call of response.toolCalls.slice(index)) record(call,
          { success: false, error: { code: reason, message } }, null, false, 0);
        return stop(reason, message);
      }
      for (const [index, call] of response.toolCalls.entries()) {
        if (expired()) return rejectPending(index, "timeout", "Overall deadline exceeded before tool execution");
        if (!tools.some((offered) => offered.name === call.name)) return rejectPending(index, "invalid_tool_call", `Unknown tool: ${call.name}`);
        let parsed: unknown;
        try { parsed = JSON.parse(call.arguments); }
        catch { return rejectPending(index, "invalid_arguments", "Tool arguments are not valid JSON"); }
        const validation = validateComparisonAgentArguments(call.name, parsed);
        if (!validation.success) return rejectPending(index, "invalid_arguments", validation.error.message);
        // Strict Zod objects give canonical metric/baseline/target and start/end
        // order, so whitespace and raw JSON key order do not evade this check.
        const key = `${call.name}:${JSON.stringify(validation.data)}`;
        if (executedCalls.has(key)) return rejectPending(index, "repeated_tool_call", "Identical normalized tool call already executed");
        if (toolExecutions >= limits.toolExecutions) {
          return rejectPending(index, "tool_execution_budget", `Maximum ${limits.toolExecutions} tool executions reached`);
        }
        executedCalls.add(key);
        toolExecutions++;
        const toolStarted = performance.now();
        const execution = await operation(() => executeComparisonAgentTool(call.name, validation.data, executor)).catch((error: unknown) => ({
          validatedArguments: validation.data,
          result: { success: false as const, error: { code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) } },
        }));
        record(call, execution.result, execution.validatedArguments, true, performance.now() - toolStarted);
        if (expired()) return rejectPending(index + 1, "timeout", "Overall deadline exceeded during tool execution");
        if (!execution.result.success) return rejectPending(index + 1, "tool_execution_failed", execution.result.error.message);
        if (call.name !== "get_metric_definition") hasObservedResult = true;
      }
      trace.decision = "continue";
    }
  } catch (error) {
    if (turns.at(-1)?.modelCall === null) tokenUsageComplete = false;
    return stop(expired() ? "timeout" : "provider_error", error instanceof Error ? error.message : String(error));
  } finally { clearTimeout(timer); }
}
