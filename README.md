# GenUI Commerce Analyst

Minimal Day 1 foundation for calling a local Qwen model through an
OpenAI-compatible endpoint.

## Setup

```sh
cp .env.example .env
npm install
npm run typecheck
npm run dev -- "Summarize the main commerce trend to investigate."
```

The provider result includes the model name, request latency, and—when the
endpoint supplies them—token usage and a request ID.

`MODEL_REASONING_EFFORT` controls the OpenAI-compatible `reasoning_effort`
request field and is set to `none` in the example configuration.

## Day 15 — Deterministic period comparison

Run `npm run example:compare-periods` to verify September 2025 against August
2025 using the existing seeded database, without a model or `.env` configuration.
It reads the database without recreating it and asserts August `7225.00`,
September `8295.00`, absolute change `1070.00`, and percentage change `14.81`.

`comparePeriods(metric: SupportedMetric, baseline: DateInterval,
target: DateInterval, executor?: QueryPlanExecutor): Promise<PeriodComparison>`
is exported from `src/application/compare-periods.ts`. Each interval has
`start` (inclusive) and `end` (exclusive). The existing comparison validator
checks real dates, ordering, and non-overlap; two scalar plans then reuse the
SQL compiler and read-only DuckDB executor. The default 366-day interval cap
applies to each period, and execution retains the executor's deadline.
The current compiler supports only `net_revenue`; other schema-known metrics
are rejected before either query.

Values and changes are decimal strings. Application code uses the existing
exact decimal parser and BigInt arithmetic; percentage change is
`(target - baseline) / baseline * 100`, rounded to two decimals, half away
from zero. A zero baseline returns a null percentage. SQL NULL remains
no matching data: if either period is null, both changes are null.
Run `npm run test:compare-periods` for deterministic checks.

The deterministic investigation workflow below connects this function to
region comparison and definition lookup. Category and status grouping remain
outside the compiler's supported slice.

### Net revenue by region

Run `npm run example:compare-net-revenue-by-region` to compare August and
September 2025, verify each segment against independent reference SQL on the
existing database, and reconcile the segments with the scalar totals.
`compareNetRevenueByRegion(baseline: DateInterval, target: DateInterval,
executor?: QueryPlanExecutor): Promise<RegionPeriodComparison>` is exported from
`src/application/compare-net-revenue-by-region.ts`.

Region is a non-null, constrained field on each order in the seed and live
schema. The compiler accepts empty dimensions or `["region"]`, reuses the
authoritative net-revenue formula, and groups directly on `orders` without
joins. Results sort by region and include every region present in either
period. Each segment returns `baselineValue`, `targetValue`, `absoluteChange`,
`baselinePresent`, and `targetPresent`. An absent period has a false presence
flag and null value, and contributes zero when calculating change. A present
SQL NULL has a true presence flag and null value, and makes the change null.
Genuine zero is returned as `"0.00"` with a true presence flag. In the seeded
schema, non-null monetary columns prevent a present SQL NULL aggregate.

| Region | August | September | Change |
| --- | ---: | ---: | ---: |
| East | 2020.00 | 2320.00 | 300.00 |
| North | 2275.00 | 2850.00 | 575.00 |
| South | 1900.00 | 1900.00 | 0.00 |
| West | 1030.00 | 1225.00 | 195.00 |
| Total | 7225.00 | 8295.00 | 1070.00 |

All arithmetic uses shared exact decimal handling and BigInt cents.
Run `npm run test:compare-net-revenue-by-region` for deterministic checks;
`npm run test:query-plan-executor` also checks grouped boundaries and absence
using a temporary DuckDB fixture. No model or investigation orchestration.

### Fixed metric-change investigation workflow

Run `npm run example:investigate-metric-change` for the real seeded August versus
September 2025 investigation and a missing-metric demonstration. The exported
`investigateMetricChange(input: unknown, options?: InvestigationOptions):
Promise<InvestigationResult>` in `src/application/investigate-metric-change.ts`
accepts `{ metric, baseline: { start, end }, target: { start, end }, dimension }`.
Only explicit `net_revenue` and `region` are supported.

Stages always run in this order: `validate_inputs`, `compare_periods`,
`compare_regions`, `get_metric_definition`, `produce_summary`. Missing inputs
return `clarification_required` before any SQL or definition lookup; unsupported
metric/dimension or malformed inputs return `rejected`. Execution or definition
failures return `failed` with `failedStage` and an error. The trace includes only
attempted stages with status and elapsed milliseconds; later stages stop and
there are no retries.

The summary checks exact regional reconciliation before reporting the overall
change and regional contributions. It cites the existing definition tool's
repository source ID. That tool has no source-version metadata, so
`sourceVersion` is explicitly null. It states that business causes are not
established. This is fixed application orchestration, with no model or agent
planning. Run `npm run test:investigate-metric-change` for focused checks.

### Natural-language investigation input

`investigateMetricChangeFromText(provider, question, options?)` in
`src/application/natural-language-investigation.ts` uses the existing model
adapter with a strict five-field contract: metric, baseline interval, target
interval, dimension, and unresolved questions. The versioned prompt is
`investigation-extractor-v1`; it never requests SQL or query plans. Application
validation requires explicit net_revenue/region and valid non-overlapping
periods before calling the fixed workflow. Missing or ambiguous fields require
clarification; explicit unsupported choices return unsupported. Extraction
errors stop without SQL, repair, or retry. The summary remains deterministic.
Structural validity does not independently prove that extraction matches intent.

`npm run experiment:investigation-input` runs the three fixed Day 15 requests
once each against the configured real model and existing read-only database.
It creates a new artifact directory with frozen protocol/checksums, immediate
raw-call JSONL, validated outcomes, SQL counts, usage, latency, and API cost.
It requires `.env` model configuration and a running endpoint. This is a small
demonstration, not an evaluation of generalization or production readiness.
`npm run test:investigation-input` uses fake providers and makes no model calls.

API cost is unavailable unless both `MODEL_INPUT_USD_PER_MILLION_TOKENS` and
`MODEL_OUTPUT_USD_PER_MILLION_TOKENS` are configured with nonnegative USD rates
and the provider returns token usage. Estimated API charges exclude local
compute, hardware, and energy costs; total execution cost remains unmeasured.

`npm run experiment:investigation-development` runs the frozen 15-case
`evals/investigation/development-v1.json` development baseline once per case.
It verifies declared numerical expectations with independent SQL before calls,
reuses the immediate raw-call recorder, and records outcome/extraction/numerical
grades, misleading-answer evidence checks, stage/query traces, SQL counts,
failed stage, latency, tokens, and explicit API-cost availability. It creates
new artifacts and makes 15 real model calls without retries. See the
[development report](docs/evals/day-15-investigation-development.md) for all
category results and failure inspections; it is not production-readiness evidence.

The separate [Day 15 contract review](docs/evals/day-15-investigation-contract-review.md)
regrades only saved outputs under documented task-success rules, preserves the
original grades, separates the equal-period contract mismatch, and retains
exact-extraction diagnostics on successful unsupported rejections. It made no
new model calls or implementation changes.

## Day 6 — One net revenue KPI

```sh
npm install
npm run example:net-revenue-ui
```

Open http://127.0.0.1:3000. This minimal server-rendered React page runs an
explicit `query-plan-v1` plan through the existing net-revenue compiler and
read-only DuckDB executor on each page request. No model or `.env` configuration
is needed. The server prints the plan and actual executor rows.

The card displays the executor's decimal string unchanged, metric
`net_revenue`, and exact interval `[2025-08-01, 2025-09-01)` (start inclusive,
end exclusive). The 31-day interval fits the existing 366-day policy; the
existing execution deadline remains in effect. Dimensions and filters are
explicitly empty, and comparison, ordering, limit, and visualization are
`none`. KPI rendering is owned by the page rather than the compiler.
SQL `NULL` is displayed as “No matching data for this date range,” with the
metric and executed dates visible. The three money columns are `NOT NULL`, so
this SUM distinguishes an empty match set (`null`) from genuine zero net
revenue (`"0.00"`). Zero remains a normal KPI/table value. No match-count
metadata or UI specification fields are needed for the current schema.

The example requires `data/commerce.duckdb`. If it is absent, run `npm run
db:init` once to create the deterministic seed database. That command recreates
the database, so do not run it over a database you want to preserve. Stop the
UI server with Ctrl+C.

The page validates these fixed UI specifications before rendering:

```json
{"type":"kpi","resultField":"net_revenue"}
```

```json
{"type":"table","resultField":"net_revenue"}
```

Only component types `kpi` and `table`, and result field `net_revenue`, are allowed.
The strict schema rejects extra
properties, including a numeric `value`; the card resolves its value from the
separate executor rows. The table renders all executor rows under a “Net revenue”
column. Both views show the metric and exact inclusive/exclusive dates.
Unknown component types and result fields produce
readable validation errors before rendering.

Open `/` for the KPI or `/table` for the table on the same local UI server.
Run `npm run example:kpi-specification` to demonstrate both views against the
same real DuckDB result, and rejection of `type: "chart"` and `resultField: "profit"`.
Run `npm run test:ui` for deterministic UI validation tests.

### Model display selection

`npm run example:model-display-selection` makes exactly two real model calls,
one for a KPI request and one for a table request, using the configured provider
and strict structured output generated from the existing UI schema. The August
query plan stays fixed. The model receives allowed display types and the result
field, but no numeric result. Only validated specifications reach the renderer;
failures produce a readable error page without a result component.

Each invocation creates a new `results/day-06-display-selection-<timestamp>/`
directory with raw-output JSONL records, the frozen protocol, outcomes, and
`kpi.html` / `table.html` pages that can be opened locally. Both views receive
the same real DuckDB rows separately. There are no retries. This command needs
the model configuration in `.env` and a running model endpoint; ordinary UI
launch and `test:ui` remain model-free.

### Interactive model display

```sh
npm run example:model-display-ui
```

Open http://127.0.0.1:3001. Enter **Start (inclusive)** and **End (exclusive)**,
which default to `[2025-08-01, 2025-09-01)`, then click **Show KPI** or
**Show table**. The server builds the net-revenue plan with those dates and
applies the existing QueryPlan validation and 366-day policy before any model
call. Each valid click makes one server-side streaming structured-output model
call. The server accumulates content deltas and requires a normal `stop` finish
and the `[DONE]` marker before parsing and validating the complete specification. Only then does the
server revalidate the request and execute the plan through read-only DuckDB.
The existing React component labels the actual executed interval beside the
result. The model selects only the display and never receives the numeric result.

The page clears the previous result and disables both buttons while showing
“Choosing display…” followed by “Running query…” and then the component.
Generation, validation, and query failures show a readable error and leave no
successful result; both buttons become available again. A disconnected or
truncated stream is a generation error, even if its accumulated JSON looks
complete. Tokens are not streamed to the browser, and there are no retries.
The provider's existing non-streaming `generate` path remains available.

`npm run verify:live-streaming-display` makes exactly one live **Show table**
request in isolated headless Chrome and executes the August plan through real
DuckDB. It writes a new `results/day-06-live-streaming-display-<timestamp>/`
artifact directory with content chunks, raw model output, completion status,
time to first content, total model duration, validated specification, executor
rows, browser states, and rendered HTML. It does not retry a failed request.
`npm run test:provider` checks stream completion and truncation with mocked
transport responses, alongside the existing non-streaming adapter tests.

Editing either date clears the previous result immediately. Date inputs are
disabled while a request is pending so the displayed result cannot arrive for
a range edited in the meantime. Only dates vary; metric, dimensions, filters,
and all other plan fields remain application-owned.

Missing dates show “Choose a start and end date” and identify the absent input.
The page clears any previous result, associates the clarification with that
input, and blocks submission. Both server endpoints also clarify missing dates
before model or executor calls. Supplying the dates allows the normal flow;
reversed dates remain validation errors, and no dates are guessed.

`npm run verify:model-display-browser` verifies this flow in a separate
headless Chrome instance using the installed macOS Google Chrome. It makes
one real model request and one simulated provider failure, checks visible
state transitions and button locking, and closes its temporary server/browser.
The simulated failure is injected only by the verification script.

`npm run verify:model-display-dates` verifies one edited interval against real
DuckDB, checks result clearing on edit, and confirms a reversed interval is
rejected before any additional model call or database execution. This command
makes one real model request and uses an isolated headless Chrome instance.

`npm run verify:no-matching-data` checks both display choices against the real
no-match interval `[2026-01-01, 2026-02-01)` and a temporary DuckDB fixture with
two matching orders whose net revenue is zero. It uses deterministic display
selection, makes no model calls, and removes the fixture after verification.

`npm run verify:query-failure` demonstrates query failure after a valid stubbed
table specification. It first renders a stubbed KPI, then checks
“Choosing display…” → “Running query…” → “Query failed: Simulated query error”.
The previous result stays cleared, neither component renders, and both buttons
re-enable. The demonstration uses the existing error handling and makes no
live model or database calls.

`npm run verify:date-clarification` checks a missing end date with no calls or
stale result, then restores the end date and verifies normal selection/query
states and the real DuckDB value. Display selection is stubbed; this verification
makes no live model calls.

`npm run verify:streaming-boundary` demonstrates simulated model chunks in the
existing interactive page. It holds “Choosing display…” after each of three
chunks, including after the assembled JSON becomes complete, until the explicit
stream-completion signal. The existing validator then accepts the specification
and the renderer displays a table from a separate fixed executor-result fixture.
A stream ending after two chunks shows a readable error without a component.
This isolated demonstration changes no provider adapter and makes no live
model or database calls.
