const validPlan = {
  version: "query-plan-v1",
  metric: { kind: "metric", value: "total_gross_revenue" },
  dimensions: { kind: "specified", values: [] },
  filters: { kind: "specified", items: [] },
  dateRange: { kind: "all_time" },
  comparison: { kind: "none" },
  ordering: { kind: "none" },
  limit: { kind: "none" },
  visualization: { kind: "unspecified" },
};

export const VALID_QUERY_PLAN_OUTPUT = JSON.stringify({
  schemaVersion: "query-plan-output-v1",
  outcome: "query_plan",
  queryPlan: validPlan,
});

export const MALFORMED_QUERY_PLAN_OUTPUT =
  '{"schemaVersion":"query-plan-output-v1","outcome":"query_plan"';

export const STRUCTURALLY_INVALID_QUERY_PLAN_OUTPUT = JSON.stringify({
  schemaVersion: "query-plan-output-v1",
  outcome: "query_plan",
  queryPlan: {
    ...validPlan,
    metric: { kind: "metric", value: "profit" },
  },
});

export const BUSINESS_RULE_INVALID_QUERY_PLAN_OUTPUT = JSON.stringify({
  schemaVersion: "query-plan-output-v1",
  outcome: "query_plan",
  queryPlan: {
    ...validPlan,
    dateRange: {
      kind: "interval",
      start: "2025-10-01",
      end: "2025-09-01",
    },
  },
});
