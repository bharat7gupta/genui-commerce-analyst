import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";

import { config } from "../config.js";
import { databasePath } from "../db/connection.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { compileQueryPlan } from "../db/query-plan-sql-compiler.js";
import { gradeExtractionOutcome } from "../evals/extraction-outcome-grader.js";
import { gradePlanMeaning, type PlanMeaningRequirements } from "../evals/plan-meaning-grader.js";
import { gradeScalarNumericalResult } from "../evals/scalar-numerical-grader.js";
import { supportedAnalyticsCases } from "../evals/supported-analytics-cases.js";
import { queryPlanOutputSchema } from "../query-plan/query-plan-extraction.js";
import { parseQueryPlan, queryPlanSchema, validateQueryPlan } from "../query-plan/query-plan.js";

const sources = {
  development: "results/day-07-five-cases-query-plan-extractor-v3-2026-10-07T17-21-47-825Z-8c8aac1b-68b9-4469-a2c5-8a8bfa0bf613",
  held_out: "results/day-07-five-cases-held_out-query-plan-extractor-v3-2026-10-07T17-37-48-897Z-c434a973-dbc1-4b00-b41e-32924180bb4d",
};
const configuration = {
  model: config.model.model, reasoningEffort: config.model.reasoningEffort,
  routerVersion: "router-v3", extractionPromptVersion: "query-plan-extractor-v3",
  routing: { temperature: 0, maxTokens: 8 }, extraction: { temperature: 0, maxTokens: 1024 },
};
if (configuration.model !== "qwen3.5:4b" || configuration.reasoningEffort !== "none") throw new Error("Configured model differs from saved v3 runs");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const frozen: Record<string, string> = {};
async function frozenRead(path: string) {
  const text = await readFile(path, "utf8");
  frozen[path] = sha(text);
  return text;
}
const seed = await frozenRead("data/seed.sql");
if (sha(seed) !== "18f4ddd475ab0274ebe904412519d049e10f3850d42ca0fca0f70a78ab52ced2") throw new Error("Seed differs from reference seed");
for (const path of ["src/routing/router-v3-prompt.ts", "src/query-plan/query-plan-extraction-v3-prompt.ts",
  "src/query-plan/query-plan-extraction.ts", "src/query-plan/query-plan.ts", "src/db/query-plan-sql-compiler.ts",
  "src/evals/august-net-revenue-case.ts", "src/evals/supported-analytics-cases.ts", "src/evals/plan-meaning-grader.ts",
  "src/evals/scalar-numerical-grader.ts", "src/application/commerce-analysis-pipeline.ts",
  "src/db/duckdb-query-plan-executor.ts", "src/experiments/day-05-deterministic-numerical-evaluation.ts"]) await frozenRead(path);
const absentKinds = z.array(z.enum(["none", "unspecified"]));
const rowsSchema = z.array(z.object({ net_revenue: z.string().nullable() }).strict());
const caseSchema = z.object({
  id: z.string(), question: z.string(), expectedRoute: z.literal("analytics"), expectedPlan: queryPlanSchema,
  acceptableAbsentOperationKinds: z.object({ comparison: absentKinds, ordering: absentKinds, limit: absentKinds, visualization: absentKinds }),
  expectedRows: rowsSchema.length(1), referenceSql: z.string(),
});
const heldoutText = await frozenRead("evals/analytics/heldout-cases-v1.jsonl");
if (sha(heldoutText) !== "c4929a7c3140879ebd643dfe682eaa5a59880fce74d55395cb347a2f7e373365") throw new Error("Held-out dataset checksum mismatch");
const pipelineCases = [...supportedAnalyticsCases.map(item => ({ ...caseSchema.parse(item), source: sources.development })),
  ...heldoutText.trim().split("\n").map(line => ({ ...caseSchema.parse(JSON.parse(line)), source: sources.held_out }))];

// Independently declared arithmetic scopes; not derived from compiled SQL or model plans.
const scopes = [
  ["2025-08-01", "2025-09-01", null], ["2025-08-01", "2025-09-01", null],
  ["2025-09-01", "2025-10-01", null], ["2025-08-01", "2025-09-01", "North"], ["2025-08-01", "2025-09-01", "South"],
  ["2025-08-05", "2025-08-18", null], ["2025-09-10", "2025-09-24", null],
  ["2025-08-20", "2025-09-14", "East"], ["2025-08-07", "2025-09-18", "West"], ["2025-08-05", "2025-08-18", null],
  ["2025-08-02", "2025-08-04", null], ["2025-10-01", "2025-10-02", "North"],
] as const;
const noOperations: PlanMeaningRequirements["acceptableAbsentOperationKinds"] = {
  comparison: ["none"], ordering: ["none"], limit: ["none"], visualization: ["none"],
};
function executorPlan(start: string, end: string, region?: "North") {
  return parseQueryPlan({ version: "query-plan-v1", metric: { kind: "metric", value: "net_revenue" },
    dateRange: { kind: "interval", start, end }, dimensions: { kind: "specified", values: [] },
    filters: { kind: "specified", items: region ? [{ field: "region", operator: "eq", value: region }] : [] },
    comparison: { kind: "none" }, ordering: { kind: "none" }, limit: { kind: "none" }, visualization: { kind: "none" } });
}
const executorCases = [
  { id: "start-inclusive-end-exclusive", expectedPlan: executorPlan("2025-08-02", "2025-08-04"),
    acceptableAbsentOperationKinds: noOperations, expectedRows: [{ net_revenue: "1100.00" }],
    referenceSql: "SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue FROM orders WHERE order_date >= DATE '2025-08-02' AND order_date < DATE '2025-08-04';" },
  { id: "no-matching-rows", expectedPlan: executorPlan("2025-10-01", "2025-10-02", "North"),
    acceptableAbsentOperationKinds: noOperations, expectedRows: [{ net_revenue: null }],
    referenceSql: "SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue FROM orders WHERE order_date >= DATE '2025-10-01' AND order_date < DATE '2025-10-02' AND region = 'North';" },
];
const allCases = [...pipelineCases, ...executorCases];
const planned = [...(await frozenRead("docs/evals/day-7-dataset-plan.md"))
  .matchAll(/^\| (?:29|3[0-9]|40) \| `([^`]+)`/gm)].map(match => match[1]);
if (allCases.length !== 12 || JSON.stringify(planned) !== JSON.stringify(allCases.map(item => item.id))) throw new Error("Twelve planned numerical case IDs must match in order");
const seedRows = [...seed.matchAll(/\('([^']+)', '([^']+)', DATE '(\d{4}-\d{2}-\d{2})', '([^']+)',\s*'([^']+)',\s*(\d+\.\d{2}),\s*(\d+\.\d{2}),\s*(\d+\.\d{2}),\s*'([^']+)'\)/g)]
  .map(match => ({ id: match[1]!, date: match[3]!, region: match[4]!, gross: BigInt(match[6]!.replace(".", "")),
    discount: BigInt(match[7]!.replace(".", "")), refund: BigInt(match[8]!.replace(".", "")) }));
if (seedRows.length !== 30) throw new Error("Independent seed parser must recover all 30 rows");
const amount = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
function gradeRows(rows: unknown, expectedRows: z.infer<typeof rowsSchema>) {
  const expected = expectedRows[0]?.net_revenue;
  if (expected === undefined) throw new Error("Expected one declared scalar row");
  if (expected === null) {
    // Same exact row comparison and SQL NULL semantics used by the Day 5 evaluator.
    const pass = isDeepStrictEqual(rows, [{ net_revenue: null }]);
    return { pass, reason: pass ? "Exactly one net_revenue row containing SQL NULL" : "Expected exactly [{net_revenue:null}]; zero, absent fields, and other row shapes do not match" };
  }
  return gradeScalarNumericalResult(rows, { field: "net_revenue", amount: expected });
}
const arithmetic = allCases.map((item, index) => {
  const [start, end, region] = scopes[index]!;
  const rows = seedRows.filter(row => row.date >= start && row.date < end && (region === null || row.region === region));
  const gross = rows.reduce((sum, row) => sum + row.gross, 0n);
  const discount = rows.reduce((sum, row) => sum + row.discount, 0n);
  const refund = rows.reduce((sum, row) => sum + row.refund, 0n);
  const expectedRows = [{ net_revenue: rows.length === 0 ? null : amount(gross - discount - refund) }];
  if (!gradeRows(expectedRows, item.expectedRows).pass) throw new Error(`Independent seed arithmetic mismatch: ${item.id}`);
  const canonical = parseQueryPlan(item.expectedPlan);
  if (!isDeepStrictEqual(canonical.dateRange, { kind: "interval", start, end })
      || !isDeepStrictEqual(canonical.filters, { kind: "specified", items: region === null ? [] : [{ field: "region", operator: "eq", value: region }] })) throw new Error(`Declared scope mismatch: ${item.id}`);
  if (!gradePlanMeaning(canonical, item).pass) throw new Error(`Canonical meaning mismatch: ${item.id}`);
  return { caseId: item.id, scope: { start, end, region }, matchedSeedIds: rows.map(row => row.id),
    gross: amount(gross), discounts: amount(discount), refunds: amount(refund), expectedRows };
});
const directory = `results/day-07-numerical-category-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
await mkdir(directory);
const seeded = await DuckDBInstance.create(":memory:");
const live = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
const seedConnection = await seeded.connect();
const liveConnection = await live.connect();
let liveRowsSha256: string;
try {
  await seedConnection.run(seed);
  const sql = "SELECT * FROM orders ORDER BY order_id;";
  const seededRows = (await seedConnection.runAndReadAll(sql)).getRowObjectsJson();
  const liveRows = (await liveConnection.runAndReadAll(sql)).getRowObjectsJson();
  if (!isDeepStrictEqual(liveRows, seededRows)) throw new Error("Live database differs from seed: full ordered rows compared, including possible October rows");
  liveRowsSha256 = sha(JSON.stringify(liveRows));
  const references = [];
  for (const item of allCases) {
    const seedReferenceRows = rowsSchema.parse((await seedConnection.runAndReadAll(item.referenceSql)).getRowObjectsJson());
    const liveReferenceRows = rowsSchema.parse((await liveConnection.runAndReadAll(item.referenceSql)).getRowObjectsJson());
    if (!gradeRows(seedReferenceRows, item.expectedRows).pass || !gradeRows(liveReferenceRows, item.expectedRows).pass) throw new Error(`Handwritten reference SQL mismatch: ${item.id}`);
    references.push({ caseId: item.id, sql: item.referenceSql, seedReferenceRows, liveReferenceRows });
  }
  await writeFile(`${directory}/preflight.json`, JSON.stringify({ status: "pass", configuration,
    seedSha256: sha(seed), liveRowsSha256, matchedRowCount: liveRows.length, rowComparison: "All columns, all dates, ordered by order_id",
    resultRules: { monetary: "One row containing net_revenue; exact decimal equality, equivalent decimal spellings accepted; no rounding or tolerance",
      emptySet: "Exactly [{net_revenue:null}], via existing Day 5 exact row equality; NULL is distinct from zero" },
    arithmetic, references, cases: allCases, sourceSha256: frozen }, null, 2) + "\n", { flag: "wx" });
} catch (error) {
  await writeFile(`${directory}/preflight.json`, JSON.stringify({ status: "fail", reason: String(error), modelCalls: 0, executorCasesRun: 0 }) + "\n", { flag: "wx" });
  throw error;
} finally {
  seedConnection.closeSync(); liveConnection.closeSync(); seeded.closeSync(); live.closeSync();
}

const checkSchema = z.object({ status: z.enum(["pass", "fail", "not_reached", "not_observable"]), reason: z.string(),
  mismatches: z.array(z.object({ field: z.string(), reason: z.string() })).optional() });
type Check = z.infer<typeof checkSchema>;
const passFail = (pass: boolean, reason: string): Check => ({ status: pass ? "pass" : "fail", reason });
const nr = (reason: string): Check => ({ status: "not_reached", reason });
const savedSchema = z.object({ caseId: z.string(), question: z.string(), configuration: z.unknown(), expectedRoute: z.string(),
  expectedPlan: queryPlanSchema, expectedRows: rowsSchema, validatedPlan: queryPlanSchema.nullable(), actualRows: rowsSchema.nullable(),
  checksums: z.object({ before: z.record(z.string(), z.string()), unchanged: z.literal(true) }),
  routing: checkSchema, schemaValidation: checkSchema, businessRuleValidation: checkSchema, planMeaning: checkSchema,
  compilation: checkSchema, databaseExecution: checkSchema, numericalResult: checkSchema, overall: checkSchema,
  executionError: z.unknown(), pipelineError: z.string().nullable(), pipelineLatencyMs: z.number(), providerMetadata: z.unknown(),
});
const callSchema = z.object({ stage: z.enum(["routing", "extraction"]), settings: z.object({ temperature: z.number(), maxTokens: z.number(), responseFormat: z.string().nullable() }),
  rawOutput: z.string().nullable(), metadata: z.unknown(), finishReason: z.string().nullable(), refusal: z.string().nullable(), error: z.string().nullable() });
const pipelineRecords = [];
for (const item of pipelineCases) {
  const preflight = z.object({ status: z.literal("pass"), seedSha256: z.string(), rowsSha256: z.string(), references: z.array(z.object({ caseId: z.string(), rows: rowsSchema })) })
    .parse(JSON.parse(await frozenRead(`${item.source}/preflight.json`)));
  if (preflight.seedSha256 !== sha(seed) || preflight.rowsSha256 !== liveRowsSha256
      || !gradeRows(preflight.references.find(row => row.caseId === item.id)?.rows, item.expectedRows).pass) throw new Error(`Saved data/reference mismatch: ${item.id}; no model retries`);
  const path = `${item.source}/${item.id}/result.json`;
  const saved = savedSchema.parse(JSON.parse(await frozenRead(path)));
  if (saved.caseId !== item.id || saved.question !== item.question || saved.expectedRoute !== item.expectedRoute
      || !isDeepStrictEqual(saved.configuration, configuration) || !isDeepStrictEqual(saved.expectedPlan, item.expectedPlan)
      || !isDeepStrictEqual(saved.expectedRows, item.expectedRows)) throw new Error(`Saved case/configuration/expectation mismatch: ${item.id}; no model retries`);
  // Prompts, contract, compiler, case definitions and the decimal grader must match.
  // Meaning's requested-operation extension is regraded below for compatibility.
  for (const [path, hash] of Object.entries(frozen)) {
    const name = path.split("/").at(-1)!;
    if (name !== "plan-meaning-grader.ts" && name in saved.checksums.before && saved.checksums.before[name] !== hash) throw new Error(`Saved frozen source mismatch: ${item.id}: ${name}`);
  }
  const callsPath = `${item.source}/${item.id}/calls.jsonl`;
  const calls = (await frozenRead(callsPath)).trim().split("\n").map(line => callSchema.parse(JSON.parse(line)));
  for (const call of calls) {
    const settings = call.stage === "routing" ? configuration.routing : configuration.extraction;
    if (call.settings.temperature !== settings.temperature || call.settings.maxTokens !== settings.maxTokens) throw new Error(`Recorded generation setting mismatch: ${item.id}`);
  }
  let envelopeValidity = nr("No completed extraction response available");
  let outcomeCorrectness = nr("No valid extraction envelope available");
  const capture = calls.find(call => call.stage === "extraction");
  if (capture?.rawOutput !== null && capture?.rawOutput !== undefined && capture.refusal === null
      && (capture.finishReason === null || capture.finishReason === "stop") && capture.error === null) {
    let raw: unknown = null;
    try { raw = JSON.parse(capture.rawOutput); } catch { /* Existing envelope schema reports invalid input. */ }
    const envelope = queryPlanOutputSchema.safeParse(raw);
    envelopeValidity = passFail(envelope.success, envelope.success ? "Recorded envelope passed existing schema" : JSON.stringify(envelope.error.issues));
    if (envelope.success) {
      const grade = gradeExtractionOutcome(envelope.data, "query_plan");
      outcomeCorrectness = passFail(grade.pass, grade.reason);
    }
  }
  if (saved.validatedPlan !== null) {
    const validation = validateQueryPlan(saved.validatedPlan);
    if (!validation.success) throw new Error(`Saved validated plan no longer passes validation: ${item.id}`);
    const meaning = gradePlanMeaning(validation.data, item);
    if ((meaning.pass ? "pass" : "fail") !== saved.planMeaning.status
        || !isDeepStrictEqual(meaning.mismatches, saved.planMeaning.mismatches)) throw new Error(`Meaning rules no longer match saved evidence: ${item.id}`);
  }
  const numerical = saved.actualRows === null ? saved.numericalResult : (() => {
    const grade = gradeRows(saved.actualRows, item.expectedRows); return passFail(grade.pass, grade.reason);
  })();
  if (saved.actualRows === null && saved.numericalResult.status !== "not_reached"
      && saved.numericalResult.status !== "not_observable") throw new Error(`Missing rows cannot receive numerical grade: ${item.id}`);
  const checks = { routing: saved.routing, envelopeValidity, outcomeCorrectness, schemaValidation: saved.schemaValidation,
    businessRuleValidation: saved.businessRuleValidation, planMeaning: saved.planMeaning,
    compilation: saved.compilation, databaseExecution: saved.databaseExecution, numericalResult: numerical };
  const overall = passFail(Object.values(checks).every(check => check.status === "pass"), "All pipeline stages are required to pass");
  if (overall.status !== saved.overall.status) throw new Error(`Current checks disagree with original overall verdict: ${item.id}`);
  pipelineRecords.push({ caseId: item.id, target: "full_pipeline", evidence: "reused", sourceArtifact: path, callsArtifact: callsPath,
    reuseVerification: "Exact question, target provenance, v3 configuration, expected plan/rows and source definitions match; current live rows match saved seed/preflight; current meaning regrade agrees with original",
    question: item.question, expectedRows: item.expectedRows, actualRows: saved.actualRows, checks, overall,
    pipelineError: saved.pipelineError, executionError: saved.executionError, pipelineLatencyMs: saved.pipelineLatencyMs,
    providerMetadata: saved.providerMetadata, calls });
}

// Only these two cases are freshly executed, with their model-free declared target.
const executorRecords = [];
for (const item of executorCases) {
  const plan = parseQueryPlan(item.expectedPlan);
  let compilation = nr("Compiler not reached");
  let databaseExecution = nr("Compilation did not complete");
  let numericalResult = nr("No rows produced");
  let referenceAgreement = nr("No rows produced");
  let actualRows: z.infer<typeof rowsSchema> | null = null;
  const started = performance.now();
  try {
    compileQueryPlan(plan);
    compilation = passFail(true, "Canonical plan compiled through real compiler");
    actualRows = rowsSchema.parse(await new DuckDBQueryPlanExecutor().execute(plan));
    databaseExecution = passFail(true, "Real read-only DuckDB executor returned rows");
    const grade = gradeRows(actualRows, item.expectedRows);
    numericalResult = passFail(grade.pass, grade.reason);
    const preflight = z.object({ references: z.array(z.object({ caseId: z.string(), liveReferenceRows: rowsSchema, seedReferenceRows: rowsSchema })) })
      .parse(JSON.parse(await readFile(`${directory}/preflight.json`, "utf8")));
    const reference = preflight.references.find(row => row.caseId === item.id)!;
    referenceAgreement = passFail(gradeRows(actualRows, reference.liveReferenceRows).pass && gradeRows(actualRows, reference.seedReferenceRows).pass,
      "Compared executor rows with independently handwritten live and seeded reference SQL rows");
  } catch (error) {
    if (compilation.status !== "pass") compilation = passFail(false, String(error));
    else databaseExecution = passFail(false, String(error));
  }
  const meaning = gradePlanMeaning(plan, item);
  const checks = { schemaValidation: passFail(true, "Canonical plan schema passed"), businessRuleValidation: passFail(true, "Canonical plan business rules passed"),
    planMeaning: passFail(meaning.pass, meaning.reason), compilation, databaseExecution, numericalResult, referenceAgreement };
  executorRecords.push({ caseId: item.id, target: "executor", evidence: "fresh", modelFree: true, expectedPlan: plan,
    expectedRows: item.expectedRows, actualRows, elapsedMs: Math.round(performance.now() - started), checks,
    overall: passFail(Object.values(checks).every(check => check.status === "pass"), "All executor checks and independent references required to pass") });
}
function numericalCounts(records: readonly { checks: { numericalResult: Check } }[]) {
  const count = (status: Check["status"]) => records.filter(record => record.checks.numericalResult.status === status).length;
  return { passed: count("pass"), failed: count("fail"), not_reached: count("not_reached"), not_observable: count("not_observable"),
    gradingDenominator: count("pass") + count("fail"), totalCases: records.length };
}
for (const [path, hash] of Object.entries(frozen)) if (sha(await readFile(path, "utf8")) !== hash) throw new Error(`Frozen input changed: ${path}`);
const report = { timestamp: new Date().toISOString(), configuration, preflightArtifact: "preflight.json", sourceSha256: frozen, sourcesUnchanged: true,
  freshModelCalls: 0, reusedPipelineRequests: 10, freshExecutorCases: 2,
  executor: { success: { passed: executorRecords.filter(row => row.overall.status === "pass").length, total: 2 }, numericalCounts: numericalCounts(executorRecords), cases: executorRecords },
  fullPipeline: { success: { passed: pipelineRecords.filter(row => row.overall.status === "pass").length, total: 10 }, numericalCounts: numericalCounts(pipelineRecords), cases: pipelineRecords },
  numericalCountsAllTargets: numericalCounts([...executorRecords, ...pipelineRecords]),
  note: "Targets preserved. Only original unedited v3 pipeline observations reused; no prompt-version mixing, no model retries, no revised original verdicts. Prior held-out cases are exposed regression. Monetary comparison has no rounding/tolerance; SQL NULL uses existing Day 5 exact row equality. Meaning's task-17 extension was checked for identical verdicts on these absent-operation cases." };
await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ directory, executor: { success: report.executor.success, numericalCounts: report.executor.numericalCounts },
  fullPipeline: { success: report.fullPipeline.success, numericalCounts: report.fullPipeline.numericalCounts }, numericalCountsAllTargets: report.numericalCountsAllTargets }, null, 2));
