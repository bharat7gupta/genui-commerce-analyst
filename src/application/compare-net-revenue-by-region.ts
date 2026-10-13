import { decimalToCents, formatHundredths } from "../decimal.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { SUPPORTED_REGION_FILTER_VALUES } from "../query-plan/query-plan.js";
import type { QueryPlanExecutor, TableRow } from "./commerce-analysis-pipeline.js";
import { buildPeriodComparisonPlans, type DateInterval } from "./compare-periods.js";

export type RegionComparison = Readonly<{
  region: string;
  baselinePresent: boolean;
  targetPresent: boolean;
  baselineValue: string | null;
  targetValue: string | null;
  absoluteChange: string | null;
}>;

export type RegionPeriodComparison = Readonly<{
  metric: "net_revenue";
  dimension: "region";
  baseline: DateInterval;
  target: DateInterval;
  segments: readonly RegionComparison[];
}>;

/**
 * Compare all regions present in either period, sorted by region.
 * Absence contributes zero to the change but remains explicitly absent in
 * the returned value/presence flag. Present SQL NULL propagates to the change.
 */
export async function compareNetRevenueByRegion(
  baseline: DateInterval,
  target: DateInterval,
  executor: QueryPlanExecutor = new DuckDBQueryPlanExecutor(),
): Promise<RegionPeriodComparison> {
  const { baselinePlan, targetPlan, periods } = buildPeriodComparisonPlans(
    "net_revenue", baseline, target, ["region"],
  );
  const baselineValues = readRegionValues(await executor.execute(baselinePlan));
  const targetValues = readRegionValues(await executor.execute(targetPlan));
  const regions = [...new Set([...baselineValues.keys(), ...targetValues.keys()])].sort();

  return {
    metric: "net_revenue",
    dimension: "region",
    baseline: periods.baseline,
    target: periods.target,
    segments: regions.map((region) => {
      const baselinePresent = baselineValues.has(region);
      const targetPresent = targetValues.has(region);
      const baselineCents = baselineValues.get(region);
      const targetCents = targetValues.get(region);
      return {
        region, baselinePresent, targetPresent,
        baselineValue: baselineCents == null ? null : formatHundredths(baselineCents),
        targetValue: targetCents == null ? null : formatHundredths(targetCents),
        absoluteChange: baselineCents === null || targetCents === null
          ? null
          : formatHundredths((targetCents ?? 0n) - (baselineCents ?? 0n)),
      };
    }),
  };
}

function readRegionValues(rows: readonly TableRow[]): Map<string, bigint | null> {
  const values = new Map<string, bigint | null>();
  for (const row of rows) {
    const region = row.region;
    if (typeof region !== "string" ||
      !SUPPORTED_REGION_FILTER_VALUES.some((known) => known === region) ||
      !Object.hasOwn(row, "net_revenue") || values.has(region)) {
      throw new Error("Expected one net_revenue aggregate per supported region");
    }
    values.set(region, row.net_revenue === null ? null : decimalToCents(row.net_revenue));
  }
  return values;
}
