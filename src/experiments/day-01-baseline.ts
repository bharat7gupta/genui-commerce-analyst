import { appendFile, mkdir, readFile } from "node:fs/promises";

import type { ModelProvider, TokenUsage } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { openDatabase } from "../db/connection.js";

type BaselineCase = {
  id: string;
  question: string;
  reference_sql: string;
};

type RunRecord = {
  timestamp: string;
  experiment: "baseline-v0";
  questionId: string;
  questionText: string;
  expectedResult: unknown;
  modelOutput: string | null;
  modelName: string;
  tokenUsage: TokenUsage | null;
  latencyMs: number | null;
  requestId: string | null;
  status: "success" | "error";
  error: string | null;
};

const EXPERIMENT_NAME = "baseline-v0";
const QUESTION_ID = "total-gross-revenue";
const casesUrl = new URL("../../evals/baseline-cases.json", import.meta.url);
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const resultsUrl = new URL("day-01-runs.jsonl", resultsDirectoryUrl);

const record: RunRecord = {
  timestamp: new Date().toISOString(),
  experiment: EXPERIMENT_NAME,
  questionId: QUESTION_ID,
  questionText: "unavailable",
  expectedResult: null,
  modelOutput: null,
  modelName: config.model.model,
  tokenUsage: null,
  latencyMs: null,
  requestId: null,
  status: "error",
  error: null,
};

let modelCallStartedAt: number | null = null;

try {
  const baselineCases = JSON.parse(
    await readFile(casesUrl, "utf8"),
  ) as BaselineCase[];
  const baselineCase = baselineCases.find(({ id }) => id === QUESTION_ID);

  if (!baselineCase) {
    throw new Error(`Baseline question not found: ${QUESTION_ID}`);
  }

  record.questionText = baselineCase.question;

  const connection = await openDatabase();
  let orders: unknown;

  try {
    const ordersReader = await connection.runAndReadAll(`
      SELECT
        order_id,
        customer_id,
        order_date,
        region,
        category,
        gross_amount,
        discount_amount,
        refund_amount,
        status
      FROM orders
      ORDER BY order_id
    `);
    const expectedReader = await connection.runAndReadAll(
      baselineCase.reference_sql,
    );

    orders = ordersReader.getRowObjectsJson();
    record.expectedResult = expectedReader.getRowObjectsJson();
  } finally {
    connection.closeSync();
  }

  const prompt = [
    `Experiment: ${EXPERIMENT_NAME}`,
    "Use the order data below to answer the question.",
    "Reply with only the answer.",
    `Orders: ${JSON.stringify(orders)}`,
    `Question: ${baselineCase.question}`,
  ].join("\n\n");

  const provider: ModelProvider = new QwenProvider(config.model);
  modelCallStartedAt = performance.now();
  const result = await provider.generate({
    messages: [{ role: "user", content: prompt }],
  });

  record.modelOutput = result.text;
  record.modelName = result.metadata.model;
  record.tokenUsage = result.metadata.tokenUsage;
  record.latencyMs = result.metadata.latencyMs;
  record.requestId = result.metadata.requestId;
  record.status = "success";
} catch (error) {
  if (modelCallStartedAt !== null && record.latencyMs === null) {
    record.latencyMs = Math.round(performance.now() - modelCallStartedAt);
  }

  record.error = error instanceof Error ? error.message : String(error);
}

await mkdir(resultsDirectoryUrl, { recursive: true });
let separator = "";

try {
  const existingResults = await readFile(resultsUrl, "utf8");
  separator = existingResults.length > 0 && !existingResults.endsWith("\n") ? "\n" : "";
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

await appendFile(resultsUrl, `${separator}${JSON.stringify(record)}\n`, "utf8");

console.log(JSON.stringify(record, null, 2));

if (record.status === "error") {
  process.exitCode = 1;
}
