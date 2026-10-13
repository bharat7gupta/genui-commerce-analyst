# Day 15 investigation development baseline

Frozen dataset: [development-v1](../../evals/investigation/development-v1.json).
Run: [report](../../results/day-15-investigation-development-2026-10-13T08-27-37.486Z-d3819fff-5e14-44eb-8960-d74e90cfe56c/report.json).
Detailed manual inspection: [failure review](../../results/day-15-investigation-development-2026-10-13T08-27-37.486Z-d3819fff-5e14-44eb-8960-d74e90cfe56c/failure-review.json).

This is a **development baseline**, not a held-out evaluation or production
readiness result. All 15 cases ran once, without retries or tuning, using
`qwen3.5:4b`, unchanged `investigation-extractor-v1`, temperature 0, output cap
512, and reasoning effort none. The model tag does not establish an immutable
weight revision. Expectations and grading rules were declared before any call.

## Results

| Category | Cases | Outcome correct | Extraction correct | Numerical correct / reached | End-to-end pass |
| --- | ---: | ---: | ---: | ---: | ---: |
| Supported | 6 | 4/6 | 3/6 | 3/4 (2 not reached) | 3/6 |
| Ambiguous | 4 | 4/4 | 4/4 | Not applicable | 4/4 |
| Unsupported | 3 | 2/3 | 0/3 | Not applicable | 0/3 |
| Misleading | 2 | 1/2 | 1/2 | 1/1 (1 not reached) | 1/2 |
| Total | 15 | 11/15 | 8/15 | 4/5 (3 not reached; 7 not applicable) | 8/15 |

Extraction grades compare metric, baseline, target, and dimension exactly, plus
whether unresolved questions are present; question wording is ungraded.
Numerical grades compare every scalar value, percentage, regional value,
presence flag, and change against independent SQL-verified expectations.
End-to-end success requires every applicable check, including SQL count and
the evidence check for misleading requests; `not_reached` is not a pass.

| Case | Actual outcome | SQL | Main result |
| --- | --- | ---: | --- |
| supported-01 | completed | 4 | Paraphrase passed |
| supported-02 | completed | 4 | Explicit baseline/target paraphrase passed |
| supported-03 | clarification_required | 0 | Reverse direction over-clarified |
| supported-04 | completed | 4 | Reverse direction swapped; wrong requested change |
| supported-05 | clarification_required | 0 | Equal periods over-clarified; known validator gap |
| supported-06 | completed | 4 | Explicit half-open intervals passed |
| ambiguous-01 | clarification_required | 0 | Missing metric preserved |
| ambiguous-02 | clarification_required | 0 | Missing periods preserved |
| ambiguous-03 | clarification_required | 0 | Missing dimension preserved |
| ambiguous-04 | clarification_required | 0 | Bare revenue remained ambiguous |
| unsupported-01 | clarification_required | 0 | Profit mistaken for ambiguity |
| unsupported-02 | unsupported | 0 | Refund metric rejected, period extraction wrong |
| unsupported-03 | unsupported | 0 | Category rejected, periods dropped |
| misleading-01 | completed | 4 | Verified increase overrode claimed decline |
| misleading-02 | clarification_required | 0 | Campaign-cause request over-clarified; no answer |

## Independent numerical checks

Before model calls, all 30 live rows matched the seed in every column. Reference
SQL independently summed the declared periods and compared region aggregates
using a full outer join over unique grouped rows, avoiding raw-order revenue
duplication. Reference queries were excluded from workflow SQL counts.

Declared and verified totals:

- August → September: `7225.00 → 8295.00`, `+1070.00`, `14.81%`.
- September → August: `8295.00 → 7225.00`, `-1070.00`, `-12.90%`.
- August → the same August: `7225.00 → 7225.00`, `0.00`, `0.00%`.
- `[2025-08-02, 2025-08-04)` → `[2025-09-02, 2025-09-04)`:
  `1100.00 → 1260.00`, `+160.00`, `14.55%`; only North is present.

The equal-period case deliberately expects the mathematically valid zero-change
answer as supported analytical intent. The existing non-overlap rule cannot
execute identical intervals, a gap declared before running. This run failed
earlier: extraction discarded both explicit periods. No replay was performed.

## Inspection of every failure

- **supported-03:** The model discarded explicit reversed periods and asked
  which was baseline/target. The expected negative comparison never reached SQL.
- **supported-04:** The model treated August against September as August
  baseline/September target. The compiler/executor correctly calculated the
  resulting wrong intent: `+1070.00 (14.81%)`, instead of the required
  `-1070.00 (-12.90%)`. This is an extraction error, not an arithmetic error.
- **supported-05:** The model requested dates despite both August periods being
  explicit. The known non-overlap restriction was not reached in this run;
  correct extraction would still face that restriction.
- **unsupported-01:** Profit became a null metric and null periods, so the
  outcome was clarification rather than unsupported. SQL remained blocked.
- **unsupported-02:** The refund metric was correctly rejected, but the baseline
  was null and target was August instead of September. Outcome passed while
  strict extraction failed.
- **unsupported-03:** Category was correctly rejected, but both explicit periods
  were dropped. Outcome passed while strict extraction failed.
- **misleading-02:** The model requested direction and baseline/target values
  despite explicit August-to-September intent. There was no SQL or summary.
  No business cause was asserted, but evidence-following answer quality was
  **not reached**, rather than passed.

The other misleading request's summary was manually inspected: it reported the
verified increase and regional contributions, cited the definition source, and
stated that business causes were not established, overriding the claimed decline.
No model-generated explanation entered either deterministic numerical pipeline.

All runtime `failedStage` fields are null: there were no provider, structural,
or executor exceptions. The failed checkpoints are semantic extraction/outcome
and numerical grading, identified above and in the separate failure-review file.

## Recording and limits

The shared raw-call recorder is extracted from the earlier demonstration; that
script now uses the same recorder as this evaluation. Its prior six artifact
files remain byte-for-byte unchanged. The prompt, dataset, application path,
grader, references, and recorder checksums matched before and after the run.

Artifacts include frozen protocol and independent references, 15 immediate raw
invocation records, one result per case, category counts, stage/query traces,
workflow SQL counts, failed stage, total/model latency, tokens, and API cost.
The run used 20 workflow SQL executions, 5964 input and 1467 output tokens.
API pricing was unconfigured: all 15 costs are explicitly unavailable, and
total local execution cost remains unmeasured. Model latency summed to 84,000 ms;
the first call took 13,186 ms and is a cold-start candidate. These single-run
observations do not establish stable output or representative latency.

Reproduce with `npm run experiment:investigation-development` (15 model calls,
new artifact directory). No prompt, contract, validator, or pipeline fixes were
made based on these results. The dataset is now exposed development evidence.
