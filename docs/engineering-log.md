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
