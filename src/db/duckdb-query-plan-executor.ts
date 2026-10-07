import { DuckDBInstance, type Json } from "@duckdb/node-api";

import type {
  QueryPlanExecutor,
  TableCell,
  TableRow,
} from "../application/commerce-analysis-pipeline.js";
import type { QueryPlan } from "../query-plan/query-plan.js";
import { databasePath } from "./connection.js";
import { compileQueryPlan } from "./query-plan-sql-compiler.js";

export class DuckDBQueryPlanExecutor implements QueryPlanExecutor {
  constructor(private readonly path: string = databasePath) {}

  async execute(plan: QueryPlan): Promise<readonly TableRow[]> {
    const compiled = compileQueryPlan(plan);
    const instance = await DuckDBInstance.create(this.path, {
      access_mode: "READ_ONLY",
    });
    let connection: Awaited<ReturnType<DuckDBInstance["connect"]>> | undefined;

    try {
      connection = await instance.connect();
      const reader = await connection.runAndReadAll(compiled.sql, [
        ...compiled.parameters,
      ]);
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
