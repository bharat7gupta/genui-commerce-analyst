import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ModelProvider } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";
import { runComparePeriodsToolOnce, runComparePeriodsAgent, reserveComparisonInputTokens, COMPARISON_INPUT_ESTIMATOR, COMPARE_PERIODS_AGENT_LIMITS, INVESTIGATION_AGENT_LIMITS, COMPARE_PERIODS_TOOL_MODEL_SETTINGS } from "../application/compare-periods-tool-once.js";
import { COMPARE_PERIODS_TOOL_PROMPT_VERSION, COMPARE_PERIODS_TOOL_SYSTEM_PROMPT } from "../application/compare-periods-tool-v1-prompt.js";
import { COMPARE_PERIODS_AGENT_PROMPT_VERSION, COMPARE_PERIODS_AGENT_SYSTEM_PROMPT } from "../application/compare-periods-agent-v1-prompt.js";
import { COMPARE_PERIODS_AGENT_V2_PROMPT_VERSION, COMPARE_PERIODS_AGENT_V2_SYSTEM_PROMPT, comparePeriodsV2ToolDefinition, COMPARE_PERIODS_TOOL_V2_VERSION } from "../application/compare-periods-agent-v2-prompt.js";
import { COMPARISON_AGENT_V3_PROMPT_VERSION, COMPARISON_AGENT_V3_SYSTEM_PROMPT, COMPARISON_AGENT_V3_TOOLS, COMPARISON_AGENT_V3_TOOL_VERSIONS } from "../application/compare-periods-agent-v3-prompt.js";
import { comparePeriodsToolDefinition } from "../tools/compare-periods.js";
import { apiCost, readApiPricing } from "./investigation-recorder.js";
import { investigationDevelopmentSchema } from "../evals/investigation-development.js";

const developmentMode = process.argv.includes("--day15-development");
const datasetPath = "evals/investigation/development-v1.json";
const workflowPath = "results/day-15-investigation-development-2026-10-13T08-27-37.486Z-d3819fff-5e14-44eb-8960-d74e90cfe56c";
const reviewPath = "results/day-15-investigation-contract-review-v2/report.json";
const dataset = developmentMode ? investigationDevelopmentSchema.parse(JSON.parse(await readFile(new URL(`../../${datasetPath}`, import.meta.url), "utf8"))) : null;
const contractReview = developmentMode ? z.object({
  gradingVersion: z.literal("investigation-contract-review-v2"),
  rules: z.record(z.string(), z.string()),
  summary: z.object({ contractMismatches: z.array(z.string()) }),
}).parse(JSON.parse(await readFile(new URL(`../../${reviewPath}`, import.meta.url), "utf8"))) : null;
const cases = dataset?.cases.filter((item) => !contractReview?.summary.contractMismatches.includes(item.id)) ?? [];
if (developmentMode && (cases.length !== 14 || contractReview?.summary.contractMismatches.length !== 1)) throw new Error("Expected 14 eligible tasks and one contract mismatch");
const revision = developmentMode || process.argv.includes("--agent-v3") ? "v3" : process.argv.includes("--agent-v2") ? "v2" : "v1";
const question = revision === "v3" ? "Investigate how net revenue changed from August 2025 to September 2025 by region. Include the metric definition and distinguish regional contributions from established business causes."
  : "Compare net revenue in September 2025 against August 2025.";
const agentMode = process.argv.includes("--agent") || revision !== "v1";
const promptVersion = revision === "v3" ? COMPARISON_AGENT_V3_PROMPT_VERSION : revision === "v2" ? COMPARE_PERIODS_AGENT_V2_PROMPT_VERSION : agentMode ? COMPARE_PERIODS_AGENT_PROMPT_VERSION : COMPARE_PERIODS_TOOL_PROMPT_VERSION;
const systemPrompt = revision === "v3" ? COMPARISON_AGENT_V3_SYSTEM_PROMPT : revision === "v2" ? COMPARE_PERIODS_AGENT_V2_SYSTEM_PROMPT : agentMode ? COMPARE_PERIODS_AGENT_SYSTEM_PROMPT : COMPARE_PERIODS_TOOL_SYSTEM_PROMPT;
const tool = revision === "v2" ? comparePeriodsV2ToolDefinition : comparePeriodsToolDefinition;
const tools = revision === "v3" ? COMPARISON_AGENT_V3_TOOLS : [tool];
const limits = revision === "v3" ? INVESTIGATION_AGENT_LIMITS : COMPARE_PERIODS_AGENT_LIMITS;
const pricing = readApiPricing();
const previousRuns = (await readdir(new URL("../../results/", import.meta.url))).filter((name) => name.startsWith("day-16-compare-periods-") || (developmentMode && name.startsWith("day-15-")));
const previousArtifacts = (await Promise.all(previousRuns.map(async (directory) =>
  (await readdir(new URL(`../../results/${directory}/`, import.meta.url))).map((name) => `results/${directory}/${name}`)))).flat();
const files = ["src/application/compare-periods-tool-v1-prompt.ts", "src/application/compare-periods-agent-v1-prompt.ts", "src/application/compare-periods-agent-v2-prompt.ts", "src/application/compare-periods-agent-v3-prompt.ts", "src/application/compare-periods-tool-once.ts",
  "src/ai/provider.ts", "src/application/commerce-analysis-pipeline.ts",
  "src/application/metric-definition-tool-workflow.ts", "src/application/compare-periods.ts", "src/application/compare-net-revenue-by-region.ts", "src/tools/compare-periods.ts",
  "src/tools/get-metric-definition.ts", "src/decimal.ts", "src/query-plan/query-plan.ts",
  "src/ai/qwen-provider.ts", "src/db/query-plan-sql-compiler.ts", "src/db/duckdb-query-plan-executor.ts",
  "src/experiments/day-16-compare-periods-tool.ts", "src/experiments/investigation-recorder.ts", "data/seed.sql", ...previousArtifacts,
  ...(developmentMode ? [datasetPath, "src/evals/investigation-development.ts", "src/evals/scalar-numerical-grader.ts"] : [])];
async function checksums() {
  return Object.fromEntries(await Promise.all(files.map(async (path) => [path,
    createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex")])));
}
const before = await checksums();
const directory = new URL(`../../results/day-16-compare-periods-${developmentMode ? "agent-v3-day15-development-comparison" : revision === "v3" ? "agent-v3-development" : revision === "v2" ? "agent-v2-development" : agentMode ? "agent" : "tool"}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}/`, import.meta.url);
await mkdir(directory);
await writeFile(new URL("protocol.json", directory), JSON.stringify({
  question: developmentMode ? null : question, promptVersion, systemPrompt,
  label: developmentMode ? "development comparison between two recorded configurations; not a controlled agent/workflow experiment" : revision !== "v1" ? "development revision" : "development baseline",
  ...(developmentMode ? { dataset, eligibleCaseIds: cases.map(({ id }) => id),
    excludedContractMismatches: contractReview?.summary.contractMismatches,
    workflowSource: workflowPath, reviewedContractSource: reviewPath, reviewedRules: contractReview?.rules,
    grading: { method: "Manual semantic answer review plus existing exact scalar/development graders and frozen SQL-verified numerical references; no new evaluation harness.",
      completedTasks: "Correct requested metric, periods and region; overall baseline/target/change/percentage and every regional contribution reported; observed results agree with reference; definition calculation/source cited and no established business causes or inferred currency. Normal answer termination is not sufficient.",
      ambiguousTasks: "Ask for the missing/ambiguous input(s), preserve explicit intent, invent no missing inputs, and execute zero SQL. Tool-choice/answer intent diagnostics replace structured extraction where the agent offers no extraction object.",
      unsupportedTasks: "Correctly identify and reject the explicit unsupported metric/dimension with zero SQL. Unrelated date errors are diagnostic, not rejection failures.",
      telemetry: "Agent tool executions counted directly. Workflow read-only operations derived from completed compare_periods/compare_regions/get_metric_definition stages; not model-selected tool calls. Report actual SQL, repeated input/output, wall latency and native termination separately.",
      misleadingTasks: "Follow verified direction/numbers and distinguish contributions from established causes; do not endorse the claimed decline or campaign causation.",
    }, repetitions: 1 } : {}),
  toolDefinitionVersions: revision === "v3" ? COMPARISON_AGENT_V3_TOOL_VERSIONS : null,
  toolDefinitionVersion: revision === "v1" ? "compare-periods-tool-definition-v1" : COMPARE_PERIODS_TOOL_V2_VERSION,
  tools, model: config.model.model, reasoningEffort: config.model.reasoningEffort,
  settings: COMPARE_PERIODS_TOOL_MODEL_SETTINGS, modelRequestLimit: agentMode ? limits.modelTurns : 1, toolCallLimit: agentMode ? limits.toolExecutions : 1, retries: 0,
  agentLimits: agentMode ? limits : null,
  inputEstimator: agentMode ? COMPARISON_INPUT_ESTIMATOR : null,
  tokenAccounting: "Charge provider-reported input/output usage only, including repeated history. Approximate reservations determine preflight capacity and output cap; they are never deducted. Missing usage stops the loop. Estimated capacity is not a hard token guarantee.",
  stopAt: agentMode ? "Answer with observed result, or explicit bounded termination; answer claims unverified"
    : "Tool-result message appended to conversation history; no follow-up model request",
  reviewCriteria: revision !== "v1" ? {
    periodIntent: { metric: "net_revenue", baseline: { start: "2025-08-01", end: "2025-09-01" }, target: { start: "2025-09-01", end: "2025-10-01" } },
    numericalAgreement: "Inspect final-answer values and direction against the observed successful tool result, independently of period-intent correctness.",
    unsupportedCurrency: "Currency symbols or labels require currency metadata in the tool result. This result supplies none. Percent signs are allowed.",
    requestedEvidence: revision === "v3" ? {
      overall: { baseline: "7225.00", target: "8295.00", change: "1070.00", percentage: "14.81" },
      regionalContributions: { East: "300.00", North: "575.00", South: "0.00", West: "195.00" },
      definitionSource: "src/tools/get-metric-definition.ts#METRIC_DEFINITIONS.net_revenue",
      causalEvidence: "No established business causes; regional changes are descriptive contributions only.",
    } : null,
    note: "Evaluator-only criteria; never sent in model messages. A single exposed-case development revision is not unchanged-baseline or generalization evidence.",
  } : null,
  pricing, checksums: before,
}, null, 2), { flag: "wx" });
const underlying = new QwenProvider(config.model);
let modelRequestCount = 0;
let activeCaseId: string | null = null;
let caseRequestCount = 0;
const provider: ModelProvider = { async generate(request) {
  const requestIndex = ++modelRequestCount;
  const caseFields = developmentMode ? { caseId: activeCaseId, repetition: 1, caseRequestIndex: ++caseRequestCount } : {};
  const { signal, ...recordedRequest } = request;
  const inputReservation = agentMode ? { inputEstimatorVersion: COMPARISON_INPUT_ESTIMATOR.version,
    inputTokenReservation: reserveComparisonInputTokens(request.messages, request.tools) } : {};
  const started = performance.now();
  let response;
  try { response = await underlying.generate(request); }
  catch (error) {
    await appendFile(new URL("calls.jsonl", directory), `${JSON.stringify({
      promptVersion, ...caseFields, ...inputReservation, requestIndex, request: recordedRequest, cancellationSignalAttached: signal !== undefined,
      response: null, latencyMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error), apiCost: apiCost(pricing, null),
    })}\n`);
    throw error;
  }
  // Preserve raw arguments, assistant text, IDs and metadata before validation.
  await appendFile(new URL("calls.jsonl", directory), `${JSON.stringify({
    promptVersion, ...caseFields, ...inputReservation, requestIndex, request: recordedRequest, cancellationSignalAttached: signal !== undefined,
    response, apiCost: apiCost(pricing, response.metadata.tokenUsage), error: null,
  })}\n`);
  return response;
} };
const realExecutor = new DuckDBQueryPlanExecutor();
let sqlExecutionCount = 0;
const executor: QueryPlanExecutor = { async execute(plan, options) { sqlExecutionCount++; return realExecutor.execute(plan, options); } };
if (developmentMode) {
  const reports = [];
  for (const item of cases) {
    if (!isDeepStrictEqual(before, await checksums())) throw new Error("Frozen inputs changed before case");
    activeCaseId = item.id;
    caseRequestCount = 0;
    const sqlBefore = sqlExecutionCount;
    const result = await runComparePeriodsAgent(provider, item.question, { executor, revision });
    const usage = result.tokenUsageComplete ? { inputTokens: result.cumulativeInputTokens,
      outputTokens: result.cumulativeOutputTokens, totalTokens: result.cumulativeTokens } : null;
    const report = { ...item, label: "development comparison", workflowSource: `${workflowPath}/${item.id}.json`,
      ...result, sqlExecutionCount: sqlExecutionCount - sqlBefore, modelRequestCount: caseRequestCount,
      apiCost: apiCost(pricing, usage) };
    await writeFile(new URL(`${item.id}.json`, directory), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    reports.push(report);
    console.log(`${item.id}: ${result.stopReason}; tools=${result.toolExecutionCount}; SQL=${report.sqlExecutionCount}; tokens=${result.cumulativeTokens}`);
  }
  const after = await checksums();
  const unchanged = isDeepStrictEqual(before, after);
  await writeFile(new URL("report.json", directory), `${JSON.stringify({ label: "development comparison between two recorded configurations; not controlled proof that agents are better or worse",
    reports, excludedContractMismatches: contractReview?.summary.contractMismatches,
    modelRequestCount, sqlExecutionCount, checksums: { before, after, unchanged },
    previousRunsUnchanged: previousArtifacts.every((path) => before[path] === after[path]) }, null, 2)}\n`, { flag: "wx" });
  console.log(`Artifacts: ${directory.pathname}`);
  if (!unchanged) throw new Error("Frozen inputs changed during development comparison");
} else {
const result = agentMode ? await runComparePeriodsAgent(provider, question, { executor, revision })
  : await runComparePeriodsToolOnce(provider, question, executor);
const after = await checksums();
const unchanged = isDeepStrictEqual(before, after);
const usage = "turns" in result ? result.tokenUsageComplete ? {
  inputTokens: result.cumulativeInputTokens, outputTokens: result.cumulativeOutputTokens, totalTokens: result.cumulativeTokens,
} : null : result.modelCall.tokenUsage;
const report = { question, configuredModel: config.model.model, reasoningEffort: config.model.reasoningEffort,
  label: revision !== "v1" ? "development revision" : "development baseline",
  sqlExecutionCount, modelRequestCount, ...result, apiCost: apiCost(pricing, usage),
  checksums: { before, after, unchanged },
  previousRunsUnchanged: previousArtifacts.every((path) => before[path] === after[path]) };
await writeFile(new URL("report.json", directory), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
console.log(`Artifacts: ${directory.pathname}`);
if (!unchanged) throw new Error("Frozen inputs changed during live run");
}
