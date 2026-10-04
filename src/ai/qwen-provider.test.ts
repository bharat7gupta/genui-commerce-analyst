import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { QwenProvider } from "./qwen-provider.js";

const requestBodySchema = z
  .object({
    model: z.string(),
    reasoning_effort: z.string(),
    response_format: z
      .object({
        type: z.literal("json_schema"),
        json_schema: z
          .object({
            name: z.string(),
            strict: z.literal(true),
            schema: z.record(z.string(), z.unknown()),
          })
          .strict(),
      })
      .strict(),
  })
  .passthrough();

test("maps provider-neutral JSON Schema output to chat completions", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        model: "qwen-test",
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"ok":true}', refusal: null },
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 5,
          total_tokens: 16,
        },
      }),
      {
        status: 200,
        headers: { "x-request-id": "request-123" },
      },
    );
  };

  const provider = new QwenProvider({
    baseUrl: "http://model.test/v1",
    model: "qwen-test",
    reasoningEffort: "none",
  });
  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };
  const result = await provider.generate({
    messages: [{ role: "user", content: "Return JSON" }],
    responseFormat: {
      type: "json_schema",
      name: "test_schema",
      schema,
      strict: true,
    },
  });

  const parsedBody = requestBodySchema.parse(requestBody);
  assert.deepEqual(parsedBody.response_format, {
    type: "json_schema",
    json_schema: {
      name: "test_schema",
      strict: true,
      schema,
    },
  });
  assert.equal(result.finishReason, "stop");
  assert.equal(result.refusal, null);
  assert.equal(result.metadata.requestId, "request-123");
});
