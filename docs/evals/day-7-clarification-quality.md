# Day 7 — Clarification quality: unspecified revenue

**Question:** “How much revenue did we make from 2025-08-01 inclusive to 2025-09-01 exclusive, across all regions and order statuses?”

**Missing information:** gross or net revenue. Gross sums `gross_amount`;
net subtracts discounts and refunds. Choosing one changes the amount.
The repository declares no default revenue metric. Its existing
[`ambiguous-revenue` case](../../evals/query-plan/development-cases-v1.jsonl)
expects clarification for unspecified revenue; the
[metric definitions](../../src/tools/get-metric-definition.ts) distinguish both.
Dates, regions, and status scope are already supplied.

**Target:** extractor, directly through `extractQueryPlan` with
`query-plan-extractor-v3`. Expected outcome: `clarification_required`.
A useful clarification must resolve gross versus net without guessing.
The [extraction policy](../../src/query-plan/query-plan-extraction-v3-prompt.ts)
requires clarification when required information prevents a meaningful plan.

The router's clarification label is `clarify`; it supplies no clarification
text. The pipeline stops on that route, so this example targets the extractor
separately rather than assuming it is reached through `runCommerceAnalysis`.

## Manual rubric

Judge meaning, not exact wording. **All three criteria must pass.**

1. **Missing information:** identifies the unresolved gross-versus-net choice.
2. **Scope fidelity:** invents no restrictions and asks for no supplied information.
3. **Answerability:** asks a specific follow-up the user can answer.

The contract represents clarification as `schemaVersion`, `outcome`, and
non-empty `reason`. Envelope validity and outcome correctness are separate
checks; criteria 1–3 assess the meaning of `reason`. There is no separate
question field or guaranteed user-facing rendering.

## Authored examples

These are illustrative extraction responses, **not observed model outputs**.
All use this envelope, with the `reason` shown in the table:

```json
{
  "schemaVersion": "query-plan-output-v1",
  "outcome": "clarification_required",
  "reason": "Do you mean gross revenue before discounts and refunds, or net revenue after subtracting them?"
}
```

| Example / `reason` | 1 | 2 | 3 | Quality / explanation |
|---|---|---|---|---|
| Useful: “Do you mean gross revenue before discounts and refunds, or net revenue after subtracting them?” | PASS | PASS | PASS | PASS: resolves the metric with a clear choice and preserves scope. |
| Fluent, wrong information: “To calculate revenue accurately, which region should I include: North, South, East, or West?” | FAIL | FAIL | PASS | FAIL: asks an answerable question about region, although all regions were supplied; leaves the metric unresolved. |
| Vague: “Could you clarify your request?” | FAIL | PASS | FAIL | FAIL: adds no restriction but identifies neither the missing choice nor a specific question to answer. |
