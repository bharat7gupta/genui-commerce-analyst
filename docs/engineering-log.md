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
