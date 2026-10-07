## Day 1 — Local model smoke test

- Qwen responded correctly through the provider adapter.
- Latency: 7,168 ms.
- Reported usage: 17 input and 197 output tokens.
- Request ID was unavailable.
- The output-token count is unexpectedly high for `LOCAL_MODEL_OK`.
  It may include internal reasoning tokens, but this has not been verified.
- Next: compare cold and warm calls before drawing conclusions about latency.

## Day 1 — Baseline output variability

- The same `baseline-v0` prompt was run three times for
  `total-gross-revenue`.
- All three runs reported 2,170 input tokens, confirming that the serialized
  input remained stable.
- The model returned three different answers: `36480.0`, `24850.00`, and
  `12940.00`. The handwritten SQL reference result is `18010.00`.
- The request does not currently set a temperature or random seed, so the
  endpoint uses its default sampling behavior. `MODEL_REASONING_EFFORT=none`
  does not disable sampling or guarantee deterministic output.
- Reproducibility and correctness are separate concerns. A zero-temperature or
  fixed-seed request may improve repeatability, but an LLM can still produce a
  consistently incorrect arithmetic result when asked to sum raw JSON rows.
- A run status of `success` currently means that the provider call completed;
  it does not mean that the model output matched the expected result.

## Day 2 — Router prompt comparison

- `router-v1` and `router-v2` were each evaluated with 60 calls against the
  frozen `routing-cases-v1` dataset using identical model settings.
- `router-v1` remains the current winner: 75% exact-match accuracy versus 65%
  for `router-v2`.
- Both versions produced valid labels for every call and were stable across all
  20 cases, so the difference reflects consistent classification behavior.
- `router-v2` improved `clarify` accuracy from 25% to 50%, but reduced
  `analytics` from 75% to 50% and `unsupported` from 100% to 50%. It fixed
  `clarify-02` while newly breaking `analytics-02`, `unsupported-01`, and
  `unsupported-02`.
- The longer v2 prompt raised average input usage from 196.65 to 261.65 tokens
  without improving overall accuracy; warm median latency remained similar
  (177 ms versus 182 ms).
- Decision: keep `router-v1` as the selected router. Retain immutable
  `router-v2` and its results as a rejected experiment for traceability.

## Day 2 — Router v3 development-set decision

- Hypothesis: concise few-shot examples may communicate route boundaries to
  `qwen3.5:4b` better than the rule-heavy `router-v2` prompt.
- `router-v3` achieved 90% accuracy with zero invalid outputs, zero provider
  errors, and 20/20 stable cases. Per-route accuracy was: `analytics` 75%,
  `docs` 100%, `investigation` 100%, `clarify` 75%, and `unsupported` 100%.
- Two failures remain: `analytics-04` expected `analytics` but received `docs`;
  `clarify-03` expected `clarify` but received `analytics`.
- Comparison: `router-v1` scored 75% at 196.65 average input tokens,
  `router-v2` scored 65% at 261.65 tokens, and `router-v3` scored 90% at
  349.65 tokens. V3 improved accuracy by 15 percentage points over v1 while
  increasing input usage by approximately 78%; warm median latency changed
  only from 177 ms to 183 ms.
- Decision: select immutable `router-v3` as the current development-set winner.
  Retain v1 and v2 unchanged for reproducibility and rollback. Do not create a
  v4 specifically for the two remaining failures, because further tuning on
  these cases would overfit the evaluation set.
- `routing-cases-v1` is now a development/regression set, not an unseen
  held-out set. Before considering v3 production-ready, evaluate the frozen
  prompt against a separately created held-out routing set.
- Immutable experiment artifacts: [`routing-baseline-v1`](../results/day-02-routing-baseline-v1.jsonl),
  [`routing-baseline-v2`](../results/day-02-routing-baseline-v2.jsonl), and
  [`routing-baseline-v3`](../results/day-02-routing-baseline-v3.jsonl).

## Held-out evaluation

- Prompt: `router-v3`.
- Dataset: `routing-heldout-v1`.
- Result: [`results/routing-heldout-v1-router-v3.jsonl`](../results/routing-heldout-v1-router-v3.jsonl).
- Development accuracy: 90%.
- Held-out accuracy: 76%.
- Generalization gap: -14 percentage points.
- Invalid outputs: 0%.
- Provider errors: 0%.
- Stability: 25/25 cases.
- Unsupported accuracy: 100%.
- Adversarial accuracy: 40%.
- Overall acceptance verdict: failed.
- Per-route held-out accuracy: `analytics` 80%, `docs` 100%,
  `investigation` 40%, `clarify` 60%, and `unsupported` 100%.
- Six systematic failures were stable across all three repetitions:
  - `heldout-analytics-04` expected `analytics` but received `clarify`.
  - `heldout-investigation-01` expected `investigation` but received
    `analytics`.
  - `heldout-investigation-04` expected `investigation` but received `docs`.
  - `heldout-investigation-05` expected `investigation` but received `docs`.
  - `heldout-clarify-01` expected `clarify` but received `analytics`.
  - `heldout-clarify-04` expected `clarify` but received `analytics`.
- Recorded checksums:
  - Dataset SHA-256:
    `bf7fb7af773233c689a412db93ce217273fdc5d2d9b397331ce334674631e25a`.
  - `router-v3` prompt-package SHA-256:
    `3f1ba625ae267eb3d6818ca7844793940d3ffd1a53c55ad6b0cb3f9f424422db`.
  - Result-file SHA-256:
    `656bb03daf496773154d2f3223264c68b430401f7fbb11941e6f4db656a49c9a`.

## Interpretation

- Exact-label output validation is reliable.
- Temperature zero produced stable but consistently incorrect
  classifications.
- The model frequently relied on lexical cues instead of the operational
  distinction between direct analytics, missing information, documentation
  lookup, and multi-step investigation.
- Few-shot prompting improved development performance but did not generalize
  sufficiently.
- Prompt-injection handling generalized only for `docs` and `unsupported`
  examples; it failed for `analytics`, `investigation`, and `clarify`.
- Unsupported-action detection remained strong.
- Longer prompts increased tokens without guaranteeing generalization.

## Decision

- `router-v3` remains the best development-set version but is not
  production-ready.
- No prompt version passed the held-out acceptance gate.
- Preserve router-v1, v2, and v3 unchanged for reproducibility.
- Do not create router-v4 by tuning directly against the exposed held-out
  failures.
- `routing-heldout-v1` is now an audit/regression dataset and cannot serve as
  an unseen final test again.
- Any future iteration requires a new development cycle and another
  independently authored held-out set.
- A future iteration should compare prompt-only routing with stronger-model or
  hybrid deterministic/model routing.
- Downstream authorization, tool access, argument validation, and safety
  controls must remain enforced in application code regardless of the
  predicted route.
- Day 2 is completed with a failed production-readiness gate but a successful
  prompt-versioning and evaluation exercise.

## Day 3 — Structured QueryPlan contract and extraction

- `query-plan-v1` is the typed interpretation contract between natural-language
  intent and future deterministic query compilation. UI selectors could emit
  the same contract; the LLM's product value remains an unproven usability
  benefit, not a requirement of the architecture.
- Structural validity only proves conformance to the contract. Semantic
  correctness additionally requires the right outcome and exact intent fields;
  schema-constrained output did not guarantee either.
- On the eight-case development set (three runs each), extraction-v1 achieved
  100% structural validity, 50% outcome accuracy, 0% exact expected-plan field
  accuracy, and 25% end-to-end success. It failed both scalar-total cases by
  over-clarifying; emitted the wrong metric/limit for gross-by-region; failed
  top-three-regions by clarifying; emitted the wrong metric, grouping, and limit
  for North net revenue; and classified the reversed interval as unsupported.
  Its profit outcome was correct, but manual review found the false claim that
  net revenue equals profit in all three explanations.
- Extraction-v2 achieved 87.5% structural validity, 75% outcome accuracy, 40%
  exact expected-plan field accuracy, and 50% end-to-end success. Its remaining
  failures were timestamp-shaped values for the explicit interval, omission of
  the requested top-three limit, invented region grouping for filtered North
  net revenue, and a generated plan for ambiguous revenue. It corrected scalar
  aggregation, grouped revenue, reversed-interval clarification, and the profit
  explanation.
- Decision: retain immutable v2 as the stronger development candidate, but
  keep v1 as the current default. Neither is production-ready, and the exposed
  development cases must not drive another tuning round.
- Application validation blocked all timestamp-shaped dates. A mocked transport
  capture of the current request construction confirmed that Draft 7
  `pattern: "^\\d{4}-\\d{2}-\\d{2}$"` reaches every interval date in the strict
  JSON Schema; the saved v2 responses show three violations of that pattern.
  This rules out a missing source constraint or adapter mapping loss, but does
  not isolate a provider or backend root cause.
- Known limitations and follow-ups: determine which JSON Schema keywords the
  endpoint actually enforces; resolve the ambiguity boundary and remaining
  field errors without tuning on this set; validate a frozen candidate on a
  separately authored set; and compare the LLM flow with deterministic
  selectors using measured user outcomes before claiming a usability benefit.
- Artifacts: [`development-cases-v1`](../evals/query-plan/development-cases-v1.jsonl)
  and [`query-plan-extraction-development-v1-v2`](../results/day-03-query-plan-extraction-development-v1-v2.jsonl).

## Day 4 — Function calling

- Implemented three application-owned, runtime-validated tools:
  `get_metric_definition`, `get_schema`, and `preview_query_plan`. A bounded
  standalone workflow executes calls sequentially with limits of four model
  requests and six total tool calls; it remains separate from the commerce
  analysis pipeline and database execution.
- Real `qwen3.5:4b` runs successfully used `get_metric_definition` for metric
  questions and correctly returned greetings without unnecessary tool calls.
- Two failure classes remain. First, final answers sometimes added unsupported
  interpretations or contradicted authoritative tool results. Stronger
  grounding instructions improved the constraint but did not establish
  reliable faithfulness.
- Second, complex argument generation repeatedly produced structurally invalid
  QueryPlans and incorrect date interpretations. Supplying the complete
  generated schema and a valid, differently shaped `preview_query_plan`
  example did not resolve these errors.
- Both complex-preview experiments terminated through the model-request budget
  without a successful preview or final answer. Runtime validation rejected
  every invalid plan, and no invalid plan reached database execution.
- Future experiments should compare a simpler model-facing argument contract,
  a stronger model, and deterministic orchestration using the existing
  extraction path. Do not treat additional prompt tuning on these observed
  failures as evidence of generalization.

## Day 5 — Live commerce-analysis pipeline

- Ran three frozen questions once each with `qwen3.5:4b`, `router-v3`,
  `query-plan-extractor-v2`, the deterministic SQL compiler, and the real
  read-only DuckDB executor. Handwritten reference SQL and expected rows were
  verified before the first model call; no retries or prompt tuning were used.
- Result: 0/3 end-to-end passes. The all-time request was routed to `clarify`,
  so extraction and execution did not run. Both explicit-interval requests
  routed to `analytics`, but extraction emitted timestamp-shaped dates and was
  rejected by runtime validation before database execution. The North request
  also added a region dimension despite asking for a filter-only scalar total.
- No case reached DuckDB through the live pipeline, so this run provides no
  live-model evidence about numerical execution accuracy. The failures are one
  routing failure and two extraction failures, not execution or numerical
  mismatches.
- Artifact: [`day-05-live-commerce-analysis-v1`](../results/day-05-live-commerce-analysis-v1.jsonl),
  SHA-256 `39db73dbca914d4547ffa35fb4970646380e815701abda9005feff8f700cdafb`.

## Day 5 — Deterministic numerical evaluation

- Ran ten model-free cases through the real read-only DuckDB executor within
  the current compiler slice: all-time and explicit intervals, both with and
  without region equality filters. Each executed row was compared exactly with
  separately declared expected rows and independently handwritten reference
  SQL; all 10 cases passed all three comparisons.
- A `[2025-08-02, 2025-08-04)` case included O001 on the start date and
  excluded O002 exactly on the end date, producing `1100.00` and confirming
  the existing half-open boundary semantics.
- `SUM(gross_amount - discount_amount - refund_amount)` over no matching rows
  returns one row containing SQL `NULL`, not zero. The evaluator records this
  explicitly as `emptySetSemantics: "returns_null"`.
- Artifact: [`day-05-deterministic-numerical-evaluation-v1`](../results/day-05-deterministic-numerical-evaluation-v1.jsonl),
  SHA-256 `92a092b2bd79e62b92cac61b016a7be76e20d043c3f65e4af22d7d850bab8d4b`.
