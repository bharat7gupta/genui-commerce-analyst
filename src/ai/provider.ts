export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  messages: readonly ModelMessage[];
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
  metadata: ModelMetadata;
  finishReason?: string | null;
  refusal?: string | null;
};

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelResult>;
}
