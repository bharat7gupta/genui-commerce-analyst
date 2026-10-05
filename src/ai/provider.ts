export type ModelToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: readonly ModelToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
    };

export type ModelToolDefinition = {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
};

export type ModelRequest = {
  messages: readonly ModelMessage[];
  tools?: readonly ModelToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: JsonSchemaResponseFormat;
};

export type JsonSchemaResponseFormat = {
  type: "json_schema";
  name: string;
  schema: Readonly<Record<string, unknown>>;
  strict: true;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelMetadata = {
  model: string;
  tokenUsage: TokenUsage | null;
  latencyMs: number;
  requestId: string | null;
};

export type ModelResult = {
  text: string;
  toolCalls: readonly ModelToolCall[];
  metadata: ModelMetadata;
  finishReason?: string | null;
  refusal?: string | null;
};

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelResult>;
}
