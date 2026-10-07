import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright-core";

import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { createModelDisplayServer } from "../ui/model-display-server.js";

declare global {
  interface Window { reportClarificationTransition?: (status: string) => Promise<void>; }
}
let selectionCalls = 0;
let executorCalls = 0;
const executor = new DuckDBQueryPlanExecutor();
const server = createModelDisplayServer({
  // Stub display selection to test clarification deterministically, with no live model calls.
  async generate(request) {
    selectionCalls++;
    const type = request.messages.at(-1)?.content.includes("table") ? "table" : "kpi";
    return {
      text: JSON.stringify({ type, resultField: "net_revenue" }), toolCalls: [], finishReason: "stop",
      metadata: { model: "clarification-fixture", latencyMs: 0, tokenUsage: null, requestId: null },
    };
  },
}, {
  async execute(plan) { executorCalls++; return executor.execute(plan); },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;
try {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  });
  try {
    const page = await browser.newPage();
    let apiRequests = 0;
    page.on("request", request => { if (request.url().includes("/api/")) apiRequests++; });
    await page.goto(baseUrl);
    await page.waitForLoadState("networkidle");
    const showKpi = page.getByRole("button", { name: "Show KPI", exact: true });
    const end = page.getByLabel("End (exclusive)");
    await showKpi.click();
    await page.getByText("Display ready.", { exact: true }).waitFor();
    assert.equal(await page.locator("#result .value").textContent(), "7225.00");
    assert.equal(selectionCalls, 1);
    assert.equal(executorCalls, 1);
    const requestsBefore = apiRequests;

    await end.fill("");
    assert.equal(await page.locator("#result").textContent(), "");
    await showKpi.click();
    assert.equal(await page.locator("#status").textContent(), "Choose a start and end date");
    assert.equal(await page.locator("#missing-dates").textContent(), "Missing input: End (exclusive).");
    assert.equal(await end.getAttribute("aria-invalid"), "true");
    assert.equal(await end.getAttribute("aria-describedby"), "missing-dates");
    assert.equal(await page.locator("#result").textContent(), "");
    assert.equal(selectionCalls, 1);
    assert.equal(executorCalls, 1);
    assert.equal(apiRequests, requestsBefore, "A missing date must not even submit a selection request");
    assert.equal(await showKpi.isEnabled(), true);
    console.log(JSON.stringify({
      case: "missing end date", state: "Choose a start and end date", missingInput: "End (exclusive)",
      additionalSelectionCalls: 0, additionalExecutorCalls: 0, apiRequests: 0, staleResult: false,
    }));

    // Both server endpoints also clarify omitted dates before doing any work.
    for (const endpoint of ["/api/select-display", "/api/run-query"]) {
      const response = await page.request.post(`${baseUrl}${endpoint}`, {
        data: { specification: { type: "kpi", resultField: "net_revenue" }, start: "2025-08-01" },
      });
      assert.equal(response.status(), 400);
      assert.deepEqual(await response.json(), {
        outcome: "clarification", error: "Choose a start and end date", missingInputs: ["end"],
      });
    }
    assert.equal(selectionCalls, 1);
    assert.equal(executorCalls, 1);

    const observations: string[] = [];
    await page.exposeFunction("reportClarificationTransition", (status: string) => { observations.push(status); });
    await page.evaluate(() => {
      const status = document.getElementById("status");
      if (status) new MutationObserver(() => {
        void window.reportClarificationTransition?.(status.textContent ?? "");
      }).observe(status, { childList: true });
    });
    await end.fill("2025-09-01");
    assert.equal(await end.getAttribute("aria-invalid"), null);
    assert.equal(await page.locator("#missing-dates").textContent(), "");
    await showKpi.click();
    await page.getByText("Display ready.", { exact: true }).waitFor();
    assert.equal(await page.locator("#result .value").textContent(), "7225.00");
    assert.equal(selectionCalls, 2);
    assert.equal(executorCalls, 2);
    const transitions = observations.filter((status, index) => index === 0 || status !== observations[index - 1]);
    assert.deepEqual(transitions, ["Choose a display.", "Choosing display…", "Running query…", "Display ready."]);
    console.log(JSON.stringify({
      case: "end date provided", transitions, displayedValue: "7225.00",
      additionalSelectionCalls: 1, additionalExecutorCalls: 1, liveModelCalls: 0,
      dateRange: { start: "2025-08-01", end: "2025-09-01" },
    }));
  } finally { await browser.close(); }
} finally {
  server.close(); server.closeAllConnections(); await once(server, "close");
}
