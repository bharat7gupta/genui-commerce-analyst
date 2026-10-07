import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBResultReader,
  type Json,
} from "@duckdb/node-api";

import type {
  QueryPlanExecutor,
  TableCell,
  TableRow,
} from "../application/commerce-analysis-pipeline.js";
import type { QueryPlan } from "../query-plan/query-plan.js";
import { databasePath } from "./connection.js";
import { compileQueryPlan } from "./query-plan-sql-compiler.js";

export const DEFAULT_DATABASE_EXECUTION_DEADLINE_MS = 2_000;
export const DEFAULT_MAXIMUM_EXPLICIT_DATE_INTERVAL_DAYS = 366;

export type DuckDBQueryPlanExecutorOptions = Readonly<{
  databasePath?: string;
  executionDeadlineMs?: number;
  /**
   * Applies only to explicit [start, end) intervals. Explicit all_time plans
   * have no date-range cap and remain bounded by the execution deadline.
   */
  maximumExplicitDateIntervalDays?: number;
}>;

export class DuckDBExecutionTimeoutError extends Error {
  readonly code = "QUERY_EXECUTION_TIMEOUT" as const;

  constructor(
    readonly deadlineMs: number,
    cause: unknown,
  ) {
    super(`DuckDB query exceeded the ${deadlineMs} ms execution deadline`, {
      cause,
    });
    this.name = "DuckDBExecutionTimeoutError";
  }
}

export class DuckDBDateIntervalLimitError extends Error {
  readonly code = "QUERY_DATE_INTERVAL_TOO_LARGE" as const;

  constructor(
    readonly intervalDays: number,
    readonly maximumDays: number,
  ) {
    super(
      `QueryPlan explicit date interval is ${intervalDays} days; maximum is ${maximumDays} days`,
    );
    this.name = "DuckDBDateIntervalLimitError";
  }
}

export class DuckDBQueryPlanExecutor implements QueryPlanExecutor {
  private readonly path: string;
  private readonly executionDeadlineMs: number;
  private readonly maximumExplicitDateIntervalDays: number;

  constructor(options: DuckDBQueryPlanExecutorOptions = {}) {
    this.path = options.databasePath ?? databasePath;
    this.executionDeadlineMs =
      options.executionDeadlineMs ?? DEFAULT_DATABASE_EXECUTION_DEADLINE_MS;
    this.maximumExplicitDateIntervalDays =
      options.maximumExplicitDateIntervalDays ??
      DEFAULT_MAXIMUM_EXPLICIT_DATE_INTERVAL_DAYS;

    if (
      !Number.isInteger(this.executionDeadlineMs) ||
      this.executionDeadlineMs <= 0
    ) {
      throw new Error("executionDeadlineMs must be a positive integer");
    }

    if (
      !Number.isInteger(this.maximumExplicitDateIntervalDays) ||
      this.maximumExplicitDateIntervalDays <= 0
    ) {
      throw new Error(
        "maximumExplicitDateIntervalDays must be a positive integer",
      );
    }
  }

  async execute(plan: QueryPlan): Promise<readonly TableRow[]> {
    const compiled = compileQueryPlan(plan);
    enforceExplicitDateIntervalLimit(
      plan,
      this.maximumExplicitDateIntervalDays,
    );
    const instance = await DuckDBInstance.create(this.path, {
      access_mode: "READ_ONLY",
    });
    let connection: Awaited<ReturnType<DuckDBInstance["connect"]>> | undefined;

    try {
      connection = await instance.connect();
      const reader = await runWithExecutionDeadline(
        connection,
        compiled.sql,
        compiled.parameters,
        this.executionDeadlineMs,
      );
      return toTableRows(reader.getRowObjectsJson());
    } finally {
      try {
        connection?.closeSync();
      } finally {
        instance.closeSync();
      }
    }
  }
}

function enforceExplicitDateIntervalLimit(
  plan: QueryPlan,
  maximumDays: number,
): void {
  if (plan.dateRange.kind !== "interval") return;

  const millisecondsPerDay = 24 * 60 * 60 * 1_000;
  const start = Date.parse(`${plan.dateRange.start}T00:00:00.000Z`);
  const end = Date.parse(`${plan.dateRange.end}T00:00:00.000Z`);
  const intervalDays = (end - start) / millisecondsPerDay;

  if (intervalDays > maximumDays) {
    throw new DuckDBDateIntervalLimitError(intervalDays, maximumDays);
  }
}

async function runWithExecutionDeadline(
  connection: DuckDBConnection,
  sql: string,
  parameters: readonly string[],
  deadlineMs: number,
): Promise<DuckDBResultReader> {
  let deadlineExpired = false;
  let interruptError: unknown;
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true;
    try {
      connection.interrupt();
    } catch (error) {
      interruptError = error;
    }
  }, deadlineMs);

  try {
    const reader = await connection.runAndReadAll(sql, [...parameters]);
    if (deadlineExpired) {
      throw new DuckDBExecutionTimeoutError(
        deadlineMs,
        interruptError ??
          new Error("DuckDB query settled after interruption was requested"),
      );
    }
    return reader;
  } catch (error) {
    if (deadlineExpired && !(error instanceof DuckDBExecutionTimeoutError)) {
      throw new DuckDBExecutionTimeoutError(
        deadlineMs,
        interruptError === undefined
          ? error
          : new AggregateError(
              [interruptError, error],
              "DuckDB interruption and query settlement both failed",
            ),
      );
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

function toTableRows(
  rows: readonly Readonly<Record<string, Json>>[],
): readonly TableRow[] {
  return rows.map((row) => {
    const tableRow: Record<string, TableCell> = {};

    for (const [column, value] of Object.entries(row)) {
      if (!isTableCell(value)) {
        throw new Error(
          `DuckDB returned a non-scalar value for column ${JSON.stringify(column)}`,
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
