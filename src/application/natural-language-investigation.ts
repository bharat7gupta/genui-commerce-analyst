import { z } from "zod";
import type { ModelProvider, ModelMetadata } from "../ai/provider.js";
import { buildPeriodComparisonPlans } from "./compare-periods.js";
import { investigateMetricChange, type InvestigationOptions, type InvestigationResult } from "./investigate-metric-change.js";
import { INVESTIGATION_PROMPT_VERSION, INVESTIGATION_SYSTEM_PROMPT } from "./investigation-extraction-v1-prompt.js";

export const INVESTIGATION_SCHEMA_VERSION = "investigation-input-v1" as const;
export const INVESTIGATION_MODEL_SETTINGS = Object.freeze({ temperature: 0, maxTokens: 512 });
const intervalSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
export const investigationExtractionSchema = z.object({
  metric: z.string().min(1).nullable(),
  baseline: intervalSchema.nullable(),
  target: intervalSchema.nullable(),
  dimension: z.string().min(1).nullable(),
  unresolvedQuestions: z.array(z.string().min(1)),
}).strict();
export const investigationExtractionJsonSchema = z.toJSONSchema(investigationExtractionSchema, {
  target: "draft-07", unrepresentable: "throw", reused: "inline",
});
export type InvestigationFields = z.infer<typeof investigationExtractionSchema>;
type ExtractionTelemetry = Readonly<{
  rawOutput: string | null;
  metadata: ModelMetadata | null;
  latencyMs: number;
  finishReason: string | null;
  promptVersion: typeof INVESTIGATION_PROMPT_VERSION;
  schemaVersion: typeof INVESTIGATION_SCHEMA_VERSION;
  modelSettings: typeof INVESTIGATION_MODEL_SETTINGS;
}>;
export type InvestigationExtraction = ExtractionTelemetry & (
  | { outcome: "inputs"; fields: InvestigationFields }
  | { outcome: "clarification_required"; fields: InvestigationFields; unresolvedQuestions: readonly string[] }
  | { outcome: "unsupported"; fields: InvestigationFields; reason: string }
  | { outcome: "extraction_failed"; error: { code: string; message: string } }
);

export async function extractInvestigationInputs(provider: ModelProvider, question: string): Promise<InvestigationExtraction> {
  const started = performance.now();
  let telemetry: ExtractionTelemetry = {
    rawOutput: null, metadata: null, latencyMs: 0, finishReason: null,
    promptVersion: INVESTIGATION_PROMPT_VERSION, schemaVersion: INVESTIGATION_SCHEMA_VERSION,
    modelSettings: INVESTIGATION_MODEL_SETTINGS,
  };
  function failure(code: string, message: string): InvestigationExtraction {
    return { ...telemetry, outcome: "extraction_failed", error: { code, message } };
  }
  let response;
  try {
    response = await provider.generate({
      messages: [{ role: "system", content: INVESTIGATION_SYSTEM_PROMPT }, { role: "user", content: question }],
      ...INVESTIGATION_MODEL_SETTINGS,
      responseFormat: { type: "json_schema", name: "investigation_input_v1",
        schema: investigationExtractionJsonSchema, strict: true },
    });
  } catch (error) {
    telemetry = { ...telemetry, latencyMs: performance.now() - started };
    return failure("PROVIDER_ERROR", error instanceof Error ? error.message : String(error));
  }
  telemetry = { ...telemetry, rawOutput: response.text, metadata: response.metadata,
    latencyMs: response.metadata.latencyMs, finishReason: response.finishReason ?? null };
  if (response.refusal != null) return failure("REFUSAL", response.refusal);
  if (response.finishReason != null && response.finishReason !== "stop") return failure("INCOMPLETE", `Finish reason: ${response.finishReason}`);
  if (response.toolCalls.length > 0) return failure("UNEXPECTED_TOOL_CALL", "Extraction must return structured text only");
  let parsed: unknown;
  try { parsed = JSON.parse(response.text); }
  catch { return failure("MALFORMED_JSON", "Extraction is not valid JSON"); }
  const validation = investigationExtractionSchema.safeParse(parsed);
  if (!validation.success) return failure("INVALID_STRUCTURE", validation.error.message);
  const fields = validation.data;
  // Explicit unsupported choices take precedence over missing companion fields.
  if (fields.metric !== null && fields.metric !== "net_revenue") {
    return { ...telemetry, outcome: "unsupported", fields, reason: `Unsupported metric: ${fields.metric}. Only net_revenue executes.` };
  }
  if (fields.dimension !== null && fields.dimension !== "region") {
    return { ...telemetry, outcome: "unsupported", fields, reason: `Unsupported dimension: ${fields.dimension}. Only region executes.` };
  }
  const questions = [...fields.unresolvedQuestions];
  for (const field of ["metric", "baseline", "target", "dimension"] as const) {
    if (fields[field] === null) questions.push(`Specify ${field}.`);
  }
  if (questions.length > 0) return { ...telemetry, outcome: "clarification_required", fields,
    unresolvedQuestions: [...new Set(questions)] };
  // Reuse the existing calendar-date, non-overlap, compiler and date-cap checks.
  if (fields.baseline === null || fields.target === null) return failure("INVALID_INPUTS", "Missing periods");
  try { buildPeriodComparisonPlans("net_revenue", fields.baseline, fields.target, ["region"]); }
  catch (error) {
    return { ...telemetry, outcome: "clarification_required", fields,
      unresolvedQuestions: [error instanceof Error ? error.message : String(error)] };
  }
  return { ...telemetry, outcome: "inputs", fields };
}

export type NaturalLanguageInvestigationResult = Readonly<{
  outcome: InvestigationResult["outcome"] | "unsupported" | "extraction_failed";
  extraction: InvestigationExtraction;
  investigation: InvestigationResult | null;
}>;

export async function investigateMetricChangeFromText(
  provider: ModelProvider,
  question: string,
  options: InvestigationOptions = {},
): Promise<NaturalLanguageInvestigationResult> {
  const extraction = await extractInvestigationInputs(provider, question);
  if (extraction.outcome !== "inputs") return { outcome: extraction.outcome, extraction, investigation: null };
  const { metric, baseline, target, dimension } = extraction.fields;
  const investigation = await investigateMetricChange({ metric, baseline, target, dimension }, options);
  return { outcome: investigation.outcome, extraction, investigation };
}
