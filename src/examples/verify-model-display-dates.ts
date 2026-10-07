import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright-core";

import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import type { QueryPlan } from "../query-plan/query-plan.js";
import { createModelDisplayServer } from "../ui/model-display-server.js";

const expectedPlan = {
  version: "query-plan-v1",
  metric: { kind: "metric", value: "net_revenue" },
  dimensions: { kind: "specified", values: [] },
  filters: { kind: "specified", items: [] },
  dateRange: { kind: "interval", start: "2025-08-02", end: "2025-08-04" },
  comparison: { kind: "none" },
  ordering: { kind: "none" },
  limit: { kind: "none" },
  visualization: { kind: "none" },
} satisfies QueryPlan;
let providerCalls = 0;
const executedPlans: QueryPlan[] = [];
const provider = new QwenProvider(config.model);
const executor = new DuckDBQueryPlanExecutor();
const server = createModelDisplayServer({
  async generate(request) { providerCalls++; return provider.generate(request); },
}, {
  async execute(plan) {
    executedPlans.push(plan);
    assert.deepEqual(plan, expectedPlan);
    const rows = await executor.execute(plan);
    assert.deepEqual(rows, [{ net_revenue: "1100.00" }]);
    console.log(JSON.stringify({ case: "valid interval", executedPlan: plan, executorResult: rows }));
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
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForLoadState("networkidle");
    const start = page.getByLabel("Start (inclusive)");
    const end = page.getByLabel("End (exclusive)");
    assert.equal(await start.inputValue(), "2025-08-01");
    assert.equal(await end.inputValue(), "2025-09-01");
    await start.fill("2025-08-02");
    await end.fill("2025-08-04");
    await page.getByRole("button", { name: "Show table", exact: true }).click();
    await page.getByText("Display ready.", { exact: true }).waitFor({ timeout: 120_000 });
    assert.equal(await page.getByRole("cell").textContent(), "1100.00");
    assert.match(await page.locator("#result").innerText(), /2025-08-02 \(inclusive\).*2025-08-04 \(exclusive\)/);
    assert.equal(providerCalls, 1);
    assert.equal(executedPlans.length, 1);

    await start.fill("2025-08-04");
    assert.equal(await page.locator("#result").textContent(), "", "Editing a date must clear the old result immediately");
    await end.fill("2025-08-02");
    await page.getByRole("button", { name: "Show KPI", exact: true }).click();
    await page.getByRole("alert").waitFor();
    const error = await page.getByRole("alert").textContent();
    assert.match(error ?? "", /dateRange.start must be earlier than dateRange.end/);
    assert.equal(await page.locator("#result").textContent(), "");
    assert.equal(providerCalls, 1, "A reversed interval must not reach the model");
    assert.equal(executedPlans.length, 1, "A reversed interval must not execute DuckDB");
    assert.equal(await start.isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Show table", exact: true }).isEnabled(), true);
    console.log(JSON.stringify({
      case: "reversed interval", start: "2025-08-04", end: "2025-08-02", error,
      additionalProviderCalls: 0, additionalExecutorCalls: 0, previousResultClearedOnEdit: true,
    }));

    // The execution endpoint also enforces validation when called directly.
    const response = await page.request.post(`http://127.0.0.1:${address.port}/api/run-query`, {
      data: { specification: { type: "kpi", resultField: "net_revenue" }, start: "2025-08-04", end: "2025-08-02" },
    });
    assert.equal(response.status(), 400);
    assert.equal(executedPlans.length, 1);
  } finally { await browser.close(); }
} finally {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
}
