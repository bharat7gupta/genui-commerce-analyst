import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { fileURLToPath } from "node:url";

export const databasePath = fileURLToPath(
  new URL("../../data/commerce.duckdb", import.meta.url),
);

export async function openDatabase(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(databasePath);
  return instance.connect();
}
