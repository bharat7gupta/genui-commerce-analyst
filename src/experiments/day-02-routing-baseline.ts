import { appendFile, mkdir, readFile } from "node:fs/promises";

import { z } from "zod";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
  TokenUsage,
} from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import {
  ROUTER_VERSION,
  ROUTE_LABELS,
  type RouteLabel,
} from "../routing/router-v1-prompt.js";
import {
  InvalidRouteOutputError,
  routeRequest,
} from "../routing/router.js";

const EXPERIMENT_NAME = "routing-baseline-v1";
const CASE_SET_VERSION = "routing-cases-v1";
const REPETITIONS = [1, 2, 3] as const;
const MODEL_SETTINGS = {
  temperature: 0,
  maxTokens: 8,
  reasoningEffort: config.model.reasoningEffort,
} as const;

const routingCaseSchema = z
  .object({
    id: z.string().min(1),
    input: z.string().min(1),
    expectedRoute: z.enum(ROUTE_LABELS),
    reason: z.string().min(1),
  })
  .strict();

type RoutingCase = z.infer<typeof routingCaseSchema>;

type RoutingRunRecord = {
  timestamp: string;
  experiment: typeof EXPERIMENT_NAME;
  caseSetVersion: typeof CASE_SET_VERSION;
  promptVersion: typeof ROUTER_VERSION;
  caseId: string;
  repetition: 1 | 2 | 3;
  input: string;
  expectedRoute: RouteLabel;
  rawModelOutput: string | null;
  actualRoute: RouteLabel | null;
  correct: boolean;
  modelName: string;
  modelSettings: typeof MODEL_SETTINGS;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  requestId: string | null;
  validationError: string | null;
  providerError: string | null;
};

class ObservingProvider implements ModelProvider {
  lastResult: ModelResult | null = null;

  constructor(private readonly delegate: ModelProvider) {}

  reset(): void {
    this.lastResult = null;
  }

  async generate(request: ModelRequest): Promise<ModelResult> {
    const result = await this.delegate.generate(request);
    this.lastResult = result;
    return result;
  }
}

const casesUrl = new URL("../../evals/routing/cases-v1.jsonl", import.meta.url);
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const resultsUrl = new URL(
  "day-02-routing-baseline-v1.jsonl",
  resultsDirectoryUrl,
);

const cases = await loadCases();
const baseProvider = new QwenProvider(config.model);
const observingProvider = new ObservingProvider(baseProvider);
const records: RoutingRunRecord[] = [];

await mkdir(resultsDirectoryUrl, { recursive: true });

for (const [caseIndex, routingCase] of cases.entries()) {
  for (const repetition of REPETITIONS) {
    console.log(
      `[${caseIndex + 1}/${cases.length}] ${routingCase.id} — run ${repetition}/3`,
    );

    observingProvider.reset();
    const startedAt = performance.now();
    let actualRoute: RouteLabel | null = null;
    let validationError: string | null = null;
    let providerError: string | null = null;

    try {
      const decision = await routeRequest(observingProvider, routingCase.input);
      actualRoute = decision.route;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof InvalidRouteOutputError) {
        validationError = message;
      } else {
        providerError = message;
      }
    }

    const observedResult = observingProvider.lastResult;
    const record: RoutingRunRecord = {
      timestamp: new Date().toISOString(),
      experiment: EXPERIMENT_NAME,
      caseSetVersion: CASE_SET_VERSION,
      promptVersion: ROUTER_VERSION,
      caseId: routingCase.id,
      repetition,
      input: routingCase.input,
      expectedRoute: routingCase.expectedRoute,
      rawModelOutput: observedResult?.text ?? null,
      actualRoute,
      correct: actualRoute === routingCase.expectedRoute,
      modelName: observedResult?.metadata.model ?? config.model.model,
      modelSettings: MODEL_SETTINGS,
      latencyMs:
        observedResult?.metadata.latencyMs ??
        Math.round(performance.now() - startedAt),
      tokenUsage: observedResult?.metadata.tokenUsage ?? null,
      requestId: observedResult?.metadata.requestId ?? null,
      validationError,
      providerError,
    };

    await appendRunRecord(record);
    records.push(record);
    console.log(
      `  ${record.actualRoute ?? "invalid"} — ${record.correct ? "correct" : "incorrect"}`,
    );
  }
}

console.log(JSON.stringify(buildSummary(records, cases), null, 2));
console.log(`Results: ${resultsUrl.pathname}`);

async function loadCases(): Promise<RoutingCase[]> {
  const lines = (await readFile(casesUrl, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const parsedCases = lines.map((line, index) => {
    try {
      return routingCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid routing case on line ${index + 1}`, {
        cause: error,
      });
    }
  });

  if (parsedCases.length !== 20) {
    throw new Error(`Expected 20 routing cases, found ${parsedCases.length}`);
  }

  const ids = new Set(parsedCases.map(({ id }) => id));
  if (ids.size !== parsedCases.length) {
    throw new Error("Routing case IDs must be unique");
  }

  return parsedCases;
}

async function appendRunRecord(record: RoutingRunRecord): Promise<void> {
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

function buildSummary(records: RoutingRunRecord[], cases: RoutingCase[]) {
  const correctCount = records.filter(({ correct }) => correct).length;
  const invalidCount = records.filter(
    ({ validationError }) => validationError !== null,
  ).length;
  const accuracyByRoute = Object.fromEntries(
    ROUTE_LABELS.map((route) => {
      const routeRecords = records.filter(
        ({ expectedRoute }) => expectedRoute === route,
      );
      const routeCorrect = routeRecords.filter(({ correct }) => correct).length;

      return [
        route,
        {
          correct: routeCorrect,
          total: routeRecords.length,
          accuracy: routeCorrect / routeRecords.length,
        },
      ];
    }),
  );
  const confusionMatrix = Object.fromEntries(
    ROUTE_LABELS.map((expectedRoute) => [
      expectedRoute,
      Object.fromEntries(
        [...ROUTE_LABELS, "invalid"].map((actualRoute) => [
          actualRoute,
          records.filter(
            (record) =>
              record.expectedRoute === expectedRoute &&
              (record.actualRoute ?? "invalid") === actualRoute,
          ).length,
        ]),
      ),
    ]),
  );
  const stabilityByCase = Object.fromEntries(
    cases.map((routingCase) => {
      const caseRecords = records.filter(
        ({ caseId }) => caseId === routingCase.id,
      );
      const firstRoute = caseRecords[0]?.actualRoute ?? null;
      const stable =
        firstRoute !== null &&
        caseRecords.length === REPETITIONS.length &&
        caseRecords.every(({ actualRoute }) => actualRoute === firstRoute);

      return [
        routingCase.id,
        {
          stable,
          routes: caseRecords.map(({ actualRoute }) => actualRoute),
        },
      ];
    }),
  );
  const failedOrUnstableCases = cases.flatMap((routingCase) => {
    const caseRecords = records.filter(
      ({ caseId }) => caseId === routingCase.id,
    );
    const stability = stabilityByCase[routingCase.id];

    if (caseRecords.every(({ correct }) => correct) && stability?.stable) {
      return [];
    }

    return [
      {
        caseId: routingCase.id,
        expectedRoute: routingCase.expectedRoute,
        stable: stability?.stable ?? false,
        runs: caseRecords.map((record) => ({
          repetition: record.repetition,
          rawModelOutput: record.rawModelOutput,
          actualRoute: record.actualRoute,
          correct: record.correct,
          validationError: record.validationError,
          providerError: record.providerError,
        })),
      },
    ];
  });

  return {
    experiment: EXPERIMENT_NAME,
    caseSetVersion: CASE_SET_VERSION,
    promptVersion: ROUTER_VERSION,
    overall: {
      correct: correctCount,
      total: records.length,
      accuracy: correctCount / records.length,
    },
    accuracyByRoute,
    invalidOutput: {
      count: invalidCount,
      total: records.length,
      rate: invalidCount / records.length,
    },
    stabilityByCase,
    confusionMatrix,
    failedOrUnstableCases,
  };
}
