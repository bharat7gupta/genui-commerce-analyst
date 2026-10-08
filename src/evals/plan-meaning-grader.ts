import { isDeepStrictEqual } from "node:util";

import type { QueryPlan } from "../query-plan/query-plan.js";

type OperationField = "comparison" | "ordering" | "limit" | "visualization";
type ScopeField = "metric" | "dateRange" | "dimensions" | "filters";
type MeaningField = ScopeField | OperationField;

export type PlanMeaningRequirements = Readonly<{
  expectedPlan: QueryPlan;
  acceptableAbsentOperationKinds: Readonly<
    Record<OperationField, readonly ("none" | "unspecified")[]>
  >;
}>;

export type PlanMeaningVerdict = Readonly<{
  pass: boolean;
  reason: string;
  mismatches: readonly Readonly<{ field: MeaningField; reason: string }>[];
}>;

/** Input must already have passed schema and business-rule validation. */
export function gradePlanMeaning(
  plan: QueryPlan,
  requirements: PlanMeaningRequirements,
): PlanMeaningVerdict {
  const mismatches: { field: MeaningField; reason: string }[] = [];
  const scopeFields: readonly ScopeField[] = [
    "metric", "dateRange", "dimensions", "filters",
  ];
  for (const field of scopeFields) {
    const expected = requirements.expectedPlan[field];
    if (!isDeepStrictEqual(plan[field], expected)) {
      mismatches.push({
        field,
        reason: `${field}: expected ${JSON.stringify(expected)}; received ${JSON.stringify(plan[field])}`,
      });
    }
  }

  const operationFields: readonly OperationField[] = [
    "comparison", "ordering", "limit", "visualization",
  ];
  for (const field of operationFields) {
    const expected = requirements.expectedPlan[field];
    const allowed = requirements.acceptableAbsentOperationKinds[field];
    const requested = (field === "ordering" || field === "limit")
      && expected.kind !== "none" && expected.kind !== "unspecified";
    if (requested ? !isDeepStrictEqual(plan[field], expected)
      : !allowed.some((kind) => kind === plan[field].kind)) {
      mismatches.push({
        field,
        reason: requested
          ? `${field}: expected ${JSON.stringify(expected)}; received ${JSON.stringify(plan[field])}`
          : `${field}: expected absent operation kind ${allowed.join(" or ")}; received ${JSON.stringify(plan[field])}`,
      });
    }
  }
  return {
    pass: mismatches.length === 0,
    reason: mismatches.length === 0
      ? "Plan matches the case's meaning requirements"
      : mismatches.map(({ reason }) => reason).join("; "),
    mismatches,
  };
}
