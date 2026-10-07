import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright-core";

import type { ModelProvider } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { createModelDisplayServer } from "../ui/model-display-server.js";

type Observation = { status: string; disabled: boolean[]; result: string };
declare global {
  interface Window { reportDisplayState?: (state: Observation) => Promise<void>; }
}

// Test-only dependency injection; no failure switches are exposed in the UI/API.
let simulateFailure = false;
let providerCalls = 0;
let queryCalls = 0;
const realProvider = new QwenProvider(config.model);
const provider: ModelProvider = {
  async generate(request) {
    providerCalls++;
    if (simulateFailure) throw new Error("Simulated provider failure");
    return realProvider.generate(request);
  },
};
const realExecutor = new DuckDBQueryPlanExecutor();
const server = createModelDisplayServer(provider, {
  async execute(plan) { queryCalls++; return realExecutor.execute(plan); },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");

try {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const observations: Observation[] = [];
    await page.exposeFunction("reportDisplayState", (state: Observation) => { observations.push(state); });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      new MutationObserver(() => { void window.reportDisplayState?.({
        status: document.getElementById("status")?.textContent ?? "",
        disabled: Array.from(document.querySelectorAll("button")).map(button => button.disabled),
        result: document.getElementById("result")?.textContent ?? "",
      }); }).observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "aria-busy"],
      });
    });

    await page.getByRole("button", { name: "Show KPI", exact: true }).click();
    await page.getByText("Display ready.", { exact: true }).waitFor({ timeout: 120_000 });
    assert.equal(await page.locator(".value").textContent(), "7225.00");
    assert.match(await page.locator("#result").innerText(), /net_revenue/);
    assert.match(await page.locator("#result").innerText(), /2025-08-01/);
    assert.match(await page.locator("#result").innerText(), /2025-09-01/);
    assert.ok(observations.some(state => state.status === "Choosing display…" &&
      state.disabled.every(Boolean) && state.result === ""));
    assert.ok(observations.some(state => state.status === "Running query…" &&
      state.disabled.every(Boolean) && state.result === ""));
    assert.equal(await page.getByRole("button", { name: "Show table", exact: true }).isEnabled(), true);
    console.log(JSON.stringify({ case: "real success", observations: [...observations], providerCalls, queryCalls }));

    observations.length = 0;
    simulateFailure = true;
    await page.getByRole("button", { name: "Show table", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").textContent(), "Display generation failed: Simulated provider failure");
    assert.equal(await page.locator("#result").textContent(), "");
    assert.ok(observations.some(state => state.status === "Choosing display…" &&
      state.disabled.every(Boolean) && state.result === ""));
    assert.ok(!observations.some(state => state.status === "Running query…"));
    assert.equal(queryCalls, 1, "A failed provider must not execute DuckDB");
    assert.equal(providerCalls, 2, "One provider invocation per click; no retries");
    assert.equal(await page.getByRole("button", { name: "Show KPI", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Show table", exact: true }).isEnabled(), true);
    console.log(JSON.stringify({ case: "simulated provider failure", observations: [...observations], providerCalls, queryCalls }));
  } finally {
    await browser.close();
  }
} finally {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
}
