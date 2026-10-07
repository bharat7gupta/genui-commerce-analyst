import assert from "node:assert/strict";

import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { KPI_SPECIFICATION, UiSpecificationValidationError } from "../ui/kpi-specification.js";
import { renderKpiPage } from "../ui/net-revenue-kpi-page.js";
import { NET_REVENUE_KPI_PLAN } from "../ui/net-revenue-kpi-plan.js";

const rows = await new DuckDBQueryPlanExecutor().execute(NET_REVENUE_KPI_PLAN);
const html = renderKpiPage(KPI_SPECIFICATION, rows);
const value = rows[0]?.net_revenue;
assert.equal(typeof value, "string");
assert.ok(html.includes(`<p class="value">${value}</p>`));
console.log(JSON.stringify({
  case: "valid", specification: KPI_SPECIFICATION, executorResult: rows,
  outcome: "rendered", displayedValue: value,
}));

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
