import { createServer, type ServerResponse } from "node:http";

import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { KPI_SPECIFICATION, TABLE_SPECIFICATION, UiSpecificationValidationError } from "./kpi-specification.js";
import { renderKpiPage } from "./net-revenue-kpi-page.js";
import { NET_REVENUE_KPI_PLAN as plan } from "./net-revenue-kpi-plan.js";

const executor = new DuckDBQueryPlanExecutor();

async function servePage(response: ServerResponse, specification: unknown): Promise<void> {
  try {
    // The existing executor compiles, applies policy, and reads DuckDB on the server.
    const rows = await executor.execute(plan);
    const html = renderKpiPage(specification, rows);
    console.log(JSON.stringify({ plan, specification, executorResult: rows }));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(html);
  } catch (error) {
    console.error("Net revenue page failed:", error);
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(error instanceof UiSpecificationValidationError
      ? error.message
      : "Net revenue is unavailable. Check the server log and ensure data/commerce.duckdb exists.");
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && (request.url === "/" || request.url === "/table")) {
    void servePage(response, request.url === "/table" ? TABLE_SPECIFICATION : KPI_SPECIFICATION);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(3000, "127.0.0.1", () => {
  console.log("Net revenue KPI: http://127.0.0.1:3000");
});
