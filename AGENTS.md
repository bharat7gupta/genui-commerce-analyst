# GenUI Commerce Analyst — Contributor Guide

This file applies to the entire repository. Keep changes scoped to the current
roadmap task and preserve completed experiments as reproducible artifacts.

## Project purpose and current status

This repository is an Applied AI Engineering learning project for a commerce
analyst. It currently contains:

- a provider-neutral model interface and local Qwen adapter;
- validated environment configuration and model-call metadata capture;
- a deterministic DuckDB commerce dataset with reference analytics;
- Day 1 baseline experiments recorded as JSONL;
- versioned request-routing prompts and controlled routing evaluations.

The current routing decision is nuanced:

- `router-v1`: 75% on the development/regression set; retained as a simple
  rollback baseline.
- `router-v2`: 65%; rejected experiment, retained unchanged.
- `router-v3`: 90% on the development/regression set and 76% on the exposed
  held-out set. It is the best development-set version, but it failed the
  production-readiness gate and is not production-ready.

Read `docs/engineering-log.md` before continuing roadmap work. It is the source
of truth for experiment decisions and interpretation.

## Technology stack

- Node.js 20 or newer
- TypeScript in strict ESM mode (`module: NodeNext`, `.js` import suffixes)
- `tsx` for local execution and Node's built-in test runner
- Native `fetch` against an OpenAI-compatible local endpoint
- Local model currently configured as `qwen3.5:4b`
- `zod` for runtime validation
- `dotenv` for local environment loading
- DuckDB through the Promise-based `@duckdb/node-api` client
- JSON and JSONL for evaluation definitions and immutable run records

There is intentionally no React UI, ORM, generic repository layer, agent/tool
framework, retry framework, or general evaluation framework yet. Add such
layers only when a roadmap task explicitly requires them.

## Repository map

- `src/ai/provider.ts`: provider-neutral request/result contract.
- `src/ai/qwen-provider.ts`: OpenAI-compatible Qwen transport adapter.
- `src/config.ts`: validated environment configuration.
- `src/db/`: DuckDB connection, deterministic initialization, and reference
  result printing.
- `src/routing/`: immutable prompt versions, version selection, strict output
  validation, and focused unit tests.
- `src/experiments/`: executable experiment scripts; these may make real model
  calls and append results.
- `data/seed.sql`: deterministic 30-row commerce seed.
- `evals/baseline-cases.json`: Day 1 analytics ground truth and acceptance
  metadata.
- `evals/routing/cases-v1.jsonl`: exposed development/regression routing set.
- `evals/routing/heldout-cases-v1.jsonl`: exposed audit/regression set; it is no
  longer an unseen held-out set.
- `results/`: immutable JSONL experiment artifacts.
- `docs/engineering-log.md`: concise hypotheses, results, and decisions.

## Environment configuration

Copy `.env.example` to `.env`. Never commit or print secrets from `.env`.

Required variables:

- `MODEL_BASE_URL`
- `MODEL_NAME`
- `MODEL_API_KEY` (may be empty for a local endpoint)
- `MODEL_REASONING_EFFORT`

Routing comparisons currently use `qwen3.5:4b`, temperature `0`, maximum output
tokens `8`, and reasoning effort `none`. Do not change these during a controlled
comparison.

## Common commands

```sh
npm install
npm run typecheck
npm run test:routing
```

Database commands:

```sh
npm run db:init
npm run db:results
```

`db:init` deliberately recreates `data/commerce.duckdb`. Do not run it when the
task is read-only or when database recreation is unnecessary.

Commands under `experiment:*` can make real model calls and append records.
Run them only when explicitly requested. Never use a full evaluation run as a
routine smoke test.

## Architectural rules

- Keep provider-neutral types free of Qwen/OpenAI transport details.
- Keep endpoint paths, headers, response mapping, and transport errors inside
  the provider adapter.
- Validate external configuration and evaluation definitions before work
  begins; fail clearly rather than silently defaulting malformed input.
- Keep versioned prompts outside routing business logic.
- Send the trusted system prompt separately from the untrusted user request.
- For few-shot packages, preserve the system, user, assistant, and final-user
  message roles exactly.
- Accept only an exact known route label. Do not trim, extract, guess, repair,
  or retry invalid model output.
- A predicted route is not authorization. Downstream permissions, tool access,
  argument validation, and safety controls must remain enforced in code.

## Immutable experiment policy

Treat these as frozen unless the user explicitly requests a new version:

- `src/routing/router-v1-prompt.ts`
- `src/routing/router-v2-prompt.ts`
- `src/routing/router-v3-prompt.ts`
- `evals/routing/cases-v1.jsonl`
- `evals/routing/heldout-cases-v1.jsonl`
- existing files under `results/`

Never edit a prompt version in place after evaluation. Create a newly named
version only when explicitly authorized. Do not create `router-v4` by tuning to
the exposed failures in either routing dataset.

Do not overwrite, truncate, normalize, or reorder existing JSONL result files.
New experiment runs should use a new artifact path or append only when the
experiment protocol explicitly calls for it. Preserve raw model output before
validation and record provider/validation failures without retries.

Evaluator-only fields such as `expectedRoute`, `reason`, reference results, and
acceptance criteria must never be included in model messages.

## Evaluation discipline

- Freeze the prompt, case set, model settings, parser, and evaluation rules
  before the first call.
- Record one JSONL object per invocation immediately after the call.
- Capture version identifiers, case ID, repetition, raw output, validated
  output, correctness, model/settings, latency, usage, request ID, and errors.
- Compare expected and actual routes only after the router call completes.
- Separate a first-call cold-start candidate from representative warm latency.
- Verify prompt and dataset checksums before and after controlled evaluations.
- Stable output is not necessarily correct output.
- Development/regression results are not evidence of production readiness.
- Any future model or routing approach needs a new development cycle and an
  independently authored, genuinely unseen held-out set.

## Coding conventions

- Prefer small, task-specific modules over speculative abstractions.
- Use explicit TypeScript types and discriminated unions at important
  boundaries; avoid `any` and unchecked casts.
- Use `DECIMAL` for monetary database values and deterministic ordering for
  reference queries.
- Preserve the existing JSONL field names and nullable metadata conventions.
- Keep tests deterministic with fake providers; unit tests must not call the
  model or load frozen evaluation cases as fixtures.
- Keep the engineering log concise. Record durable findings and decisions, not
  every observation or repeated metric.
- Before editing, inspect `git status` and preserve unrelated user changes.

## General recommendations

- Run `npm run typecheck` and the smallest relevant test command before handing
  off code changes.
- Add CI for type-checking and focused tests when repository automation enters
  scope.
- Update the README as the public setup guide evolves; keep experiment history
  and rejected approaches in the engineering log instead.
- Prefer measured comparisons over intuition, but stop tuning once a dataset
  has influenced prompt design; move to a fresh validation set.
- Keep model routing advisory and deterministic application safeguards
  authoritative.
