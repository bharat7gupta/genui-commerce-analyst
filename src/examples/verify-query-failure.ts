import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright-core";

import { createModelDisplayServer } from "../ui/model-display-server.js";
import { NET_REVENUE_KPI_PLAN } from "../ui/net-revenue-kpi-plan.js";

type Observation = { status: string; disabled: boolean[]; result: string };
declare global {
  interface Window { reportQueryFailureState?: (state: Observation) => Promise<void>; }
}

let failQuery = false;
let selectionCalls = 0;
let executorCalls = 0;
const server = createModelDisplayServer({
  async generate(request) {
    selectionCalls++;
    const type = request.messages.at(-1)?.content.includes("table") ? "table" : "kpi";
    return {
      text: JSON.stringify({ type, resultField: "net_revenue" }),
      toolCalls: [], finishReason: "stop", refusal: null,
      metadata: { model: "stubbed-display-selection", latencyMs: 0, tokenUsage: null, requestId: null },
    };
  },
}, {
  async execute(plan) {
    executorCalls++;
    assert.deepEqual(plan, NET_REVENUE_KPI_PLAN);
    if (failQuery) throw new Error("Simulated query error");
    // Seed a visible prior result without contacting a real model or database.
    return [{ net_revenue: "123.45" }];
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
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Show KPI", exact: true }).click();
    await page.getByText("Display ready.", { exact: true }).waitFor();
    assert.equal(await page.locator("#result .value").textContent(), "123.45");

    const observations: Observation[] = [];
    await page.exposeFunction("reportQueryFailureState", (state: Observation) => { observations.push(state); });
    await page.evaluate(() => {
      new MutationObserver(() => { void window.reportQueryFailureState?.({
        status: document.getElementById("status")?.textContent ?? "",
        disabled: Array.from(document.querySelectorAll("button")).map(button => button.disabled),
        result: document.getElementById("result")?.textContent ?? "",
      }); }).observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "aria-busy"],
      });
    });
    failQuery = true;
    const selectedResponse = page.waitForResponse(response => response.url().endsWith("/api/select-display"));
    const queryResponse = page.waitForResponse(response => response.url().endsWith("/api/run-query"));
    await page.getByRole("button", { name: "Show table", exact: true }).click();
    const selected = await selectedResponse;
    assert.equal(selected.status(), 200);
    assert.deepEqual(await selected.json(), {
      specification: { type: "table", resultField: "net_revenue" },
      dateRange: NET_REVENUE_KPI_PLAN.dateRange,
    });
    assert.equal((await queryResponse).status(), 503);
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").textContent(), "Query failed: Simulated query error");
    assert.equal(await page.locator("#result").textContent(), "");
    assert.equal(await page.locator("#result .kpi, #result .value, #result table").count(), 0);
    assert.equal(await page.locator("#result").getAttribute("aria-busy"), "false");
    for (const name of ["Show KPI", "Show table"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).isEnabled(), true);
    }
    const transitions = observations.map(state => state.status)
      .filter((status, index, statuses) => index === 0 || status !== statuses[index - 1]);
    assert.deepEqual(transitions, ["Choosing display…", "Running query…", "Query failed: Simulated query error"]);
    for (const state of observations) {
      assert.equal(state.result, "", "The previous result must stay cleared throughout failure");
      assert.deepEqual(state.disabled, state.status.startsWith("Query failed:") ? [false, false] : [true, true]);
    }
    assert.equal(selectionCalls, 2);
    assert.equal(executorCalls, 2); // One setup request and one failing request, with no retries.
    console.log(JSON.stringify({
      selectedSpecification: { type: "table", resultField: "net_revenue" },
      transitions, observations, previousResultCleared: true, renderedComponents: 0,
      bothButtonsEnabled: true, failingRequestSelectionCalls: 1, failingRequestExecutorCalls: 1,
      liveModelCalls: 0, realDatabaseCalls: 0,
    }));
  } finally { await browser.close(); }
} finally {
  server.close(); server.closeAllConnections(); await once(server, "close");
}
