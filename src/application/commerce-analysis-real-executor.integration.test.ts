import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { DuckDBInstance } from "@duckdb/node-api";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
} from "../ai/provider.js";
import {
  DuckDBDateIntervalLimitError,
  DuckDBQueryPlanExecutor,
} from "../db/duckdb-query-plan-executor.js";
import { runCommerceAnalysis } from "./commerce-analysis-pipeline.js";

const FIXTURE_SQL = `
  CREATE TABLE orders (
    order_date DATE NOT NULL,
    region VARCHAR NOT NULL,
    gross_amount DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) NOT NULL,
    refund_amount DECIMAL(12, 2) NOT NULL
  );

  INSERT INTO orders VALUES
    (DATE '2025-08-01', 'North', 100.00, 10.00, 5.00),
    (DATE '2025-08-15', 'South', 200.00, 20.00, 30.00);
`;

const REFERENCE_SQL = `
  SELECT
    SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
  FROM orders;
`;

let temporaryDirectory: string;
let testDatabasePath: string;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "commerce-pipeline-"));
  testDatabasePath = join(temporaryDirectory, "pipeline-test.duckdb");
  await seedDatabase();
});

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("runs the pipeline with the real executor and matches reference SQL", async () => {
  const provider = providerFor({ kind: "all_time" });
  const executor = new DuckDBQueryPlanExecutor({
    databasePath: testDatabasePath,
  });

  const result = await runCommerceAnalysis(
    provider,
    executor,
    "What is net revenue for all time?",
  );

  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;

  const referenceRows = await readReferenceRows();
  assert.deepEqual(result.tableRows, referenceRows);
  assert.deepEqual(result.tableRows, [{ net_revenue: "235.00" }]);
  assert.equal(provider.requests.length, 2);
});

test("rejects an oversized interval through the commerce analysis pipeline", async () => {
  const provider = providerFor({
    kind: "interval",
    start: "2025-01-01",
    end: "2026-01-03",
  });
  const executor = new DuckDBQueryPlanExecutor({
    databasePath: testDatabasePath,
  });

  await assert.rejects(
    runCommerceAnalysis(
      provider,
      executor,
      "What is net revenue for this oversized interval?",
    ),
    (error) => {
      assert.ok(error instanceof DuckDBDateIntervalLimitError);
      assert.equal(error.code, "QUERY_DATE_INTERVAL_TOO_LARGE");
      assert.equal(error.intervalDays, 367);
      assert.equal(error.maximumDays, 366);
      return true;
    },
  );
  assert.equal(provider.requests.length, 2);
});

function providerFor(dateRange: DateRange): DeterministicProvider {
  return new DeterministicProvider([
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
          dateRange,
          comparison: { kind: "none" },
          ordering: { kind: "none" },
          limit: { kind: "none" },
          visualization: { kind: "none" },
        },
      }),
    ),
  ]);
}

async function seedDatabase(): Promise<void> {
  const instance = await DuckDBInstance.create(testDatabasePath);
  const connection = await instance.connect();
  try {
    await connection.run(FIXTURE_SQL);
  } finally {
    try {
      connection.closeSync();
    } finally {
      instance.closeSync();
    }
  }
}

async function readReferenceRows() {
  const instance = await DuckDBInstance.create(testDatabasePath, {
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

type DateRange =
  | { kind: "all_time" }
  | { kind: "interval"; start: string; end: string };

class DeterministicProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  private nextResultIndex = 0;

  constructor(private readonly results: readonly ModelResult[]) {}

  async generate(request: ModelRequest): Promise<ModelResult> {
    this.requests.push(request);
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
      model: "deterministic-test-provider",
      tokenUsage: null,
      latencyMs: 0,
      requestId: null,
    },
    finishReason: "stop",
    refusal: null,
  };
}
