import { appendFile, mkdir, readFile } from "node:fs/promises";

import { z } from "zod";

import type { ModelProvider, TokenUsage } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { openDatabase } from "../db/connection.js";

const numericExpectedAnswerSchema = z
  .object({
    type: z.literal("number"),
    value: z.number(),
    tolerance: z.number().nonnegative(),
  })
  .strict();

const textExpectedAnswerSchema = z
  .object({
    type: z.literal("text"),
    value: z.string().min(1),
    caseSensitive: z.boolean(),
  })
  .strict();

const comparisonExpectedAnswerSchema = z
  .object({
    type: z.literal("comparison"),
    august: z.number(),
    september: z.number(),
    absoluteChange: z.number(),
    percentageChange: z.number(),
    direction: z.enum(["increase", "decrease", "unchanged"]),
  })
  .strict();

export type NumericExpectedAnswer = z.infer<
  typeof numericExpectedAnswerSchema
>;
export type TextExpectedAnswer = z.infer<typeof textExpectedAnswerSchema>;
export type ComparisonExpectedAnswer = z.infer<
  typeof comparisonExpectedAnswerSchema
>;
export type ExpectedAnswer =
  | NumericExpectedAnswer
  | TextExpectedAnswer
  | ComparisonExpectedAnswer;

const expectedAnswerSchema = z.discriminatedUnion("type", [
  numericExpectedAnswerSchema,
  textExpectedAnswerSchema,
  comparisonExpectedAnswerSchema,
]);
const referenceValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const baselineCaseSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    reference_sql: z.string().min(1),
    referenceResult: z
      .array(z.record(z.string(), referenceValueSchema))
      .min(1),
    expectedAnswer: expectedAnswerSchema,
  })
  .strict();
const baselineCasesSchema = z.array(baselineCaseSchema).min(1);

type BaselineCase = z.infer<typeof baselineCaseSchema>;

type RunRecord = {
  timestamp: string;
  experiment: "baseline-v0";
  runNumber: 1 | 2 | 3;
  datasetVersion: "seed-v1";
  promptVersion: "baseline-v0";
  questionId: string;
  questionText: string;
  referenceResult: BaselineCase["referenceResult"];
  expectedAnswer: ExpectedAnswer;
  modelOutput: string | null;
  modelName: string;
  tokenUsage: TokenUsage | null;
  latencyMs: number | null;
  requestId: string | null;
  status: "success" | "error";
  error: string | null;
};

const EXPERIMENT_NAME = "baseline-v0";
const DATASET_VERSION = "seed-v1";
const PROMPT_VERSION = "baseline-v0";
const RUN_NUMBERS = [1, 2, 3] as const;
const casesUrl = new URL("../../evals/baseline-cases.json", import.meta.url);
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const resultsUrl = new URL("day-01-runs.jsonl", resultsDirectoryUrl);

const baselineCases = baselineCasesSchema.parse(
  JSON.parse(await readFile(casesUrl, "utf8")),
);
const connection = await openDatabase();
let serializedOrders: string;

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

  serializedOrders = JSON.stringify(ordersReader.getRowObjectsJson());
} finally {
  connection.closeSync();
}

await mkdir(resultsDirectoryUrl, { recursive: true });

const provider: ModelProvider = new QwenProvider(config.model);

for (const [caseIndex, baselineCase] of baselineCases.entries()) {
  const prompt = buildPrompt(serializedOrders, baselineCase.question);

  for (const runNumber of RUN_NUMBERS) {
    console.log(
      `[${caseIndex + 1}/${baselineCases.length}] ${baselineCase.id} — run ${runNumber}/3`,
    );

    const record: RunRecord = {
      timestamp: new Date().toISOString(),
      experiment: EXPERIMENT_NAME,
      runNumber,
      datasetVersion: DATASET_VERSION,
      promptVersion: PROMPT_VERSION,
      questionId: baselineCase.id,
      questionText: baselineCase.question,
      referenceResult: baselineCase.referenceResult,
      expectedAnswer: baselineCase.expectedAnswer,
      modelOutput: null,
      modelName: config.model.model,
      tokenUsage: null,
      latencyMs: null,
      requestId: null,
      status: "error",
      error: null,
    };
    const modelCallStartedAt = performance.now();

    try {
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
      record.latencyMs = Math.round(performance.now() - modelCallStartedAt);
      record.error = error instanceof Error ? error.message : String(error);
    }

    await appendRunRecord(record);
    console.log(`  ${record.status}`);
  }
}

function buildPrompt(serializedDataset: string, question: string): string {
  return [
    `Experiment: ${EXPERIMENT_NAME}`,
    "Use the order data below to answer the question.",
    "Reply with only the answer.",
    `Orders: ${serializedDataset}`,
    `Question: ${question}`,
  ].join("\n\n");
}

async function appendRunRecord(record: RunRecord): Promise<void> {
  let separator = "";

  try {
    const existingResults = await readFile(resultsUrl, "utf8");
    separator =
      existingResults.length > 0 && !existingResults.endsWith("\n") ? "\n" : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await appendFile(resultsUrl, `${separator}${JSON.stringify(record)}\n`, "utf8");
}
