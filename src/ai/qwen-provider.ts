import type {
  ModelMessage,
  ModelProvider,
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

export class QwenProvider implements ModelProvider {
  constructor(private readonly config: QwenProviderConfig) {}

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
