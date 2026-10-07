import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";

import type { ModelProvider } from "../ai/provider.js";
import type { QueryPlanExecutor } from "../application/commerce-analysis-pipeline.js";
import { selectDisplay } from "./display-selection.js";
import { MissingDatesError, parseModelDisplayRequest } from "./model-display-request.js";
import { renderKpiFragment } from "./net-revenue-kpi-page.js";

const QUESTIONS = {
  kpi: "Show the net revenue as a KPI card.",
  table: "Show the net revenue in a table.",
} as const;

function BrowserPage() {
  return (
    <html lang="en"><head>
      <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Choose the net revenue display</title>
      <style>{`
        * { box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; color: #172a3a; background: #f4f6f8; margin: 0; }
        main { max-width: 640px; margin: 8vh auto; padding: 24px; }
        h1 { font-size: 24px; } h2 { font-size: 16px; }
        button { padding: 12px 18px; margin-right: 12px; border-radius: 8px;
          border: 1px solid #b7c6d1; background: white; font: inherit; cursor: pointer; }
        button:disabled { opacity: .5; cursor: wait; }
        .dates { display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0; }
        label { display: grid; gap: 6px; }
        input { padding: 10px; font: inherit; border: 1px solid #b7c6d1; border-radius: 8px; }
        #status { min-height: 24px; } [role=alert] { color: #a02121; }
        .kpi { background: white; border: 1px solid #dce3e8; border-radius: 16px; padding: 28px; }
        .value { font-size: 48px; font-weight: 650; font-variant-numeric: tabular-nums; }
        dl { border-top: 1px solid #e5eaee; padding-top: 12px; }
        dt { color: #536574; font-size: 13px; margin-top: 12px; } dd { margin: 4px 0; }
        .definition { color: #536574; font-size: 14px; line-height: 1.5; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5eaee; }
      `}</style>
    </head><body><main>
      <h1>Net revenue</h1>
      <p>Choose the date range and how to display net_revenue.</p>
      <div className="dates">
        <label htmlFor="start">Start (inclusive)
          <input id="start" type="date" defaultValue="2025-08-01" required />
        </label>
        <label htmlFor="end">End (exclusive)
          <input id="end" type="date" defaultValue="2025-09-01" required />
        </label>
      </div>
      <button type="button" data-display="kpi">Show KPI</button>
      <button type="button" data-display="table">Show table</button>
      <p id="status" role="status" aria-live="polite">Choose a display.</p>
      <p id="missing-dates" />
      <div id="result" aria-busy="false" />
    </main><script type="module" src="/model-display-client.js" /></body></html>
  );
}

async function readSpecification(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024) throw new Error("UI specification request is too large.");
    chunks.push(bytes);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("UI specification request must be valid JSON."); }
  return parseModelDisplayRequest(parsed);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createModelDisplayServer(provider: ModelProvider, executor: QueryPlanExecutor) {
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end("<!doctype html>" + renderToStaticMarkup(<BrowserPage />));
      return;
    }
    if (request.method === "GET" && request.url === "/model-display-client.js") {
      const script = await readFile(new URL("./model-display-client.js", import.meta.url), "utf8");
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    if (request.method === "POST" && request.url === "/api/select-display") {
      const requested = await readSpecification(request);
      const selection = await selectDisplay(provider, QUESTIONS[requested.specification.type]);
      if (selection.outcome !== "validated") {
        json(response, 502, { error: selection.error });
        return;
      }
      json(response, 200, { specification: selection.specification, dateRange: requested.plan.dateRange });
      return;
    }
    if (request.method === "POST" && request.url === "/api/run-query") {
      const { specification, plan } = await readSpecification(request);
      try {
        const rows = await executor.execute(plan);
        json(response, 200, { html: renderKpiFragment(specification, rows, plan) });
      } catch (error) {
        json(response, 503, { error: `Query failed: ${error instanceof Error ? error.message : String(error)}` });
      }
      return;
    }
    json(response, 404, { error: "Not found" });
  }
  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof MissingDatesError) {
        json(response, 400, { outcome: "clarification", error: error.message, missingInputs: error.missingInputs });
        return;
      }
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}
