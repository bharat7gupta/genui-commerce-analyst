import { parseQueryPlan } from "../query-plan/query-plan.js";

// Explicit application-owned plan; no routing, extraction, or model calls.
export const NET_REVENUE_KPI_PLAN = parseQueryPlan({
  version: "query-plan-v1",
  metric: { kind: "metric", value: "net_revenue" },
  dimensions: { kind: "specified", values: [] },
  filters: { kind: "specified", items: [] },
  dateRange: { kind: "interval", start: "2025-08-01", end: "2025-09-01" },
  comparison: { kind: "none" },
  ordering: { kind: "none" },
  limit: { kind: "none" },
  // The compiler requires none. Rendering a KPI is this page's responsibility.
  visualization: { kind: "none" },
});
