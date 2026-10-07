import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { DuckDBInstance, type Json } from "@duckdb/node-api";

import type {
  TableCell,
  TableRow,
} from "../application/commerce-analysis-pipeline.js";
import { databasePath } from "../db/connection.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { parseQueryPlan, type QueryPlan } from "../query-plan/query-plan.js";

const EXPERIMENT = "day-05-deterministic-numerical-evaluation-v1" as const;
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const resultsUrl = new URL(`${EXPERIMENT}.jsonl`, resultsDirectoryUrl);

type Region = "North" | "South" | "East" | "West";

type EvaluationCase = Readonly<{
  id: string;
  description: string;
  expectedPlan: QueryPlan;
  referenceSql: string;
  expectedAmount: string | null;
  boundaryEvidence: string | null;
  noMatchingRows: boolean;
}>;

type EvaluationRecord = Readonly<{
  timestamp: string;
  experiment: typeof EXPERIMENT;
  caseId: string;
  description: string;
  expectedPlan: QueryPlan;
  referenceSql: string;
  expectedAmount: string | null;
  expectedRows: readonly TableRow[];
  referenceRows: readonly TableRow[] | null;
  actualRows: readonly TableRow[] | null;
  boundaryEvidence: string | null;
  emptySetSemantics: "not_applicable" | "returns_null" | "returns_zero";
  actualMatchesReference: boolean | null;
  actualMatchesExpected: boolean | null;
  referenceMatchesExpected: boolean | null;
  pass: boolean;
  error: string | null;
}>;

const cases: readonly EvaluationCase[] = [
  {
    id: "all-time-all-regions",
    description: "All-time net revenue without a filter",
    expectedPlan: expectedPlan({ kind: "all_time" }),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders;
    `,
    expectedAmount: "15520.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "all-time-north",
    description: "All-time net revenue for North",
    expectedPlan: expectedPlan({ kind: "all_time" }, "North"),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE region = 'North';
    `,
    expectedAmount: "5125.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "august-all-regions",
    description: "August net revenue without a filter",
    expectedPlan: expectedPlan({
      kind: "interval",
      start: "2025-08-01",
      end: "2025-09-01",
    }),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-08-01'
        AND order_date < DATE '2025-09-01';
    `,
    expectedAmount: "7225.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "september-all-regions",
    description: "September net revenue without a filter",
    expectedPlan: expectedPlan({
      kind: "interval",
      start: "2025-09-01",
      end: "2025-10-01",
    }),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-09-01'
        AND order_date < DATE '2025-10-01';
    `,
    expectedAmount: "8295.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "august-north",
    description: "August net revenue for North",
    expectedPlan: expectedPlan(
      { kind: "interval", start: "2025-08-01", end: "2025-09-01" },
      "North",
    ),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-08-01'
        AND order_date < DATE '2025-09-01'
        AND region = 'North';
    `,
    expectedAmount: "2275.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "september-north",
    description: "September net revenue for North",
    expectedPlan: expectedPlan(
      { kind: "interval", start: "2025-09-01", end: "2025-10-01" },
      "North",
    ),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-09-01'
        AND order_date < DATE '2025-10-01'
        AND region = 'North';
    `,
    expectedAmount: "2850.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "august-south",
    description: "August net revenue for South",
    expectedPlan: expectedPlan(
      { kind: "interval", start: "2025-08-01", end: "2025-09-01" },
      "South",
    ),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-08-01'
        AND order_date < DATE '2025-09-01'
        AND region = 'South';
    `,
    expectedAmount: "1900.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "september-west",
    description: "September net revenue for West",
    expectedPlan: expectedPlan(
      { kind: "interval", start: "2025-09-01", end: "2025-10-01" },
      "West",
    ),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-09-01'
        AND order_date < DATE '2025-10-01'
        AND region = 'West';
    `,
    expectedAmount: "1225.00",
    boundaryEvidence: null,
    noMatchingRows: false,
  },
  {
    id: "start-inclusive-end-exclusive",
    description: "A two-day interval proving [start, end) boundaries",
    expectedPlan: expectedPlan({
      kind: "interval",
      start: "2025-08-02",
      end: "2025-08-04",
    }),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-08-02'
        AND order_date < DATE '2025-08-04';
    `,
    expectedAmount: "1100.00",
    boundaryEvidence:
      "Includes O001 dated 2025-08-02; excludes O002 dated exactly 2025-08-04",
    noMatchingRows: false,
  },
  {
    id: "no-matching-rows",
    description: "An interval and region filter matching no seeded rows",
    expectedPlan: expectedPlan(
      { kind: "interval", start: "2025-10-01", end: "2025-10-02" },
      "North",
    ),
    referenceSql: `
      SELECT SUM(gross_amount - discount_amount - refund_amount) AS net_revenue
      FROM orders
      WHERE order_date >= DATE '2025-10-01'
        AND order_date < DATE '2025-10-02'
        AND region = 'North';
    `,
    expectedAmount: null,
    boundaryEvidence: null,
    noMatchingRows: true,
  },
];

verifyCaseDefinitions();
await ensureResultsDoNotExist();
await mkdir(resultsDirectoryUrl, { recursive: true });
await writeFile(resultsUrl, "", { encoding: "utf8", flag: "wx" });

const executor = new DuckDBQueryPlanExecutor();
const referenceInstance = await DuckDBInstance.create(databasePath, {
  access_mode: "READ_ONLY",
});
const referenceConnection = await referenceInstance.connect();
const records: EvaluationRecord[] = [];

try {
  for (const [index, evaluationCase] of cases.entries()) {
    console.log(`[${index + 1}/${cases.length}] ${evaluationCase.id}`);
    const record = await evaluateCase(evaluationCase);
    records.push(record);
    await appendFile(resultsUrl, `${JSON.stringify(record)}\n`, "utf8");
    console.log(
      `  ${record.pass ? "pass" : "fail"}: ${JSON.stringify(record.actualRows)}`,
    );
  }
} finally {
  try {
    referenceConnection.closeSync();
  } finally {
    referenceInstance.closeSync();
  }
}

const passed = records.filter(({ pass }) => pass).length;
console.log(
  JSON.stringify(
    {
      experiment: EXPERIMENT,
      cases: records.length,
      passed,
      failed: records.length - passed,
      noMatchingRowsResult:
        records.find(({ caseId }) => caseId === "no-matching-rows")
          ?.emptySetSemantics ?? null,
      results: resultsUrl.pathname,
    },
    null,
    2,
  ),
);

async function evaluateCase(
  evaluationCase: EvaluationCase,
): Promise<EvaluationRecord> {
  const expectedRows: readonly TableRow[] = [
    { net_revenue: evaluationCase.expectedAmount },
  ];
  let referenceRows: readonly TableRow[] | null = null;
  let actualRows: readonly TableRow[] | null = null;

  try {
    const [executedRows, referenceReader] = await Promise.all([
      executor.execute(evaluationCase.expectedPlan),
      referenceConnection.runAndReadAll(evaluationCase.referenceSql),
    ]);
    actualRows = executedRows;
    referenceRows = toTableRows(referenceReader.getRowObjectsJson());

    const actualMatchesReference = isDeepStrictEqual(actualRows, referenceRows);
    const actualMatchesExpected = isDeepStrictEqual(actualRows, expectedRows);
    const referenceMatchesExpected = isDeepStrictEqual(
      referenceRows,
      expectedRows,
    );
    const emptySetSemantics = evaluationCase.noMatchingRows
      ? classifyEmptySetResult(actualRows)
      : "not_applicable";

    return {
      timestamp: new Date().toISOString(),
      experiment: EXPERIMENT,
      caseId: evaluationCase.id,
      description: evaluationCase.description,
      expectedPlan: evaluationCase.expectedPlan,
      referenceSql: evaluationCase.referenceSql,
      expectedAmount: evaluationCase.expectedAmount,
      expectedRows,
      referenceRows,
      actualRows,
      boundaryEvidence: evaluationCase.boundaryEvidence,
      emptySetSemantics,
      actualMatchesReference,
      actualMatchesExpected,
      referenceMatchesExpected,
      pass:
        actualMatchesReference &&
        actualMatchesExpected &&
        referenceMatchesExpected &&
        (!evaluationCase.noMatchingRows || emptySetSemantics === "returns_null"),
      error: null,
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      experiment: EXPERIMENT,
      caseId: evaluationCase.id,
      description: evaluationCase.description,
      expectedPlan: evaluationCase.expectedPlan,
      referenceSql: evaluationCase.referenceSql,
      expectedAmount: evaluationCase.expectedAmount,
      expectedRows,
      referenceRows,
      actualRows,
      boundaryEvidence: evaluationCase.boundaryEvidence,
      emptySetSemantics: "not_applicable",
      actualMatchesReference: null,
      actualMatchesExpected: null,
      referenceMatchesExpected: null,
      pass: false,
      error: describeError(error),
    };
  }
}

function expectedPlan(
  dateRange: QueryPlan["dateRange"],
  region?: Region,
): QueryPlan {
  return {
    version: "query-plan-v1",
    metric: { kind: "metric", value: "net_revenue" },
    dimensions: { kind: "specified", values: [] },
    filters: {
      kind: "specified",
      items:
        region === undefined
          ? []
          : [{ field: "region", operator: "eq", value: region }],
    },
    dateRange,
    comparison: { kind: "none" },
    ordering: { kind: "none" },
    limit: { kind: "none" },
    visualization: { kind: "none" },
  };
}

function verifyCaseDefinitions(): void {
  if (cases.length !== 10) {
    throw new Error(`Expected exactly 10 cases, received ${cases.length}`);
  }

  const ids = new Set<string>();
  for (const evaluationCase of cases) {
    if (ids.has(evaluationCase.id)) {
      throw new Error(`Duplicate evaluation case ID: ${evaluationCase.id}`);
    }
    ids.add(evaluationCase.id);
    parseQueryPlan(evaluationCase.expectedPlan);
  }
}

function classifyEmptySetResult(
  rows: readonly TableRow[],
): "returns_null" | "returns_zero" {
  if (isDeepStrictEqual(rows, [{ net_revenue: null }])) return "returns_null";
  if (isDeepStrictEqual(rows, [{ net_revenue: "0.00" }])) return "returns_zero";
  throw new Error(
    `No-matching-rows case returned neither NULL nor zero: ${JSON.stringify(rows)}`,
  );
}

function toTableRows(
  rows: readonly Readonly<Record<string, Json>>[],
): readonly TableRow[] {
  return rows.map((row) => {
    const tableRow: Record<string, TableCell> = {};
    for (const [column, value] of Object.entries(row)) {
      if (!isTableCell(value)) {
        throw new Error(
          `Reference SQL returned a non-scalar value for ${JSON.stringify(column)}`,
        );
      }
      tableRow[column] = value;
    }
    return tableRow;
  });
}

function isTableCell(value: Json): value is TableCell {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

async function ensureResultsDoNotExist(): Promise<void> {
  try {
    await access(resultsUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Refusing to overwrite existing results: ${resultsUrl.pathname}`,
  );
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = "code" in error ? ` [${String(error.code)}]` : "";
  return `${error.name}${code}: ${error.message}`;
}
