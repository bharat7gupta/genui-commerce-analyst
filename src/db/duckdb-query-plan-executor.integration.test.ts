import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { DuckDBInstance } from "@duckdb/node-api";

import type { QueryPlan } from "../query-plan/query-plan.js";
import { DuckDBQueryPlanExecutor } from "./duckdb-query-plan-executor.js";

// Independently calculated from the four fixture rows:
// 85.00 + 150.00 + 250.00 + 350.00.
const EXPECTED_ALL_TIME_AMOUNT = "835.00";
// The inclusive start contributes 85.00 and the inside row contributes 150.00.
// The 250.00 exclusive-end row and 350.00 South row do not contribute.
const EXPECTED_FILTERED_AMOUNT = "235.00";

const REFERENCE_ALL_TIME_SQL = `
  SELECT
    SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
  FROM orders;
`;

const REFERENCE_FILTERED_SQL = `
  SELECT
    SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
  FROM orders
  WHERE order_date >= DATE '2025-08-01'
    AND order_date < DATE '2025-09-01'
    AND region = 'North';
`;

const FIXTURE_SQL = `
  CREATE TABLE orders (
    order_id VARCHAR PRIMARY KEY,
    customer_id VARCHAR NOT NULL,
    order_date DATE NOT NULL,
    region VARCHAR NOT NULL,
    category VARCHAR NOT NULL,
    gross_amount DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) NOT NULL,
    refund_amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR NOT NULL
  );

  INSERT INTO orders VALUES
    ('START', 'C001', DATE '2025-08-01', 'North', 'Home', 100.00, 10.00,  5.00, 'partially_refunded'),
    ('INSIDE', 'C002', DATE '2025-08-15', 'North', 'Home', 200.00, 20.00, 30.00, 'partially_refunded'),
    ('END', 'C003', DATE '2025-09-01', 'North', 'Home', 300.00, 30.00, 20.00, 'partially_refunded'),
    ('OTHER_REGION', 'C004', DATE '2025-08-20', 'South', 'Home', 400.00, 40.00, 10.00, 'partially_refunded');
`;

let temporaryDirectory: string;
let testDatabasePath: string;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "commerce-executor-"));
  testDatabasePath = join(temporaryDirectory, "commerce-test.duckdb");

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
});

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("executes all-time net revenue and preserves the decimal string", async () => {
  const executor = new DuckDBQueryPlanExecutor(testDatabasePath);
  const actualRows = await executor.execute(makePlan());
  const referenceRows = await runReferenceQuery(REFERENCE_ALL_TIME_SQL);
  const expectedRows = [{ net_revenue: EXPECTED_ALL_TIME_AMOUNT }];

  assert.deepEqual(actualRows, referenceRows);
  assert.deepEqual(actualRows, expectedRows);
  assert.equal(typeof actualRows[0]?.net_revenue, "string");
});

test("binds the half-open interval and region filter during execution", async () => {
  const executor = new DuckDBQueryPlanExecutor(testDatabasePath);
  const actualRows = await executor.execute(
    makePlan({
      dateRange: {
        kind: "interval",
        start: "2025-08-01",
        end: "2025-09-01",
      },
      filters: {
        kind: "specified",
        items: [{ field: "region", operator: "eq", value: "North" }],
      },
    }),
  );
  const referenceRows = await runReferenceQuery(REFERENCE_FILTERED_SQL);
  const expectedRows = [{ net_revenue: EXPECTED_FILTERED_AMOUNT }];

  assert.deepEqual(actualRows, referenceRows);
  assert.deepEqual(actualRows, expectedRows);
  assert.equal(typeof actualRows[0]?.net_revenue, "string");
});

async function runReferenceQuery(sql: string) {
  const instance = await DuckDBInstance.create(testDatabasePath, {
    access_mode: "READ_ONLY",
  });
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  } finally {
    try {
      connection.closeSync();
    } finally {
      instance.closeSync();
    }
  }
}

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: { kind: "specified", items: [] },
    dateRange: { kind: "all_time" },
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "none" },
    ...overrides,
  };
}
