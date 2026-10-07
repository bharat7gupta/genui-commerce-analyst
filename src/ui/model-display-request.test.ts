import assert from "node:assert/strict";
import test from "node:test";

import { DuckDBDateIntervalLimitError } from "../db/duckdb-query-plan-executor.js";
import { QueryPlanValidationError } from "../query-plan/query-plan.js";
import { KPI_SPECIFICATION, TABLE_SPECIFICATION } from "./kpi-specification.js";
import { MissingDatesError, parseModelDisplayRequest } from "./model-display-request.js";
import { renderKpiFragment } from "./net-revenue-kpi-page.js";
import { NET_REVENUE_KPI_PLAN } from "./net-revenue-kpi-plan.js";

test("entered dates change only the interval and label both component types", () => {
  for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
    const { plan } = parseModelDisplayRequest({ specification, start: "2025-08-02", end: "2025-08-04" });
    assert.deepEqual(plan, {
      ...NET_REVENUE_KPI_PLAN,
      dateRange: { kind: "interval", start: "2025-08-02", end: "2025-08-04" },
    });
    const html = renderKpiFragment(specification, [{ net_revenue: "1100.00" }], plan);
    assert.ok(html.includes("1100.00"));
    assert.ok(html.includes('dateTime="2025-08-02"'));
    assert.ok(html.includes('dateTime="2025-08-04"'));
    assert.ok(!html.includes("2025-09-01"));
  }
});

test("dates reuse calendar-date and reversed-interval validation", () => {
  for (const dates of [
    { start: "2025-08-04", end: "2025-08-02" },
    { start: "2025-02-30", end: "2025-03-01" },
    { start: "2025-08-01T00:00:00Z", end: "2025-09-01" },
  ]) {
    assert.throws(() => parseModelDisplayRequest({ specification: KPI_SPECIFICATION, ...dates }), QueryPlanValidationError);
  }
});

test("missing dates require clarification and identify each absent input", () => {
  for (const dates of [
    { start: "2025-08-01", end: "", missing: ["end"] },
    { start: "", end: "2025-09-01", missing: ["start"] },
    { start: undefined, end: undefined, missing: ["start", "end"] },
  ]) {
    assert.throws(() => parseModelDisplayRequest({
      specification: KPI_SPECIFICATION, start: dates.start, end: dates.end,
    }), (error) => {
      assert.ok(error instanceof MissingDatesError);
      assert.equal(error.message, "Choose a start and end date");
      assert.deepEqual(error.missingInputs, dates.missing);
      return true;
    });
  }
});

test("preflight uses the existing 366-day date policy", () => {
  assert.doesNotThrow(() => parseModelDisplayRequest({
    specification: KPI_SPECIFICATION, start: "2025-01-01", end: "2026-01-02",
  }));
  assert.throws(() => parseModelDisplayRequest({
    specification: TABLE_SPECIFICATION, start: "2025-01-01", end: "2026-01-03",
  }), DuckDBDateIntervalLimitError);
});

test("the request cannot change the metric or add specification properties", () => {
  assert.throws(() => parseModelDisplayRequest({
    specification: KPI_SPECIFICATION, start: "2025-08-02", end: "2025-08-04", metric: "profit",
  }), /Invalid display request/);
  assert.throws(() => parseModelDisplayRequest({
    specification: { ...KPI_SPECIFICATION, value: 123 }, start: "2025-08-02", end: "2025-08-04",
  }), /Invalid display request/);
});
