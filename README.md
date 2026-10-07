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

The page validates this fixed UI specification before rendering:

```json
{"type":"kpi","resultField":"net_revenue"}
```

Only `kpi` and `net_revenue` are allowed. The strict schema rejects extra
properties, including a numeric `value`; the card resolves its value from the
separate executor rows. Unknown component types and result fields produce
readable validation errors before rendering.

Run `npm run example:kpi-specification` to demonstrate the real DuckDB result
rendering and rejection of `type: "chart"` and `resultField: "profit"`.
Run `npm run test:ui` for deterministic UI validation tests.
