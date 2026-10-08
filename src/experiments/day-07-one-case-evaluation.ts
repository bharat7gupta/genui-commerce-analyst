import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";

import type { ModelProvider, ModelResult } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import {
  runCommerceAnalysis,
  type CommerceAnalysisResult,
  type QueryPlanExecutor,
  type TableRow,
} from "../application/commerce-analysis-pipeline.js";
import { config } from "../config.js";
import {
  DuckDBQueryPlanExecutor,
  DuckDBDateIntervalLimitError,
} from "../db/duckdb-query-plan-executor.js";
import { compileQueryPlan } from "../db/query-plan-sql-compiler.js";
import { databasePath } from "../db/connection.js";
import { supportedAnalyticsCases, type SupportedAnalyticsCase } from "../evals/supported-analytics-cases.js";
import { gradePlanMeaning } from "../evals/plan-meaning-grader.js";
import { gradeScalarNumericalResult } from "../evals/scalar-numerical-grader.js";
import {
  QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
  queryPlanOutputSchema,
} from "../query-plan/query-plan-extraction.js";
import { parseQueryPlan, queryPlanSchema, validateQueryPlan, type QueryPlan } from "../query-plan/query-plan.js";
import { ROUTE_LABELS } from "../routing/router-v1-prompt.js";

// Five supported cases, sequentially, one invocation each; no retries or repairs.
const extractionVersion = process.argv[2] ?? "query-plan-extractor-v2";
if (extractionVersion !== "query-plan-extractor-v2" && extractionVersion !== "query-plan-extractor-v3") {
  throw new Error("Expected query-plan-extractor-v2 or query-plan-extractor-v3");
}
const options = {
  routerVersion: "router-v3",
  extractionPromptVersion: extractionVersion,
} as const;
const split = process.argv[3] ?? "development";
if (split !== "development" && split !== "held_out") {
  throw new Error("Expected development or held_out split");
}
if (split === "held_out" && extractionVersion !== "query-plan-extractor-v3") {
  throw new Error("The frozen held-out run requires query-plan-extractor-v3");
}
const heldoutDatasetUrl = new URL("../../evals/analytics/heldout-cases-v1.jsonl", import.meta.url);
let datasetSha256: string | null = null;
let evaluationCases: readonly SupportedAnalyticsCase[] = supportedAnalyticsCases;
if (split === "held_out") {
  const preparation = z.object({
    datasetSha256: z.string(), frozenSourceChecksums: z.record(z.string(), z.string()),
  }).parse(JSON.parse(await readFile(new URL(
    "../../results/day-07-heldout-preparation-2026-10-07T17-34-15-917Z-85e161a7-c9d0-42b2-8917-e4fbcdd4aae0.json",
    import.meta.url,
  ), "utf8")));
  const dataset = await readFile(heldoutDatasetUrl);
  datasetSha256 = createHash("sha256").update(dataset).digest("hex");
  if (datasetSha256 !== preparation.datasetSha256) {
    throw new Error("Held-out dataset does not match its recorded SHA-256; no model calls made");
  }
  for (const [path, expectedHash] of Object.entries(preparation.frozenSourceChecksums)) {
    const actualHash = createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Frozen source changed: ${path}`);
  }
  const absentKinds = z.array(z.enum(["none", "unspecified"])).min(1);
  const caseSchema = z.object({
    id: z.string().min(1), category: z.enum(["date_interval", "region_filter", "paraphrase"]),
    split: z.literal("held_out"), question: z.string().min(1), expectedRoute: z.literal("analytics"),
    expectedPlan: queryPlanSchema,
    acceptableAbsentOperationKinds: z.object({
      comparison: absentKinds, ordering: absentKinds, limit: absentKinds, visualization: absentKinds,
    }).strict(),
    expectedRows: z.array(z.object({ net_revenue: z.string() }).strict()).length(1),
    numericalExpectation: z.object({ field: z.literal("net_revenue"), amount: z.string() }).strict(),
    referenceSql: z.string().min(1), referenceVerification: z.string().min(1),
  }).strict();
  evaluationCases = dataset.toString("utf8").trim().split(/\r?\n/).map((line) => caseSchema.parse(JSON.parse(line)));
  if (evaluationCases.length !== 5 || new Set(evaluationCases.map(({ id }) => id)).size !== 5) {
    throw new Error("Expected exactly five unique frozen held-out cases");
  }
  for (const evaluationCase of evaluationCases) parseQueryPlan(evaluationCase.expectedPlan);
}
type Check = {
  status: "pass" | "fail" | "not_reached" | "not_observable";
  reason: string;
};
const unavailable = (reason: string): Check => ({ status: "not_reached", reason });
const verdict = (pass: boolean, reason: string): Check => ({
  status: pass ? "pass" : "fail", reason,
});
const describeError = (error: unknown): string => error instanceof Error
  ? `${error.name}${"code" in error ? ` [${String(error.code)}]` : ""}: ${error.message}`
  : String(error);
const sourceUrls = [
  new URL("../../data/seed.sql", import.meta.url),
  new URL("../routing/router-v3-prompt.ts", import.meta.url),
  new URL("../query-plan/query-plan-extraction-v2-prompt.ts", import.meta.url),
  new URL("../query-plan/query-plan-extraction-v3-prompt.ts", import.meta.url),
  new URL("../evals/august-net-revenue-case.ts", import.meta.url),
  new URL("../evals/supported-analytics-cases.ts", import.meta.url),
  new URL("../evals/plan-meaning-grader.ts", import.meta.url),
  new URL("../evals/scalar-numerical-grader.ts", import.meta.url),
  new URL("../query-plan/query-plan.ts", import.meta.url),
  new URL("../query-plan/query-plan-extraction.ts", import.meta.url),
  new URL("../db/query-plan-sql-compiler.ts", import.meta.url),
];
if (split === "held_out") sourceUrls.push(heldoutDatasetUrl);
async function checksums() {
  return Object.fromEntries(await Promise.all(sourceUrls.map(async (url) => [
    url.pathname.split("/").at(-1),
    createHash("sha256").update(await readFile(url)).digest("hex"),
  ])));
}

const timestamp = new Date().toISOString();
const runDirectory = new URL(
  `../../results/day-07-five-cases-${split}-${extractionVersion}-${timestamp.replace(/[:.]/g, "-")}-${randomUUID()}/`,
  import.meta.url,
);
const frozenChecksums = await checksums();
// Reserve fresh artifacts and check data before making any model call.
await mkdir(runDirectory);
if (config.model.model !== "qwen3.5:4b" || config.model.reasoningEffort !== "none") {
  throw new Error("This comparison requires qwen3.5:4b and reasoning effort none");
}
try {
  const preflight = await verifyDatabaseAgainstSeed();
  await writeFile(new URL("preflight.json", runDirectory), `${JSON.stringify({ ...preflight, split, datasetSha256 }, null, 2)}\n`, { flag: "wx" });
} catch (error) {
  const stopped = { status: "fail", reason: describeError(error), modelCalls: 0 };
  await writeFile(new URL("preflight.json", runDirectory), `${JSON.stringify(stopped, null, 2)}\n`, { flag: "wx" });
  console.error(JSON.stringify({ ...stopped, artifact: runDirectory.pathname }));
  throw error;
}
const underlyingProvider = new QwenProvider(config.model);

async function evaluateCase(evaluationCase: SupportedAnalyticsCase) {
  const timestamp = new Date().toISOString();
  const caseDirectory = new URL(`${evaluationCase.id}/`, runDirectory);
  await mkdir(caseDirectory);
  const callsUrl = new URL("calls.jsonl", caseDirectory);
  await writeFile(callsUrl, "", { flag: "wx" });
  const providerResults: (ModelResult | null)[] = [];
  const providerErrors: (string | null)[] = [];
  const provider: ModelProvider = {
    async generate(request) {
      const stage = providerResults.length === 0 ? "routing" : "extraction";
      const started = performance.now();
      let response: ModelResult | null = null;
      let error: string | null = null;
      try {
        response = await underlyingProvider.generate(request);
        return response;
      } catch (caught) {
        error = describeError(caught);
        throw caught;
      } finally {
        providerResults.push(response);
        providerErrors.push(error);
        await appendFile(callsUrl, `${JSON.stringify({
          stage, timestamp: new Date().toISOString(),
          settings: {
            temperature: request.temperature ?? null,
            maxTokens: request.maxTokens ?? null,
            responseFormat: request.responseFormat?.name ?? null,
          },
          rawOutput: response?.text ?? null,
          metadata: response?.metadata ?? null,
          finishReason: response?.finishReason ?? null,
          refusal: response?.refusal ?? null,
          elapsedMs: Math.round(performance.now() - started), error,
        })}\n`);
      }
    },
  };

  let compilation: Check = unavailable("Executor was not invoked");
  let databaseExecution: Check = unavailable("Executor was not invoked");
  let executionError: { stage: string; message: string } | null = null;
  let executionLatencyMs: number | null = null;
  let actualRows: readonly TableRow[] | null = null;
  let executorPlan: QueryPlan | null = null;
  const underlyingExecutor = new DuckDBQueryPlanExecutor();
  const executor: QueryPlanExecutor = {
    async execute(plan) {
      executorPlan = plan;
      const started = performance.now();
      try {
        // Observe compilation independently before delegating to the unchanged executor.
        compileQueryPlan(plan);
        compilation = verdict(true, "QueryPlan compiled successfully");
      } catch (error) {
        compilation = verdict(false, describeError(error));
        databaseExecution = unavailable("Compilation failed before database execution");
        executionError = { stage: "compilation", message: describeError(error) };
        throw error;
      }
      try {
        actualRows = await underlyingExecutor.execute(plan);
        databaseExecution = verdict(true, "DuckDB executor completed and returned rows");
        return actualRows;
      } catch (error) {
        const policyFailure = error instanceof DuckDBDateIntervalLimitError;
        executionError = {
          stage: policyFailure ? "execution_policy" : "executor",
          message: describeError(error),
        };
        databaseExecution = policyFailure
          ? unavailable("Date policy rejected the plan before opening DuckDB")
          : verdict(false, `${describeError(error)} (executor does not expose the precise internal stage)`);
        throw error;
      } finally {
        executionLatencyMs = Math.round(performance.now() - started);
      }
    },
  };

  let result: CommerceAnalysisResult | null = null;
  let pipelineError: string | null = null;
  const started = performance.now();
  try {
    result = await runCommerceAnalysis(provider, executor, evaluationCase.question, options);
  } catch (error) {
    pipelineError = describeError(error);
  }
  const pipelineLatencyMs = Math.round(performance.now() - started);

  // Captured text alone is not proof of validation: revalidate recovered evidence.
  const routeText = providerResults[0]?.text ?? null;
  const observedRoute = result?.routingDecision.route ??
    (ROUTE_LABELS.find((label) => label === routeText) ?? null);
  const routing = verdict(
    observedRoute === evaluationCase.expectedRoute,
    observedRoute === null
      ? providerErrors[0] ?? `Invalid route output: ${JSON.stringify(routeText)}`
      : `Expected ${evaluationCase.expectedRoute}; observed ${observedRoute}`,
  );
  let schemaValidation: Check = unavailable("Extraction was not invoked");
  let businessRuleValidation: Check = unavailable("No structurally valid QueryPlan available");
  let validatedPlan: QueryPlan | null = null;
  let validationErrors: unknown[] = [];
  const extractionResponse = providerResults[1];
  if (providerResults.length > 1) {
    schemaValidation = unavailable("Extraction produced no usable plan response");
    if (extractionResponse === null || extractionResponse === undefined) {
      schemaValidation = unavailable(providerErrors[1] ?? "Extraction provider failed");
    } else if (extractionResponse.refusal != null ||
      (extractionResponse.finishReason != null && extractionResponse.finishReason !== "stop")) {
      schemaValidation = unavailable("Extraction refused or did not complete normally");
    } else {
      try {
        const parsed: unknown = JSON.parse(extractionResponse.text);
        const envelope = queryPlanOutputSchema.safeParse(parsed);
        if (!envelope.success) {
          validationErrors = envelope.error.issues;
          schemaValidation = verdict(false, "Extraction envelope/QueryPlan schema validation failed");
        } else if (envelope.data.outcome !== "query_plan") {
          schemaValidation = unavailable(`Extraction returned ${envelope.data.outcome}: ${envelope.data.reason}`);
        } else {
          schemaValidation = verdict(true, "Recorded extraction passed strict envelope and plan schemas");
          const validation = validateQueryPlan(envelope.data.queryPlan);
          if (validation.success) {
            businessRuleValidation = verdict(true, "QueryPlan business rules passed");
            validatedPlan = validation.data;
          } else {
            validationErrors = validation.issues;
            businessRuleValidation = verdict(false, "QueryPlan business-rule validation failed");
          }
        }
      } catch (error) {
        schemaValidation = verdict(false, `Malformed JSON: ${describeError(error)}`);
        validationErrors = [schemaValidation.reason];
      }
    }
  }
  // If execution was entered, validation occurred; use its validated input if
  // recording is unavailable. Never label a lost executed stage not_reached.
  if (executorPlan !== null && validatedPlan === null) {
    const validation = validateQueryPlan(executorPlan);
    if (validation.success) {
      validatedPlan = validation.data;
      schemaValidation = verdict(true, "Recovered executor input passed QueryPlan schema");
      businessRuleValidation = verdict(true, "Recovered executor input passed business rules");
    } else {
      schemaValidation = { status: "not_observable", reason: "Executor ran but its validated input could not be recovered" };
      businessRuleValidation = { status: "not_observable", reason: schemaValidation.reason };
    }
  }
  const meaningVerdict = validatedPlan === null ? null : gradePlanMeaning(validatedPlan, evaluationCase);
  const planMeaning = meaningVerdict === null
    ? unavailable("No validated QueryPlan available to grade")
    : { ...verdict(meaningVerdict.pass, meaningVerdict.reason), mismatches: meaningVerdict.mismatches };
  const numericalVerdict = actualRows === null ? null
    : gradeScalarNumericalResult(actualRows, evaluationCase.numericalExpectation);
  const numericalResult = numericalVerdict === null
    ? unavailable("No database rows returned")
    : verdict(numericalVerdict.pass, numericalVerdict.reason);
  const afterChecksums = await checksums();
  const unchangedInputs = JSON.stringify(frozenChecksums) === JSON.stringify(afterChecksums);
  const overallPass = [routing, schemaValidation, businessRuleValidation, planMeaning,
    compilation, databaseExecution, numericalResult].every(({ status }) => status === "pass") && unchangedInputs;
  const report = {
    timestamp, caseId: evaluationCase.id, category: evaluationCase.category, question: evaluationCase.question,
    split, datasetSha256,
    configuration: {
      model: config.model.model, reasoningEffort: config.model.reasoningEffort,
      ...options,
      routing: { temperature: 0, maxTokens: 8 },
      extraction: QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
    },
    expectedRoute: evaluationCase.expectedRoute, expectedPlan: evaluationCase.expectedPlan,
    expectedRows: evaluationCase.expectedRows,
    checksums: { before: frozenChecksums, after: afterChecksums, unchanged: unchangedInputs },
    observedRoute, routing,
    extractionOutcome: result?.outcome === "rejected" ? result.extraction.outcome :
      validatedPlan !== null ? "query_plan" : null,
    schemaValidation, businessRuleValidation, validationErrors,
    validatedPlan, planMeaning,
    compilation, databaseExecution, executionError, actualRows, numericalResult,
    pipelineOutcome: result?.outcome ?? null, pipelineError,
    pipelineLatencyMs, executionLatencyMs,
    providerMetadata: providerResults.map((response, index) => ({
      stage: index === 0 ? "routing" : "extraction",
      metadata: response?.metadata ?? null,
      error: providerErrors[index] ?? null,
    })),
    overall: verdict(overallPass, overallPass ? "All required checks passed" : "One or more required checks did not pass"),
    callsArtifact: "calls.jsonl",
  };
  await writeFile(new URL("result.json", caseDirectory), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(`${evaluationCase.id}: ${report.overall.status} (route=${observedRoute}, schema=${schemaValidation.status}, meaning=${planMeaning.status}, numerical=${numericalResult.status})`);
  return report;
}
// Compare complete relevant rows, not just sums: changed rows can cancel out.
async function verifyDatabaseAgainstSeed() {
  const seed = await readFile(new URL("../../data/seed.sql", import.meta.url), "utf8");
  const seedSha256 = createHash("sha256").update(seed).digest("hex");
  if (seedSha256 !== "18f4ddd475ab0274ebe904412519d049e10f3850d42ca0fca0f70a78ab52ced2") {
    throw new Error("Seed checksum differs from the seed used to establish case expectations");
  }
  const seeded = await DuckDBInstance.create(":memory:");
  try {
    const seedConnection = await seeded.connect();
    try {
      await seedConnection.run(seed);
      const live = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
      try {
        const liveConnection = await live.connect();
        try {
          const sql = `SELECT * FROM orders
WHERE order_date >= DATE '2025-08-01' AND order_date < DATE '2025-10-01'
ORDER BY order_id;`;
          const seededRows = (await seedConnection.runAndReadAll(sql)).getRowObjectsJson();
          const liveRows = (await liveConnection.runAndReadAll(sql)).getRowObjectsJson();
          if (!isDeepStrictEqual(liveRows, seededRows)) {
            throw new Error("Live database rows in [2025-08-01, 2025-10-01) differ from seed rows");
          }
          // Recheck independently authored references against declared expectations.
          const references = [];
          for (const evaluationCase of evaluationCases) {
            const rows = (await liveConnection.runAndReadAll(evaluationCase.referenceSql)).getRowObjectsJson();
            if (!isDeepStrictEqual(rows, evaluationCase.expectedRows)) {
              throw new Error(`${evaluationCase.id}: reference rows differ from declared expectations`);
            }
            references.push({ caseId: evaluationCase.id, rows });
          }
          return {
            status: "pass", seedSha256, relevantInterval: "[2025-08-01, 2025-10-01)",
            matchedRowCount: liveRows.length, comparison: "All columns, ordered by order_id",
            rowsSha256: createHash("sha256").update(JSON.stringify(liveRows)).digest("hex"),
            references,
          };
        } finally { liveConnection.closeSync(); }
      } finally { live.closeSync(); }
    } finally { seedConnection.closeSync(); }
  } finally { seeded.closeSync(); }
}

const reports: Awaited<ReturnType<typeof evaluateCase>>[] = [];
for (const evaluationCase of evaluationCases) {
  reports.push(await evaluateCase(evaluationCase));
}
const checkNames = [
  "routing", "schemaValidation", "businessRuleValidation", "planMeaning",
  "compilation", "databaseExecution", "numericalResult",
] as const;
const checkCounts = Object.fromEntries(checkNames.map((name) => {
  const counts = { passed: 0, failed: 0, not_reached: 0, not_observable: 0 };
  for (const report of reports) {
    const status = report[name].status;
    if (status === "pass") counts.passed += 1;
    else if (status === "fail") counts.failed += 1;
    else counts[status] += 1;
  }
  return [name, {
    ...counts,
    gradingDenominator: counts.passed + counts.failed,
    passFraction: `${counts.passed}/${counts.passed + counts.failed}`,
    totalCases: reports.length,
  }];
}));
const summary = {
  timestamp, configuration: reports[0]?.configuration,
  split, datasetSha256,
  overall: {
    passed: reports.filter(({ overall }) => overall.status === "pass").length,
    total: reports.length,
    failedRequests: reports.filter(({ overall }) => overall.status === "fail").length,
  },
  checkCounts,
  cases: reports.map((report) => ({
    caseId: report.caseId, category: report.category, observedRoute: report.observedRoute,
    split: report.split, datasetSha256: report.datasetSha256,
    checks: Object.fromEntries(checkNames.map((name) => [name, report[name]])),
    actualRows: report.actualRows, overall: report.overall,
    artifact: `${report.caseId}/result.json`,
  })),
};
await writeFile(new URL("summary.json", runDirectory), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ...summary, artifact: new URL("summary.json", runDirectory).pathname }, null, 2));
