# Day 7 — Final 40-case evaluation report

Consolidation of saved evidence only. No model calls, evaluation reruns, artifact edits, or application changes were made for this report. There is no combined “AI accuracy” score.

## Scope, configuration, and evidence

The [dataset plan](day-7-dataset-plan.md) supplies exactly **40 unique IDs**: routing 10, interpretation 6, clarification 6, unsupported 6, numerical 12. Declared targets are **17 router, 11 extractor, 2 executor, 10 full pipeline**. Component results retain their targets.

All scored model runs use **qwen3.5:4b**, reasoning effort `none`, temperature `0`. Router: `router-v3`, maximum output tokens `8`. Extractor: `query-plan-extractor-v3`, maximum output tokens `1024`, strict `query_plan_output_v1` JSON-schema response format. The historical comparison alone includes extractor-v2; its scores are kept separate.

Evidence selected from tasks 16–20 comprises 28 fresh component requests, 2 fresh model-free executor cases, and 10 reused original unedited v3 pipeline requests. “Fresh” describes those category evaluations, not this consolidation. Task 20 checked reused questions, target, configuration, expectations, source hashes, and seed/live rows. Previous invocations of the same cases, supplementary outcome grading, authored examples, and edited replays are not extra cases.

Routes, envelope/outcome, plan schema/business rules/meaning, compilation/execution, and numerical results are deterministic grades. Clarification and unsupported reason quality are **manual**, using rubrics frozen before the category calls; no LLM judge. Structured reasons do not establish application-rendered messages.

Evidence keys used throughout:

- **R**: [day-07-planned-routing-2026-10-08T04-43-31-855Z-69e44fa8-21b4-4845-931a-0bec40788775-summary.json](../../results/day-07-planned-routing-2026-10-08T04-43-31-855Z-69e44fa8-21b4-4845-931a-0bec40788775-summary.json)
- **I**: [summary.json](../../results/day-07-interpretation-2026-10-08T05-40-39-744Z-67286245-dee5-4ece-9a88-c552c2cd7de3/summary.json)
- **C**: [final-report.json](../../results/day-07-clarification-cases-2026-10-08T06-02-49-240Z-ee2fb563-bb3c-4b7b-9519-d44064a47dfa/final-report.json)
- **U**: [final-report.json](../../results/day-07-unsupported-cases-2026-10-08T06-12-38-966Z-19c5377e-462f-4c1f-90a8-a2296ad71967/final-report.json)
- **N**: [report.json](../../results/day-07-numerical-category-2026-10-08T06-24-48-626Z-9fc6c309-b6f3-4b6c-a179-5c4e913204f1/report.json)
- **P**: [day-07-v2-v3-comparison-2026-10-07T17-23-23-652Z-52dd4dd6-3a3d-4f72-af55-c1a9deaf1db9.json](../../results/day-07-v2-v3-comparison-2026-10-07T17-23-23-652Z-52dd4dd6-3a3d-4f72-af55-c1a9deaf1db9.json)

## Case inventory

Roles retain the plan: **D** development (33), **V** validation/exposed regression (5), **T** reserved-test candidate (2). T candidates are now evaluated and exposed; neither is still unseen. Prior held-out router cases are D regression; the five frozen analytics cases retain original `held_out` metadata but are V/exposed regression here. No frozen file was relabeled.

| # | Unique case ID | Category | Evaluation target | Role | Evidence |
|---:|---|---|---|---|---|
| 1 | `analytics-01` | Routing | router | D | R / fresh component |
| 2 | `analytics-02` | Routing | router | D | R / fresh component |
| 3 | `analytics-04` | Routing | router | D | R / fresh component |
| 4 | `docs-01` | Routing | router | D | R / fresh component |
| 5 | `docs-02` | Routing | router | D | R / fresh component |
| 6 | `docs-04` | Routing | router | D | R / fresh component |
| 7 | `investigation-01` | Routing | router | D | R / fresh component |
| 8 | `investigation-03` | Routing | router | D | R / fresh component |
| 9 | `heldout-docs-04` | Routing | router | D | R / fresh component |
| 10 | `heldout-investigation-04` | Routing | router | D | R / fresh component |
| 11 | `scalar-gross-unspecified-date` | Interpretation | extractor | D | I / fresh component |
| 12 | `scalar-gross-explicit-interval` | Interpretation | extractor | D | I / fresh component |
| 13 | `gross-by-region` | Interpretation | extractor | D | I / fresh component |
| 14 | `top-three-regions-gross` | Interpretation | extractor | D | I / fresh component |
| 15 | `net-revenue-north` | Interpretation | extractor | D | I / fresh component |
| 16 | `proposed-category-filter-net-v1` | Interpretation | extractor | T | I / fresh component |
| 17 | `clarify-01` | Clarification | router | D | C / fresh component |
| 18 | `clarify-03` | Clarification | router | D | C / fresh component |
| 19 | `clarify-04` | Clarification | router | D | C / fresh component |
| 20 | `ambiguous-revenue` | Clarification | extractor | D | C / fresh component |
| 21 | `reversed-date-interval` | Clarification | extractor | D | C / fresh component |
| 22 | `day-7-clarification-revenue-scope-v1` | Clarification | extractor | D | C / fresh component |
| 23 | `unsupported-02` | Refusal/unsupported | router | D | U / fresh component |
| 24 | `unsupported-03` | Refusal/unsupported | router | D | U / fresh component |
| 25 | `unsupported-04` | Refusal/unsupported | router | D | U / fresh component |
| 26 | `heldout-unsupported-04` | Refusal/unsupported | router | D | U / fresh component |
| 27 | `unsupported-profit` | Refusal/unsupported | extractor | D | U / fresh component |
| 28 | `proposed-return-rate-definition-v1` | Refusal/unsupported | extractor | T | U / fresh component |
| 29 | `day-7-august-net-revenue-v1` | Numerical | full pipeline | D | N / reused v3 |
| 30 | `day-7-august-net-revenue-paraphrase-v1` | Numerical | full pipeline | D | N / reused v3 |
| 31 | `day-7-september-net-revenue-v1` | Numerical | full pipeline | D | N / reused v3 |
| 32 | `day-7-august-north-net-revenue-v1` | Numerical | full pipeline | D | N / reused v3 |
| 33 | `day-7-august-south-net-revenue-v1` | Numerical | full pipeline | D | N / reused v3 |
| 34 | `day-7-heldout-interval-01-v1` | Numerical | full pipeline | V | N / reused v3 |
| 35 | `day-7-heldout-interval-02-v1` | Numerical | full pipeline | V | N / reused v3 |
| 36 | `day-7-heldout-east-01-v1` | Numerical | full pipeline | V | N / reused v3 |
| 37 | `day-7-heldout-west-01-v1` | Numerical | full pipeline | V | N / reused v3 |
| 38 | `day-7-heldout-paraphrase-01-v1` | Numerical | full pipeline | V | N / reused v3 |
| 39 | `start-inclusive-end-exclusive` | Numerical | executor | D | N / fresh executor |
| 40 | `no-matching-rows` | Numerical | executor | D | N / fresh executor |

## Results by target

Denominator means cases actually graded for that check; pass + fail. `not_reached` and `not_observable` remain separate. No blocked cases were recorded in C/U.

### Router components

**14/17 (82.4%)** exact route matches: R **8/10**, C router **2/3**, U router **4/4**. All 17 labels were valid; there were no ungraded router cases. Pipeline routing is reported separately below and is not added to this component denominator. Counts recomputed from R/C/U case records.

| Expected route | Correct / cases | Accuracy |
|---|---:|---:|
| `analytics` | 2/3 | 66.7% |
| `docs` | 4/4 | 100.0% |
| `investigation` | 2/3 | 66.7% |
| `clarify` | 2/3 | 66.7% |
| `unsupported` | 4/4 | 100.0% |

### Extractor components and manual quality

| Check / subset | Pass | Fail | Not reached | Not observable | Graded / applicable | Evidence |
|---|---:|---:|---:|---:|---:|---|
| Envelope validity, all extractor targets | 11 | 0 | 0 | 0 | 11/11 | I+C+U |
| Outcome correctness, interpretation | 6 | 0 | 0 | 0 | 6/6 | I |
| Outcome correctness, clarification | 1 | 2 | 0 | 0 | 3/3 | C |
| Outcome correctness, unsupported | 2 | 0 | 0 | 0 | 2/2 | U |
| Outcome correctness, all extractor targets | 9 | 2 | 0 | 0 | 11/11 | I+C+U |
| Plan schema, interpretation | 6 | 0 | 0 | 0 | 6/6 | I |
| Business rules, interpretation | 6 | 0 | 0 | 0 | 6/6 | I |
| Plan meaning, interpretation | 3 | 3 | 0 | 0 | 6/6 | I |
| Manual clarification quality | 1 | 0 | 2 | 0 | 1/3 | C |
| Manual unsupported reason quality | 2 | 0 | 0 | 0 | 2/2 | U |

Interpretation meaning correctness is **3/6**; outcome correctness across extractor targets is **9/11**. C's two wrong outcomes cannot receive clarification-quality grades. Quality is not applicable to C's 3 and U's 4 label-only router cases; no quality pass is awarded. C/U targets grade route or envelope/outcome and reason quality, not incidental query plans produced by wrong outcomes. Valid clarification/unsupported envelopes contain no plan, so plan checks are not reached.

### Model-free executor

**2/2 success**, with schema, business rules, canonical meaning, compilation, execution, reference agreement, and numerical checks all passing (N). Boundary case returns `1100.00`; no-match case returns one `net_revenue: null` row. Both live and seeded handwritten reference SQL agree with independent seed arithmetic. All 30 live rows matched the seed. These prove execution of supplied plans, not language interpretation.

### Full pipeline

**0/10 success**: development-v3 **0/5**, former-held-out-v3 **0/5** (N). Different questions make these dataset performances, not a measured prompt improvement/regression. All ten original verdicts remain FAIL.

| Check | Pass | Fail | Not reached | Not observable | Graded / cases | Evidence |
|---|---:|---:|---:|---:|---:|---|
| Routing | 10 | 0 | 0 | 0 | 10/10 | N |
| Envelope | 10 | 0 | 0 | 0 | 10/10 | N |
| Outcome | 9 | 1 | 0 | 0 | 10/10 | N |
| Plan schema | 9 | 0 | 1 | 0 | 9/10 | N |
| Business rules | 7 | 2 | 1 | 0 | 9/10 | N |
| Meaning | 0 | 7 | 3 | 0 | 7/10 | N |
| Compilation | 0 | 7 | 3 | 0 | 7/10 | N |
| Database execution | 0 | 0 | 10 | 0 | 0/10 | N |
| Numerical | 0 | 0 | 10 | 0 | 0/10 | N |

Seven requests reached compilation and were rejected; three stopped earlier. None executed against the database. Numerical grading has **zero graded pipeline cases**, not ten numerical mismatches. A request can fail several checks; failed-check counts are not failed-request counts. Executor numerical grades remain a separate **2/2**.

## Prompt comparison and diagnostics

The real development comparison (P), using the same five questions and settings:

| Extractor | Plan schema success | Full-pipeline success |
|---|---:|---:|
| v2 | 0/5 | 0/5 |
| v3 | 5/5 | 0/5 |

The only prompt addition required date-only `YYYY-MM-DD` boundaries, never timestamps/timezones. All five v2 outputs failed schema validation. v3 reached business validation (3 pass, 2 fail), meaning (0/3 pass), and compilation (0/3 pass). These downstream grades are **newly observed**, not automatically improved: v2 had no grades for them. Edited date replays are diagnostics only and never enter real-run success scores. P preserves per-case latency/token data; category evidence retains raw responses and metadata. Single first-call cold-start candidates are not representative warm latency.

## Concrete failure classes

- **Routing override confusion (model classification):** `analytics-04` and `heldout-investigation-04` returned `docs` instead of analytics/investigation (R). `clarify-03` returned analytics despite unresolved revenue/period scope (C).
- **Invented metric default (model interpretation):** `ambiguous-revenue` and `day-7-clarification-revenue-scope-v1` returned `query_plan` with `total_gross_revenue` when policy required `clarification_required` (C). Valid envelopes still failed outcome correctness; quality was not reached.
- **Wrong scope despite validation (model interpretation):** `net-revenue-north` added region grouping; `proposed-category-filter-net-v1` added category grouping and three monetary filters; `top-three-regions-gross` omitted limit 3 (I). All passed schema/business validation and failed meaning. In the pipeline, `day-7-august-net-revenue-paraphrase-v1` and `day-7-september-net-revenue-v1` invented mutually contradictory region filters and failed business rules (N).
- **Compiler boundary, distinct from interpretation:** `day-7-august-net-revenue-v1` was rejected with `UNSUPPORTED_LIMIT` for `unspecified`; its explicit “do not” instruction also makes this a meaning mismatch. `day-7-august-north-net-revenue-v1` added grouping (meaning failure) and hit `UNSUPPORTED_DIMENSIONS` (N). Omitted-operation expectations in other analytics cases accept `unspecified`, while compilation requires `none`; this documented discrepancy remains. No saved scored pipeline plan passed meaning, so there is no observed meaning-PASS/compilation-FAIL example here. Gross, grouping, ranking, category filters, and unspecified dates may be contract-valid extractor intents but are not supported compiler operations; they are not extra extractor failures (I).

## Limitations and discrepancies

- Small datasets, one invocation per selected case, no reliability/stability estimate. Related gross, August, and partial-interval paraphrases reduce independence; case counts are not independent family counts.
- Former held-out questions are exposed regression. The plan's two reserved candidates have now been used; the original role labels are historical, not remaining unseen evidence.
- No user-facing rendering or conversational clarification/refusal workflow evaluation. Router labels have no reason text. Manual assessments address exact extractor reason fields only.
- Pipeline numerical checks never reached; executor success cannot establish end-to-end numerical reliability. No broad ranking/multirow/comparison numerical coverage.
- Envelope validation uses a discriminated schema that also validates the query-plan branch structure; envelope and plan-schema grades are reported separately but are not independent checks. Supplementary offline outcome grades do not revise original overall verdicts.
- Verification found no missing/duplicate IDs, target mismatches, or count discrepancies between selected records and saved category summaries. Historical role exposure and the meaning/compiler optional-field discrepancy are explicitly retained rather than silently reconciled.

## What we learned

Expectations define the answer independently of model output; graders compare evidence, and harnesses expose stages and preserve failures. Supplementary checks and replay help diagnose failures without creating new cases or replacing failed runs. Component correctness and pipeline success answer different questions: successful routing or extraction does not prove executable, correct results.

Validation establishes contract consistency; meaning checks user intent, including explicit empty scope. Valid JSON and valid business rules can still encode invented grouping or omit a requested limit. Money uses exact decimals with equivalent representations equal; SQL NULL remains distinct from zero. No tolerance was needed. Future rounding/tolerance must follow the calculation's specification and be justified before outputs are seen.

Manual rubrics judge meaning rather than exact wording, cite the actual reason, and require all criteria to pass. Wrong outcomes prevent quality grading. Development supports iteration, regression checks exposed cases, and credible held-out claims require independently authored unseen data frozen before use. Different datasets do not measure a prompt change.

## Prioritized backlog — proposal only

1. Decide and document omitted-operation semantics across extraction, meaning, and compilation; preserve current evidence before any change.
2. Address invented scope/defaults and missed clarification with a new controlled development cycle; maintain separate outcome and meaning checks.
3. Strengthen routing-override coverage and clarify product policy for unresolved scope, without tuning to exposed held-out failures.
4. Add supported end-to-end numerical and user-facing workflow coverage, then author a genuinely unseen frozen test set and assess repeated-run reliability.
