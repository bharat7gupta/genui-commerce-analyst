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
