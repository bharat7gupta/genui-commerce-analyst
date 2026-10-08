import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import type { ModelProvider } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { gradeExtractionOutcome } from "../evals/extraction-outcome-grader.js";
import { gradePlanMeaning } from "../evals/plan-meaning-grader.js";
import { extractQueryPlan, queryPlanOutputSchema, QUERY_PLAN_EXTRACTION_MODEL_SETTINGS } from "../query-plan/query-plan-extraction.js";
import { queryPlanSchema, validateQueryPlan } from "../query-plan/query-plan.js";
import { METRIC_DEFINITIONS } from "../tools/get-metric-definition.js";

const manifestPath = "evals/query-plan/day-7-interpretation-cases-v1.jsonl";
const absentKinds = z.array(z.enum(["none", "unspecified"]));
const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), question: z.string().min(1), source: z.string().min(1),
  category: z.literal("query_plan_interpretation"), datasetRole: z.enum(["development", "reserved_test"]),
  paraphraseFamily: z.string().min(1), expectedOutcome: z.literal("query_plan"), expectedPlan: queryPlanSchema,
  acceptableAbsentOperationKinds: z.object({ comparison: absentKinds, ordering: absentKinds, limit: absentKinds, visualization: absentKinds }).strict(),
  policyVerification: z.object({ status: z.enum(["verified", "unresolved"]), reason: z.string().min(1) }).strict(),
  compilerRestrictions: z.array(z.string()),
}).strict();
const frozenPaths = [manifestPath, "evals/query-plan/development-cases-v1.jsonl", "evals/analytics/heldout-cases-v1.jsonl",
  "docs/evals/day-7-dataset-plan.md", "src/query-plan/query-plan-extraction-v3-prompt.ts",
  "src/query-plan/query-plan-extraction.ts", "src/query-plan/query-plan.ts", "src/tools/get-metric-definition.ts",
  "src/evals/plan-meaning-grader.ts", "src/evals/extraction-outcome-grader.ts"];
async function checksums() {
  return Object.fromEntries(await Promise.all(frozenPaths.map(async path =>
    [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
}
const before = await checksums();
const cases = (await readFile(manifestPath, "utf8")).trim().split("\n").map(line => caseSchema.parse(JSON.parse(line)));
const planned = [...(await readFile("docs/evals/day-7-dataset-plan.md", "utf8"))
  .matchAll(/^\| (?:11|12|13|14|15|16) \| `([^`]+)`/gm)].map(match => match[1]);
if (cases.length !== 6 || new Set(cases.map(item => item.id)).size !== 6
    || JSON.stringify(planned) !== JSON.stringify(cases.map(item => item.id))) throw new Error("Six planned case IDs must match in order");
const originalQuestions = z.array(z.object({ id: z.string(), input: z.string() })).parse(
  (await readFile("evals/query-plan/development-cases-v1.jsonl", "utf8")).trim().split("\n").map(line => JSON.parse(line)));
const canonicalVerification = cases.map(item => {
  if (item.policyVerification.status !== "verified") throw new Error(`Unresolved policy: ${item.id}; no calls made`);
  const original = originalQuestions.find(source => source.id === item.id);
  if (item.datasetRole === "development" && original?.input !== item.question) throw new Error(`Question source mismatch: ${item.id}`);
  const validation = validateQueryPlan(item.expectedPlan);
  if (!validation.success) throw new Error(`Invalid expected plan for ${item.id}: ${JSON.stringify(validation.issues)}`);
  if (validation.data.metric.kind !== "metric") throw new Error(`Expected metric missing: ${item.id}`);
  const meaning = gradePlanMeaning(validation.data, item);
  if (!meaning.pass) throw new Error(`Canonical plan fails meaning: ${item.id}: ${meaning.reason}`);
  return { caseId: item.id, schema: "pass", businessRules: "pass", meaning: "pass", metricDefinition: METRIC_DEFINITIONS[validation.data.metric.value] };
});
if (config.model.model !== "qwen3.5:4b" || config.model.reasoningEffort !== "none"
    || QUERY_PLAN_EXTRACTION_MODEL_SETTINGS.temperature !== 0 || QUERY_PLAN_EXTRACTION_MODEL_SETTINGS.maxTokens !== 1024) {
  throw new Error("Model/settings must match previous extraction runs; no calls made");
}
if (process.argv[2] === "--verify-only") {
  console.log(JSON.stringify({ canonicalVerification, sourceSha256: before }, null, 2));
  process.exit(0);
}
if (process.argv[2] !== undefined) throw new Error("Unknown argument; no calls made");

const configuration = { model: config.model.model, reasoningEffort: config.model.reasoningEffort,
  promptVersion: "query-plan-extractor-v3" as const, ...QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
  responseFormat: { type: "json_schema", name: "query_plan_output_v1", strict: true } };
const directory = `results/day-07-interpretation-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
await mkdir(directory);
await writeFile(`${directory}/preflight.json`, JSON.stringify({ configuration, canonicalVerification, sourceSha256: before, cases }, null, 2) + "\n", { flag: "wx" });
type Check = { status: "pass" | "fail" | "not_reached" | "not_observable"; reason: string; issues?: unknown; mismatches?: unknown };
const notReached = (reason: string): Check => ({ status: "not_reached", reason });
const fields = ["envelopeValidity", "outcomeCorrectness", "schemaValidation", "businessRuleValidation", "planMeaning"] as const;
const records: { caseId: string; extraction: Awaited<ReturnType<typeof extractQueryPlan>>;
  checks: Record<typeof fields[number], Check> }[] = [];
for (const [index, item] of cases.entries()) {
  console.log(`[${index + 1}/6] ${item.id}`);
  let invocations = 0;
  const transport = new QwenProvider(config.model);
  const recordingProvider: ModelProvider = { async generate(request) {
    if (++invocations !== 1) throw new Error("Only one model invocation per case permitted");
    const started = performance.now();
    try {
      const result = await transport.generate(request);
      await writeFile(`${directory}/${item.id}-call.json`, JSON.stringify({ timestamp: new Date().toISOString(), configuration,
        rawOutput: result.text, metadata: result.metadata, finishReason: result.finishReason ?? null,
        refusal: result.refusal ?? null, elapsedMs: Math.round(performance.now() - started), error: null }, null, 2) + "\n", { flag: "wx" });
      return result;
    } catch (error) {
      await writeFile(`${directory}/${item.id}-call.json`, JSON.stringify({ timestamp: new Date().toISOString(), configuration,
        rawOutput: null, metadata: null, elapsedMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n", { flag: "wx" });
      throw error;
    }
  } };
  const extraction = await extractQueryPlan(recordingProvider, item.question, configuration.promptVersion);
  let envelopeValidity = notReached(`Extraction returned ${extraction.outcome}`);
  let outcomeCorrectness = notReached("No valid completed extraction envelope");
  let schemaValidation = notReached("No query_plan output available");
  let businessRuleValidation = notReached("No structurally valid plan available");
  let planMeaning = notReached("No business-valid plan available");
  if (extraction.rawOutput !== null && !["refusal", "incomplete"].includes(extraction.outcome)) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(extraction.rawOutput); } catch { /* Schema records the invalid input. */ }
    const envelope = queryPlanOutputSchema.safeParse(parsed);
    envelopeValidity = envelope.success ? { status: "pass", reason: "Existing extraction envelope schema passed" }
      : { status: "fail", reason: "Existing extraction envelope schema failed", issues: envelope.error.issues };
    if (envelope.success) {
      const grade = gradeExtractionOutcome(envelope.data, item.expectedOutcome);
      outcomeCorrectness = { status: grade.pass ? "pass" : "fail", reason: grade.reason };
    }
    if (typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, "queryPlan")
        && Reflect.get(parsed, "outcome") === "query_plan") {
      const schema = queryPlanSchema.safeParse(Reflect.get(parsed, "queryPlan"));
      schemaValidation = schema.success ? { status: "pass", reason: "QueryPlan schema passed" }
        : { status: "fail", reason: "QueryPlan schema failed", issues: schema.error.issues };
      if (schema.success) {
        const business = validateQueryPlan(schema.data);
        businessRuleValidation = business.success ? { status: "pass", reason: "QueryPlan business rules passed" }
          : { status: "fail", reason: "QueryPlan business rules failed", issues: business.issues };
        if (business.success) {
          const grade = gradePlanMeaning(business.data, item);
          planMeaning = { status: grade.pass ? "pass" : "fail", reason: grade.reason, mismatches: grade.mismatches };
        }
      }
    }
  }
  const record = { timestamp: new Date().toISOString(), caseId: item.id, category: item.category, datasetRole: item.datasetRole,
    paraphraseFamily: item.paraphraseFamily, component: "extractor", question: item.question, configuration, invocations,
    sourceSha256: before, expectedOutcome: item.expectedOutcome, expectedPlan: item.expectedPlan,
    acceptableAbsentOperationKinds: item.acceptableAbsentOperationKinds, extraction,
    checks: { envelopeValidity, outcomeCorrectness, schemaValidation, businessRuleValidation, planMeaning },
    compilerRestrictions: item.compilerRestrictions,
    note: "Checks validate captured output independently after the call. Compiler restrictions are informational; no routing, compilation, or SQL execution performed." };
  await writeFile(`${directory}/${item.id}.json`, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  records.push(record);
  console.log(JSON.stringify({ caseId: item.id, checks: record.checks }));
}
const checkCounts = Object.fromEntries(fields.map(field => {
  const count = (status: Check["status"]) => records.filter(record => record.checks[field].status === status).length;
  return [field, { passed: count("pass"), failed: count("fail"), not_reached: count("not_reached"), not_observable: count("not_observable"),
    gradingDenominator: count("pass") + count("fail"), totalCases: records.length,
    ungraded: records.filter(record => ["not_reached", "not_observable"].includes(record.checks[field].status))
      .map(record => ({ caseId: record.caseId, reason: record.checks[field].reason })) }];
}));
const sourcesUnchanged = JSON.stringify(before) === JSON.stringify(await checksums());
await writeFile(`${directory}/summary.json`, JSON.stringify({ component: "extractor", configuration, canonicalVerification,
  sourceSha256: before, sourcesUnchanged, checkCounts, cases: records,
  note: "Component grades only. The reserved-test candidate is now exposed; this is not full-pipeline or fresh held-out evidence." }, null, 2) + "\n", { flag: "wx" });
if (!sourcesUnchanged) throw new Error("Frozen inputs changed during evaluation");
console.log(JSON.stringify({ directory, checkCounts }, null, 2));
