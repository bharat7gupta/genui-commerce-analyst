import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { DuckDBInstance, type Json } from "@duckdb/node-api";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
  TokenUsage,
} from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import {
  runCommerceAnalysis,
  type TableCell,
  type TableRow,
} from "../application/commerce-analysis-pipeline.js";
import { config } from "../config.js";
import { databasePath } from "../db/connection.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { compileQueryPlan } from "../db/query-plan-sql-compiler.js";
import {
  queryPlanOutputSchema,
  type QueryPlanExtractionPromptVersion,
} from "../query-plan/query-plan-extraction.js";
import { QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION } from "../query-plan/query-plan-extraction-v2-prompt.js";
import {
  parseQueryPlan,
  type QueryPlan,
} from "../query-plan/query-plan.js";
import { ROUTER_V3_VERSION } from "../routing/router-v3-prompt.js";
import type { RouterVersion, RoutingDecision } from "../routing/router.js";

const EXPERIMENT = "day-05-live-commerce-analysis-v1" as const;
const REQUIRED_MODEL = "qwen3.5:4b";
const ROUTER_VERSION: RouterVersion = ROUTER_V3_VERSION;
const EXTRACTION_VERSION: QueryPlanExtractionPromptVersion =
  QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION;
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const resultsUrl = new URL(`${EXPERIMENT}.jsonl`, resultsDirectoryUrl);

type FailureCategory =
  | "routing_failure"
  | "extraction_failure"
  | "execution_failure"
  | "plan_mismatch"
  | "numerical_mismatch";

type ExperimentCase = Readonly<{
  id: string;
  question: string;
  expectedPlan: QueryPlan;
  referenceSql: string;
  expectedRows: readonly TableRow[];
}>;

type ProviderCallRecord = Readonly<{
  requestIndex: number;
  stage: "routing" | "extraction";
  temperature: number | null;
  maxTokens: number | null;
  responseFormat: string | null;
  rawOutput: string | null;
  model: string | null;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  requestId: string | null;
  finishReason: string | null;
  refusal: string | null;
  error: string | null;
}>;

type RecordingProvider = ModelProvider & {
  readonly calls: ProviderCallRecord[];
};

type RunRecord = Readonly<{
  timestamp: string;
  experiment: typeof EXPERIMENT;
  caseId: string;
  question: string;
  routerVersion: RouterVersion;
  extractionPromptVersion: QueryPlanExtractionPromptVersion;
  expectedPlan: QueryPlan;
  extractedPlan: QueryPlan | null;
  routingDecision: RoutingDecision | null;
  extractionOutcome: string | null;
  referenceSql: string;
  referenceRows: readonly TableRow[];
  expectedRows: readonly TableRow[];
  actualRows: readonly TableRow[] | null;
  planMatches: boolean | null;
  rowsMatch: boolean | null;
  pass: boolean;
  failureCategory: FailureCategory | null;
  failureDetail: string | null;
  providerCalls: readonly ProviderCallRecord[];
}>;

const cases: readonly ExperimentCase[] = [
  {
    id: "all-time-net-revenue",
    question:
      "What is net revenue for all time? Do not group, compare, order, limit, or visualize.",
    expectedPlan: expectedPlan({ kind: "all_time" }),
    referenceSql: `
      SELECT
        SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders;
    `,
    expectedRows: [{ net_revenue: "15520.00" }],
  },
  {
    id: "august-net-revenue",
    question:
      "What is net revenue from 2025-08-01, up to but excluding 2025-09-01? Do not group, compare, order, limit, or visualize.",
    expectedPlan: expectedPlan({
      kind: "interval",
      start: "2025-08-01",
      end: "2025-09-01",
    }),
    referenceSql: `
      SELECT
        SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-08-01'
        AND order_date < DATE '2025-09-01';
    `,
    expectedRows: [{ net_revenue: "7225.00" }],
  },
  {
    id: "august-north-net-revenue",
    question:
      "What is net revenue for the North region from 2025-08-01, up to but excluding 2025-09-01? Do not group, compare, order, limit, or visualize.",
    expectedPlan: expectedPlan(
      {
        kind: "interval",
        start: "2025-08-01",
        end: "2025-09-01",
      },
      "North",
    ),
    referenceSql: `
      SELECT
        SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-08-01'
        AND order_date < DATE '2025-09-01'
        AND region = 'North';
    `,
    expectedRows: [{ net_revenue: "2275.00" }],
  },
];

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
const referenceRowsByCase = await verifyFrozenCases();
await mkdir(resultsDirectoryUrl, { recursive: true });
await writeFile(resultsUrl, "", { encoding: "utf8", flag: "wx" });

const underlyingProvider = new QwenProvider(config.model);
const executor = new DuckDBQueryPlanExecutor();
const records: RunRecord[] = [];

for (const [index, experimentCase] of cases.entries()) {
  console.log(`[${index + 1}/${cases.length}] ${experimentCase.id}`);
  const provider = createRecordingProvider(underlyingProvider);
  const referenceRows = referenceRowsByCase.get(experimentCase.id);
  if (referenceRows === undefined) {
    throw new Error(`Missing verified reference rows for ${experimentCase.id}`);
  }

  const record = await runCase(
    experimentCase,
    referenceRows,
    provider,
    executor,
  );
  await appendFile(resultsUrl, `${JSON.stringify(record)}\n`, "utf8");
  records.push(record);
  console.log(
    `  ${record.pass ? "pass" : `fail:${record.failureCategory ?? "unknown"}`}`,
  );
}

console.log(
  JSON.stringify(
    {
      experiment: EXPERIMENT,
      routerVersion: ROUTER_VERSION,
      extractionPromptVersion: EXTRACTION_VERSION,
      model: config.model.model,
      reasoningEffort: config.model.reasoningEffort,
      cases: records.length,
      passed: records.filter(({ pass }) => pass).length,
      failed: records.filter(({ pass }) => !pass).length,
      results: resultsUrl.pathname,
    },
    null,
    2,
  ),
);

async function runCase(
  experimentCase: ExperimentCase,
  referenceRows: readonly TableRow[],
  provider: RecordingProvider,
  executor: DuckDBQueryPlanExecutor,
): Promise<RunRecord> {
  let routingDecision: RoutingDecision | null = null;
  let extractionOutcome: string | null = null;
  let extractedPlan: QueryPlan | null = null;
  let actualRows: readonly TableRow[] | null = null;
  let planMatches: boolean | null = null;
  let rowsMatch: boolean | null = null;
  let failureCategory: FailureCategory | null = null;
  let failureDetail: string | null = null;

  try {
    const result = await runCommerceAnalysis(
      provider,
      executor,
      experimentCase.question,
      {
        routerVersion: ROUTER_VERSION,
        extractionPromptVersion: EXTRACTION_VERSION,
      },
    );

    routingDecision = result.routingDecision;
    if (result.outcome === "routed") {
      failureCategory = "routing_failure";
      failureDetail = `Expected analytics route, received ${result.routingDecision.route}`;
    } else if (result.outcome === "rejected") {
      extractionOutcome = result.extraction.outcome;
      failureCategory = "extraction_failure";
      failureDetail = describeExtractionFailure(result.extraction);
    } else {
      extractionOutcome = "query_plan";
      extractedPlan = result.queryPlan;
      actualRows = result.tableRows;
      planMatches = isDeepStrictEqual(
        result.queryPlan,
        experimentCase.expectedPlan,
      );
      rowsMatch =
        isDeepStrictEqual(result.tableRows, experimentCase.expectedRows) &&
        isDeepStrictEqual(result.tableRows, referenceRows);

      if (!planMatches) {
        failureCategory = "plan_mismatch";
        failureDetail = "Extracted QueryPlan did not exactly match the expected plan";
      } else if (!rowsMatch) {
        failureCategory = "numerical_mismatch";
        failureDetail = "Executed rows did not match the expected rows";
      }
    }
  } catch (error) {
    routingDecision = routingDecisionFromRecordedCalls(provider.calls);
    extractedPlan = planFromRecordedExtraction(provider.calls);
    extractionOutcome = extractedPlan === null ? null : "query_plan";
    planMatches =
      extractedPlan === null
        ? null
        : isDeepStrictEqual(extractedPlan, experimentCase.expectedPlan);
    failureCategory =
      provider.calls.length < 2 ? "routing_failure" : "execution_failure";
    failureDetail = describeError(error);
  }

  return {
    timestamp: new Date().toISOString(),
    experiment: EXPERIMENT,
    caseId: experimentCase.id,
    question: experimentCase.question,
    routerVersion: ROUTER_VERSION,
    extractionPromptVersion: EXTRACTION_VERSION,
    expectedPlan: experimentCase.expectedPlan,
    extractedPlan,
    routingDecision,
    extractionOutcome,
    referenceSql: experimentCase.referenceSql,
    referenceRows,
    expectedRows: experimentCase.expectedRows,
    actualRows,
    planMatches,
    rowsMatch,
    pass: failureCategory === null,
    failureCategory,
    failureDetail,
    providerCalls: provider.calls,
  };
}

async function verifyFrozenCases(): Promise<Map<string, readonly TableRow[]>> {
  const ids = new Set<string>();
  const instance = await DuckDBInstance.create(databasePath, {
    access_mode: "READ_ONLY",
  });
  const connection = await instance.connect();
  const references = new Map<string, readonly TableRow[]>();

  try {
    for (const experimentCase of cases) {
      if (ids.has(experimentCase.id)) {
        throw new Error(`Duplicate experiment case ID: ${experimentCase.id}`);
      }
      ids.add(experimentCase.id);
      parseQueryPlan(experimentCase.expectedPlan);
      compileQueryPlan(experimentCase.expectedPlan);

      const reader = await connection.runAndReadAll(experimentCase.referenceSql);
      const referenceRows = toTableRows(reader.getRowObjectsJson());
      if (!isDeepStrictEqual(referenceRows, experimentCase.expectedRows)) {
        throw new Error(
          `${experimentCase.id} reference rows do not match independently defined expected rows`,
        );
      }
      references.set(experimentCase.id, referenceRows);
    }
  } finally {
    try {
      connection.closeSync();
    } finally {
      instance.closeSync();
    }
  }

  return references;
}

function expectedPlan(
  dateRange: QueryPlan["dateRange"],
  region?: "North" | "South" | "East" | "West",
): QueryPlan {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: {
      kind: "specified",
      items:
        region === undefined
          ? []
          : [{ field: "region", operator: "eq", value: region }],
    },
    dateRange,
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "none" },
  };
}

function planFromRecordedExtraction(
  calls: readonly ProviderCallRecord[],
): QueryPlan | null {
  const rawOutput = calls.find(({ stage }) => stage === "extraction")?.rawOutput;
  if (rawOutput == null) return null;

  try {
    const parsed = queryPlanOutputSchema.safeParse(JSON.parse(rawOutput));
    return parsed.success && parsed.data.outcome === "query_plan"
      ? parsed.data.queryPlan
      : null;
  } catch {
    return null;
  }
}

function routingDecisionFromRecordedCalls(
  calls: readonly ProviderCallRecord[],
): RoutingDecision | null {
  const rawOutput = calls.find(({ stage }) => stage === "routing")?.rawOutput;
  return rawOutput === "analytics"
    ? { routerVersion: ROUTER_VERSION, route: "analytics" }
    : null;
}

function describeExtractionFailure(
  extraction: Exclude<
    Awaited<ReturnType<typeof runCommerceAnalysis>>,
    { outcome: "routed" | "completed" }
  >["extraction"],
): string {
  if ("error" in extraction) return extraction.error;
  if ("refusal" in extraction) return extraction.refusal;
  if ("reason" in extraction) return extraction.reason;
  return extraction.issues.map(({ message }) => message).join("; ");
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = "code" in error ? ` [${String(error.code)}]` : "";
  return `${error.name}${code}: ${error.message}`;
}

async function ensureResultsDoNotExist(): Promise<void> {
  try {
    await access(resultsUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Refusing to overwrite existing results: ${resultsUrl.pathname}`,
  );
}

function toTableRows(
  rows: readonly Readonly<Record<string, Json>>[],
): readonly TableRow[] {
  return rows.map((row) => {
    const tableRow: Record<string, TableCell> = {};
    for (const [column, value] of Object.entries(row)) {
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new Error(
          `Reference SQL returned a non-scalar value for ${JSON.stringify(column)}`,
        );
      }
      tableRow[column] = value;
    }
    return tableRow;
  });
}

function createRecordingProvider(provider: ModelProvider): RecordingProvider {
  const calls: ProviderCallRecord[] = [];

  return {
    calls,
    async generate(request: ModelRequest): Promise<ModelResult> {
      const requestIndex = calls.length + 1;
      const stage = requestIndex === 1 ? "routing" : "extraction";
      const startedAt = performance.now();

      try {
        const result = await provider.generate(request);
        calls.push({
          requestIndex,
          stage,
          temperature: request.temperature ?? null,
          maxTokens: request.maxTokens ?? null,
          responseFormat: request.responseFormat?.name ?? null,
          rawOutput: result.text,
          model: result.metadata.model,
          latencyMs: result.metadata.latencyMs,
          tokenUsage: result.metadata.tokenUsage,
          requestId: result.metadata.requestId,
          finishReason: result.finishReason ?? null,
          refusal: result.refusal ?? null,
          error: null,
        });
        return result;
      } catch (error) {
        calls.push({
          requestIndex,
          stage,
          temperature: request.temperature ?? null,
          maxTokens: request.maxTokens ?? null,
          responseFormat: request.responseFormat?.name ?? null,
          rawOutput: null,
          model: null,
          latencyMs: Math.round(performance.now() - startedAt),
          tokenUsage: null,
          requestId: null,
          finishReason: null,
          refusal: null,
          error: describeError(error),
        });
        throw error;
      }
    },
  };
}
