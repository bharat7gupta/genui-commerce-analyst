import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { NaturalLanguageInvestigationResult } from "../application/natural-language-investigation.js";
import type { RegionPeriodComparison } from "../application/compare-net-revenue-by-region.js";
import type { PeriodComparison } from "../application/compare-periods.js";

const interval = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const amount = z.string().regex(/^-?\d+\.\d{2}$/);
const segment = z.object({ region: z.string(), baselinePresent: z.boolean(), targetPresent: z.boolean(),
  baselineValue: amount.nullable(), targetValue: amount.nullable(), absoluteChange: amount.nullable() }).strict();
const reference = z.object({ baseline: interval, target: interval, baselineValue: amount,
  targetValue: amount, absoluteChange: amount, percentageChange: amount, segments: z.array(segment) }).strict();
const caseSchema = z.object({
  id: z.string().min(1), category: z.enum(["supported", "ambiguous", "unsupported", "misleading"]),
  question: z.string().min(1), expectedOutcome: z.enum(["completed", "clarification_required", "unsupported"]),
  expectedInputs: z.object({ metric: z.string().nullable(), baseline: interval.nullable(),
    target: interval.nullable(), dimension: z.string().nullable() }).strict(),
  expectUnresolvedQuestions: z.boolean(), numericalReference: z.string().nullable(), requireEvidence: z.boolean(), note: z.string(),
}).strict();
export const investigationDevelopmentSchema = z.object({
  version: z.literal("investigation-development-v1"), split: z.literal("development"),
  cases: z.array(caseSchema).length(15), numericalReferences: z.record(z.string(), reference),
}).strict().superRefine((data, context) => {
  if (new Set(data.cases.map(({ id }) => id)).size !== 15) context.addIssue({ code: "custom", message: "Case IDs must be unique" });
  for (const [category, count] of [["supported", 6], ["ambiguous", 4], ["unsupported", 3], ["misleading", 2]] as const) {
    if (data.cases.filter((item) => item.category === category).length !== count) context.addIssue({ code: "custom", message: `Expected ${count} ${category} cases` });
  }
  for (const item of data.cases) {
    if (item.numericalReference !== null && !Object.hasOwn(data.numericalReferences, item.numericalReference)) {
      context.addIssue({ code: "custom", message: `Missing numerical reference for ${item.id}` });
    }
    if ((item.expectedOutcome === "completed") !== (item.numericalReference !== null)) {
      context.addIssue({ code: "custom", message: `Completed expectation/reference mismatch for ${item.id}` });
    }
  }
});
export type InvestigationDevelopmentCase = z.infer<typeof caseSchema>;
export type InvestigationNumericalReference = z.infer<typeof reference>;
export type Check = Readonly<{ status: "pass" | "fail" | "not_reached" | "not_applicable"; reason: string }>;
const check = (pass: boolean, reason: string): Check => ({ status: pass ? "pass" : "fail", reason });

export function gradeInvestigationDevelopmentCase(
  item: InvestigationDevelopmentCase,
  result: NaturalLanguageInvestigationResult,
  sqlCount: number,
  numeric: InvestigationNumericalReference | null,
) {
  const outcome = check(result.outcome === item.expectedOutcome, `Expected ${item.expectedOutcome}; observed ${result.outcome}`);
  const fields = "fields" in result.extraction ? result.extraction.fields : null;
  const mismatches: string[] = [];
  if (fields !== null) {
    for (const field of ["metric", "baseline", "target", "dimension"] as const) {
      if (!isDeepStrictEqual(fields[field], item.expectedInputs[field])) mismatches.push(field);
    }
    if ((fields.unresolvedQuestions.length > 0) !== item.expectUnresolvedQuestions) mismatches.push("unresolvedQuestions presence");
  }
  const extraction = check(fields !== null && mismatches.length === 0,
    fields === null ? "No structurally validated fields" : mismatches.length ? `Mismatch: ${mismatches.join(", ")}` : "All four inputs match; unresolved-question presence matches (wording ungraded)");
  const completed = result.investigation?.outcome === "completed" ? result.investigation : null;
  const numerical: Check = numeric === null ? { status: "not_applicable", reason: "No numerical result expected" }
    : completed === null ? { status: "not_reached", reason: "No completed investigation to grade" }
    : check(numericalMatches(completed.overall, completed.regional, numeric), "Compare all scalar amounts and all regional values/presence/change fields with SQL-verified expectations");
  const sql = check(sqlCount === (item.expectedOutcome === "completed" ? 4 : 0), `Expected ${item.expectedOutcome === "completed" ? 4 : 0} SQL executions; observed ${sqlCount}`);
  const evidence: Check = !item.requireEvidence ? { status: "not_applicable", reason: "Not a misleading case" }
    : completed === null ? { status: "not_reached", reason: "No summary to inspect for evidence compliance" }
    : check(completed.summary.includes("Net revenue increased by 1070.00 (14.81%)") &&
      completed.summary.includes("Business causes are not established by these aggregate results.") &&
      completed.summary.includes(completed.definition.sourceId) &&
      !/advertising campaign caused|net revenue (?:fell|declined|decreased)/i.test(completed.summary),
    "Require verified increase, source citation, no established cause, and no asserted decline/campaign cause");
  const required = [outcome, extraction, sql, numerical, evidence];
  return { outcome, extraction, numerical, sql, evidence,
    endToEnd: check(required.every(({ status }) => status === "pass" || status === "not_applicable"), "All applicable checks must pass; not_reached does not count as numerical success") };
}

function numericalMatches(overall: PeriodComparison, regional: RegionPeriodComparison, expected: InvestigationNumericalReference): boolean {
  return overall.baselineValue === expected.baselineValue && overall.targetValue === expected.targetValue &&
    overall.absoluteChange === expected.absoluteChange && overall.percentageChange === expected.percentageChange &&
    isDeepStrictEqual(regional.segments, expected.segments);
}
