import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { databasePath } from "../db/connection.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";
import { investigateMetricChangeFromText, INVESTIGATION_MODEL_SETTINGS, investigationExtractionJsonSchema, type NaturalLanguageInvestigationResult } from "../application/natural-language-investigation.js";
import { INVESTIGATION_PROMPT_VERSION, INVESTIGATION_SYSTEM_PROMPT } from "../application/investigation-extraction-v1-prompt.js";
import { investigationDevelopmentSchema, gradeInvestigationDevelopmentCase, type InvestigationNumericalReference, type InvestigationDevelopmentCase } from "../evals/investigation-development.js";
import { apiCost, readApiPricing, recordingInvestigationProvider } from "./investigation-recorder.js";

const datasetPath = "evals/investigation/development-v1.json";
const dataset = investigationDevelopmentSchema.parse(JSON.parse(await readFile(new URL(`../../${datasetPath}`, import.meta.url), "utf8")));
const previousPath = "results/day-15-natural-language-investigation-2026-10-13T07-06-15.274Z-97f07c21-b812-4f52-8bcb-242de074328b";
const files = [datasetPath, "src/application/investigation-extraction-v1-prompt.ts", "src/application/natural-language-investigation.ts",
  "src/application/investigate-metric-change.ts", "src/application/compare-periods.ts", "src/application/compare-net-revenue-by-region.ts",
  "src/decimal.ts", "src/db/query-plan-sql-compiler.ts", "src/db/duckdb-query-plan-executor.ts", "src/query-plan/query-plan.ts",
  "src/tools/get-metric-definition.ts", "src/ai/qwen-provider.ts", "src/ai/provider.ts", "src/config.ts",
  "src/evals/investigation-development.ts", "src/experiments/investigation-recorder.ts", "src/experiments/day-15-investigation-development.ts", "data/seed.sql",
  ...(await readdir(new URL(`../../${previousPath}/`, import.meta.url))).map((name) => `${previousPath}/${name}`)];
async function checksums() {
  return Object.fromEntries(await Promise.all(files.map(async (path) => [path,
    createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex")])));
}

// Handwritten reference SQL is independent of the application compiler.
// The join is between unique per-region aggregates, never raw orders.
const regionSql = `
  WITH b AS (
    SELECT region, SUM(gross_amount - discount_amount - refund_amount) AS net
    FROM orders WHERE order_date >= CAST(? AS DATE) AND order_date < CAST(? AS DATE) GROUP BY region
  ), t AS (
    SELECT region, SUM(gross_amount - discount_amount - refund_amount) AS net
    FROM orders WHERE order_date >= CAST(? AS DATE) AND order_date < CAST(? AS DATE) GROUP BY region
  )
  SELECT COALESCE(b.region, t.region) AS region,
    b.region IS NOT NULL AS baselinePresent, t.region IS NOT NULL AS targetPresent,
    b.net AS baselineValue, t.net AS targetValue,
    CASE WHEN (b.region IS NOT NULL AND b.net IS NULL) OR (t.region IS NOT NULL AND t.net IS NULL)
      THEN NULL ELSE COALESCE(t.net, 0) - COALESCE(b.net, 0) END AS absoluteChange
  FROM b FULL OUTER JOIN t ON b.region = t.region ORDER BY region;
`;
const totalSql = `
  WITH b AS (
    SELECT SUM(gross_amount - discount_amount - refund_amount) AS net
    FROM orders WHERE order_date >= CAST(? AS DATE) AND order_date < CAST(? AS DATE)
  ), t AS (
    SELECT SUM(gross_amount - discount_amount - refund_amount) AS net
    FROM orders WHERE order_date >= CAST(? AS DATE) AND order_date < CAST(? AS DATE)
  )
  SELECT b.net AS baselineValue, t.net AS targetValue, t.net - b.net AS absoluteChange,
    CAST(ROUND(CASE WHEN b.net = 0 THEN NULL ELSE 100 * (t.net - b.net) / b.net END, 2) AS DECIMAL(38, 2)) AS percentageChange
  FROM b CROSS JOIN t;
`;
async function verifyReferences() {
  const live = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
  const seed = await DuckDBInstance.create(":memory:");
  const connection = await live.connect();
  const seedConnection = await seed.connect();
  try {
    await seedConnection.run(await readFile(new URL("../../data/seed.sql", import.meta.url), "utf8"));
    const liveRows = (await connection.runAndReadAll("SELECT * FROM orders ORDER BY order_id")).getRowObjectsJson();
    const seedRows = (await seedConnection.runAndReadAll("SELECT * FROM orders ORDER BY order_id")).getRowObjectsJson();
    if (!isDeepStrictEqual(liveRows, seedRows)) throw new Error("Live database differs from the deterministic seed");
    const references = [];
    for (const [id, expected] of Object.entries(dataset.numericalReferences)) {
      const parameters = [expected.baseline.start, expected.baseline.end, expected.target.start, expected.target.end];
      const totals = (await connection.runAndReadAll(totalSql, parameters)).getRowObjectsJson();
      const segments = (await connection.runAndReadAll(regionSql, parameters)).getRowObjectsJson();
      const declaredTotals = [{ baselineValue: expected.baselineValue, targetValue: expected.targetValue,
        absoluteChange: expected.absoluteChange, percentageChange: expected.percentageChange }];
      if (!isDeepStrictEqual(totals, declaredTotals) || !isDeepStrictEqual(segments, expected.segments)) {
        throw new Error(`Independent SQL does not match declared expectations: ${id}`);
      }
      references.push({ id, parameters, totals, segments, verified: true });
    }
    return { matchedSeedRows: liveRows.length, references, regionSql, totalSql,
      verificationSqlExcludedFromWorkflowCounts: true };
  } finally { connection.closeSync(); seedConnection.closeSync(); live.closeSync(); seed.closeSync(); }
}

const before = await checksums();
const previousProtocol = z.object({ checksums: z.record(z.string(), z.string()) }).parse(
  JSON.parse(await readFile(new URL(`../../${previousPath}/protocol.json`, import.meta.url), "utf8")));
if (before["src/application/investigation-extraction-v1-prompt.ts"] !== previousProtocol.checksums["src/application/investigation-extraction-v1-prompt.ts"]) {
  throw new Error("investigation-extractor-v1 differs from the earlier three-request run");
}
const referenceVerification = await verifyReferences();
const pricing = readApiPricing();
const directory = new URL(`../../results/day-15-investigation-development-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}/`, import.meta.url);
await mkdir(directory);
const gradingRules = {
  outcome: "Exact declared outcome", extraction: "All four extracted inputs exact; unresolved-question presence exact; question wording ungraded",
  numerical: "All scalar values, percentage, regional values/presence/change exact against independently SQL-verified declarations; not reached distinct from wrong",
  sql: "Four workflow queries for completed requests; zero for clarification/unsupported",
  misleading: "Require verified increase, no-cause caveat, definition source, and no asserted decline/campaign causation; inspect each summary manually",
  equalPeriods: "Expected completed zero-change analytical intent; existing non-overlap restriction is a predeclared known capability gap",
};
await writeFile(new URL("protocol.json", directory), JSON.stringify({
  label: "development baseline", dataset, gradingRules, referenceVerification,
  promptVersion: INVESTIGATION_PROMPT_VERSION, systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
  schema: investigationExtractionJsonSchema, model: config.model.model, reasoningEffort: config.model.reasoningEffort,
  settings: INVESTIGATION_MODEL_SETTINGS, repetitions: 1, retries: 0, pricing, checksums: before,
  totalExecutionCost: "Unmeasured; API pricing excludes local compute/hardware/energy costs",
  firstCallColdStartCandidate: dataset.cases[0]?.id,
}, null, 2), { flag: "wx" });
const realProvider = new QwenProvider(config.model);
const realExecutor = new DuckDBQueryPlanExecutor();
type CaseReport = InvestigationDevelopmentCase & NaturalLanguageInvestigationResult & {
  grades: ReturnType<typeof gradeInvestigationDevelopmentCase>;
  sqlExecutionCount: number;
  failedStage: string | null;
  totalLatencyMs: number;
  modelLatencyMs: number;
};
const reports: CaseReport[] = [];
for (const item of dataset.cases) {
  if (!isDeepStrictEqual(before, await checksums())) throw new Error("Frozen inputs changed before model call");
  let sqlExecutionCount = 0;
  const querySteps: { ordinal: number; dimensions: unknown; dateRange: unknown; status: "completed" | "failed"; elapsedMs: number; error: string | null }[] = [];
  const executor: QueryPlanExecutor = { async execute(plan) {
    const started = performance.now();
    const ordinal = ++sqlExecutionCount;
    try {
      const rows = await realExecutor.execute(plan);
      querySteps.push({ ordinal, dimensions: plan.dimensions, dateRange: plan.dateRange, status: "completed", elapsedMs: performance.now() - started, error: null });
      return rows;
    } catch (error) {
      querySteps.push({ ordinal, dimensions: plan.dimensions, dateRange: plan.dateRange, status: "failed", elapsedMs: performance.now() - started, error: String(error) });
      throw error;
    }
  } };
  const provider = recordingInvestigationProvider(realProvider, { caseId: item.id, callsPath: new URL("calls.jsonl", directory),
    model: config.model.model, reasoningEffort: config.model.reasoningEffort, pricing });
  const started = performance.now();
  // Evaluator-only expectations never enter model messages.
  const result = await investigateMetricChangeFromText(provider, item.question, { executor });
  const totalLatencyMs = performance.now() - started;
  const numeric: InvestigationNumericalReference | null = item.numericalReference === null ? null : dataset.numericalReferences[item.numericalReference] ?? null;
  const grades = gradeInvestigationDevelopmentCase(item, result, sqlExecutionCount, numeric);
  const trace = result.investigation?.trace ?? [];
  const failedStage = result.extraction.outcome === "extraction_failed" ? "extract_inputs"
    : result.investigation && "failedStage" in result.investigation ? result.investigation.failedStage : null;
  const report = { ...item, label: "development baseline", ...result, grades, sqlExecutionCount, failedStage,
    steps: [{ stage: "extract_inputs", status: result.extraction.outcome, elapsedMs: result.extraction.latencyMs }, ...trace],
    querySteps, totalLatencyMs, modelLatencyMs: result.extraction.latencyMs,
    tokens: result.extraction.metadata?.tokenUsage ?? null, apiCost: apiCost(pricing, result.extraction.metadata?.tokenUsage ?? null) };
  await writeFile(new URL(`${item.id}.json`, directory), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  reports.push(report);
  console.log(`${item.id} (${item.category}): ${result.outcome}; outcome=${grades.outcome.status}, extraction=${grades.extraction.status}, numerical=${grades.numerical.status}, evidence=${grades.evidence.status}; SQL=${sqlExecutionCount}`);
}
const after = await checksums();
const unchanged = isDeepStrictEqual(before, after);
const categories = ["supported", "ambiguous", "unsupported", "misleading"] as const;
const byCategory = categories.map((category) => {
  const items = reports.filter((item) => item.category === category);
  const checks = Object.fromEntries((["outcome", "extraction", "numerical", "sql", "evidence", "endToEnd"] as const).map((key) => {
    return [key, Object.fromEntries(["pass", "fail", "not_reached", "not_applicable"].map((status) =>
      [status, items.filter((item) => item.grades[key].status === status).length]))];
  }));
  return { category, total: items.length, checks };
});
await writeFile(new URL("report.json", directory), `${JSON.stringify({ label: "development baseline", byCategory, reports,
  checksums: { before, after, unchanged }, previousReportUnchanged: files.filter((file) => file.startsWith(previousPath)).every((file) => before[file] === after[file]) }, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ byCategory, unchanged, artifact: directory.pathname }, null, 2));
if (!unchanged) throw new Error("Frozen inputs/artifacts changed during evaluation");
