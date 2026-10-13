import { appendFile } from "node:fs/promises";
import { z } from "zod";
import type { ModelProvider, TokenUsage } from "../ai/provider.js";
import { INVESTIGATION_MODEL_SETTINGS } from "../application/natural-language-investigation.js";
import { INVESTIGATION_PROMPT_VERSION } from "../application/investigation-extraction-v1-prompt.js";

export type ApiPricing = Readonly<{ inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number }>;

export function readApiPricing(): ApiPricing | null {
  const priceSchema = z.coerce.number().finite().nonnegative();
  const input = process.env.MODEL_INPUT_USD_PER_MILLION_TOKENS;
  const output = process.env.MODEL_OUTPUT_USD_PER_MILLION_TOKENS;
  if ((input === undefined) !== (output === undefined)) throw new Error("Configure both input and output API prices or neither");
  if (input === "" || output === "") throw new Error("Configured API prices must not be empty");
  return input === undefined ? null : {
    inputUsdPerMillionTokens: priceSchema.parse(input), outputUsdPerMillionTokens: priceSchema.parse(output),
  };
}

export function apiCost(pricing: ApiPricing | null, usage: TokenUsage | null) {
  return pricing === null || usage === null
    ? { status: "unavailable", usd: null, reason: pricing === null ? "API pricing is not configured" : "Token usage is unavailable" }
    : { status: "estimated", usd: (usage.inputTokens * pricing.inputUsdPerMillionTokens + usage.outputTokens * pricing.outputUsdPerMillionTokens) / 1_000_000 };
}

/** Same immediate raw-call recorder used by the three-request demonstration. */
export function recordingInvestigationProvider(
  underlying: ModelProvider,
  options: Readonly<{ caseId: string; callsPath: URL; model: string; reasoningEffort: string; pricing: ApiPricing | null }>,
): ModelProvider {
  return { async generate(request) {
    const started = performance.now();
    const base = { caseId: options.caseId, repetition: 1, timestamp: new Date().toISOString(),
      promptVersion: INVESTIGATION_PROMPT_VERSION, model: options.model,
      settings: INVESTIGATION_MODEL_SETTINGS, reasoningEffort: options.reasoningEffort };
    let response;
    try { response = await underlying.generate(request); }
    catch (error) {
      await appendFile(options.callsPath, `${JSON.stringify({ ...base, rawOutput: null, metadata: null,
        latencyMs: performance.now() - started, apiCost: apiCost(options.pricing, null),
        error: error instanceof Error ? error.message : String(error) })}\n`);
      throw error;
    }
    // Persist raw invocation before extraction validation or database execution.
    await appendFile(options.callsPath, `${JSON.stringify({ ...base, rawOutput: response.text,
      metadata: response.metadata, finishReason: response.finishReason ?? null,
      refusal: response.refusal ?? null, apiCost: apiCost(options.pricing, response.metadata.tokenUsage), error: null })}\n`);
    return response;
  } };
}
