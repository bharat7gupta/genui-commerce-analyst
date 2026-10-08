import type { QueryPlanModelOutput } from "../query-plan/query-plan-extraction.js";

export type ExtractionOutcome = QueryPlanModelOutput["outcome"];

/** Requires an envelope already accepted by queryPlanOutputSchema.
 * Business-rule validation and plan meaning are separate checks.
 */
export function gradeExtractionOutcome(
  observed: QueryPlanModelOutput,
  expected: ExtractionOutcome,
): Readonly<{ pass: boolean; reason: string }> {
  return {
    pass: observed.outcome === expected,
    reason: `Expected extraction outcome ${expected}; observed ${observed.outcome}`,
  };
}
