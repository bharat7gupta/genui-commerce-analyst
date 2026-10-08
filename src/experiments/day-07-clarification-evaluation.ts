import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import type { ModelProvider, ModelResult } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { gradeExtractionOutcome } from "../evals/extraction-outcome-grader.js";
import { extractQueryPlan, queryPlanOutputSchema, QUERY_PLAN_EXTRACTION_MODEL_SETTINGS } from "../query-plan/query-plan-extraction.js";
import { InvalidRouteOutputError, routeRequest } from "../routing/router.js";

// Two fixed Day 7 inventories; this retains the existing clarification mode.
const unsupportedRun = process.argv[2] === "unsupported";
const option = process.argv[unsupportedRun ? 3 : 2];
const manifestPath = unsupportedRun ? "evals/unsupported/day-7-cases-v1.jsonl" : "evals/clarification/day-7-cases-v1.jsonl";
const common = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), question: z.string().min(1), source: z.string().min(1),
  category: z.literal("clarification"), datasetRole: z.literal("development"), paraphraseFamily: z.string().min(1),
  missingOrConflictingInformation: z.string().min(1), policy: z.string().min(1), usefulClarification: z.string().min(1),
  status: z.enum(["unblocked", "blocked"]), blocker: z.string().min(1).nullable(),
});
const clarificationCaseSchema = z.discriminatedUnion("target", [
  common.extend({ target: z.literal("router"), expectedRoute: z.literal("clarify"), expectedOutcome: z.null(), manualRubric: z.null() }).strict(),
  common.extend({ target: z.literal("extractor"), expectedRoute: z.null(), expectedOutcome: z.literal("clarification_required"),
    manualRubric: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) }).strict(),
]);
const unsupportedCommon = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), question: z.string().min(1), source: z.string().min(1),
  category: z.literal("refusal_unsupported"), datasetRole: z.enum(["development", "reserved_test"]),
  paraphraseFamily: z.string().min(1), previouslyHeldOut: z.boolean(), unsupportedBoundary: z.string().min(1),
  policy: z.string().min(1), status: z.enum(["unblocked", "blocked"]), blocker: z.string().min(1).nullable(),
});
const unsupportedCaseSchema = z.discriminatedUnion("target", [
  unsupportedCommon.extend({ target: z.literal("router"), expectedRoute: z.literal("unsupported"), expectedOutcome: z.null(), manualRubric: z.null() }).strict(),
  unsupportedCommon.extend({ target: z.literal("extractor"), expectedRoute: z.null(), expectedOutcome: z.literal("unsupported"),
    manualRubric: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) }).strict(),
]);
const caseSchema = unsupportedRun ? unsupportedCaseSchema : clarificationCaseSchema;
const frozenPaths = [manifestPath, unsupportedRun ? "docs/evals/day-7-unsupported-cases.md" : "docs/evals/day-7-clarification-cases.md", "docs/evals/day-7-clarification-quality.md",
  "docs/evals/day-7-dataset-plan.md", "docs/query-plan-v1.md", "evals/routing/cases-v1.jsonl", "evals/query-plan/development-cases-v1.jsonl",
  "evals/routing/heldout-cases-v1.jsonl", "evals/analytics/heldout-cases-v1.jsonl",
  "src/routing/router-v3-prompt.ts", "src/routing/router.ts", "src/query-plan/query-plan-extraction-v3-prompt.ts",
  "src/query-plan/query-plan-extraction.ts", "src/query-plan/query-plan.ts", "src/tools/get-metric-definition.ts",
  "src/evals/extraction-outcome-grader.ts"];
async function checksums() {
  return Object.fromEntries(await Promise.all(frozenPaths.map(async path =>
    [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
}
const sourceSha256 = await checksums();
const cases = (await readFile(manifestPath, "utf8")).trim().split("\n").map(line => caseSchema.parse(JSON.parse(line)));
const plannedPattern = unsupportedRun ? /^\| (?:23|24|25|26|27|28) \| `([^`]+)`/gm : /^\| (?:17|18|19|20|21|22) \| `([^`]+)`/gm;
const plannedIds = [...(await readFile("docs/evals/day-7-dataset-plan.md", "utf8"))
  .matchAll(plannedPattern)].map(match => match[1]);
if (cases.length !== 6 || new Set(cases.map(item => item.id)).size !== 6
    || JSON.stringify(plannedIds) !== JSON.stringify(cases.map(item => item.id))) throw new Error("Six planned target case IDs must match in order");
for (const item of cases) {
  if ((item.status === "blocked") !== (item.blocker !== null)) throw new Error(`Inconsistent blocker metadata: ${item.id}`);
  if (item.source.endsWith(".jsonl")) {
    const original = z.array(z.object({ id: z.string(), input: z.string(), expectedRoute: z.string().optional(),
      expected: z.object({ outcome: z.string() }).optional() })).parse(
      (await readFile(item.source, "utf8")).trim().split("\n").map(line => JSON.parse(line)))
      .find(source => source.id === item.id);
    if (original?.input !== item.question) throw new Error(`Original question mismatch: ${item.id}`);
    const expected = item.target === "router" ? original.expectedRoute : original.expected?.outcome;
    if (expected !== (item.expectedRoute ?? item.expectedOutcome)) throw new Error(`Original expectation mismatch: ${item.id}`);
  } else {
    const source = await readFile(item.source.split("#")[0]!, "utf8");
    const question = item.source.endsWith("#28")
      ? source.split("\n").find(line => line.startsWith("| 28 |"))?.match(/“([^”]+)”/)?.[1]
      : source.match(/\*\*Question:\*\* “([^”]+)”/)?.[1];
    if (question !== item.question) throw new Error(`Worked-example question mismatch: ${item.id}`);
  }
}
if (config.model.model !== "qwen3.5:4b" || config.model.reasoningEffort !== "none"
    || QUERY_PLAN_EXTRACTION_MODEL_SETTINGS.temperature !== 0 || QUERY_PLAN_EXTRACTION_MODEL_SETTINGS.maxTokens !== 1024) {
  throw new Error("Model/settings differ from previous runs; no calls made");
}
const configuration = { model: config.model.model, reasoningEffort: config.model.reasoningEffort,
  router: { promptVersion: "router-v3" as const, temperature: 0, maxTokens: 8 },
  extractor: { promptVersion: "query-plan-extractor-v3" as const, ...QUERY_PLAN_EXTRACTION_MODEL_SETTINGS,
    responseFormat: { type: "json_schema", name: "query_plan_output_v1", strict: true } } };
const blocked = cases.filter(item => item.status === "blocked").map(item => ({ caseId: item.id, reason: item.blocker }));
if (option === "--verify-only") {
  console.log(JSON.stringify({ verifiedCases: cases.length, blocked, configuration, sourceSha256 }, null, 2));
  process.exit(0);
}
if (option !== undefined) throw new Error("Unknown argument; no calls made");
const directory = `results/day-07-${unsupportedRun ? "unsupported" : "clarification"}-cases-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
await mkdir(directory);
await writeFile(`${directory}/preflight.json`, JSON.stringify({ timestamp: new Date().toISOString(), configuration, sourceSha256, cases, blocked }, null, 2) + "\n", { flag: "wx" });
type Check = { status: "pass" | "fail" | "not_reached" | "not_observable" | "not_applicable"; reason: string; issues?: unknown };
const na = (reason: string): Check => ({ status: "not_applicable", reason });
const nr = (reason: string): Check => ({ status: "not_reached", reason });
type Record = { caseId: string; target: "router" | "extractor"; checks: { routing: Check; envelopeValidity: Check; outcomeCorrectness: Check }; [key: string]: unknown };
const records: Record[] = [];
for (const [index, item] of cases.entries()) {
  console.log(`[${index + 1}/6] ${item.id} (${item.target})`);
  const observation: { result: ModelResult | null; elapsedMs: number | null } = { result: null, elapsedMs: null };
  let invocations = 0;
  const transport = new QwenProvider(config.model);
  const provider: ModelProvider = { async generate(request) {
    if (++invocations !== 1) throw new Error("Only one invocation per case permitted");
    const started = performance.now();
    try {
      const result = await transport.generate(request);
      observation.result = result;
      observation.elapsedMs = Math.round(performance.now() - started);
      await writeFile(`${directory}/${item.id}-call.json`, JSON.stringify({ timestamp: new Date().toISOString(), target: item.target,
        settings: item.target === "router" ? configuration.router : configuration.extractor,
        rawOutput: result.text, metadata: result.metadata, finishReason: result.finishReason ?? null,
        refusal: result.refusal ?? null, elapsedMs: observation.elapsedMs, error: null }, null, 2) + "\n", { flag: "wx" });
      return result;
    } catch (error) {
      observation.elapsedMs = Math.round(performance.now() - started);
      await writeFile(`${directory}/${item.id}-call.json`, JSON.stringify({ timestamp: new Date().toISOString(), target: item.target,
        rawOutput: null, metadata: null, elapsedMs: observation.elapsedMs,
        error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n", { flag: "wx" });
      throw error;
    }
  } };
  let routing = item.target === "router" ? nr("Case blocked") : na("Extractor target; routing not run");
  let envelopeValidity = item.target === "extractor" ? nr("Case blocked") : na("Router target; no extraction envelope");
  let outcomeCorrectness = item.target === "extractor" ? nr("No validated extraction envelope") : na("Router target; no extraction outcome");
  let quality: { status: "not_applicable" | "not_reached" | "pending_manual_assessment"; reason: string } = item.target === "router"
    ? { status: "not_applicable", reason: "Router labels contain no reason text" }
    : { status: "not_reached", reason: `Requires a valid ${item.expectedOutcome} envelope` };
  let observedRoute: string | null = null;
  let observedOutcome: string | null = null;
  let reason: string | null = null;
  let extraction: Awaited<ReturnType<typeof extractQueryPlan>> | null = null;
  if (item.status === "unblocked") {
    if (item.target === "router") {
      try {
        observedRoute = (await routeRequest(provider, item.question, "router-v3")).route;
        routing = { status: observedRoute === item.expectedRoute ? "pass" : "fail", reason: `Expected ${item.expectedRoute}; observed ${observedRoute}` };
      } catch (error) {
        routing = { status: "fail", reason: `${error instanceof InvalidRouteOutputError ? "Invalid route" : "Provider error"}: ${error instanceof Error ? error.message : String(error)}` };
      }
    } else {
      extraction = await extractQueryPlan(provider, item.question, "query-plan-extractor-v3");
      envelopeValidity = nr(`Envelope validation not reached: extraction returned ${extraction.outcome}`);
      if (extraction.rawOutput !== null && !["refusal", "incomplete"].includes(extraction.outcome)) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(extraction.rawOutput); } catch { /* Existing schema records invalid input. */ }
        const envelope = queryPlanOutputSchema.safeParse(parsed);
        envelopeValidity = envelope.success ? { status: "pass", reason: "Existing extraction envelope schema passed" }
          : { status: "fail", reason: "Existing extraction envelope schema failed", issues: envelope.error.issues };
        if (envelope.success) {
          observedOutcome = envelope.data.outcome;
          const grade = gradeExtractionOutcome(envelope.data, item.expectedOutcome);
          outcomeCorrectness = { status: grade.pass ? "pass" : "fail", reason: grade.reason };
          if (envelope.data.outcome === item.expectedOutcome && "reason" in envelope.data) {
            reason = envelope.data.reason;
            quality = { status: "pending_manual_assessment", reason: "Assess exact reason against pre-call rubric; no automated quality grading" };
          } else quality.reason = `Observed ${envelope.data.outcome}, expected ${item.expectedOutcome}; quality assessment not reached`;
        } else quality.reason = "Invalid extraction envelope; quality assessment not reached";
      }
    }
  } else {
    if (item.target === "router") routing = nr(`Blocked: ${item.blocker}`);
    else { envelopeValidity = nr(`Blocked: ${item.blocker}`); outcomeCorrectness = nr(`Blocked: ${item.blocker}`); quality.reason = `Blocked: ${item.blocker}`; }
  }
  const record: Record = { timestamp: new Date().toISOString(), caseId: item.id, target: item.target,
    datasetRole: item.datasetRole, paraphraseFamily: item.paraphraseFamily, question: item.question,
    previouslyHeldOut: "previouslyHeldOut" in item ? item.previouslyHeldOut : false,
    expectedRoute: item.expectedRoute, expectedOutcome: item.expectedOutcome, configuration, sourceSha256,
    blocked: item.status === "blocked", blocker: item.blocker, invocations, observedRoute, observedOutcome, reason,
    extraction, checks: { routing, envelopeValidity, outcomeCorrectness }, quality, manualRubric: item.manualRubric,
    metadata: observation.result?.metadata ?? null, elapsedMs: observation.elapsedMs };
  await writeFile(`${directory}/${item.id}.json`, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  records.push(record);
  console.log(JSON.stringify({ caseId: item.id, observedRoute, observedOutcome, reason, checks: record.checks, quality }));
}
function countChecks(target: Record["target"], field: keyof Record["checks"]) {
  const applicable = records.filter(record => record.target === target);
  const count = (status: Check["status"]) => applicable.filter(record => record.checks[field].status === status).length;
  return { passed: count("pass"), failed: count("fail"), not_reached: count("not_reached"), not_observable: count("not_observable"),
    gradingDenominator: count("pass") + count("fail"), totalCases: applicable.length,
    ungraded: applicable.filter(record => ["not_reached", "not_observable"].includes(record.checks[field].status))
      .map(record => ({ caseId: record.caseId, reason: record.checks[field].reason })) };
}
const sourcesUnchanged = JSON.stringify(sourceSha256) === JSON.stringify(await checksums());
const summary = { timestamp: new Date().toISOString(), configuration, sourceSha256, sourcesUnchanged, blocked,
  routerCounts: countChecks("router", "routing"), extractorEnvelopeCounts: countChecks("extractor", "envelopeValidity"),
  extractorOutcomeCounts: countChecks("extractor", "outcomeCorrectness"), cases: records,
  note: "Separate component targets. Manual quality assessments and their denominator will be recorded separately; no combined accuracy." };
await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
if (!sourcesUnchanged) throw new Error("Frozen inputs changed during evaluation");
console.log(JSON.stringify({ directory, routerCounts: summary.routerCounts, extractorEnvelopeCounts: summary.extractorEnvelopeCounts,
  extractorOutcomeCounts: summary.extractorOutcomeCounts }, null, 2));
