import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { DuckDBInstance } from "@duckdb/node-api";

import type { QueryPlan } from "../query-plan/query-plan.js";
import {
  DuckDBDateIntervalLimitError,
  DuckDBExecutionTimeoutError,
  DuckDBQueryPlanExecutor,
} from "./duckdb-query-plan-executor.js";

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

const EXPENSIVE_FIXTURE_SQL = `
  CREATE VIEW orders AS
  SELECT
    DATE '2025-08-01' AS order_date,
    'North' AS region,
    CAST((generated_id % 100) + 1 AS DECIMAL(12, 2)) AS gross_amount,
    CAST(0 AS DECIMAL(12, 2)) AS discount_amount,
    CAST(0 AS DECIMAL(12, 2)) AS refund_amount
  FROM range(1000000000000) AS generated(generated_id);
`;

const RECOVERY_FIXTURE_SQL = `
  CREATE TABLE orders (
    order_date DATE NOT NULL,
    region VARCHAR NOT NULL,
    gross_amount DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) NOT NULL,
    refund_amount DECIMAL(12, 2) NOT NULL
  );

  INSERT INTO orders VALUES
    (DATE '2025-08-01', 'North', 10.00, 1.00, 0.00);
`;

let temporaryDirectory: string;
let testDatabasePath: string;
let expensiveDatabasePath: string;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "commerce-executor-"));
  testDatabasePath = join(temporaryDirectory, "commerce-test.duckdb");
  expensiveDatabasePath = join(temporaryDirectory, "expensive-test.duckdb");

  await seedDatabase(testDatabasePath, FIXTURE_SQL);
  await seedDatabase(expensiveDatabasePath, EXPENSIVE_FIXTURE_SQL);
});

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("executes all-time net revenue and preserves the decimal string", async () => {
  const executor = new DuckDBQueryPlanExecutor({
    databasePath: testDatabasePath,
  });
  const actualRows = await executor.execute(makePlan());
  const referenceRows = await runReferenceQuery(REFERENCE_ALL_TIME_SQL);
  const expectedRows = [{ net_revenue: EXPECTED_ALL_TIME_AMOUNT }];

  assert.deepEqual(actualRows, referenceRows);
  assert.deepEqual(actualRows, expectedRows);
  assert.equal(typeof actualRows[0]?.net_revenue, "string");
});

test("binds the half-open interval and region filter during execution", async () => {
  const executor = new DuckDBQueryPlanExecutor({
    databasePath: testDatabasePath,
  });
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

test("executes an explicit interval exactly at the 366-day maximum", async () => {
  const executor = new DuckDBQueryPlanExecutor({
    databasePath: testDatabasePath,
  });

  assert.deepEqual(
    await executor.execute(
      makePlan({
        dateRange: {
          kind: "interval",
          start: "2025-01-01",
          end: "2026-01-02",
        },
      }),
    ),
    [{ net_revenue: EXPECTED_ALL_TIME_AMOUNT }],
  );
});

test("rejects an explicit interval one day beyond the maximum before opening DuckDB", async () => {
  const missingDatabasePath = join(
    temporaryDirectory,
    "must-not-be-opened.duckdb",
  );
  const executor = new DuckDBQueryPlanExecutor({
    databasePath: missingDatabasePath,
  });

  await assert.rejects(
    executor.execute(
      makePlan({
        dateRange: {
          kind: "interval",
          start: "2025-01-01",
          end: "2026-01-03",
        },
      }),
    ),
    (error) => {
      assert.ok(error instanceof DuckDBDateIntervalLimitError);
      assert.equal(error.code, "QUERY_DATE_INTERVAL_TOO_LARGE");
      assert.equal(error.intervalDays, 367);
      assert.equal(error.maximumDays, 366);
      return true;
    },
  );

  await assert.rejects(
    DuckDBInstance.create(missingDatabasePath, { access_mode: "READ_ONLY" }),
  );
});

test(
  "interrupts an expensive query and permits a subsequent invocation",
  { timeout: 15_000 },
  async () => {
    const executor = new DuckDBQueryPlanExecutor({
      databasePath: expensiveDatabasePath,
      executionDeadlineMs: 25,
    });

    await assert.rejects(
      executor.execute(makePlan()),
      (error) => {
        assert.ok(error instanceof DuckDBExecutionTimeoutError);
        assert.equal(error.code, "QUERY_EXECUTION_TIMEOUT");
        assert.equal(error.deadlineMs, 25);
        assert.match(String(error.cause), /interrupt/i);
        return true;
      },
    );

    await rm(expensiveDatabasePath, { force: true });
    await rm(`${expensiveDatabasePath}.wal`, { force: true });
    await seedDatabase(expensiveDatabasePath, RECOVERY_FIXTURE_SQL);

    assert.deepEqual(await executor.execute(makePlan()), [
      { net_revenue: "9.00" },
    ]);
  },
);

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

async function seedDatabase(path: string, sql: string): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();
  try {
    await connection.run(sql);
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
