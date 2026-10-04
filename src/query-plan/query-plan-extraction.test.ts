import assert from "node:assert/strict";
import test from "node:test";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
} from "../ai/provider.js";
import {
  QUERY_PLAN_EXTRACTION_PROMPT_VERSION,
  QUERY_PLAN_EXTRACTION_SYSTEM_PROMPT,
} from "./query-plan-extraction-v1-prompt.js";
import {
  QUERY_PLAN_EXTRACTION_V2_EXAMPLES,
  QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION,
  QUERY_PLAN_EXTRACTION_V2_SYSTEM_PROMPT,
} from "./query-plan-extraction-v2-prompt.js";
import {
  BUSINESS_RULE_INVALID_QUERY_PLAN_OUTPUT,
  MALFORMED_QUERY_PLAN_OUTPUT,
  STRUCTURALLY_INVALID_QUERY_PLAN_OUTPUT,
  VALID_QUERY_PLAN_OUTPUT,
} from "./query-plan-extraction.fixtures.js";
import {
  extractQueryPlan,
  QUERY_PLAN_OUTPUT_SCHEMA_VERSION,
  queryPlanOutputJsonSchema,
} from "./query-plan-extraction.js";

test("submits the versioned prompt and native JSON Schema for a valid plan", async () => {
  const observedRequests: ModelRequest[] = [];
  const result = await extractQueryPlan(
    createFakeProvider(VALID_QUERY_PLAN_OUTPUT, (request) => {
      observedRequests.push(request);
    }),
    "What was total gross revenue for all time?",
  );

  assert.equal(result.outcome, "query_plan");
  if (result.outcome !== "query_plan") return;
  assert.equal(result.queryPlan.metric.kind, "metric");
  assert.equal(result.promptVersion, QUERY_PLAN_EXTRACTION_PROMPT_VERSION);
  assert.equal(result.outputSchemaVersion, QUERY_PLAN_OUTPUT_SCHEMA_VERSION);
  const observedRequest = observedRequests[0];
  assert.ok(observedRequest);
  assert.equal(observedRequest.messages[0]?.content, QUERY_PLAN_EXTRACTION_SYSTEM_PROMPT);
  assert.deepEqual(observedRequest.messages[1], {
    role: "user",
    content: "What was total gross revenue for all time?",
  });
  assert.deepEqual(observedRequest.responseFormat, {
    type: "json_schema",
    name: "query_plan_output_v1",
    schema: queryPlanOutputJsonSchema,
    strict: true,
  });
});

test("selects extraction-v2 with exactly two examples", async () => {
  const observedRequests: ModelRequest[] = [];
  const result = await extractQueryPlan(
    createFakeProvider(VALID_QUERY_PLAN_OUTPUT, (request) => {
      observedRequests.push(request);
    }),
    "A fresh scalar question",
    QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION,
  );

  assert.equal(result.promptVersion, QUERY_PLAN_EXTRACTION_V2_PROMPT_VERSION);
  assert.equal(QUERY_PLAN_EXTRACTION_V2_EXAMPLES.length, 2);
  const request = observedRequests[0];
  assert.ok(request);
  assert.equal(request.messages[0]?.content, QUERY_PLAN_EXTRACTION_V2_SYSTEM_PROMPT);
  assert.deepEqual(
    request.messages.slice(1, -1),
    QUERY_PLAN_EXTRACTION_V2_EXAMPLES.flatMap(({ user, assistant }) => [
      user,
      assistant,
    ]),
  );
  assert.deepEqual(request.messages.at(-1), {
    role: "user",
    content: "A fresh scalar question",
  });
});

test("distinguishes malformed JSON", async () => {
  const result = await extractQueryPlan(
    createFakeProvider(MALFORMED_QUERY_PLAN_OUTPUT),
    "question",
  );

  assert.equal(result.outcome, "malformed_json");
  assert.equal(result.rawOutput, MALFORMED_QUERY_PLAN_OUTPUT);
});

test("distinguishes structural schema failure", async () => {
  const result = await extractQueryPlan(
    createFakeProvider(STRUCTURALLY_INVALID_QUERY_PLAN_OUTPUT),
    "question",
  );

  assert.equal(result.outcome, "structural_validation_failure");
  if (result.outcome !== "structural_validation_failure") return;
  assert.ok(result.issues.some((issue) => issue.code === "invalid_value"));
});

test("distinguishes QueryPlan business-rule failure", async () => {
  const result = await extractQueryPlan(
    createFakeProvider(BUSINESS_RULE_INVALID_QUERY_PLAN_OUTPUT),
    "question",
  );

  assert.equal(result.outcome, "business_rule_failure");
  if (result.outcome !== "business_rule_failure") return;
  assert.ok(
    result.issues.some((issue) => issue.code === "INVALID_INTERVAL_ORDER"),
  );
});

test("distinguishes a provider refusal when exposed", async () => {
  const result = await extractQueryPlan(
    createFakeProvider("", undefined, {
      finishReason: "stop",
      refusal: "I cannot process this request.",
    }),
    "question",
  );

  assert.equal(result.outcome, "refusal");
  if (result.outcome !== "refusal") return;
  assert.equal(result.refusal, "I cannot process this request.");
});

test("distinguishes incomplete output using the finish reason", async () => {
  const result = await extractQueryPlan(
    createFakeProvider(MALFORMED_QUERY_PLAN_OUTPUT, undefined, {
      finishReason: "length",
      refusal: null,
    }),
    "question",
  );

  assert.equal(result.outcome, "incomplete");
  assert.equal(result.rawOutput, MALFORMED_QUERY_PLAN_OUTPUT);
});

function createFakeProvider(
  output: string,
  observe?: (request: ModelRequest) => void,
  completion: Pick<ModelResult, "finishReason" | "refusal"> = {
    finishReason: "stop",
    refusal: null,
  },
): ModelProvider {
  return {
    async generate(request): Promise<ModelResult> {
      observe?.(request);
      return {
        text: output,
        metadata: {
          model: "fixture-model",
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
          latencyMs: 12,
          requestId: "fixture-request-id",
        },
        ...completion,
      };
    },
  };
}
