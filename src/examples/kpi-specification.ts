import assert from "node:assert/strict";

import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { KPI_SPECIFICATION, TABLE_SPECIFICATION, UiSpecificationValidationError } from "../ui/kpi-specification.js";
import { renderKpiPage } from "../ui/net-revenue-kpi-page.js";
import { NET_REVENUE_KPI_PLAN } from "../ui/net-revenue-kpi-plan.js";

const rows = await new DuckDBQueryPlanExecutor().execute(NET_REVENUE_KPI_PLAN);
const value = rows[0]?.net_revenue;
assert.equal(value, "7225.00");
for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
  const html = renderKpiPage(specification, rows);
  assert.ok(html.includes(specification.type === "kpi"
    ? `<p class="value">${value}</p>` : `<td>${value}</td>`));
  assert.ok(html.includes("net_revenue"));
  assert.ok(html.includes("2025-08-01"));
  assert.ok(html.includes("2025-09-01"));
  console.log(JSON.stringify({
    case: "valid", specification, executorResult: rows,
    outcome: "rendered", displayedValue: value,
  }));
}

for (const specification of [
  { type: "chart", resultField: "net_revenue" },
  { type: "kpi", resultField: "profit" },
]) {
  let rejected = false;
  try {
    renderKpiPage(specification, rows);
  } catch (error) {
    if (!(error instanceof UiSpecificationValidationError)) throw error;
    rejected = true;
    console.log(JSON.stringify({ specification, outcome: "rejected", error: error.message }));
  }
  assert.ok(rejected, "Invalid UI specification must be rejected");
}
