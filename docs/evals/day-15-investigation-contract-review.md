# Day 15 evaluation contract review

This is a **post-hoc development contract review of existing outputs**. It does
not represent another run or an improvement to the model. No model calls, SQL
executions, prompt tuning, or implementation changes were made.

The [original report](day-15-investigation-development.md), its frozen grading
rules, and all original grades remain unchanged. The separate
[reviewed grades](../../results/day-15-investigation-contract-review-v2/report.json)
include every original grade alongside the reviewed user-task result.

## Rules applied to the saved outputs

**Equal-period eligibility:** `supported-05` asks for August 2025 against the
same August 2025 period. The task's zero-change expectation is mathematically
valid and was independently SQL-verified before the original run. However,
the application contract requires non-overlapping intervals, so it cannot
complete this task even with perfect extraction. This is a **task/contract
mismatch**, reported separately and excluded from the reviewed user-task
denominator. It is neither a new pass nor a model-task failure.

The saved output additionally discarded both explicit periods and asked for
dates. That exact-extraction diagnostic remains failed. The recorded run never
reached the non-overlap check, and this review does not claim that the model
produced correct extraction or that the validator caused the observed answer.

**Unsupported user-task rejection:** A rejection passes when the explicitly
unsupported metric or dimension is correctly identified, the outcome is
`unsupported`, and zero workflow SQL executes. Unrelated date-extraction errors
are retained as failed diagnostics; they do not invalidate successful rejection.
No numerical result is required for an unsupported request.

**All other cases:** Original criteria and grades are retained. Numerical and
misleading-answer evidence checks are not relaxed. No expected input, case
text, extraction, recorded call, or original grading code was edited.

## Both grading versions

| Category | Original strict end-to-end | Reviewed user-task success | Exact extraction diagnostics, unchanged |
| --- | ---: | ---: | ---: |
| Supported | 3/6 | 3/5; 1 contract mismatch | 3/6 |
| Ambiguous | 4/4 | 4/4 | 4/4 |
| Unsupported | 0/3 | 2/3 | 0/3 |
| Misleading | 1/2 | 1/2 | 1/2 |
| Total | 8/15 | 10/14; 1 contract mismatch | 8/15 |

The original strict score is 53.3%; reviewed user-task success is 71.4% among
14 eligible cases. These scores use different rules and denominators. They
must not be interpreted as a measured implementation or model improvement.
Exact extraction remains 8/15 across all frozen cases, including the separate
equal-period diagnostic. Original outcome correctness remains 11/15.

Numerical diagnostics are unchanged: four passes, one incorrect requested
comparison, three not reached, and seven not applicable. The equal-period
not-reached result is retained in this historical diagnostic count; it is not
counted against reviewed task eligibility. API cost remains unavailable as
recorded; total local cost remains unmeasured. Original traces, SQL counts,
latencies, tokens, and failed-stage fields are preserved.

## Cases affected by the review

| Case | Original strict grade | Reviewed task result | Diagnostic retained |
| --- | --- | --- | --- |
| supported-05 | fail | excluded: task/contract mismatch | Null periods and unnecessary questions; extraction fail, numerical not reached |
| unsupported-01 | fail | fail | Profit not identified; clarification rather than unsupported; zero SQL |
| unsupported-02 | fail | pass | Refund metric correctly identified and rejected with zero SQL; baseline null and target assigned to wrong month |
| unsupported-03 | fail | pass | Category correctly identified and rejected with zero SQL; explicit periods discarded |

Four eligible user-task failures remain: `supported-03` (reversed direction
over-clarified), `supported-04` (period direction swapped, producing the wrong
requested numerical answer), `unsupported-01` (profit mistaken for ambiguity),
and `misleading-02` (over-clarification prevented the required evidence-based
answer). The equal-period mismatch is reported separately. Date diagnostics on
the two successful unsupported rejections remain visible rather than being
erased or converted to extraction passes.

## Preservation and scope

The reviewed JSON references each original case file and stores its complete
original grades. SHA-256 checks before and after the review matched for all
155 protected files: implementation and evaluation source, package.json,
frozen cases, original development report/calls/protocol/case files/failure
review, the original Markdown report, and earlier three-run artifacts. The
[preservation manifest](../../results/day-15-investigation-contract-review-v2/source-checksums.json)
records those checksums. Only new review artifacts and documentation were added.

This remains exposed development evidence. The contract review establishes
which user tasks succeeded under the documented rejection policy; it does not
establish generalization, production readiness, or a fix for any failure.
