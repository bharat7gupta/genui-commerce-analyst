import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";
import { investigateMetricChangeFromText, INVESTIGATION_MODEL_SETTINGS, investigationExtractionJsonSchema } from "../application/natural-language-investigation.js";
import { INVESTIGATION_PROMPT_VERSION, INVESTIGATION_SYSTEM_PROMPT } from "../application/investigation-extraction-v1-prompt.js";

import { apiCost, readApiPricing, recordingInvestigationProvider } from "./investigation-recorder.js";

const cases = Object.freeze([
  { id: "explicit-net-region", question: "Investigate how net revenue changed from August 2025 to September 2025, broken down by region." },
  { id: "ambiguous-revenue", question: "Why did revenue change?" },
  { id: "unsupported-gross", question: "Compare gross revenue in September 2025 against August 2025 by region." },
]);
const pricing = readApiPricing();
const files = [
  "src/application/investigation-extraction-v1-prompt.ts", "src/application/natural-language-investigation.ts",
  "src/application/investigate-metric-change.ts", "src/application/compare-periods.ts",
  "src/application/compare-net-revenue-by-region.ts", "src/decimal.ts",
  "src/db/query-plan-sql-compiler.ts", "src/db/duckdb-query-plan-executor.ts",
  "src/tools/get-metric-definition.ts", "src/ai/qwen-provider.ts",
  "src/experiments/day-15-natural-language-investigation.ts", "src/experiments/investigation-recorder.ts", "data/seed.sql",
];
async function checksums() {
  const entries = await Promise.all(files.map(async (path) => [path,
    createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex")]));
  return Object.fromEntries(entries);
}
const before = await checksums();
const directory = new URL(`../../results/day-15-natural-language-investigation-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}/`, import.meta.url);
await mkdir(directory);
await writeFile(new URL("protocol.json", directory), JSON.stringify({
  cases, promptVersion: INVESTIGATION_PROMPT_VERSION, systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
  schema: investigationExtractionJsonSchema, model: config.model.model,
  reasoningEffort: config.model.reasoningEffort, settings: INVESTIGATION_MODEL_SETTINGS,
  repetitions: 1, retries: 0, pricing, checksums: before,
  totalExecutionCost: "Unmeasured; local compute and energy costs are not API pricing",
}, null, 2), { flag: "wx" });
const underlyingProvider = new QwenProvider(config.model);
const underlyingExecutor = new DuckDBQueryPlanExecutor();
const reports = [];
for (const request of cases) {
  if (!isDeepStrictEqual(before, await checksums())) throw new Error("Frozen inputs changed before a call");
  let sqlExecutionCount = 0;
  const executor: QueryPlanExecutor = { async execute(plan) {
    sqlExecutionCount++;
    return underlyingExecutor.execute(plan);
  } };
  const provider = recordingInvestigationProvider(underlyingProvider, {
    caseId: request.id, callsPath: new URL("calls.jsonl", directory),
    model: config.model.model, reasoningEffort: config.model.reasoningEffort, pricing,
  });
  const result = await investigateMetricChangeFromText(provider, request.question, { executor });
  const report = { ...request, sqlExecutionCount, apiCost: apiCost(pricing, result.extraction.metadata?.tokenUsage ?? null), ...result };
  await writeFile(new URL(`${request.id}.json`, directory), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  reports.push(report);
  console.log(JSON.stringify(report, null, 2));
}
const after = await checksums();
const unchanged = isDeepStrictEqual(before, after);
await writeFile(new URL("report.json", directory), `${JSON.stringify({ reports, checksums: { before, after, unchanged } }, null, 2)}\n`, { flag: "wx" });
console.log(`Artifacts: ${directory.pathname}; frozen checksums unchanged: ${unchanged}`);
if (!unchanged) throw new Error("Frozen inputs changed during the run");
