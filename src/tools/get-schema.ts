import { z } from "zod";

import type { ModelToolDefinition } from "../ai/provider.js";
import {
  ENUMERATED_FILTER_VALUES_BY_FIELD,
  SUPPORTED_DIMENSIONS,
  SUPPORTED_FILTER_FIELDS,
  SUPPORTED_FILTER_OPERATORS_BY_FIELD,
  SUPPORTED_METRICS,
} from "../query-plan/query-plan.js";

export const APPLICATION_QUERY_SCHEMA = Object.freeze({
  metrics: SUPPORTED_METRICS,
  dimensions: SUPPORTED_DIMENSIONS,
  filters: Object.freeze({
    fields: SUPPORTED_FILTER_FIELDS,
    operatorsByField: SUPPORTED_FILTER_OPERATORS_BY_FIELD,
    enumeratedValuesByField: ENUMERATED_FILTER_VALUES_BY_FIELD,
  }),
});

export type ApplicationQuerySchema = typeof APPLICATION_QUERY_SCHEMA;

export const getSchemaArgumentsSchema = z.object({}).strict();

export type GetSchemaArguments = z.infer<typeof getSchemaArgumentsSchema>;

export const getSchemaArgumentsJsonSchema = z.toJSONSchema(
  getSchemaArgumentsSchema,
  {
    target: "draft-07",
    unrepresentable: "throw",
    reused: "inline",
  },
);

export const getSchemaToolDefinition = Object.freeze({
  name: "get_schema",
  description:
    "Use this tool to discover the commerce analytics capabilities supported by the application. It returns supported metrics, dimensions, filter fields, per-field operators, and enumerated filter values; it does not return database contents.",
  parameters: getSchemaArgumentsJsonSchema,
} satisfies ModelToolDefinition);

export type GetSchemaValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type GetSchemaResult =
  | Readonly<{
      success: true;
      data: ApplicationQuerySchema;
    }>
  | Readonly<{
      success: false;
      error: Readonly<{
        code: "INVALID_ARGUMENTS";
        message: string;
        issues: readonly GetSchemaValidationIssue[];
      }>;
    }>;

export type GetSchemaHandler = (
  arguments_: GetSchemaArguments,
) => ApplicationQuerySchema;

export function getSchema(
  _arguments: GetSchemaArguments,
): ApplicationQuerySchema {
  return APPLICATION_QUERY_SCHEMA;
}

export function executeGetSchema(
  input: unknown,
  handler: GetSchemaHandler = getSchema,
): GetSchemaResult {
  const validationResult = getSchemaArgumentsSchema.safeParse(input);

  if (!validationResult.success) {
    return {
      success: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message: "Invalid arguments for get_schema",
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
