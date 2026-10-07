import { parseQueryPlan } from "../query-plan/query-plan.js";
import { METRIC_DEFINITIONS } from "../tools/get-metric-definition.js";

const ORDERS_TABLE = "orders";
const ORDER_DATE_COLUMN = "order_date";
const REGION_COLUMN = "region";
const NET_REVENUE_ALIAS = "net_revenue";
const NET_REVENUE_EXPRESSION =
  METRIC_DEFINITIONS.net_revenue.calculation;

export type CompiledQuery = Readonly<{
  sql: string;
  parameters: readonly string[];
}>;

export type QueryPlanCompilationErrorCode =
  | "UNSUPPORTED_METRIC"
  | "UNSUPPORTED_DIMENSIONS"
  | "UNSUPPORTED_FILTERS"
  | "UNSUPPORTED_DATE_RANGE"
  | "UNSUPPORTED_COMPARISON"
  | "UNSUPPORTED_ORDERING"
  | "UNSUPPORTED_LIMIT"
  | "UNSUPPORTED_VISUALIZATION";

export class QueryPlanCompilationError extends Error {
  constructor(
    readonly code: QueryPlanCompilationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueryPlanCompilationError";
  }
}

export function compileQueryPlan(input: unknown): CompiledQuery {
  const plan = parseQueryPlan(input);

  if (plan.metric.kind !== "metric" || plan.metric.value !== "net_revenue") {
    reject(
      "UNSUPPORTED_METRIC",
      "This compiler slice requires the net_revenue metric",
    );
  }

  if (
    plan.dimensions.kind !== "specified" ||
    plan.dimensions.values.length !== 0
  ) {
    reject(
      "UNSUPPORTED_DIMENSIONS",
      "This compiler slice requires explicitly specified empty dimensions",
    );
  }

  if (plan.comparison.kind !== "none") {
    reject(
      "UNSUPPORTED_COMPARISON",
      "This compiler slice requires an explicit comparison value of none",
    );
  }

  if (plan.ordering.kind !== "none") {
    reject(
      "UNSUPPORTED_ORDERING",
      "This compiler slice requires an explicit ordering value of none",
    );
  }

  if (plan.limit.kind !== "none") {
    reject(
      "UNSUPPORTED_LIMIT",
      "This compiler slice requires an explicit limit value of none",
    );
  }

  if (plan.visualization.kind !== "none") {
    reject(
      "UNSUPPORTED_VISUALIZATION",
      "This compiler slice requires an explicit visualization value of none",
    );
  }

  const predicates: string[] = [];
  const parameters: string[] = [];

  if (plan.dateRange.kind === "interval") {
    predicates.push(`${ORDER_DATE_COLUMN} >= CAST(? AS DATE)`);
    parameters.push(plan.dateRange.start);
    predicates.push(`${ORDER_DATE_COLUMN} < CAST(? AS DATE)`);
    parameters.push(plan.dateRange.end);
  } else if (plan.dateRange.kind !== "all_time") {
    reject(
      "UNSUPPORTED_DATE_RANGE",
      "This compiler slice requires an explicit all_time or date interval range",
    );
  }

  if (plan.filters.kind !== "specified") {
    reject(
      "UNSUPPORTED_FILTERS",
      "This compiler slice requires filters to be explicitly specified",
    );
  }

  if (plan.filters.items.length > 1) {
    reject(
      "UNSUPPORTED_FILTERS",
      "This compiler slice supports at most one filter",
    );
  }

  const [filter] = plan.filters.items;
  if (filter !== undefined) {
    if (filter.field !== "region" || filter.operator !== "eq") {
      reject(
        "UNSUPPORTED_FILTERS",
        "This compiler slice supports only a region equality filter",
      );
    }

    predicates.push(`${REGION_COLUMN} = ?`);
    parameters.push(filter.value);
  }

  const lines = [
    `SELECT ${NET_REVENUE_EXPRESSION} AS ${NET_REVENUE_ALIAS}`,
    `FROM ${ORDERS_TABLE}`,
  ];

  if (predicates.length > 0) {
    lines.push(`WHERE ${predicates.join(" AND ")}`);
  }

  return {
    sql: `${lines.join("\n")};`,
    parameters,
  };
}

function reject(code: QueryPlanCompilationErrorCode, message: string): never {
  throw new QueryPlanCompilationError(code, message);
}
