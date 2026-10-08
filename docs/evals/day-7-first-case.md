# Day 7 — Total gross revenue

## Entry point

`runCommerceAnalysis` in `src/application/commerce-analysis-pipeline.ts`,
using `QwenProvider`, `DuckDBQueryPlanExecutor`, and explicit options
`router-v3` / `query-plan-extractor-v2` (the function defaults to v1/v1).

## Input and expected plan

**Question:** “What is total gross revenue?”

**Dataset:** All 30 orders in `data/seed.sql`, dated 2025-08-02 through
2025-09-30. Include every region, category, and status. Gross revenue means
`SUM(gross_amount)`, without subtracting discounts or refunds.

**Route:** `analytics`. **Extraction:** `query-plan-output-v1` envelope with
outcome `query_plan` and this plan:

```json
{
  "version": "query-plan-v1",
  "metric": { "kind": "metric", "value": "total_gross_revenue" },
  "dimensions": { "kind": "specified", "values": [] },
  "filters": { "kind": "specified", "items": [] },
  "dateRange": { "kind": "unspecified" },
  "comparison": { "kind": "none" },
  "ordering": { "kind": "none" },
  "limit": { "kind": "unspecified" },
  "visualization": { "kind": "unspecified" }
}
```

Accept `none` or `unspecified` for ordering, limit, and visualization when
no operation is added. Preserve `dateRange: unspecified`: the question gives
no dates. Full-dataset scope is the reference assumption, not an application
default.

## Verified reference

Reference SQL from `evals/baseline-cases.json`:

```sql
SELECT SUM(gross_amount) AS total_gross_revenue
FROM orders;
```

**Expected rows:** `[{"total_gross_revenue":"18010.00"}]`.

Independently summing the seed’s gross amounts in integer cents gives August
`8330.00` + September `9680.00` = **`18010.00`**. Reference SQL agrees in an
in-memory database initialized from the seed and in the existing database
opened read-only. All 30 live rows match the seed. The historical expected
value was not used to derive this number.

## Checks

| Stage | Pass criterion | Wrong output caught |
| --- | --- | --- |
| Routing | Exact label `analytics`. | `docs`. |
| Plan structure | Valid JSON envelope and strict QueryPlan schema. | `dimensions: []`. |
| Plan meaning | Business rules pass; fields match the intent above. | A valid plan selecting `net_revenue`. |
| Database result | Exactly the expected row above; zero tolerance; matches reference SQL. | `[{"total_gross_revenue":"15520.00"}]`. |
| User-facing output | Unobservable: this entry point has no answer or renderer. | Not applicable. |

**Current limitation:** The compiler supports only `net_revenue`. A correct
gross plan throws `UNSUPPORTED_METRIC` before DuckDB execution, so the database
check cannot pass through this pipeline today. Unspecified date scope also
has no execution policy. The wrong database row above is hypothetical.

On execution errors the function returns no intermediate stages; use recorded
provider calls to inspect routing and extraction. Unobserved stages are not
passes. No model run or end-to-end pass is claimed here.

## Reusable helpers

- `queryPlanOutputSchema`, `queryPlanSchema`, and `validateQueryPlan`: envelope,
  structure, and business-rule checks.
- Day 3 `evaluateFields`: field-level intent assertions.
- Day 5 `createRecordingProvider` and `planFromRecordedExtraction`: raw-call
  capture and plan recovery; revalidate recovered plans for business rules.
- Day 5 numerical evaluation: exact actual/reference/expected comparisons
  using `isDeepStrictEqual` and DuckDB `getRowObjectsJson()`.

Experiment-local helpers are patterns to reuse, not exported APIs; importing
those scripts runs experiments. Day 5’s net-only compilation preflight cannot
accept this case unchanged.
