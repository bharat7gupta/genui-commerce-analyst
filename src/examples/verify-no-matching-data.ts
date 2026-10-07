import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { chromium } from "playwright-core";

import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { createModelDisplayServer } from "../ui/model-display-server.js";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "net-revenue-zero-"));
const fixturePath = join(temporaryDirectory, "zero.duckdb");
try {
  const instance = await DuckDBInstance.create(fixturePath);
  const connection = await instance.connect();
  try {
    await connection.run(`
      CREATE TABLE orders (
        order_date DATE NOT NULL, region VARCHAR NOT NULL,
        gross_amount DECIMAL(12,2) NOT NULL,
        discount_amount DECIMAL(12,2) NOT NULL,
        refund_amount DECIMAL(12,2) NOT NULL
      );
      INSERT INTO orders VALUES
        (DATE '2026-01-01', 'North', 100.00, 10.00, 90.00),
        (DATE '2026-01-15', 'South', 50.00, 50.00, 0.00),
        (DATE '2026-02-01', 'North', 25.00, 0.00, 0.00);
    `);
    // Independent evidence of two matches with a true zero; the positive end-date row is excluded.
    const reference = (await connection.runAndReadAll(`
      SELECT COUNT(*)::INTEGER AS matching_orders,
        SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders WHERE order_date >= DATE '2026-01-01' AND order_date < DATE '2026-02-01';
    `)).getRowObjectsJson();
    assert.deepEqual(reference, [{ matching_orders: 2, net_revenue: "0.00" }]);
    console.log(JSON.stringify({ case: "zero fixture reference", rows: reference }));
  } finally { connection.closeSync(); instance.closeSync(); }

  let useFixture = false;
  const realExecutor = new DuckDBQueryPlanExecutor();
  const fixtureExecutor = new DuckDBQueryPlanExecutor({ databasePath: fixturePath });
  const server = createModelDisplayServer({
    // Deterministic display selection: no model calls or prompt changes are needed for this data-state test.
    async generate(request) {
      const type = request.messages.at(-1)?.content.includes("table") ? "table" : "kpi";
      return {
        text: JSON.stringify({ type, resultField: "net_revenue" }), toolCalls: [], finishReason: "stop",
        metadata: { model: "deterministic-display-fixture", latencyMs: 0, tokenUsage: null, requestId: null },
      };
    },
  }, {
    async execute(plan) {
      const rows = await (useFixture ? fixtureExecutor : realExecutor).execute(plan);
      assert.deepEqual(rows, [{ net_revenue: useFixture ? "0.00" : null }]);
      console.log(JSON.stringify({ case: useFixture ? "zero with matches" : "real no matches", plan, rawExecutorResult: rows }));
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
      await page.getByLabel("Start (inclusive)").fill("2026-01-01");
      await page.getByLabel("End (exclusive)").fill("2026-02-01");
      for (const name of ["Show KPI", "Show table"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await page.getByText("Display ready.", { exact: true }).waitFor();
        assert.match(await page.locator("#result").innerText(), /No matching data for this date range/);
        assert.match(await page.locator("#result").innerText(), /2026-01-01 \(inclusive\).*2026-02-01 \(exclusive\)/);
        assert.equal(await page.locator("#result .value, #result table").count(), 0);
        console.log(JSON.stringify({ display: name, source: "real database", observed: "No matching data for this date range" }));
      }
      useFixture = true;
      for (const name of ["Show KPI", "Show table"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await page.getByText("Display ready.", { exact: true }).waitFor();
        // Result is cleared synchronously before the asynchronous query response.
        const value = name === "Show KPI" ? page.locator("#result .value") : page.getByRole("cell");
        await value.waitFor();
        assert.equal(await value.textContent(), "0.00");
        assert.ok(!(await page.locator("#result").innerText()).includes("No matching data"));
        console.log(JSON.stringify({ display: name, source: "two-order fixture", observed: "0.00" }));
      }
    } finally { await browser.close(); }
  } finally {
    server.close(); server.closeAllConnections(); await once(server, "close");
  }
} finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
