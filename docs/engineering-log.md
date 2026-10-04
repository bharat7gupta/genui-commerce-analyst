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
