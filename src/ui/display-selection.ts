import { z } from "zod";

import type { ModelMetadata, ModelProvider } from "../ai/provider.js";
import { kpiSpecificationSchema, parseKpiSpecification, type KpiSpecification } from "./kpi-specification.js";

export const DISPLAY_SELECTION_PROMPT_VERSION = "display-selection-v1";
export const DISPLAY_SELECTION_SYSTEM_PROMPT =
  'Select the display requested by the user for August net revenue. Return only the UI specification JSON with exactly two properties: type and resultField. Allowed component types are "kpi" for a KPI card and "table" for a table. The only allowed resultField is "net_revenue". Do not include a numeric value, explanation, or extra properties.';
export const DISPLAY_SELECTION_SETTINGS = Object.freeze({ temperature: 0, maxTokens: 128 });
export const displaySelectionJsonSchema = z.toJSONSchema(kpiSpecificationSchema, {
  target: "draft-07", unrepresentable: "throw", reused: "inline",
});

type SelectionTelemetry = {
  rawOutput: string | null;
  metadata: ModelMetadata | null;
  latencyMs: number;
  finishReason: string | null;
};

export type DisplaySelectionResult = SelectionTelemetry & (
  | { outcome: "validated"; specification: KpiSpecification }
  | { outcome: "generation_error" | "validation_error"; error: string }
);

// No executor rows or numeric result can enter this request boundary.
export async function selectDisplay(provider: ModelProvider, question: string): Promise<DisplaySelectionResult> {
  const startedAt = performance.now();
  let result;
  try {
    result = await provider.generate({
      messages: [
        { role: "system", content: DISPLAY_SELECTION_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      ...DISPLAY_SELECTION_SETTINGS,
      responseFormat: {
        type: "json_schema", name: "display_selection_v1",
        schema: displaySelectionJsonSchema, strict: true,
      },
    });
  } catch (error) {
    return {
      outcome: "generation_error", rawOutput: null, metadata: null,
      latencyMs: Math.round(performance.now() - startedAt), finishReason: null,
      error: `Display generation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const telemetry: SelectionTelemetry = {
    rawOutput: result.text, metadata: result.metadata,
    latencyMs: result.metadata.latencyMs, finishReason: result.finishReason ?? null,
  };
  if (result.refusal != null || result.toolCalls.length > 0 ||
      (result.finishReason != null && result.finishReason !== "stop")) {
    return {
      ...telemetry, outcome: "generation_error",
      error: `Display generation failed: ${result.refusal ?? `unexpected generation outcome (${result.finishReason ?? "tool calls"})`}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { ...telemetry, outcome: "validation_error", error: "Invalid UI specification: model output is not valid JSON." };
  }
  try {
    return { ...telemetry, outcome: "validated", specification: parseKpiSpecification(parsed) };
  } catch (error) {
    return {
      ...telemetry, outcome: "validation_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
