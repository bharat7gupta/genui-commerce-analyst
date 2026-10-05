import { z } from "zod";

export const QUERY_PLAN_VERSION = "query-plan-v1" as const;

export const SUPPORTED_METRICS = Object.freeze([
  "total_gross_revenue",
  "net_revenue",
  "total_refund_amount",
] as const);

export const SUPPORTED_DIMENSIONS = Object.freeze([
  "region",
  "category",
  "status",
] as const);

export const SUPPORTED_REGION_FILTER_VALUES = Object.freeze([
  "North",
  "South",
  "East",
  "West",
] as const);

export const SUPPORTED_CATEGORY_FILTER_VALUES = Object.freeze([
  "Electronics",
  "Apparel",
  "Home",
  "Beauty",
] as const);

export const SUPPORTED_STATUS_FILTER_VALUES = Object.freeze([
  "completed",
  "partially_refunded",
  "refunded",
] as const);

export const SUPPORTED_FILTER_FIELDS = Object.freeze([
  "order_id",
  "customer_id",
  "region",
  "category",
  "status",
  "gross_amount",
  "discount_amount",
  "refund_amount",
] as const);

const EQUALITY_FILTER_OPERATOR = "eq" as const;
const MEMBERSHIP_FILTER_OPERATOR = "in" as const;

const CATEGORICAL_FILTER_OPERATORS = Object.freeze([
  EQUALITY_FILTER_OPERATOR,
  MEMBERSHIP_FILTER_OPERATOR,
] as const);

const AMOUNT_FILTER_OPERATORS = Object.freeze([
  EQUALITY_FILTER_OPERATOR,
  "gt",
  "gte",
  "lt",
  "lte",
] as const);

export const SUPPORTED_FILTER_OPERATORS_BY_FIELD = Object.freeze({
  order_id: CATEGORICAL_FILTER_OPERATORS,
  customer_id: CATEGORICAL_FILTER_OPERATORS,
  region: CATEGORICAL_FILTER_OPERATORS,
  category: CATEGORICAL_FILTER_OPERATORS,
  status: CATEGORICAL_FILTER_OPERATORS,
  gross_amount: AMOUNT_FILTER_OPERATORS,
  discount_amount: AMOUNT_FILTER_OPERATORS,
  refund_amount: AMOUNT_FILTER_OPERATORS,
});

export const ENUMERATED_FILTER_VALUES_BY_FIELD = Object.freeze({
  region: SUPPORTED_REGION_FILTER_VALUES,
  category: SUPPORTED_CATEGORY_FILTER_VALUES,
  status: SUPPORTED_STATUS_FILTER_VALUES,
});

const SUPPORTED_AMOUNT_FILTER_FIELDS = Object.freeze([
  "gross_amount",
  "discount_amount",
  "refund_amount",
] as const);

const regionSchema = z.enum(SUPPORTED_REGION_FILTER_VALUES);
const categorySchema = z.enum(SUPPORTED_CATEGORY_FILTER_VALUES);
const statusSchema = z.enum(SUPPORTED_STATUS_FILTER_VALUES);
const identifierSchema = z.string().trim().min(1);
const amountSchema = z.number().finite().nonnegative();

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format")
  .refine(isRealCalendarDate, "Expected a real calendar date");

const intervalSchema = z
  .object({
    start: calendarDateSchema,
    end: calendarDateSchema,
  })
  .strict();

const metricSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z
    .object({
      kind: z.literal("metric"),
      value: z.enum(SUPPORTED_METRICS),
    })
    .strict(),
]);

const dimensionsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z
    .object({
      kind: z.literal("specified"),
      values: z.array(z.enum(SUPPORTED_DIMENSIONS)).max(3),
    })
    .strict(),
]);

const regionFilterSchema = z.union([
  z
    .object({
      field: z.literal("region"),
      operator: z.literal(EQUALITY_FILTER_OPERATOR),
      value: regionSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("region"),
      operator: z.literal(MEMBERSHIP_FILTER_OPERATOR),
      values: z.array(regionSchema).min(1),
    })
    .strict(),
]);

const categoryFilterSchema = z.union([
  z
    .object({
      field: z.literal("category"),
      operator: z.literal(EQUALITY_FILTER_OPERATOR),
      value: categorySchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("category"),
      operator: z.literal(MEMBERSHIP_FILTER_OPERATOR),
      values: z.array(categorySchema).min(1),
    })
    .strict(),
]);

const statusFilterSchema = z.union([
  z
    .object({
      field: z.literal("status"),
      operator: z.literal(EQUALITY_FILTER_OPERATOR),
      value: statusSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("status"),
      operator: z.literal(MEMBERSHIP_FILTER_OPERATOR),
      values: z.array(statusSchema).min(1),
    })
    .strict(),
]);

const orderIdFilterSchema = z.union([
  z
    .object({
      field: z.literal("order_id"),
      operator: z.literal(EQUALITY_FILTER_OPERATOR),
      value: identifierSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("order_id"),
      operator: z.literal(MEMBERSHIP_FILTER_OPERATOR),
      values: z.array(identifierSchema).min(1),
    })
    .strict(),
]);

const customerIdFilterSchema = z.union([
  z
    .object({
      field: z.literal("customer_id"),
      operator: z.literal(EQUALITY_FILTER_OPERATOR),
      value: identifierSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("customer_id"),
      operator: z.literal(MEMBERSHIP_FILTER_OPERATOR),
      values: z.array(identifierSchema).min(1),
    })
    .strict(),
]);

const amountFilterSchema = z
  .object({
    field: z.enum(SUPPORTED_AMOUNT_FILTER_FIELDS),
    operator: z.enum(AMOUNT_FILTER_OPERATORS),
    value: amountSchema,
  })
  .strict();

const filterSchema = z.union([
  regionFilterSchema,
  categoryFilterSchema,
  statusFilterSchema,
  orderIdFilterSchema,
  customerIdFilterSchema,
  amountFilterSchema,
]);

const filtersSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z
    .object({
      kind: z.literal("specified"),
      items: z.array(filterSchema),
    })
    .strict(),
]);

const dateRangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z.object({ kind: z.literal("all_time") }).strict(),
  z
    .object({
      kind: z.literal("interval"),
      start: calendarDateSchema,
      end: calendarDateSchema,
    })
    .strict(),
]);

const comparisonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("date_intervals"),
      baseline: intervalSchema,
      target: intervalSchema,
    })
    .strict(),
]);

const orderingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("metric"),
      direction: z.enum(["asc", "desc"]),
    })
    .strict(),
]);

const limitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("value"),
      value: z.number().int().min(1).max(100),
    })
    .strict(),
]);

const visualizationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unspecified") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("type"),
      value: z.enum(["table", "bar", "single_value"]),
    })
    .strict(),
]);

export const queryPlanSchema = z
  .object({
    version: z.literal(QUERY_PLAN_VERSION),
    metric: metricSchema,
    dimensions: dimensionsSchema,
    filters: filtersSchema,
    dateRange: dateRangeSchema,
    comparison: comparisonSchema,
    ordering: orderingSchema,
    limit: limitSchema,
    visualization: visualizationSchema,
  })
  .strict();

export type QueryPlan = z.infer<typeof queryPlanSchema>;

export type QueryPlanValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type QueryPlanValidationFailure = {
  success: false;
  category: "structural" | "business_rule";
  issues: QueryPlanValidationIssue[];
};

export type QueryPlanValidationResult =
  | { success: true; data: QueryPlan }
  | QueryPlanValidationFailure;

export class QueryPlanValidationError extends Error {
  constructor(
    readonly category: QueryPlanValidationFailure["category"],
    readonly issues: QueryPlanValidationIssue[],
  ) {
    super(
      `${category === "structural" ? "Invalid QueryPlan structure" : "Invalid QueryPlan semantics"}: ${issues.map(({ message }) => message).join("; ")}`,
    );
    this.name = "QueryPlanValidationError";
  }
}

export function validateQueryPlan(input: unknown): QueryPlanValidationResult {
  const structuralResult = queryPlanSchema.safeParse(input);

  if (!structuralResult.success) {
    return {
      success: false,
      category: "structural",
      issues: structuralResult.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        code: issue.code,
        message: `${formatPath(issue.path)}: ${issue.message}`,
      })),
    };
  }

  const businessIssues = validateBusinessRules(structuralResult.data);

  if (businessIssues.length > 0) {
    return {
      success: false,
      category: "business_rule",
      issues: businessIssues,
    };
  }

  return { success: true, data: structuralResult.data };
}

export function parseQueryPlan(input: unknown): QueryPlan {
  const result = validateQueryPlan(input);

  if (!result.success) {
    throw new QueryPlanValidationError(result.category, result.issues);
  }

  return result.data;
}

function validateBusinessRules(plan: QueryPlan): QueryPlanValidationIssue[] {
  const issues: QueryPlanValidationIssue[] = [];

  if (plan.dimensions.kind === "specified") {
    const uniqueDimensions = new Set(plan.dimensions.values);
    if (uniqueDimensions.size !== plan.dimensions.values.length) {
      issues.push({
        path: "dimensions.values",
        code: "DUPLICATE_DIMENSION",
        message: "dimensions.values must not contain duplicates",
      });
    }
  }

  if (plan.dateRange.kind === "interval") {
    validateInterval(plan.dateRange, "dateRange", issues);
  }

  if (plan.comparison.kind === "date_intervals") {
    validateInterval(plan.comparison.baseline, "comparison.baseline", issues);
    validateInterval(plan.comparison.target, "comparison.target", issues);

    if (plan.dateRange.kind !== "unspecified") {
      issues.push({
        path: "dateRange",
        code: "COMPARISON_DATE_RANGE_CONFLICT",
        message:
          "dateRange must be unspecified when comparison supplies baseline and target intervals",
      });
    }

    if (intervalsOverlap(plan.comparison.baseline, plan.comparison.target)) {
      issues.push({
        path: "comparison",
        code: "COMPARISON_INTERVALS_OVERLAP",
        message: "comparison baseline and target intervals must not overlap",
      });
    }

    if (plan.ordering.kind === "metric") {
      issues.push({
        path: "ordering",
        code: "COMPARISON_ORDERING_UNSUPPORTED",
        message: "metric ordering is not supported with date-interval comparison",
      });
    }
  }

  if (plan.ordering.kind === "metric") {
    if (plan.metric.kind !== "metric") {
      issues.push({
        path: "metric",
        code: "ORDERING_REQUIRES_METRIC",
        message: "metric ordering requires a specified metric",
      });
    }

    if (
      plan.dimensions.kind !== "specified" ||
      plan.dimensions.values.length === 0
    ) {
      issues.push({
        path: "dimensions",
        code: "ORDERING_REQUIRES_DIMENSION",
        message: "metric ordering requires at least one specified dimension",
      });
    }
  }

  if (plan.limit.kind === "value" && plan.ordering.kind !== "metric") {
    issues.push({
      path: "limit",
      code: "LIMIT_REQUIRES_ORDERING",
      message: "a numeric limit requires explicit metric ordering",
    });
  }

  if (plan.visualization.kind === "type") {
    if (
      plan.visualization.value === "bar" &&
      (plan.dimensions.kind !== "specified" ||
        plan.dimensions.values.length !== 1)
    ) {
      issues.push({
        path: "visualization",
        code: "BAR_REQUIRES_ONE_DIMENSION",
        message: "bar visualization requires exactly one specified dimension",
      });
    }

    if (
      plan.visualization.value === "single_value" &&
      (plan.dimensions.kind !== "specified" ||
        plan.dimensions.values.length !== 0)
    ) {
      issues.push({
        path: "visualization",
        code: "SINGLE_VALUE_REQUIRES_NO_DIMENSIONS",
        message:
          "single_value visualization requires explicitly specified empty dimensions",
      });
    }

    if (
      plan.visualization.value === "single_value" &&
      plan.comparison.kind === "date_intervals"
    ) {
      issues.push({
        path: "visualization",
        code: "SINGLE_VALUE_COMPARISON_UNSUPPORTED",
        message:
          "single_value visualization is not supported for date-interval comparison",
      });
    }
  }

  if (plan.filters.kind === "specified") {
    validateFilterConsistency(plan.filters.items, issues);
  }

  return issues;
}

function validateFilterConsistency(
  filters: Extract<QueryPlan["filters"], { kind: "specified" }>["items"],
  issues: QueryPlanValidationIssue[],
): void {
  const categoricalAllowed = new Map<string, Set<string>>();
  const numericBounds = new Map<
    string,
    {
      lower?: { value: number; inclusive: boolean };
      upper?: { value: number; inclusive: boolean };
    }
  >();

  for (const filter of filters) {
    if (filter.operator === "in") {
      intersectAllowedValues(
        categoricalAllowed,
        filter.field,
        new Set(filter.values),
      );
      continue;
    }

    if (typeof filter.value === "string") {
      intersectAllowedValues(
        categoricalAllowed,
        filter.field,
        new Set([filter.value]),
      );
      continue;
    }

    const bounds = numericBounds.get(filter.field) ?? {};
    switch (filter.operator) {
      case "eq":
        bounds.lower = chooseStricterLower(bounds.lower, {
          value: filter.value,
          inclusive: true,
        });
        bounds.upper = chooseStricterUpper(bounds.upper, {
          value: filter.value,
          inclusive: true,
        });
        break;
      case "gt":
      case "gte":
        bounds.lower = chooseStricterLower(bounds.lower, {
          value: filter.value,
          inclusive: filter.operator === "gte",
        });
        break;
      case "lt":
      case "lte":
        bounds.upper = chooseStricterUpper(bounds.upper, {
          value: filter.value,
          inclusive: filter.operator === "lte",
        });
        break;
    }
    numericBounds.set(filter.field, bounds);
  }

  for (const [field, values] of categoricalAllowed) {
    if (values.size === 0) {
      issues.push({
        path: "filters.items",
        code: "CONTRADICTORY_FILTERS",
        message: `filters on ${field} have no value that can satisfy all constraints`,
      });
    }
  }

  for (const [field, { lower, upper }] of numericBounds) {
    if (
      lower &&
      upper &&
      (lower.value > upper.value ||
        (lower.value === upper.value &&
          (!lower.inclusive || !upper.inclusive)))
    ) {
      issues.push({
        path: "filters.items",
        code: "CONTRADICTORY_FILTERS",
        message: `numeric filters on ${field} define an empty range`,
      });
    }
  }
}

function intersectAllowedValues(
  constraints: Map<string, Set<string>>,
  field: string,
  nextValues: Set<string>,
): void {
  const currentValues = constraints.get(field);
  constraints.set(
    field,
    currentValues
      ? new Set([...currentValues].filter((value) => nextValues.has(value)))
      : nextValues,
  );
}

type NumericBound = { value: number; inclusive: boolean };

function chooseStricterLower(
  current: NumericBound | undefined,
  next: NumericBound,
): NumericBound {
  if (!current || next.value > current.value) return next;
  if (next.value < current.value) return current;
  return { value: current.value, inclusive: current.inclusive && next.inclusive };
}

function chooseStricterUpper(
  current: NumericBound | undefined,
  next: NumericBound,
): NumericBound {
  if (!current || next.value < current.value) return next;
  if (next.value > current.value) return current;
  return { value: current.value, inclusive: current.inclusive && next.inclusive };
}

function validateInterval(
  interval: { start: string; end: string },
  path: string,
  issues: QueryPlanValidationIssue[],
): void {
  if (interval.start >= interval.end) {
    issues.push({
      path,
      code: "INVALID_INTERVAL_ORDER",
      message: `${path}.start must be earlier than ${path}.end for a [start, end) interval`,
    });
  }
}

function intervalsOverlap(
  left: { start: string; end: string },
  right: { start: string; end: string },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function isRealCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}
