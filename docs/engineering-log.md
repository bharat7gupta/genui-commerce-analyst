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

## Day 6 — Minimal React KPI

- Added a server-rendered React page using an explicit `query-plan-v1` plan:
  `net_revenue`, interval `[2025-08-01, 2025-09-01)`, empty dimensions and
  filters, and `none` for comparison, ordering, limit, and visualization.
  This 31-day interval satisfies the existing 366-day executor policy.
- Ran the example against the existing database through the unchanged compiler
  and read-only DuckDB executor, without model calls. Actual executor rows:
  `[{"net_revenue":"7225.00"}]`. Verified the HTTP response contains one React
  KPI card showing `7225.00`, `net_revenue`, and both interval boundaries with
  inclusive/exclusive labels. The decimal string is rendered unchanged; SQL
  `NULL` is shown as “No matching orders.”
- Database execution stays on the server and runs on each page request with
  the existing deadline. Type checking and all ten focused compiler/executor
  tests passed. This demonstrates deterministic execution-to-UI rendering;
  it makes no new claim about live-model reliability or production readiness.
- Launch with `npm run example:net-revenue-ui`, then open
  `http://127.0.0.1:3000`.

## Day 6 — Validated KPI specification

- Added the fixed specification `{"type":"kpi","resultField":"net_revenue"}`
  with a strict runtime schema. Only this component type and result field are
  allowed; extra properties, including a numeric value, are rejected. The
  renderer validates before looking up the separate executor result and maps
  `kpi` to the existing React card.
- Ran `example:kpi-specification` without model calls: the actual DuckDB row
  `{"net_revenue":"7225.00"}` rendered `7225.00`; `type: "chart"` was rejected
  with “Unknown component type; expected \"kpi\"”; `resultField: "profit"`
  was rejected with “Unknown result field; expected \"net_revenue\".”
- Type checking and five deterministic UI tests passed, including changing
  executor values, strict rejection, SQL NULL, and missing-result handling.

## Day 6 — Table specification

- Extended the strict UI specification to allow exactly `kpi` and `table`;
  resultField remains restricted to `net_revenue` and extra properties are
  rejected. The table renders executor rows under “Net revenue.” Both views
  keep the metric and exact date boundaries visible; fixed server views are
  available at `/` and `/table`.
- Ran both fixed specifications against one real DuckDB executor result:
  `[{"net_revenue":"7225.00"}]`. Both rendered `7225.00`. Unsupported `chart`
  was rejected with “Unknown component type; expected \"kpi\" or \"table\".”
  No model calls, metric additions, or compiler changes were made.
- Type checking and all six deterministic UI tests passed, including table
  rows and validation for both specifications.

## Day 6 — Model display selection

- Froze `display-selection-v1` and its strict JSON Schema generated from the
  existing UI specification, then ran two requests once each with `qwen3.5:4b`,
  temperature 0, max output tokens 128, and reasoning effort none. No retries
  or prompt tuning were used; source checksums matched before and after.
- The model received only the display-selection instructions and user request;
  expected types and numeric results remained evaluator/application data.
  The August plan stayed fixed and real DuckDB separately returned
  `[{"net_revenue":"7225.00"}]` for both renders.
- Raw KPI output: `{"type": "kpi", "resultField": "net_revenue"}`;
  raw table output: `{"type": "table", "resultField": "net_revenue"}`.
  Both passed strict validation, matched the requested type, and rendered
  `7225.00` with the metric and exact date interval visible.
- KPI latency was 8,801 ms with 101 input / 17 output tokens; table latency
  was 946 ms with 99 input / 16 output tokens. The first call is a cold-start
  candidate; two calls do not establish representative latency or reliability.
- Generation and validation failures have no successful specification and
  produce an error-only HTML page. Type checking and nine deterministic UI
  tests passed; both saved HTML pages were inspected for component, value,
  metric, and date boundaries.
- Artifacts: [`display-selection run`](../results/day-06-display-selection-2026-10-07T05-13-13-537Z/),
  including raw-call JSONL, frozen protocol/checksums, per-case outcomes, and
  rendered pages. This small demonstration is not a production-readiness test.

## Day 6 — Interactive model display

- Added a browser page with “Show KPI” and “Show table.” Selection waits for
  complete server-side generation and strict specification validation; a
  separate server request then executes the unchanged August plan and renders
  the existing component. No result values enter model messages, and no token
  streaming or retries were added.
- Verified in headless Chrome with one real provider call and real DuckDB:
  “Choosing display…” → “Running query…” → “Display ready.” with a KPI value
  of `7225.00`, metric, and exact date boundaries. Both buttons were disabled
  during both pending stages and enabled after completion.
- The next click cleared the previous KPI immediately. A test-only injected
  provider failure produced “Choosing display…” → “Display generation failed:
  Simulated provider failure,” no result, and enabled buttons. DuckDB invocation
  count stayed at one, confirming that provider failure prevented execution.
- Type checking and nine deterministic UI tests passed. Browser verification
  uses an isolated temporary server/browser. Launch the interactive page
  with `npm run example:model-display-ui` at `http://127.0.0.1:3001`.

## Day 6 — Editable date interval

- Added start-inclusive and end-exclusive date inputs defaulting to
  `[2025-08-01, 2025-09-01)`, preserving net_revenue and KPI/table selection.
  Only the interval changes in the application-owned plan. Both server stages
  reuse QueryPlan validation and the executor's existing 366-day policy; the
  selection stage rejects invalid intervals before a model call. Compiler
  behavior is unchanged.
- Chrome verification submitted `[2025-08-02, 2025-08-04)` once with table
  selection and real model/DuckDB execution. Actual rows were
  `[{"net_revenue":"1100.00"}]`; the table showed `1100.00` and the executed
  inclusive/exclusive boundaries. All other plan fields matched the original
  fixed plan. Dates remain separate from model display selection.
- Editing a date immediately cleared the previous result. Reversed
  `[2025-08-04, 2025-08-02)` produced “Invalid QueryPlan semantics:
  dateRange.start must be earlier than dateRange.end for a [start, end)
  interval,” with zero additional model/executor calls. A direct reversed
  request to the execution endpoint was also rejected before execution.
- Date controls are disabled during requests to prevent stale results after
  edits. Type checking, 13 deterministic UI tests, and five real-executor
  integration tests passed. Reproduce with `npm run verify:model-display-dates`.

## Day 6 — No matching data versus zero

- First ran the unchanged compiler/executor for `[2026-01-01, 2026-02-01)`
  against the existing database. Raw result: `[{"net_revenue":null}]`.
  Confirmed that gross_amount, discount_amount, and refund_amount are NOT NULL
  in both the seed and live schema. SUM therefore distinguishes no matches
  from a genuine zero decimal; no production match-count metadata is needed.
- Both display choices now show “No matching data for this date range” for
  the single SQL NULL aggregate, retaining metric and executed interval labels.
  Missing aggregate rows are errors; `"0.00"` retains ordinary KPI/table rendering.
- Chrome verified both types against the real no-match interval, and against
  a temporary DuckDB fixture with two matching zero-net orders and a positive
  order on the excluded end date. Independent reference SQL confirmed two
  matches; the executor returned `[{"net_revenue":"0.00"}]` and both components
  displayed `0.00`. The count exists only in fixture verification, outside the
  model specification. The production database and compiler are unchanged.
- Type checking and 14 deterministic UI tests passed. No model calls or prompt
  changes were made. Reproduce with `npm run verify:no-matching-data`.

## Day 6 — Deterministic query failure

- Added `verify:query-failure` using a valid stubbed display-selection response
  and a throwing executor, with no live model or database calls. A prior
  stubbed KPI value is rendered first to verify clearing on the failing click.
- Chrome observed “Choosing display…” → “Running query…” → “Query failed:
  Simulated query error”. The selection endpoint returned 200 with the valid
  table specification; the execution endpoint returned 503. The result stayed
  empty throughout, no KPI/table rendered, and both buttons re-enabled.
- The failing request made exactly one selection invocation and one executor
  invocation, with no retries. Existing error handling passed unchanged;
  only the demonstration and its launch instructions were added. Type checking
  and the browser demonstration passed.

## Day 6 — Missing-date clarification

- Added a missing-date clarification to the existing page and request boundary.
  Empty or omitted date inputs produce “Choose a start and end date” with the
  missing input identified. Both server endpoints stop before selection or
  execution; non-empty dates retain existing QueryPlan/date-policy validation,
  including reversed-interval errors. The model UI schema is unchanged.
- Chrome verification first rendered the August KPI, then cleared the end
  date. The previous result disappeared; submitting showed clarification for
  “End (exclusive)” with zero additional API, selection, or executor calls.
  Direct requests with omitted dates were also clarified by both endpoints.
- Providing `2025-09-01` restored “Choosing display…” → “Running query…” →
  “Display ready.” and displayed the real DuckDB value `7225.00`. Verification
  used stubbed selection, with no live model calls, guessing, or new metrics.
- Type checking and 15 deterministic UI tests passed, as did the browser
  demonstration. Reproduce with `npm run verify:date-clarification`.

## Day 6 — Simulated streaming boundary

- Added `verify:streaming-boundary` using the existing interactive page,
  selectDisplay validator, and renderer. A test-only simulated response
  accumulates three chunks: `{"type": "ta`, `ble", "resultF`, and
  `ield": "net_revenue"}`. No generated-output parsing or validation happens
  during accumulation; even complete assembled JSON waits for the explicit
  completion signal before returning through the existing provider contract.
- Chrome confirmed “Choosing display…” and no component after each chunk.
  Completion produced `{"type": "table", "resultField": "net_revenue"}`,
  which passed validation before fixture execution and table rendering of
  `7225.00`. The value stayed in a separate executor-result fixture.
- Ending after the first two chunks produced “Display generation failed:
  Simulated display stream ended early before completion.” The previous result
  stayed cleared, no generated specification was validated, and the fixture
  executor was not called for that request. Both buttons re-enabled.
- Type checking and browser verification passed. No live model/database calls,
  provider adapter changes, or production streaming implementation were added.

## Day 6 — Live server-side display streaming

- Added a text-only `generateStreaming` method to the existing Qwen adapter;
  retained the non-streaming `generate` path. The interactive CLI now accumulates
  chat-completions content deltas on the server with the existing strict UI JSON
  schema and unchanged display-selection prompt/settings. Only `stop` plus
  `[DONE]` permits the existing parser/validator to run. EOF, disconnect,
  malformed events, and abnormal completion fail without rendering or execution.
- Ran exactly one live **Show table** request, without retries or prompt tuning.
  Received 15 content chunks with normal completion (`stop` and `[DONE]`).
  First-content latency was 8,122 ms; total model duration was 8,719 ms.
  The completed output was
  `{"type":"table","resultField":"net_revenue"}`, which passed validation.
  Usage: 98 input, 16 output, 114 total tokens. This single first-call measurement
  is not a representative warm-latency estimate.
- Chrome observed “Choosing display…” with no result, then “Running query…”
  with no result, then “Display ready.” Parsing and strict validation wait for
  provider completion; query execution and rendering wait for validated output.
  Partial content never renders. The real August DuckDB executor returned
  `[{"net_revenue":"7225.00"}]`; the table showed `7225.00`, `net_revenue`,
  and `[2025-08-01, 2025-09-01)`. One model invocation and one executor call;
  numeric data was not sent to the model. Frozen source checksums matched.
- The live run demonstrates successful streaming and real DuckDB execution.
  Interrupted-stream behavior was checked separately with simulated browser
  chunks and mocked adapter transport: early termination produces a readable
  error and no result component. Those checks made no live model calls and do
  not establish behavior under a real provider/network interruption.
- Limitations remain: only `kpi`/`table` and `net_revenue` are supported; content
  accumulates on the server, without browser token streaming or partial renders.
  No retries or prompt tuning were added. One successful live request does not
  establish reliability, representative latency, or production readiness.
- Artifact: [live streaming report](../results/day-06-live-streaming-display-2026-10-07T06-49-57-518Z/report.json),
  with raw invocation, chunk timestamps, protocol, executor rows, and rendered
  page in the same directory. Type checking, all 12 provider tests (including
  non-streaming regression tests), and all 15 UI tests passed.
