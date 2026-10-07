import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

import type { ModelContentChunk, ModelMetadata } from "../ai/provider.js";
import { QwenProvider, QwenStreamError } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { DISPLAY_SELECTION_PROMPT_VERSION, DISPLAY_SELECTION_SETTINGS, displaySelectionJsonSchema } from "../ui/display-selection.js";
import { parseKpiSpecification, type KpiSpecification } from "../ui/kpi-specification.js";
import { createModelDisplayServer } from "../ui/model-display-server.js";
import { NET_REVENUE_KPI_PLAN } from "../ui/net-revenue-kpi-plan.js";

declare global {
  interface Window { reportLiveStreamState?: (state: { status: string; result: string }) => Promise<void>; }
}
const frozenFiles = [
  "../ai/provider.ts", "../ai/qwen-provider.ts", "../ui/display-selection.ts",
  "../ui/kpi-specification.ts", "../ui/model-display-server.tsx", "../ui/model-display-client.js",
  "../ui/net-revenue-kpi-plan.ts", "../ui/net-revenue-kpi-page.tsx", "./day-06-live-streaming-display.ts",
];
async function checksums() {
  return Promise.all(frozenFiles.map(async file => ({
    file, sha256: createHash("sha256").update(await readFile(new URL(file, import.meta.url))).digest("hex"),
  })));
}
const before = await checksums();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const directory = new URL(`../../results/day-06-live-streaming-display-${runId}/`, import.meta.url);
await mkdir(directory);
await writeFile(new URL("protocol.json", directory), JSON.stringify({
  request: "Show table", expectedType: "table", expectedRows: [{ net_revenue: "7225.00" }],
  promptVersion: DISPLAY_SELECTION_PROMPT_VERSION, model: config.model.model,
  reasoningEffort: config.model.reasoningEffort, settings: DISPLAY_SELECTION_SETTINGS,
  schema: displaySelectionJsonSchema, plan: NET_REVENUE_KPI_PLAN,
  completionRule: 'finish_reason "stop" and [DONE]', checksums: before,
}, null, 2), { flag: "wx" });
const chunksUrl = new URL("chunks.jsonl", directory);
const callsUrl = new URL("calls.jsonl", directory);
await writeFile(chunksUrl, "", { flag: "wx" });
await writeFile(callsUrl, "", { flag: "wx" });

const report: {
  chunks: ModelContentChunk[]; completionStatus: "pending" | "completed" | "failed";
  finishReason: string | null; timeToFirstContentMs: number | null; totalModelDurationMs: number | null;
  metadata: ModelMetadata | null; validatedSpecification: KpiSpecification | null;
  renderedValue: string | null; error: string | null;
  observations: { status: string; result: string }[];
} = {
  chunks: [], completionStatus: "pending", finishReason: null, timeToFirstContentMs: null,
  totalModelDurationMs: null, metadata: null, validatedSpecification: null,
  renderedValue: null, error: null, observations: [],
};
let modelCalls = 0;
let executorCalls = 0;
const provider = new QwenProvider(config.model);
const executor = new DuckDBQueryPlanExecutor();
const server = createModelDisplayServer({
  async generate(request) {
    assert.equal(++modelCalls, 1, "Only one live invocation is authorized");
    assert.ok(!JSON.stringify(request).includes("7225"));
    const startedAt = performance.now();
    try {
      const result = await provider.generateStreaming(request, chunk => {
        assert.equal(executorCalls, 0, "No execution while model content is still arriving");
        report.chunks.push(chunk);
        report.timeToFirstContentMs ??= chunk.elapsedMs;
        appendFileSync(chunksUrl, `${JSON.stringify({ timestamp: new Date().toISOString(), ...chunk })}\n`);
      });
      report.completionStatus = result.stream.completion;
      report.finishReason = result.finishReason ?? null;
      report.totalModelDurationMs = result.stream.totalDurationMs;
      report.metadata = result.metadata;
      // Preserve the invocation immediately, before selectDisplay parses/validates it.
      appendFileSync(callsUrl, `${JSON.stringify({ timestamp: new Date().toISOString(), repetition: 1, request, result })}\n`);
      return result;
    } catch (error) {
      report.completionStatus = "failed";
      report.error = error instanceof Error ? error.message : String(error);
      report.totalModelDurationMs = error instanceof QwenStreamError ? error.totalDurationMs : Math.round(performance.now() - startedAt);
      report.finishReason = error instanceof QwenStreamError ? error.finishReason : null;
      appendFileSync(callsUrl, `${JSON.stringify({ timestamp: new Date().toISOString(), repetition: 1, request, rawOutput: report.chunks.map(chunk => chunk.text).join(""), error: report.error })}\n`);
      throw error;
    }
  },
}, {
  async execute(plan) {
    assert.equal(report.completionStatus, "completed");
    assert.deepEqual(plan, NET_REVENUE_KPI_PLAN);
    executorCalls++;
    const rows = await executor.execute(plan);
    await writeFile(new URL("executor-result.json", directory), JSON.stringify({ plan, rows }, null, 2), { flag: "wx" });
    assert.deepEqual(rows, [{ net_revenue: "7225.00" }]);
    return rows;
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
try {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.exposeFunction("reportLiveStreamState", (state: { status: string; result: string }) => { report.observations.push(state); });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      new MutationObserver(() => { void window.reportLiveStreamState?.({
        status: document.getElementById("status")?.textContent ?? "",
        result: document.getElementById("result")?.textContent ?? "",
      }); }).observe(document.body, { subtree: true, childList: true });
    });
    const selectedResponse = page.waitForResponse(response => response.url().endsWith("/api/select-display"), { timeout: 120_000 });
    await page.getByRole("button", { name: "Show table", exact: true }).click();
    const selected = await selectedResponse;
    const body: unknown = await selected.json();
    if (selected.status() !== 200) {
      assert.ok(body && typeof body === "object" && "error" in body);
      throw new Error(String(body.error));
    }
    assert.ok(body && typeof body === "object" && "specification" in body);
    report.validatedSpecification = parseKpiSpecification(body.specification);
    assert.equal(report.validatedSpecification.type, "table");
    await page.getByText("Display ready.", { exact: true }).waitFor();
    report.renderedValue = await page.getByRole("cell").textContent();
    assert.equal(report.renderedValue, "7225.00");
    assert.ok(report.observations.some(state => state.status === "Choosing display…" && state.result === ""));
    assert.ok(report.observations.some(state => state.status === "Running query…" && state.result === ""));
    await writeFile(new URL("rendered-page.html", directory), await page.content(), { flag: "wx" });
  } finally { await browser.close(); }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  server.close(); server.closeAllConnections(); await once(server, "close");
}
assert.deepEqual(await checksums(), before, "Frozen source changed during live run");
await writeFile(new URL("report.json", directory), JSON.stringify({ ...report, modelCalls, executorCalls, checksumsVerified: true }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...report, modelCalls, executorCalls, artifacts: directory.pathname }));
