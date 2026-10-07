# QueryPlan v1 contract

`query-plan-v1` is a deterministic, provider-independent representation of a
commerce analytics request. It validates structure and supported combinations;
it does not generate a plan, apply defaults, or execute SQL.

Schema validity does not prove that a plan matches the user's question. A
separate interpretation step must establish that correspondence before any
future execution step.

## Valid example

This plan represents the verified question comparing September net revenue
with August net revenue:

```json
{
  "version": "query-plan-v1",
  "metric": { "kind": "metric", "value": "net_revenue" },
  "dimensions": { "kind": "specified", "values": [] },
  "filters": { "kind": "specified", "items": [] },
  "dateRange": { "kind": "unspecified" },
  "comparison": {
    "kind": "date_intervals",
    "baseline": { "start": "2025-08-01", "end": "2025-09-01" },
    "target": { "start": "2025-09-01", "end": "2025-10-01" }
  },
  "ordering": { "kind": "none" },
  "limit": { "kind": "none" },
  "visualization": { "kind": "type", "value": "table" }
}
```

All date intervals use half-open boundaries: `start` is inclusive and `end` is
exclusive (`[start, end)`). Dates must be real calendar dates in `YYYY-MM-DD`
format and `start` must precede `end`.

## Supported capabilities

- Metrics are limited to definitions verified in `evals/baseline-cases.json`:
  - `total_gross_revenue`: `SUM(gross_amount)`.
  - `net_revenue`: `SUM(gross_amount - discount_amount - refund_amount)`.
  - `total_refund_amount`: `SUM(refund_amount)`.
  These definitions include every order status unless the plan contains an
  explicit supported status filter.
- Dimensions are `region`, `category`, and `status`, all present in the seeded
  `orders` table.
- Filters are allowlisted to `order_id`, `customer_id`, `region`, `category`,
  `status`, `gross_amount`, `discount_amount`, and `refund_amount`. Identifier
  and categorical fields support equality or membership; amount fields support
  equality and bounded comparisons. No SQL or arbitrary expressions are
  accepted.
- Date intent is explicit: `unspecified`, explicit `all_time`, or an explicit
  interval. `unspecified` is preserved and is not interpreted as all-time.
- The DuckDB executor applies an application-owned maximum of 366 days to an
  explicit `[start, end)` interval by default. The application may configure
  that maximum; it rejects longer intervals rather than shortening them.
  Explicit `all_time` has no date-range cap and remains subject to the database
  execution deadline.
- Comparison supports exactly two named, non-overlapping date intervals. A
  comparison owns its periods, so the top-level date range must remain
  `unspecified`.
- Ordering is limited to the selected metric and requires at least one
  dimension. A numeric limit requires metric ordering. Comparisons cannot be
  metric-ordered in this version.
- Visualization may be unspecified, explicitly absent, or `table`, `bar`, or
  `single_value`. A bar requires exactly one dimension; a single value requires
  an explicitly empty dimension list and no date comparison.
- Repeated categorical constraints are intersected, and numeric bounds are
  combined. An empty intersection or range is rejected as a business-rule
  error.

Every nested object is strict. Unknown properties, unsupported fields,
unsupported operators, and invalid enum values are structural errors. Valid
structure with an unsupported or contradictory combination is a business-rule
error. Validation issues include a path, code, and actionable message.

## Unspecified intent and application defaults

Each choice that might be absent has an explicit `unspecified` variant. The
schema has no implicit date, comparison, filter, ordering, limit, or
visualization defaults. Any application policy that supplies defaults must be
implemented separately and must not be presented as the user's stated intent.

## Decisions requiring clarification

- An unspecified metric, date scope, filter, comparison, ordering, limit, or
  visualization may require clarification when it is material to execution.
- Profit, margin, average order value, order count, return rate, conversion,
  currency handling, time grains, and alternative status-inclusion policies
  are not defined by the verified metric set and are therefore not supported
  yet.
- Multi-metric queries, comparisons other than two explicit periods, ranking by
  a dimension, and additional chart semantics need product definitions before
  they can be added safely.

## Model extraction envelope

`query-plan-extractor-v1` asks the configured model for the strict
`query-plan-output-v1` envelope. The envelope is needed because a QueryPlan can
preserve an unspecified choice but cannot distinguish an unsupported request
from an omitted choice:

- `query_plan` contains a complete `query-plan-v1` object.
- `clarification_required` contains a non-empty reason when a supported request
  cannot yet form a meaningful plan.
- `unsupported` contains a non-empty reason when the requested metric or
  capability has no repository-backed definition.

The JSON Schema sent to the provider is derived from the Zod envelope and the
existing QueryPlan schema as JSON Schema Draft 7. The Qwen adapter sends it to
the OpenAI-compatible chat-completions endpoint as
`response_format.type = json_schema` with strict mode enabled. It does not fall
back to unconstrained JSON if the endpoint rejects that mechanism or cannot
represent the schema.

The native schema constrains shape, allowlists, required fields, and unknown
properties. Application code still parses the complete response and runs both
Zod structural validation and the existing QueryPlan business rules. Provider
refusal (when exposed), non-stop completion, malformed JSON, structural
failure, business-rule failure, and provider failure are separate typed
outcomes. There is no repair or retry.
