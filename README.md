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
