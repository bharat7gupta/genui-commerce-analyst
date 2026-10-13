import { decimalToCents, formatHundredths } from "../decimal.js";
import {
  DuckDBQueryPlanExecutor,
  enforceExplicitDateIntervalLimit,
} from "../db/duckdb-query-plan-executor.js";
import { compileQueryPlan } from "../db/query-plan-sql-compiler.js";
import { parseQueryPlan, type QueryPlan } from "../query-plan/query-plan.js";
import type { SupportedMetric } from "../tools/get-metric-definition.js";
import type { QueryPlanExecutor, TableRow } from "./commerce-analysis-pipeline.js";

export type DateInterval = Readonly<{ start: string; end: string }>;

export type PeriodComparison = Readonly<{
  metric: SupportedMetric;
  baseline: DateInterval;
  target: DateInterval;
  baselineValue: string | null;
  targetValue: string | null;
  absoluteChange: string | null;
  /** Percentage units, rounded to two decimals, half away from zero. */
  percentageChange: string | null;
}>;

/**
 * Compare explicit non-overlapping [start, end) periods across all orders.
 * Currently executable only for net_revenue, as enforced by the compiler.
 * SQL NULL means no matching data; it is never converted to zero.
 */
export async function comparePeriods(
  metric: SupportedMetric,
  baseline: DateInterval,
  target: DateInterval,
  executor: QueryPlanExecutor = new DuckDBQueryPlanExecutor(),
): Promise<PeriodComparison> {
  const { baselinePlan, targetPlan, periods } = buildPeriodComparisonPlans(metric, baseline, target);
  const baselineCents = readCents(await executor.execute(baselinePlan), metric);
  const targetCents = readCents(await executor.execute(targetPlan), metric);
  const delta = baselineCents === null || targetCents === null
    ? null
    : targetCents - baselineCents;

  return {
    metric,
    baseline: periods.baseline,
    target: periods.target,
    baselineValue: baselineCents === null ? null : formatHundredths(baselineCents),
    targetValue: targetCents === null ? null : formatHundredths(targetCents),
    absoluteChange: delta === null ? null : formatHundredths(delta),
    percentageChange: delta === null || baselineCents === null || baselineCents === 0n
      ? null
      : formatHundredths(roundRatio(delta * 10_000n, baselineCents)),
  };
}

/** Shared validation and execution-slice preparation for scalar/region comparisons. */
export function buildPeriodComparisonPlans(
  metric: SupportedMetric,
  baseline: DateInterval,
  target: DateInterval,
  dimensions: readonly "region"[] = [],
): Readonly<{
  baselinePlan: QueryPlan;
  targetPlan: QueryPlan;
  periods: Extract<QueryPlan["comparison"], { kind: "date_intervals" }>;
}> {
  const comparisonPlan = parseQueryPlan({
    version: "query-plan-v1",
    metric: { kind: "metric", value: metric },
    dimensions: { kind: "specified", values: dimensions },
    filters: { kind: "specified", items: [] },
    dateRange: { kind: "unspecified" },
    comparison: { kind: "date_intervals", baseline, target },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "none" },
  });
  // Use the validated copies, including when the caller mutates its inputs.
  if (comparisonPlan.comparison.kind !== "date_intervals") {
    throw new Error("Expected a date-interval comparison");
  }
  const periods = comparisonPlan.comparison;
  const baselinePlan = periodPlan(comparisonPlan, periods.baseline);
  const targetPlan = periodPlan(comparisonPlan, periods.target);
  // Validate both execution slices before either query. Keep the existing
  // default date cap even for an injected executor; DuckDB also enforces its
  // configured cap and deadline independently.
  for (const plan of [baselinePlan, targetPlan]) {
    compileQueryPlan(plan);
    enforceExplicitDateIntervalLimit(plan);
  }

  return { baselinePlan, targetPlan, periods };
}

function periodPlan(plan: QueryPlan, interval: DateInterval): QueryPlan {
  return parseQueryPlan({
    ...plan,
    dateRange: { kind: "interval", ...interval },
    comparison: { kind: "none" },
  });
}

function readCents(rows: readonly TableRow[], metric: SupportedMetric): bigint | null {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined || !Object.hasOwn(row, metric)) {
    throw new Error(`Expected exactly one aggregate row containing ${metric}`);
  }
  const value = row[metric];
  if (value === null) return null;
  return decimalToCents(value);
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const magnitude = numerator < 0n ? -numerator : numerator;
  const divisor = denominator < 0n ? -denominator : denominator;
  const rounded = magnitude / divisor + (2n * (magnitude % divisor) >= divisor ? 1n : 0n);
  return negative ? -rounded : rounded;
}
