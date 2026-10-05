import { z } from "zod";

import type { ModelToolDefinition } from "../ai/provider.js";
import { SUPPORTED_METRICS } from "../query-plan/query-plan.js";

export type SupportedMetric = (typeof SUPPORTED_METRICS)[number];

export type MetricDefinition = Readonly<{
  metric: SupportedMetric;
  meaning: string;
  calculation: string;
  relevantExclusions: readonly string[];
}>;

const ALL_STATUSES_POLICY =
  "No order statuses are excluded unless an explicit supported status filter is applied.";

export const METRIC_DEFINITIONS = Object.freeze({
  total_gross_revenue: Object.freeze({
    metric: "total_gross_revenue",
    meaning: "Total gross revenue.",
    calculation: "SUM(gross_amount)",
    relevantExclusions: Object.freeze([ALL_STATUSES_POLICY]),
  }),
  net_revenue: Object.freeze({
    metric: "net_revenue",
    meaning: "Net revenue after discounts and refunds.",
    calculation: "SUM(gross_amount - discount_amount - refund_amount)",
    relevantExclusions: Object.freeze([ALL_STATUSES_POLICY]),
  }),
  total_refund_amount: Object.freeze({
    metric: "total_refund_amount",
    meaning: "Total refund amount.",
    calculation: "SUM(refund_amount)",
    relevantExclusions: Object.freeze([ALL_STATUSES_POLICY]),
  }),
} satisfies Readonly<Record<SupportedMetric, MetricDefinition>>);

export const getMetricDefinitionArgumentsSchema = z
  .object({
    metric: z.enum(SUPPORTED_METRICS),
  })
  .strict();

export type GetMetricDefinitionArguments = z.infer<
  typeof getMetricDefinitionArgumentsSchema
>;

export const getMetricDefinitionArgumentsJsonSchema = z.toJSONSchema(
  getMetricDefinitionArgumentsSchema,
  {
    target: "draft-07",
    unrepresentable: "throw",
    reused: "inline",
  },
);

export const getMetricDefinitionToolDefinition = Object.freeze({
  name: "get_metric_definition",
  description:
    "Use this tool when a supported commerce metric needs an authoritative definition. It returns the metric's meaning, calculation, and relevant exclusions.",
  parameters: getMetricDefinitionArgumentsJsonSchema,
} satisfies ModelToolDefinition);

export type ToolValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type GetMetricDefinitionResult =
  | Readonly<{
      success: true;
      data: MetricDefinition;
    }>
  | Readonly<{
      success: false;
      error: Readonly<{
        code: "INVALID_ARGUMENTS";
        message: string;
        issues: readonly ToolValidationIssue[];
      }>;
    }>;

export type GetMetricDefinitionHandler = (
  arguments_: GetMetricDefinitionArguments,
) => MetricDefinition;

export function getMetricDefinition(
  arguments_: GetMetricDefinitionArguments,
): MetricDefinition {
  return METRIC_DEFINITIONS[arguments_.metric];
}

export function executeGetMetricDefinition(
  input: unknown,
  handler: GetMetricDefinitionHandler = getMetricDefinition,
): GetMetricDefinitionResult {
  const validationResult = getMetricDefinitionArgumentsSchema.safeParse(input);

  if (!validationResult.success) {
    return {
      success: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message: "Invalid arguments for get_metric_definition",
        issues: validationResult.error.issues.map((issue) => ({
          path: formatPath(issue.path),
          code: issue.code,
          message: `${formatPath(issue.path)}: ${issue.message}`,
        })),
      },
    };
  }

  return {
    success: true,
    data: handler(validationResult.data),
  };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}
