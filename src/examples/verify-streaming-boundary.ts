import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium, type Page } from "playwright-core";

import { createModelDisplayServer } from "../ui/model-display-server.js";

// Test-only gates allow inspection after each chunk and before the completion marker.
function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const chunks = ['{"type": "ta', 'ble", "resultF', 'ield": "net_revenue"}'];
function simulatedStream(parts: readonly string[], completes: boolean) {
  const started = gate();
  const finished = gate();
  const steps = parts.map(text => ({ text, delivered: gate(), consumed: gate() }));
  const events: { event: string; text?: string }[] = [];
  let accumulated = "";
  return {
    started, finished, steps, events,
    async collect() {
      started.release();
      for (const step of steps) {
        await step.delivered.promise;
        accumulated += step.text;
        events.push({ event: "chunk accumulated", text: accumulated });
        step.consumed.release();
      }
      // Even syntactically complete text remains unparsed until completion is signaled.
      await finished.promise;
      if (!completes) {
        events.push({ event: "stream ended early", text: accumulated });
        throw new Error("Simulated display stream ended early before completion");
      }
      events.push({ event: "stream completed", text: accumulated });
      return accumulated;
    },
  };
}

const complete = simulatedStream(chunks, true);
const early = simulatedStream(chunks.slice(0, 2), false);
const streams = [complete, early];
let selectionCalls = 0;
let executorCalls = 0;
const queryStarted = gate();
const queryFinished = gate();
const FIXTURE = [{ net_revenue: "7225.00" }];
const server = createModelDisplayServer({
  async generate() {
    const stream = streams[selectionCalls++];
    assert.ok(stream, "No extra generation calls or retries expected");
    const text = await stream.collect();
    // Existing selectDisplay parses and validates only after this complete response returns.
    return {
      text, toolCalls: [], finishReason: "stop", refusal: null,
      metadata: { model: "simulated-chunks", latencyMs: 0, tokenUsage: null, requestId: null },
    };
  },
}, {
  async execute() {
    executorCalls++;
    queryStarted.release();
    await queryFinished.promise;
    return FIXTURE;
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");

async function verifyPending(page: Page) {
  assert.equal(await page.locator("#status").textContent(), "Choosing display…");
  assert.equal(await page.locator("#result").textContent(), "");
  assert.equal(await page.locator("#result .kpi, #result table").count(), 0);
  for (const name of ["Show KPI", "Show table"]) {
    assert.equal(await page.getByRole("button", { name, exact: true }).isEnabled(), false);
  }
}

try {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
  });
  try {
    const page = await browser.newPage();
    let selectionResponses = 0;
    page.on("response", response => { if (response.url().endsWith("/api/select-display")) selectionResponses++; });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForLoadState("networkidle");
    const selectedResponse = page.waitForResponse(response => response.url().endsWith("/api/select-display"));
    await page.getByRole("button", { name: "Show table", exact: true }).click();
    await complete.started.promise;
    for (const [index, step] of complete.steps.entries()) {
      step.delivered.release();
      await step.consumed.promise;
      await verifyPending(page);
      assert.equal(selectionResponses, 0);
      assert.equal(executorCalls, 0);
      console.log(JSON.stringify({ chunk: index + 1, text: step.text, state: "Choosing display…", modelOutputValidated: false, rendered: false }));
    }
    complete.finished.release();
    const selected = await selectedResponse;
    assert.equal(selected.status(), 200);
    const body = await selected.json();
    assert.deepEqual(body.specification, { type: "table", resultField: "net_revenue" });
    complete.events.push({ event: "complete model specification parsed and validated" });
    await queryStarted.promise;
    assert.equal(await page.locator("#status").textContent(), "Running query…");
    assert.equal(await page.locator("#result").textContent(), "");
    queryFinished.release();
    await page.getByText("Display ready.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("cell").textContent(), "7225.00");
    complete.events.push({ event: "table rendered using separate executor-result fixture" });
    console.log(JSON.stringify({ case: "complete stream", chunks, events: complete.events, displayedValue: "7225.00", liveModelCalls: 0, databaseCalls: 0 }));

    await page.getByRole("button", { name: "Show table", exact: true }).click();
    await early.started.promise;
    for (const step of early.steps) {
      step.delivered.release();
      await step.consumed.promise;
      await verifyPending(page);
      assert.equal(selectionResponses, 1);
      assert.equal(executorCalls, 1);
    }
    early.finished.release();
    await page.getByRole("alert").waitFor();
    const error = await page.getByRole("alert").textContent();
    assert.equal(error, "Display generation failed: Simulated display stream ended early before completion");
    assert.equal(await page.locator("#result").textContent(), "");
    assert.equal(await page.locator("#result .kpi, #result table").count(), 0);
    assert.equal(executorCalls, 1, "The early stream must not reach the fixture executor");
    assert.equal(selectionCalls, 2, "No automatic retries");
    for (const name of ["Show KPI", "Show table"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).isEnabled(), true);
    }
    console.log(JSON.stringify({
      case: "early-ended stream", chunks: chunks.slice(0, 2), events: early.events, error,
      modelOutputValidated: false, rendered: false, previousResultCleared: true,
      additionalExecutorCalls: 0, liveModelCalls: 0, databaseCalls: 0,
    }));
  } finally { await browser.close(); }
} finally {
  server.close(); server.closeAllConnections(); await once(server, "close");
}
