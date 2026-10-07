import assert from "node:assert/strict";

import { DuckDBInstance } from "@duckdb/node-api";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
} from "../ai/provider.js";
import { runCommerceAnalysis } from "../application/commerce-analysis-pipeline.js";
import { databasePath } from "../db/connection.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";

const QUESTION = "What is net revenue for all time?";
const REFERENCE_SQL = `
  SELECT
    SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
  FROM orders;
`;

class DeterministicProvider implements ModelProvider {
  private nextResultIndex = 0;

  constructor(private readonly results: readonly ModelResult[]) {}

  async generate(_request: ModelRequest): Promise<ModelResult> {
    const result = this.results[this.nextResultIndex];
    this.nextResultIndex += 1;
    if (result === undefined) {
      throw new Error("Unexpected additional model request");
    }
    return result;
  }
}

function modelResult(text: string): ModelResult {
  return {
    text,
    toolCalls: [],
    metadata: {
      model: "deterministic-example-provider",
      tokenUsage: null,
      latencyMs: 0,
      requestId: null,
    },
    finishReason: "stop",
    refusal: null,
  };
}

const provider = new DeterministicProvider([
  modelResult("analytics"),
  modelResult(
    JSON.stringify({
      schemaVersion: "query-plan-output-v1",
      outcome: "query_plan",
      queryPlan: {
        version: "query-plan-v1",
        metric: { kind: "metric", value: "net_revenue" },
        dimensions: { kind: "specified", values: [] },
        filters: { kind: "specified", items: [] },
        dateRange: { kind: "all_time" },
        comparison: { kind: "none" },
        ordering: { kind: "none" },
        limit: { kind: "none" },
        visualization: { kind: "none" },
      },
    }),
  ),
]);
const executor = new DuckDBQueryPlanExecutor();
const result = await runCommerceAnalysis(provider, executor, QUESTION);

assert.equal(result.outcome, "completed");

const referenceRows = await readReferenceRows();
assert.deepEqual(result.tableRows, referenceRows);

console.log(
  JSON.stringify(
    {
      question: QUESTION,
      routingDecision: result.routingDecision,
      queryPlan: result.queryPlan,
      tableRows: result.tableRows,
      referenceRows,
      verified: true,
    },
    null,
    2,
  ),
);

async function readReferenceRows() {
  const instance = await DuckDBInstance.create(databasePath, {
    access_mode: "READ_ONLY",
  });
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(REFERENCE_SQL);
    return reader.getRowObjectsJson();
  } finally {
    try {
      connection.closeSync();
    } finally {
      instance.closeSync();
    }
  }
}
