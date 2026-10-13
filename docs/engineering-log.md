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

## Day 7 — Evaluation harnesses and consolidated findings

- Consolidated exactly 40 cases with separate targets: 17 router, 11 extractor,
  2 executor, and 10 full pipeline. Router matches: **14/17**; extractor outcome
  correctness: **9/11**; interpretation meaning: **3/6**. Manual quality passed
  for **1/1** reached clarification and **2/2** unsupported reasons; two
  clarification assessments were not reached after wrong outcomes.
- The date-only extractor-v3 instruction raised development schema success from
  **0/5 to 5/5**, but full-pipeline success stayed **0/5**. The five former
  held-out pipeline cases also scored **0/5**. Edited replays are diagnostics,
  not successful requests. Downstream v3 checks were newly observed, not
  automatically improved.
- Failure classes included routing overrides, invented gross-revenue defaults,
  added grouping/filters, contradictory region filters, and omitted limits.
  Schema/business validity did not establish meaning. Compiler restrictions
  remained separate: only a narrow scalar-net slice executes, and omitted
  operations accepted as `unspecified` by some expectations require `none`
  for compilation. None of the ten pipeline runs produced database rows;
  numerical grades were `not_reached`, not numerical failures.
- Both fresh model-free executor cases passed (**2/2**): boundary sum `1100.00`
  and one SQL NULL row for no matches. References used independent seed
  arithmetic and handwritten SQL; all 30 live rows matched the seed. Monetary
  grading used exact decimals without tolerance; NULL remained distinct from zero.
- Results are small, single-run, related-case evidence, with no user-facing
  rendering evaluation. Former held-out cases and both reserved candidates are
  now exposed. Component passes do not establish pipeline reliability or
  production readiness. Original artifacts remain unchanged; the ten matching
  v3 pipeline runs were reused, with provenance verified.
- Next priorities: decide omitted-operation semantics; address scope/default and
  clarification errors in a new development cycle; improve routing-override
  coverage; add end-to-end numerical/UI coverage and a genuinely unseen test set.
  No fixes were implemented during consolidation. See the
  [40-case report](evals/day-7-final-report.md) for inventory, denominators, and
  saved evidence.

## Day 8 — Retrieval baselines

- Built a 60-document Markdown corpus for the fictional `demo-commerce` tenant.
  Repository-backed metric, dataset, and query-behavior documents are separated
  from explicitly marked synthetic policy and FAQ fixtures. The final answer key
  contains eight draft development questions; the 32-document labels are
  preserved separately, and every final evidence excerpt was verified against
  its referenced document.
- Compared three unchanged Top-3 baselines: distinct keyword overlap; BM25 with
  `k1 = 1.2` and `b = 0.75`; and in-memory cosine similarity using the local
  `all-minilm:latest` 384-dimensional embedding model. Document vectors were
  embedded once and reused for all queries. No vector database was needed for
  60 documents.
- Overall Keyword results were Hit@1 **0.625**, Hit@3 **0.875**, and Recall@3
  **0.402083**. BM25 scored **0.500**, **0.875**, and **0.395833**. Embeddings
  scored **1.000**, **1.000**, and **0.514583**. For paraphrases, embedding
  Recall@3 was **0.650000**, versus **0.425000** for keyword and **0.412500**
  for BM25. All three methods had the same direct-question Recall@3 of
  **0.379166**, although embeddings ranked a relevant document first on every
  direct question.
- With six, three, eight, five, six, five, three, and four relevant labels per
  query, the maximum possible average Recall@3 is **0.665625**. Multipart
  evidence review found that every method's Top 3 collectively covered both
  parts of the gross-revenue/status question. For the reporting-date/refund-
  completion question, BM25 and embeddings covered both parts; keyword covered
  completion timing but did not retrieve clear evidence that `order_date`
  controls reporting-window inclusion.
- Decision: retain all three as small, reproducible baselines without tuning.
  The embedding result is strongest on this development set, particularly for
  paraphrases, but it is not production-readiness evidence. Limitations include
  only eight development queries, synthetic content, overlapping and partial-
  answer labels, a Top-3 recall ceiling below one, and no held-out evaluation.
  Artifacts: [final labels](../experiments/retrieval/queries.dev.json),
  [32-document label snapshot](../experiments/retrieval/queries.dev.32-docs.json),
  and [60-document results](../experiments/retrieval/results.dev.60-docs.json).

## Day 9 — Deterministic document chunking

- Implemented pure paragraph-aware chunking plus an in-memory, tenant-scoped
  document store with insert/replace, delete, ordered chunk listing, and
  explicit re-indexing. Chunk IDs deterministically include tenant, document
  identity, source version, content, chunking configuration, and chunk index;
  replacement chunks are generated before current state changes.
- `npm run example:document-chunking` kept the 601-character Day 8 sample whole
  and split the 952-character refund fixture into two ordered chunks at the
  700-character boundary while preserving metadata and all non-whitespace
  source text. The refund rule and its exception landed in separate chunks.
- `npm run example:document-ingestion` inserted those two version-1 chunks,
  repeated the same upsert with identical IDs and count, replaced them with one
  version-2 chunk whose current metadata was preserved and whose two old IDs
  were absent, inserted the same document ID for `other-shop`, and then deleted
  only the `demo-commerce` copy; `other-shop` retained its chunk.
- `npm run example:document-reindexing` ingested version 1 as two chunks with
  `maxCharacters = 700`, then re-indexed the retained source as one chunk with
  `maxCharacters = 1200`. The combined chunk contained both the refund rule and
  exception, both prior IDs were absent, and source version 1 and metadata were
  unchanged. Repeating the 1,200-character re-index produced the same single
  chunk ID with no duplicate.
- Source version describes a source-content revision; chunking configuration
  describes how that source is indexed. Re-indexing can therefore change chunk
  boundaries and IDs without changing the source version or source metadata.
  The 700- and 1,200-character sizes demonstrate this boundary behavior only;
  neither has been evaluated as optimal for retrieval.
- Verification passed with `npm run typecheck`,
  `npm run test:document-chunking` (five checks), and
  `npm run test:document-ingestion` (four checks), covering repeatability,
  metadata and text preservation, complete replacement, tenant/document
  isolation, missing-source reporting, and preservation of current state when
  replacement generation fails.
- Limitations: storage is process-local and in memory; overlap is fixed at
  zero; sizing uses JavaScript characters rather than model tokens; and chunks
  are not integrated with keyword, BM25, embedding, or vector retrieval. The
  existing Day 8 metrics remain document-level development results and do not
  validate either Day 9 chunking policy.

## Day 10 — Chunk embedding record

- Added a validated chunk embedding record carrying the existing chunk, vector,
  model identifier, explicit embedding revision, and dimension. Embedding
  revision is independent of source-document version; the model identifier
  alone is rejected as a revision. Callers must supply an immutable model
  revision or artifact digest; local validation cannot verify its provenance.
- Validation rejects empty, non-finite, sparse, zero-magnitude, and
  dimension-mismatched vectors, plus invalid dimensions or empty identifiers.
  Non-zero detection avoids squaring, preserving tiny finite components.
- Type checking and all seven synthetic-vector checks passed with
  `npm run test:chunk-embedding`. No model calls, retrieval integration, or
  database changes were made; Day 8 artifacts remain unchanged.

## Day 10 — Live two-chunk embedding demonstration

- Extracted Day 8's private embedding transport into an importable Ollama
  module without changing its endpoint, model, request body, or validation.
  Added `npm run example:chunk-embedding` using the existing long refund
  fixture, `maxCharacters=700`, and zero overlap. Each request embeds only one
  chunk's text; both validated records remain in memory.
- Resolved `all-minilm:latest` through the matching `name` in Ollama's
  `GET /api/tags` response, requiring its full SHA-256 `digest`. The installed
  revision was
  `sha256:1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef`.
  Metadata checks after each call returned the same digest. Missing, ambiguous,
  or malformed revision metadata fails rather than substituting a model tag.
  Checks around requests detect observed tag changes, but do not atomically pin
  a concurrent model update; no model installation/update was performed here.
- The live run returned dimension 384 for both chunks. Text lengths were 493
  and 457 characters; per-request embedding latencies were 573.548 ms and
  14.026 ms, excluding metadata checks. The first call is a cold-start
  candidate, not a representative latency estimate. Output contained IDs and
  metadata only, with no vector values.
- Type checking, seven existing chunk-record tests, and three mocked adapter
  tests passed. Adapter checks run with
  `node --import tsx --test src/ai/ollama-embedding.test.ts`.
  The sandbox initially blocked local connectivity before any embedding call;
  the authorized live run then completed two calls without retries. Day 8
  artifacts remain unchanged; no search, database, or ingestion integration.

## Day 10 — Exact retrieval over two refund chunks

- Added `npm run example:exact-chunk-retrieval` for the fixed query “What
  happens if the original payment method is closed?” Reused the prior demo's
  chunk embedding setup and extracted Day 8's cosine implementation unchanged.
  Shared vector validation supports query records without inventing a source
  document. All records must match model, immutable revision, and dimension
  before any comparison; ties sort deterministically by chunk ID.
- The live run used unchanged 700-character, zero-overlap chunking, text-only
  inputs, and the same adapter defaults for three embedding calls without
  retries. Query and chunks matched `all-minilm:latest`, dimension 384, and
  `sha256:1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef`.
  Ollama metadata checks surrounded chunk/query embedding as in the prior demo.
- The exception chunk ranked first with cosine similarity
  `0.5630380875566526`; the general refund rule ranked second with
  `0.37013314959827565`. The first chunk directly states the closed-payment-
  method fallback and its conditions. Query embedding took 9.223 ms; in-memory
  search took 0.597 ms including validation, scoring, and sorting. Both complete
  chunk texts were printed. This single query is a demonstration, not a retrieval
  quality evaluation or a representative latency estimate.
- Type checking, five synthetic search checks, and all seven existing embedding
  record checks passed. Day 8 artifacts remain unchanged; no query/chunk tuning,
  database changes, or ingestion-store integration was added.

## Day 10 — Chunk retrieval development evaluation

- Evaluated the unchanged 60-document corpus and eight Day 8 development
  queries with 700-character, zero-overlap chunks. Preserved source metadata;
  chunked Day 8's `title + newline + body` representation without repeating
  titles on later chunks. Embedded all 70 chunks once, reused them for every
  query, and embedded each query once (nine calls total, no retries).
- Ranked every chunk with exact cosine similarity after embedding identity
  validation, deduplicated by tenant plus parent ID in ranked order, then took
  three parents. Day 10 document-level Hit@1 and Hit@3 were both **8/8**,
  unchanged from the saved Day 8 embedding baseline;
  mean Recall@3 was **0.493750**, versus saved Day 8 embedding **0.514583**.
  Direct-query recall stayed **0.379166**; paraphrase recall was **0.608333**
  versus **0.650000**. The only recall decrease was paraphrase 01: gross revenue
  displaced net revenue in Top 3, reducing labeled recall from 3/6 to 2/6.
  The retrieved gross-revenue chunk states that discounts/refunds are not
  subtracted, rather than giving the requested net calculation. Other changes
  were order swaps or a same-relevance parent replacement.
- Saved-artifact inspection of paraphrase 01 found gross revenue at parent rank
  3 (chunk rank 3), scoring **0.496479**, above net revenue at parent rank 4
  (chunk rank 5), scoring **0.492680**. Both documents had two chunks. The
  correct net-revenue chunk retained the full answer-bearing formula
  `SUM(gross_amount - discount_amount - refund_amount)`; its exclusion from
  Top 3 was a ranking error, not loss of the formula at a chunk boundary.
  The gross-revenue chunk supplied topical contrast rather than the requested
  calculation. Day 8 ranked net revenue third; its artifact saved neither
  scores nor ranks beyond Top 3, so gross revenue's exact historical rank is
  unavailable. Shorter context changing term/negation weighting is a hypothesis,
  not an established cause; the historical model revision is also unverified.
- Recorded `all-minilm:latest`, dimension 384, and installed revision
  `sha256:1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef`.
  The saved Day 8 baseline lacks an immutable revision, so identical historical
  weights cannot be established. Metadata checks matched around each call;
  frozen corpus, labels, baseline, and implementation checksums matched before
  and after. Independently recomputed metrics matched both reported summaries.
- Results preserve the development-only, overlapping/partial-answer judgments
  and documented inconsistency. Document-level success does not establish chunk
  evidence completeness, production readiness, or an optimal chunk size.
  No tuning was performed. Chunking showed no measured improvement on this
  development set: Hit@1/Hit@3 stayed unchanged and Recall@3 decreased. This
  observation does not establish that chunking caused the decrease or that
  chunking generally harms retrieval. No database, ANN, generated answers, or
  ingestion integration.
- Type checking and 15 focused checks passed, including parent deduplication
  before Top 3 and tenant identity. Reproduce with
  `npm run experiment:day-10-retrieval-evaluation`; each run creates new files.
  [Saved report](../results/day-10-retrieval-development-2026-10-12T16-38-51-321Z/report.json)
  includes all parent comparisons and complete chunk rankings; its directory
  also preserves the frozen protocol and per-invocation records. Day 8 artifacts
  remain unchanged. The follow-up inspection and log update made no
  implementation/configuration/label changes and reran no experiments.

## Day 15 — Deterministic period comparison

- Existing QueryPlan validation already represents two non-overlapping periods;
  the SQL compiler still rejects direct comparison plans. Added `comparePeriods`
  to validate that contract and execute two supported scalar plans through the
  unchanged compiler and read-only DuckDB executor, with the existing date cap
  and deadlines. No model calls or database recreation.
- Extracted the existing exact decimal parser for shared use with numerical
  grading. Changes use BigInt cents in application code; percentages use
  `(target - baseline) / baseline * 100`, rounded to two decimal places, half
  away from zero. Zero baseline returns null percentage; SQL NULL remains
  distinct from zero and makes both changes null.
- `npm run example:compare-periods` verified the real seeded database:
  August `[2025-08-01, 2025-09-01)` = `7225.00`, September
  `[2025-09-01, 2025-10-01)` = `8295.00`, signed absolute change = `1070.00`,
  percentage change = `14.81%`. Type checking, six comparison tests, and eleven
  existing numerical-grader checks passed.
- Scope remains scalar `net_revenue` across all orders. Other schema-known
  metrics and grouped region/category/status breakdowns do not compile;
  investigation orchestration is not connected. This provides the aggregate
  comparison step, not driver attribution or a causal explanation.

## Day 15 — Net revenue comparison by region

- Chose region after checking seed and live schema: it is non-null, constrained
  to East/North/South/West, and present on every order. Extended the existing
  compiler to allow exactly region grouping, using the unchanged metric
  definition directly on orders, without joins, with deterministic region
  ordering. Existing validator and executor safeguards remain in use.
- Added `compareNetRevenueByRegion`, sharing period-plan preparation and exact
  decimal/cents handling with scalar comparison. Results union regions across
  both periods; presence flags distinguish absence from present SQL NULL.
  Absence contributes zero only to change arithmetic; present NULL produces
  null change. Returned absent values stay null and genuine zeros stay `0.00`.
- Real seeded results (August → September; signed change): East
  `2020.00 → 2320.00; 300.00`, North `2275.00 → 2850.00; 575.00`, South
  `1900.00 → 1900.00; 0.00`, West `1030.00 → 1225.00; 195.00`.
  Independently written conditional-aggregation SQL matched all segment
  values and changes; separate reference totals and the scalar function
  matched exact segment sums `7225.00` and `8295.00`. Changes sum to `1070.00`.
- Reproduce with `npm run example:compare-net-revenue-by-region`. Type checking,
  compiler/comparison unit checks, numerical-grader regression checks, and
  real-executor checks passed, including half-open boundaries and a region
  absent in the target fixture. Category/status grouping remains unsupported.
  No model calls, orchestration, database recreation, or frozen-artifact edits.

## Day 15 — Fixed metric-change investigation workflow

- Added `investigateMetricChange` accepting explicit metric, baseline/target
  intervals, and dimension, limited to net_revenue/region. Fixed stages validate
  inputs, call scalar comparison, call regional comparison, retrieve the
  existing metric definition, and produce a deterministic reconciled summary.
  Attempted stages report status and elapsed milliseconds; failures identify
  the stage and stop later work without retries.
- Missing inputs return clarification before SQL or definition lookup.
  Unsupported choices and malformed dates are rejected before execution.
  Summary generation verifies exact period and change reconciliation, cites
  `src/tools/get-metric-definition.ts#METRIC_DEFINITIONS.net_revenue`, and states
  that business causes are not established. The definition tool has no version
  metadata; returned sourceVersion is null rather than an invented version.
- Real August/September run completed all five stages and four read-only SQL
  executions: 7225.00 → 8295.00, increase 1070.00 (14.81%); regional contributions
  East 300.00, North 575.00, South 0.00, West 195.00. The missing-metric demo
  returned clarification_required with only validation in the trace and zero
  SQL executions. Reproduce with `npm run example:investigate-metric-change`.
- Type checking and eight focused workflow tests passed, covering stage order,
  early clarification/rejection, SQL and definition failure stops, reconciliation
  failure, and no matching data. No model calls, adaptive planning, database
  recreation, or frozen-artifact changes.

## Day 15 — Natural-language investigation input

- Added narrow five-field structured extraction using the existing Qwen adapter
  and Zod/native JSON Schema pattern. Application code derives executable,
  clarification, or unsupported outcomes and calls the fixed workflow only for
  complete validated net_revenue/region inputs with no unresolved questions.
  No SQL generation, default metric/date/dimension substitution, retries, or
  model-generated summary. Structural validity alone does not verify meaning.
- Froze investigation-extractor-v1, investigation-input-v1, temperature 0,
  max output tokens 512, and reasoning effort none. Ran the three user requests
  once each with qwen3.5:4b; no prompt changes after the calls. All source/seed
  checksums matched before and after. Model tag was recorded; immutable model
  weight revision was not established.
- Explicit net revenue August → September by region extracted the correct
  periods and completed with four SQL executions: 7225.00 → 8295.00, increase
  1070.00 (14.81%); regional changes 300.00/575.00/0.00/195.00 reconcile. The
  unchanged summary cites the definition and denies established business causes.
  Usage 395 input / 116 output tokens; model latency 15250 ms.
- “Why did revenue change?” returned all four input fields null with questions
  about metric and periods; application clarification additionally identifies
  missing dimension. Outcome clarification_required, zero SQL; usage 374/81,
  latency 4919 ms. Explicit gross revenue preserved total_gross_revenue and the
  correct periods/region, then returned unsupported, zero SQL; usage 389/118,
  latency 5969 ms.
- API pricing was not configured: cost unavailable for every call. Total local
  execution cost is unmeasured, not zero. First-call latency is a cold-start
  candidate; these three calls do not establish reliability or representative
  latency. Type checking and four fake-provider input checks passed.
- [Saved report](../results/day-15-natural-language-investigation-2026-10-13T07-06-15.274Z-97f07c21-b812-4f52-8bcb-242de074328b/report.json)
  preserves raw extraction, validated outcomes, metadata, SQL counts, and traces;
  the same directory contains protocol.json and immediate calls.jsonl records.
  Reproduce with `npm run experiment:investigation-input` (three real calls).

## Day 15 — Frozen investigation development baseline

- Declared 15 cases and expected inputs/outcomes before calls: six supported
  analytical intents, four ambiguous, three unsupported, two misleading.
  Independent reference SQL verified every declared scalar and regional result;
  all 30 live rows matched the seed. Equal periods deliberately expect zero
  change while retaining the predeclared non-overlap capability gap.
- Used unchanged investigation-extractor-v1 and prior model settings for one
  call per case, without tuning/retries. Extracted the existing immediate
  recorder for reuse by both runners; prior three-run artifacts remain
  byte-for-byte unchanged. Frozen run checksums matched before/after.
- Outcome correctness 11/15; extraction 8/15; end-to-end 8/15. Supported
  end-to-end 3/6, ambiguous 4/4, unsupported 0/3, misleading 1/2. Numerical
  results 4/5 reached; three expected comparisons not reached. The one wrong
  requested numerical answer came from reversed extraction, not SQL arithmetic.
- Inspected all seven failures: reverse-direction over-clarification and swap;
  equal-period over-clarification (validator gap not reached); profit mistaken
  for ambiguity; incomplete periods on refund/category requests; and a
  campaign-cause request over-clarified. False-decline summary followed the
  verified increase, source citation, and no-cause caveat. Campaign-cause answer
  compliance was not reached, not passed. No runtime stage exceptions occurred.
- Recorded 20 workflow SQL queries, 5964 input / 1467 output tokens, per-case
  timings, failed stage, and traces. API cost unavailable for all 15 calls;
  total local cost unmeasured. Type checking and eight focused tests passed.
- This is an exposed development baseline, not production-readiness evidence.
  No prompt or pipeline fix was made. See the
  [full category/case report and failure inspection](evals/day-15-investigation-development.md)
  and its linked immutable run artifacts. Reproduce with
  `npm run experiment:investigation-development` (15 real calls).

## Day 15 — Evaluation contract review of saved outputs

- Reviewed the existing outputs without model/SQL calls or changes to
  implementation, prompt, frozen cases, original grades, or recorded artifacts.
  Equal August periods are a task/contract mismatch: expected zero change is
  valid mathematically, but the contract prohibits overlapping periods. Exclude
  that case from reviewed user-task scoring and report it separately; its
  observed date-extraction diagnostic remains failed.
- Unsupported task rejection passes when the explicit unsupported choice is
  correctly identified, unsupported is returned, and zero SQL executes. Refund
  and category requests therefore pass user-task rejection while retaining
  failed date-extraction diagnostics. Profit still fails. All other rules and
  numerical/evidence grades remain unchanged.
- Original strict score remains 8/15; reviewed user-task score is 10/14 plus
  one contract mismatch. Exact extraction remains 8/15. Eligible task failures
  are reversed-direction clarification/swap, profit clarification, and the
  campaign-cause request's failure to produce an evidence-based answer.
  This is post-hoc grading clarification, not measured model improvement.
- Added a separate reviewed report containing original and revised grades.
  SHA-256 checks matched for 155 protected source/artifact files, including the
  earlier three-run report. See the
  [contract review and both grading versions](evals/day-15-investigation-contract-review.md).

## Day 16 — One model-selected compare_periods execution

- Inspected Day 4's tool workflow and reused its provider-call telemetry and
  tool-call ID validation helpers. Exposed the existing scalar comparison as
  read-only compare_periods, with strict net_revenue/baseline/target arguments
  and existing calendar, non-overlap, compiler and date-cap validation before
  execution. Adapter and deterministic comparison logic are unchanged.
- Froze compare-periods-tool-v1, temperature 0, output cap 512, and reasoning
  effort none. Sent “Compare net revenue in September 2025 against August
  2025.” once to qwen3.5:4b, without forced tool choice, retries, or tuning.
  The model selected compare_periods with call ID call_ca18zyh4 and correct
  baseline [2025-08-01, 2025-09-01), target [2025-09-01, 2025-10-01).
- One valid tool execution made two read-only DuckDB queries: 7225.00 → 8295.00,
  absolute change 1070.00, percentage 14.81. Preserved empty assistant text and
  raw tool-call arguments/ID, then appended the success tool-result message
  with matching toolCallId. History ends at system → user → assistant tool
  call → tool result; no second model request or final answer was generated.
- Existing telemetry: model latency 13147 ms, 523 input / 110 output / 633
  total tokens, finish reason tool_calls, request ID unavailable. API cost
  unavailable because pricing is not configured; local total cost unmeasured.
  This first-call observation does not establish reliability or warm latency.
- Type checking and 28 focused Day 4/adapter/comparison/one-call checks passed.
  Frozen checksums matched before and after; Day 15 artifacts remain intact.
  [Saved report](../results/day-16-compare-periods-tool-2026-10-13T11-13-54.029Z-280fbac2-5ee8-4f89-b33c-cc5119cce972/report.json)
  includes validated arguments, actual result, conversation and metadata;
  protocol.json and calls.jsonl preserve the frozen inputs and immediate raw
  invocation. Reproduce with `npm run experiment:compare-periods-tool` (one
  real model call). No agent loop or investigation orchestration was added.

## Day 16 — Minimal bounded comparison agent

- Extended the existing workflow, scripted tests, and runner rather than adding
  another evaluation harness. Only compare_periods is offered. Reused Day 4
  telemetry/ID checks and preserved assistant calls and matching tool results
  across requests. New compare-periods-agent-v1 adds final-answer instructions;
  the evaluated single-call prompt stays unchanged.
- Enforced maximum three model turns, two tool executions, and 6000 cumulative
  reported tokens, charging repeated input each turn. Preflight reserves input
  UTF-8 bytes plus framing allowance (conservative, not an exact tokenizer),
  then caps output within remaining budget. Missing/invalid usage halts.
  A 90-second shared abort signal reaches provider fetch and DuckDB interruption.
  Normalized duplicate calls stop before another execution. Explicit budget,
  repeat, timeout and failure reasons are never completed answers.
- One frozen live run of the same September-against-August question, no tuning
  or retries: stopReason answer, two model turns, one tool execution, two SQL
  queries, total latency 16301.853 ms. Turn 1: 13052 ms, 591 input / 110 output
  tokens; turn 2: 3201 ms, 818 input / 64 output. Cumulative 1409 input + 174
  output = 1583 tokens. Each request's output cap was 512.
- Model call call_mdrm7mpp used [2025-08-01, 2025-08-31) and
  [2025-09-01, 2025-09-30), valid but incorrect full-month boundaries. Tool
  returned 7225.00 → 8035.00, change 810.00 (11.21%). The answer repeated those
  values and added dollar symbols, without evidence of a currency definition.
  The correct previously verified full-month September result is 8295.00,
  change 1070.00 (14.81%); excluding September 30 loses the 260.00 seed order.
  This is incorrect period interpretation, not faulty SQL arithmetic. Normal
  loop termination is not user-task success; answerClaimsVerified remains false.
- Type checking and 44 focused scripted/Day 4/adapter/comparison/executor checks
  passed, including actual DuckDB cancellation. Frozen live checksums matched.
  API cost unavailable; total local cost unmeasured. Earlier recorded runs are
  preserved. No post-run prompt or implementation tuning and no replay.
- [Saved agent report](../results/day-16-compare-periods-agent-2026-10-13T11-50-27.193Z-365d012f-b656-4773-9c89-7f829e46c685/report.json)
  preserves full turn trace, raw calls, validated intervals, tool history,
  unverified final answer, stop reason, latency and cumulative tokens; the
  same directory holds frozen protocol.json and immediate calls.jsonl.

## Day 16 — Explicit date/currency interface development revision

- Inspection: v1 tool description already states start-inclusive/end-exclusive
  intervals and full-month intent; the v1 system prompt also says inclusive
  starts/exclusive ends. Neither spells out the next month's first day, the
  schema date fields have no descriptions, and neither supplies a currency
  metadata rule. The execution path already uses [start, end) SQL predicates.
- Added compare-periods-agent-v2 / compare-periods-tool-definition-v2 with
  date-field descriptions, explicit next-month-first-day semantics, and a
  February 2032 example unrelated to the exposed August/September request.
  Currency symbols/labels require currency metadata; the current result has
  none. Runtime validators/compiler/executor are unchanged: valid explicit
  partial periods remain accepted, with no hard-coded month correction.
- Same request ran once with qwen3.5:4b, temperature 0, reasoning none, no
  retries. Call call_e8arx5ho selected baseline [2025-08-01, 2025-09-01), target
  [2025-09-01, 2025-10-01). Tool result 7225.00 → 8295.00, change 1070.00
  (14.81%). Stop answer after two model turns, one tool execution, two SQL
  queries; total latency 18125.858 ms. Turn latencies 14484/3517 ms, usage
  786/110 then 1014/67, cumulative 1800 input + 177 output = 1977 tokens.
  Output caps were 512 then 313 under the unchanged cumulative-budget policy.
- Separate review: period intent passed; numerical agreement with observed tool
  values and increase direction passed via manual extraction and the existing
  exact scalar grader. Unsupported currency failed: the final answer used
  dollar signs despite absent currency metadata. Preserve that answer unchanged
  and keep answerClaimsVerified false; normal termination is not full task
  correctness. API cost unavailable, total local cost unmeasured.
- This is a development revision influenced by exposed failures, not an
  unchanged-baseline result or generalization evidence. Prompt and tool wording
  changed together; this single run cannot isolate their effects. Earlier runs
  remain byte-for-byte unchanged and frozen run checksums matched. Type checking
  and 14 existing/extended workflow tests passed, including partial periods.
  Reused the bounded runner; no new evaluation harness or post-run tuning.
- [Saved development report](../results/day-16-compare-periods-agent-v2-development-2026-10-13T13-26-12.378Z-8d83153d-87ad-40fd-b5bf-a1f5fa193cc3/report.json)
  records raw calls/history and telemetry. Separate
  [answer review](../results/day-16-compare-periods-agent-v2-development-2026-10-13T13-26-12.378Z-8d83153d-87ad-40fd-b5bf-a1f5fa193cc3/answer-review.json)
  preserves the three independent checks without modifying the recorded call
  or original report.

## Day 16 — Three independent read-only agent capabilities

- Added compare_net_revenue_by_region and get_metric_definition alongside
  compare_periods in the existing bounded loop/runner. Reused Day 15 regional
  comparison, date validation, exact decimals, and the existing definition tool
  validator. Definition observation carries the repository source ID and null
  source version. No fixed investigation workflow tool or prescribed ordering.
- New comparison-agent-v3 protocol permits five model turns and four total tool
  executions; existing 6000-token, 90-second, normalization and call-ID controls
  remain in place. Earlier revisions keep their original 3/2 limits. Extended
  existing scripted tests for chosen order, provenance, argument rejection,
  regional repeats and four-tool stops; type checking and 45 checks passed.
- One frozen live run of the requested August-to-September investigation,
  qwen3.5:4b, temperature 0, reasoning none, no retries/tuning. The model chose
  get_metric_definition (call_k3yqqfx2, net_revenue), then regional comparison
  (call_lq7ui5q6) with correct [2025-08-01, 2025-09-01) baseline and
  [2025-09-01, 2025-10-01) target. Both observations succeeded, with matching
  tool-result IDs. Regional changes: East 300.00, North 575.00, South 0.00,
  West 195.00. Auditor-only sums reconcile to 7225.00 → 8295.00, change 1070.00.
- compare_periods was not selected. After two tools/two SQL queries in the first
  model turn, the application stopped token_budget before a second turn. Actual
  usage was 1191 input + 129 output = 1320 tokens; initial reservation 5776,
  output cap 224. The stop reflects the conservative serialized-input reservation
  of 8282 exceeding the remaining 4680 tokens, not actual exhaustion of 6000 reported
  tokens or evidence that the model could not answer.
  Model latency 16109 ms; total latency 16272.149 ms.
- No final answer: scalar/percentage observation, answer-level overall/regional
  reporting, definition citation, and causal/currency checks are not reached.
  Available regional dates/numbers and definition provenance passed observation
  checks. Do not count lack of causal/currency claims without an answer as a
  successful requested response. completed is false; no automatic retries or
  post-run adjustment. API cost unavailable; total local execution cost unmeasured.
- [Saved three-tool report](../results/day-16-compare-periods-agent-v3-development-2026-10-13T13-47-29.533Z-92a0f775-a302-4971-a8c6-8cd122889f5c/report.json)
  preserves raw choices, arguments, observations/history and telemetry. Its
  [answer/evidence review](../results/day-16-compare-periods-agent-v3-development-2026-10-13T13-47-29.533Z-92a0f775-a302-4971-a8c6-8cd122889f5c/answer-review.json)
  separates omitted evidence from verified observations. Frozen checksums and
  all previous run artifacts matched before/after. Development evidence only;
  no new evaluation harness.

## Day 16 — Input reservation estimator development revision

- Before generation, inspected the configured local Ollama 0.35.0 provider:
  /api/tokenize, /tokenize, /v1/tokenize and /v1/messages/count_tokens returned
  404. The adapter exposes generation usage, not preflight counting. No matching
  tokenizer runtime/package or cached tokenizer/chat template was found;
  /api/show reports Qwen35 tokenizer metadata and placeholder {{ .Prompt }}.
  Embedded model metadata is not a callable counter. No tokenizer subsystem,
  dependencies, provider transport changes or generation probes were added.
- Freeze comparison-input-reservation-v2-approx before the one requested run:
  compact provider-neutral messages/tools JSON; ceil(ASCII bytes / 3 + non-ASCII
  UTF-8 bytes), then ceil(20% of the estimate) + 32/message + 128 fixed. This is
  a prose/JSON heuristic with explicitly chosen allowances, not a Qwen tokenizer,
  fitted ratio, validated error bound or hard token guarantee. Identifiers,
  code, multilingual input and the actual chat/tool template can differ.
- Only the input-reservation policy and recording/version metadata changed.
  comparison-agent-v3 prompt/tool definitions, 6000-token actual cumulative
  accounting, 512 maximum output (capped to estimated remaining capacity),
  five model turns/four executions and 90-second deadline remain unchanged.
  Existing scripted checks verify reservations are never deducted, repeated
  actual inputs are charged, and insufficient estimated capacity stops before
  dispatch. Typecheck and all 18 focused workflow tests passed before generation.
- One live run, no retry/tuning, unchanged qwen3.5:4b / reasoning none /
  temperature 0: reservations 2093 and 2885 versus reported inputs 1191 and
  1673. Both output caps were 512; outputs 129 and 323. Actual cumulative usage
  2864 input + 452 output = 3316; no reservation was charged. Model latency
  30344 ms combined; total latency 30473.446 ms. API cost unavailable; total
  local execution cost unmeasured. Prompt/tools/limits matched the prior v3
  protocol; frozen run inputs and all earlier artifacts remained unchanged.
- Model chose definition then regions in turn one (correct calendar boundaries),
  then answered in turn two: answer stop, two tools/two SQL queries. Regional
  values/contributions passed the existing exact grader, reconciling to
  7225.00 -> 8295.00 and 1070.00. Definition source was cited and the answer
  distinguished descriptive contributions from established causes; no inferred
  currency. It omitted overall totals/increase/percentage and never selected
  compare_periods: full task success failed despite normal termination. Keep
  answerClaimsVerified false; estimator correction does not resolve evidence
  completeness or establish estimation accuracy beyond this development run.
- [Recorded run](../results/day-16-compare-periods-agent-v3-development-2026-10-13T16-02-52.920Z-e6641ef5-37ee-4c3d-bb91-cc424a15623b/report.json)
  and [separate answer review](../results/day-16-compare-periods-agent-v3-development-2026-10-13T16-02-52.920Z-e6641ef5-37ee-4c3d-bb91-cc424a15623b/answer-review.json)
  retain raw messages/calls, estimator policy/version, estimated-versus-reported
  input per turn, observations, accounting checks and omitted overall evidence.

## Day 16 — Frozen Day 15 tasks, agent/workflow development comparison

- Reused the existing Day 16 runner/recorder with --day15-development, the
  frozen development-v1 cases and SQL-verified references, existing exact
  scalar/development graders, and investigation-contract-review-v2. Ran the
  current comparison-agent-v3 once per 14 eligible tasks, preserving supported-05
  as an excluded equal-period task/contract mismatch with no new invocation.
  Prompt/tools, v2 approximate reservation, 6000 tokens, 512 output maximum,
  five turns/four executions and 90-second deadline remained unchanged.
  Typecheck and 18 focused workflow tests passed; no retries/tuning/new harness.
- Reviewed user-task successes: recorded Day 15 workflow 10/14 versus current
  agent 1/14. By category: supported 3/5 vs 0/5; ambiguous 4/4 vs 0/4;
  unsupported 2/3 vs 1/3; misleading 1/2 vs 0/2. Original Day 15 grades and
  reviewed grades remain intact. Agent exact structured extraction is unavailable;
  selected tool arguments and answer intent are separate diagnostics.
- Agent produced ten normal answers, three invalid-argument stops, and one
  answer_without_tool_result. No eligible analytical answer was complete:
  regional-only choices omitted overall totals/percentage and net-revenue
  definition/citation/cause caveat. Six answers inferred dollars. Supported-03
  correctly handled reversed direction (Day 15 unnecessarily clarified), but
  supported-04 inverted “against” in both configurations. Misleading-01 corrected
  the false decline, yet omitted required evidence. Misleading-02 and two
  unsupported requests generated identical periods and were blocked before SQL;
  that is not successful rejection or evidence compliance.
- All four ambiguous tasks executed SQL: assumed net revenue, invented 2032
  dates, or bypassed the missing dimension. Unsupported-02 alone passed the
  minimal reviewed rejection rule (named total_refund_amount, rejected the
  regional request, zero SQL). Its unsupported availability/aggregation claims
  remain an evidence diagnostic failure; native loop completion remains false.
- Across eligible tasks, Day 15: 14 model calls, 15 deterministic read-only
  operations, 20 SQL queries, 6960 tokens and 80.525 seconds. Agent: 25 model
  calls, 11 executed tools, 20 SQL queries, 35659 tokens and 164.325 seconds.
  Agent omitted SQL/evidence on analytical tasks but added eight SQL queries
  where clarification required zero. API cost unavailable; total local cost
  unmeasured. No complete task improved in this run; some partial intent/direction
  checks improved. First-call and warm-state effects are not controlled.
- [Full per-case comparison and failure inspection](../results/day-16-compare-periods-agent-v3-day15-development-comparison-2026-10-13T16-13-52.158Z-69cf01c0-ee99-45d7-8cf5-4035ef23909b/comparison.json)
  accompanies raw case reports, immediate calls.jsonl and frozen protocol.
  All prior Day 15/16 artifacts and frozen inputs matched before/after. This
  compares two recorded development configurations with different interfaces,
  prompts and summary generation; it is not controlled proof that agents are
  better/worse or evidence of generalization.

## Day 16 — Summary and interpretation

- Premature stopping: correct regional observations did not become complete
  analytical answers. The agent accepted a regional-only answer before obtaining
  and reporting the overall comparison and definition evidence.
- Unjustified assumptions: all four ambiguous requests executed SQL instead of
  clarifying missing metric, periods or dimension, or ambiguous revenue. Tool
  argument validity did not establish that the user supplied those inputs.
- Intent errors persisted: adaptive tool selection did not reliably resolve
  comparison direction. The reversed “from” case improved, but “August against
  September” still used the wrong baseline and target.
- Example contamination: the missing-period case invented January/February 2032,
  matching the year/month used by the generic prompt/tool example. This is
  consistent with example leakage into action arguments; the recorded runs do
  not independently establish the causal mechanism.
- Normal termination did not mean success: `answer` describes how execution
  stopped, not answer quality, completeness or evidence correctness. Keep native
  termination, reviewed task success and diagnostic grades separate.
- Decision: retain this as development evidence. Before another agent revision,
  address explicit-input checks, requested intent and evidence completeness in
  application safeguards. Additional adaptive turns alone are not evidence that
  these failures will improve. No prompt/tool/limit tuning follows this comparison;
  preserve the original workflow, agent records and equal-period mismatch.
