import { createHash } from "node:crypto";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { QwenProvider } from "../ai/qwen-provider.js";
import type { TokenUsage } from "../ai/provider.js";
import { config } from "../config.js";
import {
  extractQueryPlan,
  QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
  type QueryPlanExtractionPromptVersion,
  type QueryPlanExtractionResult,
} from "../query-plan/query-plan-extraction.js";
import { QUERY_PLAN_EXTRACTION_PROMPT_VERSION as V1 } from "../query-plan/query-plan-extraction-v1-prompt.js";
import { QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION as V2 } from "../query-plan/query-plan-extraction-v2-prompt.js";
import {
  validateQueryPlan,
  type QueryPlan,
} from "../query-plan/query-plan.js";

const EXPERIMENT = "query-plan-extraction-development-v1-v2" as const;
const CASE_SET_VERSION = "query-plan-development-cases-v1" as const;
const REQUIRED_MODEL = "qwen3.5:4b";
const REPETITIONS = [1, 2, 3] as const;
const PROMPT_VERSIONS = [V1, V2] as const;
const PLAN_FIELDS = [
  "version",
  "metric",
  "dimensions",
  "filters",
  "dateRange",
  "comparison",
  "ordering",
  "limit",
  "visualization",
] as const;

const fieldAssertionSchema = z
  .object({
    field: z.enum(PLAN_FIELDS),
    equals: z.json(),
  })
  .strict();

const expectedSchema = z
  .object({
    outcome: z.enum([
      "query_plan",
      "clarification_required",
      "unsupported",
    ]),
    fieldAssertions: z.array(fieldAssertionSchema),
    manualExplanationCriterion: z.string().min(1).optional(),
  })
  .strict();

const developmentCaseSchema = z
  .object({
    id: z.string().min(1),
    input: z.string().min(1),
    expected: expectedSchema,
  })
  .strict();

type DevelopmentCase = z.infer<typeof developmentCaseSchema>;
type PlanField = (typeof PLAN_FIELDS)[number];
type Repetition = (typeof REPETITIONS)[number];

type FieldFailure = {
  field: PlanField;
  expected: unknown;
  actual: unknown;
};

type RunRecord = {
  timestamp: string;
  experiment: typeof EXPERIMENT;
  caseSetVersion: typeof CASE_SET_VERSION;
  promptVersion: QueryPlanExtractionPromptVersion;
  caseId: string;
  repetition: Repetition;
  input: string;
  expectedOutcome: DevelopmentCase["expected"]["outcome"];
  fieldAssertions: DevelopmentCase["expected"]["fieldAssertions"];
  manualExplanationCriterion: string | null;
  rawModelOutput: string | null;
  actualOutcome: QueryPlanExtractionResult["outcome"];
  actualQueryPlan: QueryPlan | null;
  structurallyValid: boolean;
  outcomeCorrect: boolean;
  fieldsCorrect: boolean | null;
  fieldFailures: FieldFailure[];
  endToEndSuccess: boolean;
  modelName: string;
  modelSettings: {
    temperature: number;
    maxTokens: number;
    reasoningEffort: typeof config.model.reasoningEffort;
  };
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  requestId: string | null;
  finishReason: string | null;
  error: string | null;
};

const casesUrl = new URL(
  "../../evals/query-plan/development-cases-v1.jsonl",
  import.meta.url,
);
const v1PromptUrl = new URL(
  "../query-plan/query-plan-extraction-v1-prompt.ts",
  import.meta.url,
);
const v2PromptUrl = new URL(
  "../query-plan/query-plan-extraction-v2-prompt.ts",
  import.meta.url,
);
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const resultsUrl = new URL(
  "day-03-query-plan-extraction-development-v1-v2.jsonl",
  resultsDirectoryUrl,
);

if (config.model.model !== REQUIRED_MODEL) {
  throw new Error(
    `Expected model ${REQUIRED_MODEL}, configured ${config.model.model}`,
  );
}

if (config.model.reasoningEffort !== "none") {
  throw new Error(
    `Expected reasoning effort none, configured ${config.model.reasoningEffort}`,
  );
}

await ensureResultsDoNotExist();
const cases = await loadCases();
const checksumsBefore = await getFrozenInputChecksums();
const provider = new QwenProvider(config.model);
const records: RunRecord[] = [];

await mkdir(resultsDirectoryUrl, { recursive: true });

for (const promptVersion of PROMPT_VERSIONS) {
  for (const [caseIndex, developmentCase] of cases.entries()) {
    for (const repetition of REPETITIONS) {
      console.log(
        `[${promptVersion}] [${caseIndex + 1}/${cases.length}] ${developmentCase.id} — run ${repetition}/3`,
      );

      const result = await extractQueryPlan(
        provider,
        developmentCase.input,
        promptVersion,
      );
      const record = buildRecord(
        promptVersion,
        developmentCase,
        repetition,
        result,
      );
      await appendFile(resultsUrl, `${JSON.stringify(record)}\n`, "utf8");
      records.push(record);
      console.log(
        `  ${record.actualOutcome}; structural=${record.structurallyValid}; outcome=${record.outcomeCorrect}; fields=${String(record.fieldsCorrect)}; success=${record.endToEndSuccess}`,
      );
    }
  }
}

const checksumsAfter = await getFrozenInputChecksums();
if (!isDeepStrictEqual(checksumsBefore, checksumsAfter)) {
  throw new Error("Prompt or development dataset changed during evaluation");
}

console.log(
  JSON.stringify(
    {
      checksums: checksumsAfter,
      summary: buildSummary(records, cases),
    },
    null,
    2,
  ),
);
console.log(`Results: ${resultsUrl.pathname}`);

async function loadCases(): Promise<DevelopmentCase[]> {
  const lines = (await readFile(casesUrl, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const cases = lines.map((line, index) => {
    try {
      return developmentCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid development case on line ${index + 1}`, {
        cause: error,
      });
    }
  });

  if (cases.length !== 8) {
    throw new Error(`Expected 8 development cases, found ${cases.length}`);
  }
  if (new Set(cases.map(({ id }) => id)).size !== cases.length) {
    throw new Error("Development case IDs must be unique");
  }

  for (const developmentCase of cases) {
    validateExpectedAssertions(developmentCase);
  }

  return cases;
}

function validateExpectedAssertions(developmentCase: DevelopmentCase): void {
  const { expected } = developmentCase;
  const fields = expected.fieldAssertions.map(({ field }) => field);

  if (new Set(fields).size !== fields.length) {
    throw new Error(`${developmentCase.id} has duplicate field assertions`);
  }

  if (expected.outcome === "query_plan") {
    if (
      fields.length !== PLAN_FIELDS.length ||
      PLAN_FIELDS.some((field) => !fields.includes(field))
    ) {
      throw new Error(
        `${developmentCase.id} must assert every QueryPlan field`,
      );
    }

    const candidate = Object.fromEntries(
      expected.fieldAssertions.map(({ field, equals }) => [field, equals]),
    );
    const validation = validateQueryPlan(candidate);
    if (!validation.success) {
      throw new Error(
        `${developmentCase.id} has an invalid expected QueryPlan: ${validation.issues.map(({ message }) => message).join("; ")}`,
      );
    }
  } else if (fields.length !== 0) {
    throw new Error(
      `${developmentCase.id} must not define plan fields for ${expected.outcome}`,
    );
  }
}

function buildRecord(
  promptVersion: QueryPlanExtractionPromptVersion,
  developmentCase: DevelopmentCase,
  repetition: Repetition,
  result: QueryPlanExtractionResult,
): RunRecord {
  const actualQueryPlan =
    result.outcome === "query_plan" ? result.queryPlan : null;
  const structurallyValid = ![
    "provider_error",
    "refusal",
    "incomplete",
    "malformed_json",
    "structural_validation_failure",
  ].includes(result.outcome);
  const outcomeCorrect = result.outcome === developmentCase.expected.outcome;
  const fieldFailures =
    developmentCase.expected.outcome === "query_plan"
      ? evaluateFields(
          developmentCase.expected.fieldAssertions,
          actualQueryPlan,
        )
      : [];
  const fieldsCorrect =
    developmentCase.expected.outcome === "query_plan"
      ? actualQueryPlan !== null && fieldFailures.length === 0
      : null;

  return {
    timestamp: new Date().toISOString(),
    experiment: EXPERIMENT,
    caseSetVersion: CASE_SET_VERSION,
    promptVersion,
    caseId: developmentCase.id,
    repetition,
    input: developmentCase.input,
    expectedOutcome: developmentCase.expected.outcome,
    fieldAssertions: developmentCase.expected.fieldAssertions,
    manualExplanationCriterion:
      developmentCase.expected.manualExplanationCriterion ?? null,
    rawModelOutput: result.rawOutput,
    actualOutcome: result.outcome,
    actualQueryPlan,
    structurallyValid,
    outcomeCorrect,
    fieldsCorrect,
    fieldFailures,
    endToEndSuccess:
      structurallyValid && outcomeCorrect && fieldsCorrect !== false,
    modelName: result.model ?? config.model.model,
    modelSettings: {
      ...QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
      reasoningEffort: config.model.reasoningEffort,
    },
    latencyMs: result.latencyMs,
    tokenUsage: result.tokenUsage,
    requestId: result.requestId,
    finishReason: result.finishReason,
    error: getResultError(result),
  };
}

function evaluateFields(
  assertions: DevelopmentCase["expected"]["fieldAssertions"],
  plan: QueryPlan | null,
): FieldFailure[] {
  return assertions.flatMap(({ field, equals }) => {
    const actual = plan === null ? null : plan[field];
    return isDeepStrictEqual(actual, equals)
      ? []
      : [{ field, expected: equals, actual }];
  });
}

function getResultError(result: QueryPlanExtractionResult): string | null {
  switch (result.outcome) {
    case "provider_error":
    case "incomplete":
    case "malformed_json":
      return result.error;
    case "refusal":
      return result.refusal;
    case "structural_validation_failure":
    case "business_rule_failure":
      return result.issues.map(({ message }) => message).join("; ");
    default:
      return null;
  }
}

function buildSummary(records: RunRecord[], cases: DevelopmentCase[]) {
  return Object.fromEntries(
    PROMPT_VERSIONS.map((promptVersion) => {
      const versionRecords = records.filter(
        (record) => record.promptVersion === promptVersion,
      );
      const expectedPlanRecords = versionRecords.filter(
        (record) => record.expectedOutcome === "query_plan",
      );
      const usages = versionRecords.flatMap(({ tokenUsage }) =>
        tokenUsage === null ? [] : [tokenUsage],
      );
      const latencies = versionRecords.map(({ latencyMs }) => latencyMs);

      return [
        promptVersion,
        {
          calls: versionRecords.length,
          structuralValidityRate: rate(
            versionRecords.filter(({ structurallyValid }) => structurallyValid)
              .length,
            versionRecords.length,
          ),
          outcomeAccuracy: rate(
            versionRecords.filter(({ outcomeCorrect }) => outcomeCorrect)
              .length,
            versionRecords.length,
          ),
          expectedPlanFieldAccuracy: rate(
            expectedPlanRecords.filter(
              ({ fieldsCorrect }) => fieldsCorrect === true,
            ).length,
            expectedPlanRecords.length,
          ),
          endToEndSuccessRate: rate(
            versionRecords.filter(({ endToEndSuccess }) => endToEndSuccess)
              .length,
            versionRecords.length,
          ),
          averageInputTokens: average(
            usages.map(({ inputTokens }) => inputTokens),
          ),
          averageOutputTokens: average(
            usages.map(({ outputTokens }) => outputTokens),
          ),
          averageLatencyMs: average(latencies),
          medianLatencyMs: median(latencies),
          cases: Object.fromEntries(
            cases.map(({ id }) => {
              const caseRecords = versionRecords.filter(
                (record) => record.caseId === id,
              );
              return [
                id,
                {
                  successes: caseRecords.filter(
                    ({ endToEndSuccess }) => endToEndSuccess,
                  ).length,
                  runs: caseRecords.length,
                },
              ];
            }),
          ),
        },
      ];
    }),
  );
}

async function getFrozenInputChecksums() {
  return {
    caseSet: await sha256(casesUrl),
    v1Prompt: await sha256(v1PromptUrl),
    v2Prompt: await sha256(v2PromptUrl),
  };
}

async function sha256(url: URL): Promise<string> {
  return createHash("sha256").update(await readFile(url)).digest("hex");
}

async function ensureResultsDoNotExist(): Promise<void> {
  try {
    await access(resultsUrl);
    throw new Error(
      `Refusing to overwrite existing experiment file ${resultsUrl.pathname}`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

function average(values: number[]): number | null {
  return values.length === 0
    ? null
    : Number(
        (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(
          2,
        ),
      );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) return null;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  return left === undefined ? right : (left + right) / 2;
}
