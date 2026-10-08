import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import { gradeExtractionOutcome } from "../evals/extraction-outcome-grader.js";
import { queryPlanOutputSchema } from "../query-plan/query-plan-extraction.js";

const sources = {
  development: "results/day-07-five-cases-query-plan-extractor-v3-2026-10-07T17-21-47-825Z-8c8aac1b-68b9-4469-a2c5-8a8bfa0bf613",
  held_out: "results/day-07-five-cases-held_out-query-plan-extractor-v3-2026-10-07T17-37-48-897Z-c434a973-dbc1-4b00-b41e-32924180bb4d",
};
const metadataPath = "evals/analytics/extraction-outcomes-v1.json";
const metadataSchema = z.object({
  version: z.literal("day-7-extraction-outcomes-v1"),
  heldoutDatasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expectations: z.array(z.object({
    caseId: z.string().regex(/^[a-z0-9-]+$/),
    split: z.enum(["development", "held_out"]),
    expectedOutcome: z.enum(["query_plan", "clarification_required", "unsupported"]),
  }).strict()).length(10),
}).strict();
const callSchema = z.object({
  stage: z.enum(["routing", "extraction"]),
  rawOutput: z.string().nullable(),
  finishReason: z.string().nullable(),
  refusal: z.string().nullable(),
  error: z.string().nullable(),
});
const summarySchema = z.object({
  overall: z.unknown(),
  cases: z.array(z.object({ caseId: z.string() })),
});
const resultSchema = z.object({
  schemaValidation: z.unknown(),
  businessRuleValidation: z.unknown(),
  planMeaning: z.unknown(),
});
type Check = { status: "pass" | "fail" | "not_reached" | "not_observable"; reason: string };
const hashes: Record<string, string> = {};
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
async function frozenRead(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  hashes[path] = sha256(text);
  return text;
}

const metadata = metadataSchema.parse(JSON.parse(await frozenRead(metadataPath)));
const datasetPath = "evals/analytics/heldout-cases-v1.jsonl";
if (sha256(await frozenRead(datasetPath)) !== metadata.heldoutDatasetSha256) {
  throw new Error("Frozen held-out dataset checksum mismatch");
}
const datasets = [];
for (const split of ["development", "held_out"] as const) {
  const source = sources[split];
  const summary = summarySchema.parse(JSON.parse(await frozenRead(`${source}/summary.json`)));
  const expectations = metadata.expectations.filter((item) => item.split === split);
  if (expectations.length !== 5 || new Set(expectations.map((item) => item.caseId)).size !== 5
      || summary.cases.length !== 5
      || summary.cases.some((item) => !expectations.some((expected) => expected.caseId === item.caseId))) {
    throw new Error(`Case coverage mismatch for ${split}`);
  }
  const cases: {
    caseId: string; split: "development" | "held_out";
    expectedOutcome: "query_plan" | "clarification_required" | "unsupported";
    observedOutcome: string | null; extractionReason: string | null;
    envelopeValidity: Check; outcomeCorrectness: Check;
    originalPlanChecks: z.infer<typeof resultSchema>;
  }[] = [];
  for (const expected of expectations) {
    const artifact = `${source}/${expected.caseId}`;
    const calls = (await frozenRead(`${artifact}/calls.jsonl`)).trim().split("\n")
      .map((line) => callSchema.parse(JSON.parse(line)))
      .filter((call) => call.stage === "extraction");
    const original = resultSchema.parse(JSON.parse(await frozenRead(`${artifact}/result.json`)));
    let envelopeValidity: Check;
    let outcomeCorrectness: Check = { status: "not_reached", reason: "No validated extraction envelope" };
    let observedOutcome: string | null = null;
    let extractionReason: string | null = null;
    if (calls.length === 0) {
      envelopeValidity = { status: "not_reached", reason: "No captured extraction call" };
    } else if (calls.length !== 1) {
      throw new Error(`Expected one extraction capture for ${expected.caseId}`);
    } else {
      const call = calls[0]!;
      if (call.rawOutput === null || call.error !== null || call.refusal !== null
          || (call.finishReason !== null && call.finishReason !== "stop")) {
        envelopeValidity = { status: "not_reached", reason: "Capture has provider error, refusal, incomplete generation, or no output" };
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(call.rawOutput); } catch { parsed = null; }
        const validation = queryPlanOutputSchema.safeParse(parsed);
        if (!validation.success) {
          envelopeValidity = { status: "fail", reason: JSON.stringify(validation.error.issues) };
        } else {
          envelopeValidity = { status: "pass", reason: "Existing strict extraction envelope schema passed" };
          observedOutcome = validation.data.outcome;
          if (validation.data.outcome !== "query_plan") extractionReason = validation.data.reason;
          const grade = gradeExtractionOutcome(validation.data, expected.expectedOutcome);
          outcomeCorrectness = { status: grade.pass ? "pass" : "fail", reason: grade.reason };
        }
      }
    }
    if (outcomeCorrectness.status === "not_reached") {
      outcomeCorrectness.reason = `Outcome ungraded: ${envelopeValidity.reason}`;
    }
    cases.push({ ...expected, observedOutcome, extractionReason, envelopeValidity, outcomeCorrectness,
      originalPlanChecks: original });
  }
  const counts = (field: "envelopeValidity" | "outcomeCorrectness") => {
    const count = (status: Check["status"]) => cases.filter((item) => item[field].status === status).length;
    return { passed: count("pass"), failed: count("fail"), not_reached: count("not_reached"),
      not_observable: count("not_observable"), gradingDenominator: count("pass") + count("fail"),
      totalCases: cases.length, ungraded: cases.filter((item) => !["pass", "fail"].includes(item[field].status))
        .map((item) => ({ caseId: item.caseId, reason: item[field].reason })) };
  };
  datasets.push({ split, source, originalOverall: summary.overall,
    counts: { envelopeValidity: counts("envelopeValidity"), outcomeCorrectness: counts("outcomeCorrectness") }, cases });
}
for (const [path, hash] of Object.entries(hashes)) {
  if (sha256(await readFile(path, "utf8")) !== hash) throw new Error(`Source changed during offline grading: ${path}`);
}
const reportPath = `results/day-07-extraction-outcomes-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}.json`;
await writeFile(reportPath, JSON.stringify({
  kind: "offline_supplementary_extraction_outcome_grading", timestamp: new Date().toISOString(),
  note: "Unedited captured outputs. Original plan checks copied unchanged; no original overall verdict recalculated. Envelope schema includes query-plan structure on its query_plan branch; business validation is separate.",
  heldoutDatasetSha256: metadata.heldoutDatasetSha256, sourceSha256: hashes, datasets,
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ reportPath, datasets: datasets.map(({ split, counts }) => ({ split, counts })) }, null, 2));
