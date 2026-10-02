import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import { databasePath } from "./connection.js";

const seedPath = resolve(dirname(databasePath), "seed.sql");

await mkdir(dirname(databasePath), { recursive: true });
await rm(databasePath, { force: true });
await rm(`${databasePath}.wal`, { force: true });

const seedSql = await readFile(seedPath, "utf8");
const instance = await DuckDBInstance.create(databasePath);
const connection = await instance.connect();

try {
  await connection.run(seedSql);
  const reader = await connection.runAndReadAll(
    "SELECT COUNT(*)::INTEGER AS order_count FROM orders",
  );
  const [summary] = reader.getRowObjectsJson();

  console.log(
    JSON.stringify(
      {
        database: databasePath,
        ...summary,
      },
      null,
      2,
    ),
  );
} finally {
  connection.closeSync();
}
