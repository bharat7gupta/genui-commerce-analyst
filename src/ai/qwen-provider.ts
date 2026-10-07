import { z } from "zod";

import type {
  ModelContentChunk,
  ModelMessage,
  StreamingModelProvider,
  StreamingModelResult,
  ModelRequest,
  ModelResult,
  ModelToolCall,
  ModelToolDefinition,
  TokenUsage,
} from "./provider.js";

export type QwenProviderConfig = {
  baseUrl: string;
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  apiKey?: string;
};

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: ChatCompletionResponseToolCall[] | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

type ChatCompletionResponseToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export class QwenProvider implements StreamingModelProvider {
  constructor(private readonly config: QwenProviderConfig) {}

  /** Structured text streaming only; resolves after stop + the protocol's terminal marker. */
  async generateStreaming(request: ModelRequest, onContent?: (chunk: ModelContentChunk) => void): Promise<StreamingModelResult> {
    if (request.tools !== undefined && request.tools.length > 0) {
      throw new Error("Qwen structured text streaming does not support tool calls");
    }
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.config.model, reasoning_effort: this.config.reasoningEffort,
          messages: request.messages.map(toChatCompletionMessage),
          stream: true, stream_options: { include_usage: true },
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
          ...(request.responseFormat === undefined ? {} : {
            response_format: { type: "json_schema", json_schema: {
              name: request.responseFormat.name, strict: request.responseFormat.strict, schema: request.responseFormat.schema,
            } },
          }),
        }),
      });
    } catch (error) {
      throw new Error(`Unable to connect to model endpoint: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Qwen streaming request failed: HTTP ${response.status}`);
    }
    return readChatCompletionStream(response, this.config.model, startedAt, onContent);
  }

  async generate(request: ModelRequest): Promise<ModelResult> {
    const tools = request.tools?.map(toChatCompletionTool);
    const hasTools = tools !== undefined && tools.length > 0;

    if (request.responseFormat !== undefined && hasTools) {
      throw new Error(
        "Qwen requests cannot combine structured output with tool calling",
      );
    }

    const startedAt = performance.now();
    let response: Response;

    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey
            ? { authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          reasoning_effort: this.config.reasoningEffort,
          messages: request.messages.map(toChatCompletionMessage),
          ...(hasTools ? { tools } : {}),
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.maxTokens === undefined
            ? {}
            : { max_tokens: request.maxTokens }),
          ...(request.responseFormat === undefined
            ? {}
            : {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: request.responseFormat.name,
                    strict: request.responseFormat.strict,
                    schema: request.responseFormat.schema,
                  },
                },
              }),
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to connect to model endpoint ${this.config.baseUrl}: ${detail}`,
        { cause: error },
      );
    }

    const latencyMs = Math.round(performance.now() - startedAt);
    const body = (await response.json()) as ChatCompletionResponse;
    const requestId = getRequestId(response);

    if (!response.ok) {
      const detail = body.error?.message ?? `HTTP ${response.status}`;
      throw new Error(
        `Qwen request failed${requestId ? ` (${requestId})` : ""}: ${detail}`,
      );
    }

    const choice = body.choices?.[0];
    const text = choice?.message?.content;
    const refusal = choice?.message?.refusal;
    const finishReason = choice?.finish_reason;
    const toolCalls = toModelToolCalls(choice?.message?.tool_calls);

    if (
      typeof text !== "string" &&
      typeof refusal !== "string" &&
      toolCalls.length === 0 &&
      (typeof finishReason !== "string" || finishReason === "stop")
    ) {
      throw new Error("Qwen returned a response without message content");
    }

    const tokenUsage = toTokenUsage(body.usage);

    return {
      text: text ?? "",
      toolCalls,
      metadata: {
        model: body.model ?? this.config.model,
        tokenUsage: tokenUsage ?? null,
        latencyMs,
        requestId: requestId ?? null,
      },
      finishReason: finishReason ?? null,
      refusal: refusal ?? null,
    };
  }
}

export class QwenStreamError extends Error {
  constructor(
    message: string,
    readonly chunks: readonly ModelContentChunk[],
    readonly finishReason: string | null,
    readonly totalDurationMs: number,
    cause: unknown,
  ) {
    super(`Qwen stream failed: ${message}`, { cause });
    this.name = "QwenStreamError";
  }
}

const streamChunkSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    index: z.number().int(),
    delta: z.object({
      content: z.string().nullish(), refusal: z.string().nullish(),
      tool_calls: z.array(z.unknown()).nullish(), function_call: z.unknown().optional(),
    }).passthrough(),
    finish_reason: z.string().nullish(),
  }).passthrough()),
  usage: z.object({
    prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number(),
  }).passthrough().nullish(),
}).passthrough();

async function readChatCompletionStream(
  response: Response, configuredModel: string, startedAt: number,
  onContent?: (chunk: ModelContentChunk) => void,
): Promise<StreamingModelResult> {
  const chunks: ModelContentChunk[] = [];
  let finishReason: string | null = null;
  let refusal: string | null = null;
  let model = configuredModel;
  let usage: TokenUsage | null = null;
  const reader = response.body?.getReader();
  try {
    if (!reader || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Expected a chat-completions event stream");
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    while (true) {
      const read = await reader.read();
      if (read.done) throw new Error("Stream disconnected or ended before the terminal completion marker");
      buffer += decoder.decode(read.value, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (data === "[DONE]") {
          if (finishReason !== "stop") throw new Error(`Generation did not complete normally (finish reason ${finishReason ?? "missing"})`);
          if (chunks.length === 0 && refusal === null) throw new Error("Stream completed without content");
          const totalDurationMs = Math.round(performance.now() - startedAt);
          return {
            text: chunks.map(chunk => chunk.text).join(""), toolCalls: [], finishReason, refusal,
            metadata: { model, latencyMs: totalDurationMs, tokenUsage: usage, requestId: getRequestId(response) ?? null },
            stream: { completion: "completed", chunks, timeToFirstContentMs: chunks[0]?.elapsedMs ?? null, totalDurationMs },
          };
        }
        if (data !== "") {
          const parsed: unknown = JSON.parse(data);
          const payload = streamChunkSchema.parse(parsed);
          if (payload.model !== undefined) model = payload.model;
          if (payload.usage != null) usage = toTokenUsage(payload.usage) ?? null;
          for (const choice of payload.choices) {
            if (choice.index !== 0) throw new Error("Multiple streamed choices are unsupported");
            if (choice.delta.tool_calls?.length || choice.delta.function_call != null) {
              throw new Error("Unexpected streamed tool call");
            }
            if (choice.delta.content) {
              if (finishReason !== null) throw new Error("Content arrived after generation finished");
              const chunk = { text: choice.delta.content, elapsedMs: Math.round(performance.now() - startedAt) };
              chunks.push(chunk);
              onContent?.(chunk);
            }
            if (choice.delta.refusal != null) refusal = (refusal ?? "") + choice.delta.refusal;
            if (choice.finish_reason != null) finishReason = choice.finish_reason;
          }
        }
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
  } catch (error) {
    throw new QwenStreamError(
      error instanceof Error ? error.message : String(error), chunks, finishReason,
      Math.round(performance.now() - startedAt), error,
    );
  } finally {
    // Once DONE is received, any remaining transport bytes are irrelevant.
    try { await reader?.cancel(); } catch { /* Preserve the original stream outcome. */ }
    reader?.releaseLock();
  }
}

type ChatCompletionMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

type ChatCompletionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Readonly<Record<string, unknown>>;
  };
};

function toChatCompletionMessage(message: ModelMessage): ChatCompletionMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls === undefined
        ? {}
        : {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: toolCall.arguments,
              },
            })),
          }),
    };
  }

  return message;
}

function toChatCompletionTool(tool: ModelToolDefinition): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toModelToolCalls(
  toolCalls: ChatCompletionResponseToolCall[] | null | undefined,
): readonly ModelToolCall[] {
  if (toolCalls == null) return [];

  return toolCalls.map((toolCall, index) => {
    if (
      typeof toolCall.id !== "string" ||
      toolCall.type !== "function" ||
      typeof toolCall.function?.name !== "string" ||
      typeof toolCall.function.arguments !== "string"
    ) {
      throw new Error(`Qwen returned an invalid tool call at index ${index}`);
    }

    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    };
  });
}

function getRequestId(response: Response): string | undefined {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("openai-request-id") ??
    undefined
  );
}

function toTokenUsage(
  usage: ChatCompletionResponse["usage"],
): TokenUsage | undefined {
  if (
    usage?.prompt_tokens === undefined ||
    usage.completion_tokens === undefined ||
    usage.total_tokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}
