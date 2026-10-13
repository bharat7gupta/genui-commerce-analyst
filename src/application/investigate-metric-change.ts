import { performance } from "node:perf_hooks";
import { z } from "zod";

import { decimalToCents, formatHundredths } from "../decimal.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import {
  executeGetMetricDefinition,
  type GetMetricDefinitionHandler,
  type MetricDefinition,
} from "../tools/get-metric-definition.js";
import type { QueryPlanExecutor } from "./commerce-analysis-pipeline.js";
import { compareNetRevenueByRegion, type RegionPeriodComparison } from "./compare-net-revenue-by-region.js";
import { buildPeriodComparisonPlans, comparePeriods, type PeriodComparison } from "./compare-periods.js";

export type InvestigationStage = "validate_inputs" | "compare_periods" |
  "compare_regions" | "get_metric_definition" | "produce_summary";
export type StageTrace = Readonly<{
  stage: InvestigationStage;
  status: "completed" | "clarification_required" | "rejected" | "failed";
  elapsedMs: number;
}>;
export type DefinitionEvidence = Readonly<{
  definition: MetricDefinition;
  sourceId: string;
  sourceVersion: string | null;
}>;
export type InvestigationResult =
  | Readonly<{
      outcome: "completed";
      overall: PeriodComparison;
      regional: RegionPeriodComparison;
      definition: DefinitionEvidence;
      summary: string;
      trace: readonly StageTrace[];
    }>
  | Readonly<{
      outcome: "clarification_required";
      missingInputs: readonly string[];
      message: string;
      trace: readonly StageTrace[];
    }>
  | Readonly<{
      outcome: "rejected" | "failed";
      failedStage: InvestigationStage;
      error: Readonly<{ code: string; message: string }>;
      trace: readonly StageTrace[];
    }>;

export type InvestigationOptions = Readonly<{
  executor?: QueryPlanExecutor;
  definitionHandler?: GetMetricDefinitionHandler;
}>;

const intervalInputSchema = z.object({ start: z.string(), end: z.string() }).strict();
const inputSchema = z.object({
  metric: z.literal("net_revenue"),
  dimension: z.literal("region"),
  baseline: intervalInputSchema,
  target: intervalInputSchema,
}).strict();

class InputError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Fixed application workflow. No model, routing, retries, or adaptive stages. */
export async function investigateMetricChange(
  input: unknown,
  options: InvestigationOptions = {},
): Promise<InvestigationResult> {
  const trace: StageTrace[] = [];
  let activeStage: InvestigationStage = "validate_inputs";
  async function stage<T>(name: InvestigationStage, work: () => T | Promise<T>): Promise<T> {
    activeStage = name;
    const started = performance.now();
    try {
      const value = await work();
      trace.push({ stage: name, status: "completed", elapsedMs: performance.now() - started });
      return value;
    } catch (error) {
      trace.push({ stage: name, status: error instanceof InputError ? "rejected" : "failed",
        elapsedMs: performance.now() - started });
      throw error;
    }
  }

  try {
    const validated = await stage("validate_inputs", () => validateInput(input));
    if (validated.kind === "missing") {
      const entry = trace[0];
      if (entry !== undefined) trace[0] = { ...entry, status: "clarification_required" };
      return { outcome: "clarification_required", missingInputs: validated.fields,
        message: `Provide explicit inputs: ${validated.fields.join(", ")}.`, trace };
    }
    const request = validated.data;
    // Construct the default executor only after validation succeeds.
    const executor = options.executor ?? new DuckDBQueryPlanExecutor();
    const overall = await stage("compare_periods", () =>
      comparePeriods(request.metric, request.baseline, request.target, executor));
    const regional = await stage("compare_regions", () =>
      compareNetRevenueByRegion(request.baseline, request.target, executor));
    const definition = await stage("get_metric_definition", (): DefinitionEvidence => {
      const result = executeGetMetricDefinition({ metric: request.metric }, options.definitionHandler);
      if (!result.success) throw new Error(result.error.message);
      if (result.data.metric !== request.metric) throw new Error("Definition metric does not match the request");
      return {
        definition: result.data,
        sourceId: "src/tools/get-metric-definition.ts#METRIC_DEFINITIONS.net_revenue",
        // The existing definition tool supplies no source-version metadata.
        sourceVersion: null,
      };
    });
    const summary = await stage("produce_summary", () => summarize(overall, regional, definition));
    return { outcome: "completed", overall, regional, definition, summary, trace };
  } catch (error) {
    return {
      outcome: error instanceof InputError ? "rejected" : "failed",
      failedStage: activeStage,
      error: {
        code: error instanceof InputError ? error.code : "STAGE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }, trace,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function validateInput(input: unknown):
  | { kind: "missing"; fields: string[] }
  | { kind: "valid"; data: z.infer<typeof inputSchema> } {
  if (!isRecord(input)) throw new InputError("INVALID_INPUT", "Expected an investigation input object");
  const fields: string[] = [];
  for (const field of ["metric", "dimension", "baseline", "target"]) {
    if (missing(input[field])) fields.push(field);
  }
  for (const field of ["baseline", "target"]) {
    const interval = input[field];
    if (isRecord(interval)) {
      for (const boundary of ["start", "end"]) {
        if (missing(interval[boundary])) fields.push(`${field}.${boundary}`);
      }
    }
  }
  if (fields.length > 0) return { kind: "missing", fields };
  if (typeof input.metric === "string" && input.metric !== "net_revenue") {
    throw new InputError("UNSUPPORTED_METRIC", "Only net_revenue is supported");
  }
  if (typeof input.dimension === "string" && input.dimension !== "region") {
    throw new InputError("UNSUPPORTED_DIMENSION", "Only region is supported");
  }
  const structural = inputSchema.safeParse(input);
  if (!structural.success) throw new InputError("INVALID_INPUT", structural.error.message);
  try {
    const plans = buildPeriodComparisonPlans("net_revenue", structural.data.baseline, structural.data.target, ["region"]);
    return { kind: "valid", data: { ...structural.data,
      baseline: plans.periods.baseline, target: plans.periods.target } };
  } catch (error) {
    throw new InputError("INVALID_INPUT", error instanceof Error ? error.message : String(error));
  }
}

function summarize(overall: PeriodComparison, regional: RegionPeriodComparison, evidence: DefinitionEvidence): string {
  function periodSum(period: "baseline" | "target"): string | null {
    let anyPresent = false;
    let total = 0n;
    for (const segment of regional.segments) {
      const present = period === "baseline" ? segment.baselinePresent : segment.targetPresent;
      const value = period === "baseline" ? segment.baselineValue : segment.targetValue;
      if (!present) continue;
      anyPresent = true;
      if (value === null) return null;
      total += decimalToCents(value);
    }
    return anyPresent ? formatHundredths(total) : null;
  }
  if (periodSum("baseline") !== overall.baselineValue || periodSum("target") !== overall.targetValue) {
    throw new Error("Regional values do not reconcile to the overall period values");
  }
  if (overall.absoluteChange !== null) {
    const sum = regional.segments.reduce((total, segment) => {
      if (segment.absoluteChange === null) throw new Error("Regional change is unavailable");
      return total + decimalToCents(segment.absoluteChange);
    }, 0n);
    if (formatHundredths(sum) !== overall.absoluteChange) throw new Error("Regional changes do not reconcile to overall change");
  }
  const interval = (period: { start: string; end: string }) => `[${period.start}, ${period.end})`;
  const delta = overall.absoluteChange === null ? null : decimalToCents(overall.absoluteChange);
  const change = delta === null ? "Change is unavailable because a period has no matching data."
    : delta === 0n ? "Net revenue was unchanged (0.00)."
    : `Net revenue ${delta > 0n ? "increased" : "decreased"} by ${formatHundredths(delta < 0n ? -delta : delta)}${overall.percentageChange === null ? " (percentage unavailable: zero baseline)" : ` (${overall.percentageChange}%)`}.`;
  const contributions = regional.segments.map((segment) =>
    `${segment.region}: ${segment.absoluteChange === null ? "unavailable (SQL NULL)" : segment.absoluteChange}` +
    `${!segment.baselinePresent ? " (absent in baseline)" : ""}${!segment.targetPresent ? " (absent in target)" : ""}`).join("; ");
  return [
    `${change} Baseline ${interval(overall.baseline)}: ${overall.baselineValue ?? "no matching data"}; target ${interval(overall.target)}: ${overall.targetValue ?? "no matching data"}.`,
    `Regional contributions (target minus baseline): ${contributions || "no matching regions"}.`,
    overall.absoluteChange === null ? "Regional period values reconcile; numerical change reconciliation is unavailable."
      : `Regional period values reconcile to the overall totals; regional changes sum to ${overall.absoluteChange}.`,
    `Definition: ${evidence.definition.calculation}. ${evidence.definition.relevantExclusions.join(" ")} Source: [${evidence.sourceId}] (version ${evidence.sourceVersion ?? "unavailable"}).`,
    "Business causes are not established by these aggregate results.",
  ].join("\n");
}
