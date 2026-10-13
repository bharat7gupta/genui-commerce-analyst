import { z } from "zod";
import type { ModelToolDefinition } from "../ai/provider.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";
import { buildPeriodComparisonPlans, comparePeriods, type PeriodComparison } from "../application/compare-periods.js";
import { compareNetRevenueByRegion, type RegionPeriodComparison } from "../application/compare-net-revenue-by-region.js";
import { executeGetMetricDefinition, getMetricDefinitionArgumentsSchema, type GetMetricDefinitionArguments, type MetricDefinition } from "./get-metric-definition.js";

const intervalSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
export const comparePeriodsArgumentsSchema = z.object({
  metric: z.literal("net_revenue"), baseline: intervalSchema, target: intervalSchema,
}).strict();
export type ComparePeriodsArguments = z.infer<typeof comparePeriodsArgumentsSchema>;
export const comparePeriodsToolDefinition = Object.freeze({
  name: "compare_periods",
  description: "Read-only comparison of net revenue for explicit baseline and target [start inclusive, end exclusive) intervals. Returns both period values, signed absolute change and percentage change. Use full calendar-month dates for explicit month/year requests. Only net_revenue is supported. Do not invent missing metrics or dates.",
  parameters: z.toJSONSchema(comparePeriodsArgumentsSchema, { target: "draft-07", unrepresentable: "throw", reused: "inline" }),
} satisfies ModelToolDefinition);

export type ComparePeriodsToolResult =
  | Readonly<{ success: true; data: PeriodComparison }>
  | Readonly<{ success: false; error: Readonly<{ code: "INVALID_ARGUMENTS" | "EXECUTION_FAILED"; message: string }> }>;
export type ComparePeriodsToolExecution = Readonly<{
  validatedArguments: ComparePeriodsArguments | null;
  result: ComparePeriodsToolResult;
}>;

export function validateComparePeriodsArguments(input: unknown):
  | Readonly<{ success: true; data: ComparePeriodsArguments }>
  | Readonly<{ success: false; error: Readonly<{ code: "INVALID_ARGUMENTS"; message: string }> }> {
  const validation = comparePeriodsArgumentsSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, error: { code: "INVALID_ARGUMENTS", message: validation.error.message } };
  }
  const arguments_ = validation.data;
  try {
    buildPeriodComparisonPlans(arguments_.metric, arguments_.baseline, arguments_.target);
  } catch (error) {
    return { success: false,
      error: { code: "INVALID_ARGUMENTS", message: error instanceof Error ? error.message : String(error) } };
  }
  return { success: true, data: arguments_ };
}

export const compareRegionArgumentsSchema = comparePeriodsArgumentsSchema.pick({ baseline: true, target: true });
export type CompareRegionArguments = z.infer<typeof compareRegionArgumentsSchema>;
export const compareRegionToolDefinition = Object.freeze({
  name: "compare_net_revenue_by_region",
  description: "Read-only net_revenue comparison by region for baseline and target [start, end) intervals. Start included, end excluded; full months end on the following month's first day. Returns every region present in either period, both values, presence flags and target-minus-baseline change. Absence differs from present SQL NULL. Contributions are descriptive, not established business causes. No currency metadata is supplied.",
  parameters: z.toJSONSchema(compareRegionArgumentsSchema, { target: "draft-07", unrepresentable: "throw", reused: "inline" }),
} satisfies ModelToolDefinition);
export type ComparisonAgentArguments = ComparePeriodsArguments | CompareRegionArguments | GetMetricDefinitionArguments;
export type MetricDefinitionObservation = Readonly<{ definition: MetricDefinition; sourceId: string; sourceVersion: null }>;
export type ComparisonAgentToolResult =
  | ComparePeriodsToolResult
  | Readonly<{ success: true; data: RegionPeriodComparison | MetricDefinitionObservation }>
  | Readonly<{ success: false; error: Readonly<{ code: string; message: string }> }>;
export type ComparisonAgentToolExecution = Readonly<{ validatedArguments: ComparisonAgentArguments | null; result: ComparisonAgentToolResult }>;

export function validateComparisonAgentArguments(name: string, input: unknown):
  | Readonly<{ success: true; data: ComparisonAgentArguments }>
  | Readonly<{ success: false; error: Readonly<{ code: string; message: string }> }> {
  if (name === "compare_periods") return validateComparePeriodsArguments(input);
  if (name === "compare_net_revenue_by_region") {
    const parsed = compareRegionArgumentsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: { code: "INVALID_ARGUMENTS", message: parsed.error.message } };
    const dates = validateComparePeriodsArguments({ metric: "net_revenue", ...parsed.data });
    return dates.success ? { success: true, data: parsed.data } : dates;
  }
  if (name === "get_metric_definition") {
    const parsed = getMetricDefinitionArgumentsSchema.safeParse(input);
    return parsed.success ? { success: true, data: parsed.data }
      : { success: false, error: { code: "INVALID_ARGUMENTS", message: parsed.error.message } };
  }
  return { success: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
}

/** Individual read-only capabilities, not the fixed investigation workflow. */
export async function executeComparisonAgentTool(name: string, input: unknown, executor: QueryPlanExecutor): Promise<ComparisonAgentToolExecution> {
  const validation = validateComparisonAgentArguments(name, input);
  if (!validation.success) return { validatedArguments: null, result: validation };
  try {
    if (name === "compare_periods") return executeComparePeriods(input, executor);
    if (name === "compare_net_revenue_by_region") {
      const args = compareRegionArgumentsSchema.parse(input);
      return { validatedArguments: args, result: { success: true,
        data: await compareNetRevenueByRegion(args.baseline, args.target, executor) } };
    }
    const result = executeGetMetricDefinition(input);
    if (!result.success) return { validatedArguments: validation.data, result };
    return { validatedArguments: validation.data, result: { success: true, data: {
      definition: result.data,
      sourceId: `src/tools/get-metric-definition.ts#METRIC_DEFINITIONS.${result.data.metric}`,
      sourceVersion: null,
    } } };
  } catch (error) {
    return { validatedArguments: validation.data, result: { success: false,
      error: { code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) } } };
  }
}

export async function executeComparePeriods(input: unknown, executor?: QueryPlanExecutor): Promise<ComparePeriodsToolExecution> {
  const validation = validateComparePeriodsArguments(input);
  if (!validation.success) return { validatedArguments: null, result: validation };
  const arguments_ = validation.data;
  try {
    return { validatedArguments: arguments_, result: { success: true,
      data: await comparePeriods(arguments_.metric, arguments_.baseline, arguments_.target, executor) } };
  } catch (error) {
    return { validatedArguments: arguments_, result: { success: false,
      error: { code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) } } };
  }
}
