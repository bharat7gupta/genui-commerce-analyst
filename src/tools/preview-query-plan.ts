import { z } from "zod";

import type { ModelToolDefinition } from "../ai/provider.js";
import {
  queryPlanSchema,
  validateQueryPlan,
  type QueryPlan,
  type QueryPlanValidationFailure,
  type QueryPlanValidationIssue,
} from "../query-plan/query-plan.js";

export const previewQueryPlanArgumentsSchema = z
  .object({
    plan: queryPlanSchema,
  })
  .strict();

export type PreviewQueryPlanArguments = z.infer<
  typeof previewQueryPlanArgumentsSchema
>;

export const previewQueryPlanArgumentsJsonSchema = z.toJSONSchema(
  previewQueryPlanArgumentsSchema,
  {
    target: "draft-07",
    unrepresentable: "throw",
    reused: "inline",
  },
);

export const previewQueryPlanToolDefinition = Object.freeze({
  name: "preview_query_plan",
  description:
    "Use this tool to validate and preview a proposed commerce QueryPlan without executing it. It returns the validated plan and a deterministic summary of its metric, grouping, filters, and date range, or structured validation errors.",
  parameters: previewQueryPlanArgumentsJsonSchema,
} satisfies ModelToolDefinition);

export type QueryPlanPreviewSummary = Readonly<{
  metric: string;
  grouping: string;
  filters: string;
  dateRange: string;
}>;

export type QueryPlanPreview = Readonly<{
  plan: QueryPlan;
  summary: QueryPlanPreviewSummary;
}>;

export type PreviewQueryPlanResult =
  | Readonly<{
      success: true;
      data: QueryPlanPreview;
    }>
  | Readonly<{
      success: false;
      error: Readonly<{
        code: "VALIDATION_ERROR";
        category: QueryPlanValidationFailure["category"];
        issues: readonly QueryPlanValidationIssue[];
      }>;
    }>;

export type PreviewQueryPlanHandler = (plan: QueryPlan) => QueryPlanPreview;

export function previewQueryPlan(plan: QueryPlan): QueryPlanPreview {
  return {
    plan,
    summary: {
      metric: summarizeMetric(plan),
      grouping: summarizeGrouping(plan),
      filters: summarizeFilters(plan),
      dateRange: summarizeDateRange(plan),
    },
  };
}

export function executePreviewQueryPlan(
  input: unknown,
  handler: PreviewQueryPlanHandler = previewQueryPlan,
): PreviewQueryPlanResult {
  const argumentsResult = previewQueryPlanArgumentsSchema.safeParse(input);

  if (!argumentsResult.success) {
    return validationFailure(
      "structural",
      argumentsResult.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        code: issue.code,
        message: `${formatPath(issue.path)}: ${issue.message}`,
      })),
    );
  }

  const planResult = validateQueryPlan(argumentsResult.data.plan);
  if (!planResult.success) {
    return validationFailure(
      planResult.category,
      planResult.issues.map((issue) => ({
        ...issue,
        path: `plan.${issue.path}`,
        message: `plan.${issue.message}`,
      })),
    );
  }

  return {
    success: true,
    data: handler(planResult.data),
  };
}

function summarizeMetric(plan: QueryPlan): string {
  return plan.metric.kind === "metric" ? plan.metric.value : "unspecified";
}

function summarizeGrouping(plan: QueryPlan): string {
  if (plan.dimensions.kind === "unspecified") return "unspecified";
  return plan.dimensions.values.length === 0
    ? "none"
    : plan.dimensions.values.join(", ");
}

function summarizeFilters(plan: QueryPlan): string {
  if (plan.filters.kind === "unspecified") return "unspecified";
  if (plan.filters.items.length === 0) return "none";

  return plan.filters.items.map(summarizeFilter).join("; ");
}

type QueryPlanFilter = Extract<
  QueryPlan["filters"],
  { kind: "specified" }
>["items"][number];

function summarizeFilter(filter: QueryPlanFilter): string {
  if (filter.operator === "in") {
    return `${filter.field} in [${filter.values.map(formatFilterValue).join(", ")}]`;
  }

  return `${filter.field} ${filter.operator} ${formatFilterValue(filter.value)}`;
}

function formatFilterValue(value: string | number): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function summarizeDateRange(plan: QueryPlan): string {
  if (plan.dateRange.kind === "interval") {
    return `[${plan.dateRange.start}, ${plan.dateRange.end})`;
  }

  return plan.dateRange.kind;
}

function validationFailure(
  category: QueryPlanValidationFailure["category"],
  issues: readonly QueryPlanValidationIssue[],
): PreviewQueryPlanResult {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      category,
      issues,
    },
  };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}
