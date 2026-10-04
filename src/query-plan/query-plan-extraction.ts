import { z } from "zod";

import type {
  ModelMetadata,
  ModelProvider,
  TokenUsage,
} from "../ai/provider.js";
import {
  QUERY_PLAN_VERSION,
  queryPlanSchema,
  validateQueryPlan,
  type QueryPlan,
  type QueryPlanValidationIssue,
} from "./query-plan.js";
import {
  QUERY_PLAN_EXTRACTION_PROMPT_VERSION as QUERY_PLAN_EXTRACTION_V1_PROMPT_VERSION,
  QUERY_PLAN_EXTRACTION_SYSTEM_PROMPT as QUERY_PLAN_EXTRACTION_V1_SYSTEM_PROMPT,
} from "./query-plan-extraction-v1-prompt.js";
import {
  QUERY_PLAN_EXTRACTION_V2_PROMPT_PACKAGE,
  QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION,
  type QueryPlanExtractionExample,
} from "./query-plan-extraction-v2-prompt.js";

export type QueryPlanExtractionPromptVersion =
  | typeof QUERY_PLAN_EXTRACTION_V1_PROMPT_VERSION
  | typeof QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION;

const NO_EXAMPLES: readonly QueryPlanExtractionExample[] = Object.freeze([]);
const QUERY_PLAN_EXTRACTION_PROMPT_PACKAGES = Object.freeze({
  [QUERY_PLAN_EXTRACTION_V1_PROMPT_VERSION]: Object.freeze({
    version: QUERY_PLAN_EXTRACTION_V1_PROMPT_VERSION,
    systemPrompt: QUERY_PLAN_EXTRACTION_V1_SYSTEM_PROMPT,
    examples: NO_EXAMPLES,
  }),
  [QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION]:
    QUERY_PLAN_EXTRACTION_V2_PROMPT_PACKAGE,
});

export const QUERY_PLAN_OUTPUT_SCHEMA_VERSION =
  "query-plan-output-v1" as const;

export const QUERY_PLAN_EXTRACTION_MODEL_SETTINGS = Object.freeze({
  temperature: 0,
  maxTokens: 1024,
});

export const queryPlanOutputSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      schemaVersion: z.literal(QUERY_PLAN_OUTPUT_SCHEMA_VERSION),
      outcome: z.literal("query_plan"),
      queryPlan: queryPlanSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(QUERY_PLAN_OUTPUT_SCHEMA_VERSION),
      outcome: z.literal("clarification_required"),
      reason: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(QUERY_PLAN_OUTPUT_SCHEMA_VERSION),
      outcome: z.literal("unsupported"),
      reason: z.string().trim().min(1),
    })
    .strict(),
]);

export type QueryPlanModelOutput = z.infer<typeof queryPlanOutputSchema>;

export const queryPlanOutputJsonSchema = z.toJSONSchema(
  queryPlanOutputSchema,
  {
    target: "draft-07",
    unrepresentable: "throw",
    reused: "inline",
  },
);

type ExtractionTelemetry = {
  promptVersion: QueryPlanExtractionPromptVersion;
  schemaVersion: typeof QUERY_PLAN_VERSION;
  outputSchemaVersion: typeof QUERY_PLAN_OUTPUT_SCHEMA_VERSION;
  model: string | null;
  modelSettings: typeof QUERY_PLAN_EXTRACTION_MODEL_SETTINGS;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  requestId: string | null;
  finishReason: string | null;
};

type CompletedExtraction = ExtractionTelemetry & {
  rawOutput: string;
};

export type QueryPlanExtractionResult =
  | (CompletedExtraction & {
      outcome: "query_plan";
      queryPlan: QueryPlan;
    })
  | (CompletedExtraction & {
      outcome: "clarification_required" | "unsupported";
      reason: string;
    })
  | (CompletedExtraction & {
      outcome: "refusal";
      refusal: string;
    })
  | (CompletedExtraction & {
      outcome: "incomplete";
      error: string;
    })
  | (CompletedExtraction & {
      outcome: "malformed_json";
      error: string;
    })
  | (CompletedExtraction & {
      outcome: "structural_validation_failure";
      issues: QueryPlanValidationIssue[];
    })
  | (CompletedExtraction & {
      outcome: "business_rule_failure";
      issues: QueryPlanValidationIssue[];
    })
  | (ExtractionTelemetry & {
      outcome: "provider_error";
      rawOutput: null;
      error: string;
    });

export async function extractQueryPlan(
  provider: ModelProvider,
  question: string,
  promptVersion: QueryPlanExtractionPromptVersion =
    QUERY_PLAN_EXTRACTION_V1_PROMPT_VERSION,
): Promise<QueryPlanExtractionResult> {
  const startedAt = performance.now();
  const promptPackage = QUERY_PLAN_EXTRACTION_PROMPT_PACKAGES[promptVersion];
  let result;

  try {
    result = await provider.generate({
      messages: [
        { role: "system", content: promptPackage.systemPrompt },
        ...promptPackage.examples.flatMap(({ user, assistant }) => [
          user,
          assistant,
        ]),
        { role: "user", content: question },
      ],
      ...QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
      responseFormat: {
        type: "json_schema",
        name: "query_plan_output_v1",
        schema: queryPlanOutputJsonSchema,
        strict: true,
      },
    });
  } catch (error) {
    return {
      ...baseTelemetry(
        promptVersion,
        null,
        Math.round(performance.now() - startedAt),
      ),
      outcome: "provider_error",
      rawOutput: null,
      error: toErrorMessage(error),
    };
  }

  const finishReason = result.finishReason ?? null;
  const refusal = result.refusal ?? null;
  const telemetry = resultTelemetry(
    promptVersion,
    result.metadata,
    finishReason,
  );
  const completed = { ...telemetry, rawOutput: result.text };

  if (refusal !== null) {
    return {
      ...completed,
      outcome: "refusal",
      refusal,
    };
  }

  if (finishReason !== null && finishReason !== "stop") {
    return {
      ...completed,
      outcome: "incomplete",
      error: `Model generation ended with finish reason ${JSON.stringify(finishReason)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (error) {
    return {
      ...completed,
      outcome: "malformed_json",
      error: `Model output is not valid JSON: ${toErrorMessage(error)}`,
    };
  }

  const structuralResult = queryPlanOutputSchema.safeParse(parsed);
  if (!structuralResult.success) {
    return {
      ...completed,
      outcome: "structural_validation_failure",
      issues: structuralResult.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        code: issue.code,
        message: `${formatPath(issue.path)}: ${issue.message}`,
      })),
    };
  }

  if (structuralResult.data.outcome !== "query_plan") {
    return {
      ...completed,
      outcome: structuralResult.data.outcome,
      reason: structuralResult.data.reason,
    };
  }

  const validationResult = validateQueryPlan(
    structuralResult.data.queryPlan,
  );
  if (!validationResult.success) {
    return {
      ...completed,
      outcome:
        validationResult.category === "business_rule"
          ? "business_rule_failure"
          : "structural_validation_failure",
      issues: validationResult.issues,
    };
  }

  return {
    ...completed,
    outcome: "query_plan",
    queryPlan: validationResult.data,
  };
}

function resultTelemetry(
  promptVersion: QueryPlanExtractionPromptVersion,
  metadata: ModelMetadata,
  finishReason: string | null,
): ExtractionTelemetry {
  return {
    ...baseTelemetry(promptVersion, metadata.model, metadata.latencyMs),
    tokenUsage: metadata.tokenUsage,
    requestId: metadata.requestId,
    finishReason,
  };
}

function baseTelemetry(
  promptVersion: QueryPlanExtractionPromptVersion,
  model: string | null,
  latencyMs: number,
): ExtractionTelemetry {
  return {
    promptVersion,
    schemaVersion: QUERY_PLAN_VERSION,
    outputSchemaVersion: QUERY_PLAN_OUTPUT_SCHEMA_VERSION,
    model,
    modelSettings: QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
    latencyMs,
    tokenUsage: null,
    requestId: null,
    finishReason: null,
  };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
