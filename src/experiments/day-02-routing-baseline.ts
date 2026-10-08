import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

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
  ROUTER_VERSION as ROUTER_V1_VERSION,
  ROUTE_LABELS,
  type RouteLabel,
} from "../routing/router-v1-prompt.js";
import { ROUTER_V2_VERSION } from "../routing/router-v2-prompt.js";
import { ROUTER_V3_VERSION } from "../routing/router-v3-prompt.js";
import {
  InvalidRouteOutputError,
  routeRequest,
  type RouterVersion,
} from "../routing/router.js";

const requestedRouterVersion = process.argv[2] ?? ROUTER_V1_VERSION;

if (
  requestedRouterVersion !== ROUTER_V1_VERSION &&
  requestedRouterVersion !== ROUTER_V2_VERSION &&
  requestedRouterVersion !== ROUTER_V3_VERSION
) {
  throw new Error(`Unknown router version: ${requestedRouterVersion}`);
}

const ROUTER_VERSION: RouterVersion = requestedRouterVersion;
const plannedRun = process.argv[3] === "day-7-planned";
if (process.argv[3] !== undefined && !plannedRun) {
  throw new Error(`Unknown routing case selection: ${process.argv[3]}`);
}
if (plannedRun && ROUTER_VERSION !== ROUTER_V3_VERSION) {
  throw new Error("Day 7 planned routing cases require router-v3");
}
const EXPERIMENT_NAME =
  plannedRun ? "day-07-planned-routing-v1" : ROUTER_VERSION === ROUTER_V3_VERSION
    ? "routing-baseline-v3"
    : ROUTER_VERSION === ROUTER_V2_VERSION
      ? "routing-baseline-v2"
      : "routing-baseline-v1";
const CASE_SET_VERSION = plannedRun ? "day-7-planned-routing-cases-v1" : "routing-cases-v1";
const REQUIRED_MODEL = "qwen3.5:4b";
const REPETITIONS = plannedRun ? [1] as const : [1, 2, 3] as const;
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
const plannedCaseSchema = routingCaseSchema.extend({
  category: z.literal("routing"),
  datasetRole: z.literal("development"),
  paraphraseFamily: z.string().min(1),
  sourceFile: z.enum(["evals/routing/cases-v1.jsonl", "evals/routing/heldout-cases-v1.jsonl"]),
  previouslyHeldOut: z.boolean(),
  policyVerification: z.object({
    status: z.enum(["verified", "unresolved"]), reason: z.string().min(1),
  }).strict(),
});
type PlannedCase = z.infer<typeof plannedCaseSchema>;
const plannedMetadata = new Map<string, PlannedCase>();

type RoutingRunRecord = {
  timestamp: string;
  experiment:
    | "day-07-planned-routing-v1"
    | "routing-baseline-v1"
    | "routing-baseline-v2"
    | "routing-baseline-v3";
  caseSetVersion: typeof CASE_SET_VERSION;
  promptVersion: RouterVersion;
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
  component?: "router";
  category?: string;
  datasetRole?: string;
  paraphraseFamily?: string;
  previouslyHeldOut?: boolean;
  sourceSha256?: Readonly<Record<string, string>>;
  finishReason?: string | null;
  refusal?: string | null;
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

const casesUrl = new URL(plannedRun
  ? "../../evals/routing/day-7-planned-cases-v1.jsonl"
  : "../../evals/routing/cases-v1.jsonl", import.meta.url);
const resultsDirectoryUrl = new URL("../../results/", import.meta.url);
const runStem = `day-07-planned-routing-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
const resultsUrl = new URL(
  plannedRun ? `${runStem}.jsonl` : `day-02-routing-baseline-${ROUTER_VERSION === ROUTER_V3_VERSION ? "v3" : ROUTER_VERSION === ROUTER_V2_VERSION ? "v2" : "v1"}.jsonl`,
  resultsDirectoryUrl,
);

if (config.model.model !== REQUIRED_MODEL) {
  throw new Error(
    `Expected model ${REQUIRED_MODEL}, configured ${config.model.model}`,
  );
}

if (config.model.reasoningEffort !== "none") {
  throw new Error(
    `Expected reasoning effort none, configured ${config.model.reasoningEffort}`,
  );
}

const cases = await loadCases();
async function frozenChecksums() {
  const paths = [casesUrl, ...[
    "../../evals/routing/cases-v1.jsonl", "../../evals/routing/heldout-cases-v1.jsonl",
    "../routing/router-v3-prompt.ts", "../routing/router.ts", "../../docs/evals/day-7-dataset-plan.md",
  ].map(path => new URL(path, import.meta.url))];
  return Object.fromEntries(await Promise.all(paths.map(async path =>
    [path.pathname, createHash("sha256").update(await readFile(path)).digest("hex")])));
}
const sourceSha256 = plannedRun ? await frozenChecksums() : null;
const baseProvider = new QwenProvider(config.model);
const observingProvider = new ObservingProvider(baseProvider);
const records: RoutingRunRecord[] = [];

await mkdir(resultsDirectoryUrl, { recursive: true });
if (plannedRun) await writeFile(resultsUrl, "", { flag: "wx" });

for (const [caseIndex, routingCase] of cases.entries()) {
  for (const repetition of REPETITIONS) {
    console.log(
      `[${caseIndex + 1}/${cases.length}] ${routingCase.id} — run ${repetition}/${REPETITIONS.length}`,
    );

    observingProvider.reset();
    const startedAt = performance.now();
    let actualRoute: RouteLabel | null = null;
    let validationError: string | null = null;
    let providerError: string | null = null;

    try {
      const decision = await routeRequest(
        observingProvider,
        routingCase.input,
        ROUTER_VERSION,
      );
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
      ...(plannedRun ? {
        component: "router" as const,
        category: plannedMetadata.get(routingCase.id)!.category,
        datasetRole: plannedMetadata.get(routingCase.id)!.datasetRole,
        paraphraseFamily: plannedMetadata.get(routingCase.id)!.paraphraseFamily,
        previouslyHeldOut: plannedMetadata.get(routingCase.id)!.previouslyHeldOut,
        sourceSha256: sourceSha256!,
        finishReason: observedResult?.finishReason ?? null,
        refusal: observedResult?.refusal ?? null,
      } : {}),
    };

    await appendRunRecord(record);
    records.push(record);
    console.log(
      `  ${record.actualRoute ?? "invalid"} — ${record.correct ? "correct" : "incorrect"}`,
    );
  }
}

const summary = buildSummary(records, cases);
if (plannedRun) {
  const sourcesUnchanged = JSON.stringify(sourceSha256) === JSON.stringify(await frozenChecksums());
  await writeFile(new URL(`${runStem}-summary.json`, resultsDirectoryUrl), JSON.stringify({
    ...summary, component: "router", sourcesUnchanged, sourceSha256,
    note: "Exposed development/regression component results; not full-pipeline success. Two cases were previously held out. One call per case does not measure stability.",
    modelName: config.model.model, modelSettings: MODEL_SETTINGS,
    cases: records,
  }, null, 2) + "\n", { flag: "wx" });
  if (!sourcesUnchanged) throw new Error("Frozen inputs changed during routing evaluation");
}
console.log(JSON.stringify(summary, null, 2));
console.log(`Results: ${resultsUrl.pathname}`);

async function loadCases(): Promise<RoutingCase[]> {
  const lines = (await readFile(casesUrl, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const parsedCases = lines.map((line, index) => {
    try {
      if (plannedRun) {
        const item = plannedCaseSchema.parse(JSON.parse(line));
        plannedMetadata.set(item.id, item);
        return item;
      }
      return routingCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid routing case on line ${index + 1}`, {
        cause: error,
      });
    }
  });

  const expectedCount = plannedRun ? 10 : 20;
  if (parsedCases.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} routing cases, found ${parsedCases.length}`);
  }

  const ids = new Set(parsedCases.map(({ id }) => id));
  if (ids.size !== parsedCases.length) {
    throw new Error("Routing case IDs must be unique");
  }
  if (plannedRun) {
    const plan = await readFile(new URL("../../docs/evals/day-7-dataset-plan.md", import.meta.url), "utf8");
    const plannedIds = [...plan.matchAll(/^\| (?:[1-9]|10) \| `([^`]+)`/gm)].map(match => match[1]);
    if (JSON.stringify(plannedIds) !== JSON.stringify(parsedCases.map(item => item.id))) {
      throw new Error("Manifest must match the ten planned routing IDs in order");
    }
    for (const item of plannedMetadata.values()) {
      if (item.policyVerification.status !== "verified") {
        throw new Error(`Unresolved routing policy for ${item.id}: ${item.policyVerification.reason}; no calls made`);
      }
      const source = (await readFile(new URL(`../../${item.sourceFile}`, import.meta.url), "utf8"))
        .trim().split("\n").map(line => routingCaseSchema.parse(JSON.parse(line)))
        .find(sourceCase => sourceCase.id === item.id);
      if (!source || source.input !== item.input || source.expectedRoute !== item.expectedRoute || source.reason !== item.reason
          || item.previouslyHeldOut !== item.sourceFile.includes("heldout")) {
        throw new Error(`Frozen source mismatch for ${item.id}; no calls made`);
      }
    }
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
          accuracy: routeRecords.length === 0 ? null : routeCorrect / routeRecords.length,
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
        stable: plannedRun ? null : stability?.stable ?? false,
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
  const tokenUsages = records.flatMap(({ tokenUsage }) =>
    tokenUsage ? [tokenUsage] : [],
  );
  const firstRecord = records[0];
  const warmRecords = records.slice(1);
  const stableCaseCount = Object.values(stabilityByCase).filter(
    ({ stable }) => stable,
  ).length;

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
    stability: plannedRun ? { status: "not_assessed", reason: "One invocation per case" } : {
      stableCases: stableCaseCount,
      totalCases: cases.length,
      rate: stableCaseCount / cases.length,
    },
    stabilityByCase: plannedRun ? null : stabilityByCase,
    confusionMatrix,
    failedOrUnstableCases,
    averageTokenUsage: {
      measuredCalls: tokenUsages.length,
      inputTokens:
        tokenUsages.reduce((sum, usage) => sum + usage.inputTokens, 0) /
        tokenUsages.length,
      outputTokens:
        tokenUsages.reduce((sum, usage) => sum + usage.outputTokens, 0) /
        tokenUsages.length,
    },
    latency: {
      coldStartCandidate: firstRecord
        ? {
            caseId: firstRecord.caseId,
            repetition: firstRecord.repetition,
            latencyMs: firstRecord.latencyMs,
          }
        : null,
      warm: summarizeNumbers(warmRecords.map(({ latencyMs }) => latencyMs)),
    },
  };
}

function summarizeNumbers(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);

  return {
    count: sorted.length,
    averageMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    medianMs: median,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
}
