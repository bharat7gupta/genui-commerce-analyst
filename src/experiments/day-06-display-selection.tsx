import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";

import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import {
  DISPLAY_SELECTION_PROMPT_VERSION, DISPLAY_SELECTION_SETTINGS,
  displaySelectionJsonSchema, selectDisplay,
} from "../ui/display-selection.js";
import { renderKpiPage } from "../ui/net-revenue-kpi-page.js";
import { NET_REVENUE_KPI_PLAN } from "../ui/net-revenue-kpi-plan.js";

const cases = [
  { id: "kpi", question: "Show the August net revenue as a KPI card.", expectedType: "kpi" },
  { id: "table", question: "Show the August net revenue in a table.", expectedType: "table" },
] as const;
const frozenFiles = [
  "../ui/display-selection.ts", "../ui/kpi-specification.ts",
  "../ui/net-revenue-kpi-plan.ts", "../ui/net-revenue-kpi-page.tsx",
  "./day-06-display-selection.tsx",
];
async function checksums() {
  return Promise.all(frozenFiles.map(async (file) => ({
    file, sha256: createHash("sha256").update(await readFile(new URL(file, import.meta.url))).digest("hex"),
  })));
}
const before = await checksums();
const rows = await new DuckDBQueryPlanExecutor().execute(NET_REVENUE_KPI_PLAN);
assert.deepEqual(rows, [{ net_revenue: "7225.00" }]);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const directory = new URL(`../../results/day-06-display-selection-${runId}/`, import.meta.url);
await mkdir(directory); // Unique artifact directory; never overwrite an earlier run.
await writeFile(new URL("protocol.json", directory), JSON.stringify({
  cases, promptVersion: DISPLAY_SELECTION_PROMPT_VERSION,
  model: config.model.model, reasoningEffort: config.model.reasoningEffort,
  settings: DISPLAY_SELECTION_SETTINGS, schema: displaySelectionJsonSchema,
  plan: NET_REVENUE_KPI_PLAN, executorResult: rows, checksums: before,
}, null, 2), { flag: "wx" });
const recordsUrl = new URL("calls.jsonl", directory);
await writeFile(recordsUrl, "", { flag: "wx" });
const provider = new QwenProvider(config.model);

for (const testCase of cases) {
  const selection = await selectDisplay(provider, testCase.question);
  // Preserve every call immediately, including raw output and failures, before rendering.
  const record = {
    timestamp: new Date().toISOString(), promptVersion: DISPLAY_SELECTION_PROMPT_VERSION,
    caseId: testCase.id, question: testCase.question, repetition: 1,
    expectedType: testCase.expectedType, ...selection,
    correct: selection.outcome === "validated" ? selection.specification.type === testCase.expectedType : null,
    model: selection.metadata?.model ?? config.model.model,
    settings: DISPLAY_SELECTION_SETTINGS, reasoningEffort: config.model.reasoningEffort,
    tokenUsage: selection.metadata?.tokenUsage ?? null, requestId: selection.metadata?.requestId ?? null,
  };
  await appendFile(recordsUrl, `${JSON.stringify(record)}\n`);

  let html: string;
  let renderedComponent: string | null = null;
  let error: string | null = null;
  try {
    if (selection.outcome !== "validated") throw new Error(selection.error);
    html = renderKpiPage(selection.specification, rows);
    assert.ok(html.includes(selection.specification.type === "kpi"
      ? '<p class="value">7225.00</p>' : '<td>7225.00</td>'));
    renderedComponent = selection.specification.type;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
    html = "<!doctype html>" + renderToStaticMarkup(
      <html lang="en"><head><meta charSet="utf-8" /><title>Display selection error</title></head>
        <body><p role="alert">{error}</p></body></html>,
    );
  }
  await writeFile(new URL(`${testCase.id}.html`, directory), html, { flag: "wx" });
  const outcome = {
    ...record, renderedComponent, displayedValue: renderedComponent === null ? null : rows[0]?.net_revenue,
    error, htmlFile: `${testCase.id}.html`,
  };
  await writeFile(new URL(`${testCase.id}-outcome.json`, directory), JSON.stringify(outcome, null, 2), { flag: "wx" });
  console.log(JSON.stringify(outcome));
}
assert.deepEqual(await checksums(), before, "Frozen source changed during the run");
console.log(`Artifacts: ${directory.pathname}`);
