import { readFile } from "node:fs/promises";

import { openDatabase } from "./connection.js";

type BaselineCase = {
  id: string;
  question: string;
  reference_sql: string;
};

const casesUrl = new URL("../../evals/baseline-cases.json", import.meta.url);
const cases = JSON.parse(await readFile(casesUrl, "utf8")) as BaselineCase[];
const connection = await openDatabase();

try {
  for (const baselineCase of cases) {
    const reader = await connection.runAndReadAll(baselineCase.reference_sql);

    console.log(`\n${baselineCase.id}: ${baselineCase.question}`);
    console.log(JSON.stringify(reader.getRowObjectsJson(), null, 2));
  }
} finally {
  connection.closeSync();
}
