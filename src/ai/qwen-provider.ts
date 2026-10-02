import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
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
    message?: {
      content?: string | null;
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

export class QwenProvider implements ModelProvider {
  constructor(private readonly config: QwenProviderConfig) {}

  async generate(request: ModelRequest): Promise<ModelResult> {
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
          messages: request.messages,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.maxTokens === undefined
            ? {}
            : { max_tokens: request.maxTokens }),
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

    const text = body.choices?.[0]?.message?.content;

    if (typeof text !== "string") {
      throw new Error("Qwen returned a response without message content");
    }

    const tokenUsage = toTokenUsage(body.usage);

    return {
      text,
      metadata: {
        model: body.model ?? this.config.model,
        tokenUsage: tokenUsage ?? null,
        latencyMs,
        requestId: requestId ?? null,
      },
    };
  }
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
