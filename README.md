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
SQL `NULL` is displayed as “No matching orders,” preserving the executor's
empty-set semantics without converting it to zero.

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

Open http://127.0.0.1:3001 and click **Show KPI** or **Show table**. Each click
makes one server-side structured-output model call, waits for the complete
specification, and validates it. Only then does the server execute the fixed
August plan through read-only DuckDB and render the existing React component.
The model never receives the numeric result.

The page clears the previous result and disables both buttons while showing
“Choosing display…” followed by “Running query…” and then the component.
Generation, validation, and query failures show a readable error and leave no
successful result; both buttons become available again. There is no token
streaming or retry.

`npm run verify:model-display-browser` verifies this flow in a separate
headless Chrome instance using the installed macOS Google Chrome. It makes
one real model request and one simulated provider failure, checks visible
state transitions and button locking, and closes its temporary server/browser.
The simulated failure is injected only by the verification script.
