import assert from "node:assert/strict";
import { DuckDBInstance } from "@duckdb/node-api";
import { compareNetRevenueByRegion } from "../application/compare-net-revenue-by-region.js";
import { comparePeriods } from "../application/compare-periods.js";
import { databasePath } from "../db/connection.js";
import { decimalToCents, formatHundredths } from "../decimal.js";

const baseline = { start: "2025-08-01", end: "2025-09-01" };
const target = { start: "2025-09-01", end: "2025-10-01" };
const actual = await compareNetRevenueByRegion(baseline, target);
const totals = await comparePeriods("net_revenue", baseline, target);

// Independent reference: conditional aggregation in one scan, literal dates,
// and separate counts to distinguish absence from a present NULL aggregate.
// Neither the compiler nor the metric-definition SQL supplies this query.
const referenceSql = `
  SELECT region,
    COUNT(*) FILTER (WHERE order_date < DATE '2025-09-01') > 0 AS baseline_present,
    COUNT(*) FILTER (WHERE order_date >= DATE '2025-09-01') > 0 AS target_present,
    SUM(gross_amount - discount_amount - refund_amount)
      FILTER (WHERE order_date < DATE '2025-09-01') AS baseline_value,
    SUM(gross_amount - discount_amount - refund_amount)
      FILTER (WHERE order_date >= DATE '2025-09-01') AS target_value,
    CASE WHEN
      (COUNT(*) FILTER (WHERE order_date < DATE '2025-09-01') > 0 AND
       SUM(gross_amount - discount_amount - refund_amount)
         FILTER (WHERE order_date < DATE '2025-09-01') IS NULL) OR
      (COUNT(*) FILTER (WHERE order_date >= DATE '2025-09-01') > 0 AND
       SUM(gross_amount - discount_amount - refund_amount)
         FILTER (WHERE order_date >= DATE '2025-09-01') IS NULL)
    THEN NULL ELSE
      COALESCE(SUM(gross_amount - discount_amount - refund_amount)
        FILTER (WHERE order_date >= DATE '2025-09-01'), 0) -
      COALESCE(SUM(gross_amount - discount_amount - refund_amount)
        FILTER (WHERE order_date < DATE '2025-09-01'), 0)
    END AS absolute_change
  FROM orders
  WHERE order_date >= DATE '2025-08-01' AND order_date < DATE '2025-10-01'
  GROUP BY region ORDER BY region;
`;
const referenceTotalsSql = `
  SELECT
    SUM(gross_amount - discount_amount - refund_amount)
      FILTER (WHERE order_date < DATE '2025-09-01') AS baseline_value,
    SUM(gross_amount - discount_amount - refund_amount)
      FILTER (WHERE order_date >= DATE '2025-09-01') AS target_value
  FROM orders
  WHERE order_date >= DATE '2025-08-01' AND order_date < DATE '2025-10-01';
`;
const instance = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
const connection = await instance.connect();
try {
  const reference = (await connection.runAndReadAll(referenceSql)).getRowObjectsJson();
  assert.deepEqual(actual.segments, reference.map((row) => ({
    region: row.region,
    baselinePresent: row.baseline_present,
    targetPresent: row.target_present,
    baselineValue: row.baseline_value,
    targetValue: row.target_value,
    absoluteChange: row.absolute_change,
  })));
  const referenceTotals = (await connection.runAndReadAll(referenceTotalsSql)).getRowObjectsJson();
  assert.deepEqual(referenceTotals, [{ baseline_value: "7225.00", target_value: "8295.00" }]);
} finally {
  connection.closeSync();
  instance.closeSync();
}

// Reconcile in application code with exact cents, never floating point.
function sum(field: "baselineValue" | "targetValue" | "absoluteChange"): string {
  return formatHundredths(actual.segments.reduce((total, segment) => {
    const value = segment[field];
    assert.notEqual(value, null, `Seeded ${segment.region}.${field} must be non-null`);
    return total + decimalToCents(value);
  }, 0n));
}
const reconciliation = {
  baselineSegments: sum("baselineValue"), baselineTotal: totals.baselineValue,
  targetSegments: sum("targetValue"), targetTotal: totals.targetValue,
  segmentChanges: sum("absoluteChange"), totalChange: totals.absoluteChange,
};
assert.equal(reconciliation.baselineSegments, "7225.00");
assert.equal(reconciliation.targetSegments, "8295.00");
assert.equal(reconciliation.segmentChanges, "1070.00");
assert.equal(reconciliation.baselineSegments, reconciliation.baselineTotal);
assert.equal(reconciliation.targetSegments, reconciliation.targetTotal);
assert.equal(reconciliation.segmentChanges, reconciliation.totalChange);
console.log(JSON.stringify({ ...actual, referenceSqlMatched: true, reconciliation }, null, 2));
