import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { getMetricDefinitionToolDefinition } from "../tools/get-metric-definition.js";
import type { ModelRequest } from "./provider.js";
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

test("serializes provider-neutral tool definitions for chat completions", async () => {
  const { requestBody, result } = await generateWithMockedTransport(
    {
      messages: [{ role: "user", content: "Define net revenue" }],
      tools: [getMetricDefinitionToolDefinition],
    },
    completionResponse({ content: "I can look that up." }),
  );

  assert.deepEqual(requestBody, {
    model: "qwen-test",
    reasoning_effort: "none",
    messages: [{ role: "user", content: "Define net revenue" }],
    tools: [
      {
        type: "function",
        function: {
          name: getMetricDefinitionToolDefinition.name,
          description: getMetricDefinitionToolDefinition.description,
          parameters: getMetricDefinitionToolDefinition.parameters,
        },
      },
    ],
  });
  assert.equal(result.text, "I can look that up.");
  assert.deepEqual(result.toolCalls, []);
});

test("extracts a tool call while preserving assistant content and raw arguments", async () => {
  const rawArguments = '{"metric":"net_revenue"}';
  const { result } = await generateWithMockedTransport(
    {
      messages: [{ role: "user", content: "What does net revenue mean?" }],
      tools: [getMetricDefinitionToolDefinition],
    },
    completionResponse(
      {
        content: "I will retrieve the authoritative definition.",
        tool_calls: [
          {
            id: "call_metric_1",
            type: "function",
            function: {
              name: "get_metric_definition",
              arguments: rawArguments,
            },
          },
        ],
      },
      "tool_calls",
    ),
  );

  assert.equal(result.text, "I will retrieve the authoritative definition.");
  assert.deepEqual(result.toolCalls, [
    {
      id: "call_metric_1",
      name: "get_metric_definition",
      arguments: rawArguments,
    },
  ]);
  assert.equal(result.finishReason, "tool_calls");
});

test("extracts multiple tool calls in response order", async () => {
  const { result } = await generateWithMockedTransport(
    {
      messages: [{ role: "user", content: "Define two metrics" }],
      tools: [getMetricDefinitionToolDefinition],
    },
    completionResponse(
      {
        content: "I will retrieve both definitions.",
        tool_calls: [
          {
            id: "call_metric_1",
            type: "function",
            function: {
              name: "get_metric_definition",
              arguments: '{"metric":"total_gross_revenue"}',
            },
          },
          {
            id: "call_metric_2",
            type: "function",
            function: {
              name: "get_metric_definition",
              arguments: '{"metric":"total_refund_amount"}',
            },
          },
        ],
      },
      "tool_calls",
    ),
  );

  assert.equal(result.text, "I will retrieve both definitions.");
  assert.deepEqual(result.toolCalls, [
    {
      id: "call_metric_1",
      name: "get_metric_definition",
      arguments: '{"metric":"total_gross_revenue"}',
    },
    {
      id: "call_metric_2",
      name: "get_metric_definition",
      arguments: '{"metric":"total_refund_amount"}',
    },
  ]);
});

test("serializes assistant tool calls and matching tool results for follow-up", async () => {
  const { requestBody } = await generateWithMockedTransport(
    {
      messages: [
        { role: "user", content: "What does net revenue mean?" },
        {
          role: "assistant",
          content: "I will check the application definition.",
          toolCalls: [
            {
              id: "call_metric_1",
              name: "get_metric_definition",
              arguments: '{"metric":"net_revenue"}',
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_metric_1",
          content: '{"success":true,"data":{"metric":"net_revenue"}}',
        },
      ],
      tools: [getMetricDefinitionToolDefinition],
    },
    completionResponse({ content: "Net revenue is revenue after deductions." }),
  );

  assert.deepEqual(requestBody, {
    model: "qwen-test",
    reasoning_effort: "none",
    messages: [
      { role: "user", content: "What does net revenue mean?" },
      {
        role: "assistant",
        content: "I will check the application definition.",
        tool_calls: [
          {
            id: "call_metric_1",
            type: "function",
            function: {
              name: "get_metric_definition",
              arguments: '{"metric":"net_revenue"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_metric_1",
        content: '{"success":true,"data":{"metric":"net_revenue"}}',
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: getMetricDefinitionToolDefinition.name,
          description: getMetricDefinitionToolDefinition.description,
          parameters: getMetricDefinitionToolDefinition.parameters,
        },
      },
    ],
  });
});

test("preserves existing text behavior when no tools are supplied", async () => {
  const { requestBody, result } = await generateWithMockedTransport(
    {
      messages: [{ role: "user", content: "Say hello" }],
      temperature: 0,
      maxTokens: 8,
    },
    completionResponse({ content: "Hello", refusal: null }),
  );

  assert.deepEqual(requestBody, {
    model: "qwen-test",
    reasoning_effort: "none",
    messages: [{ role: "user", content: "Say hello" }],
    temperature: 0,
    max_tokens: 8,
  });
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.metadata.tokenUsage, {
    inputTokens: 11,
    outputTokens: 5,
    totalTokens: 16,
  });
  assert.equal(result.metadata.requestId, "request-123");
});

test("maps provider-neutral JSON Schema output to chat completions", async () => {
  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };
  const { requestBody, result } = await generateWithMockedTransport(
    {
      messages: [{ role: "user", content: "Return JSON" }],
      responseFormat: {
        type: "json_schema",
        name: "test_schema",
        schema,
        strict: true,
      },
    },
    completionResponse({ content: '{"ok":true}', refusal: null }),
  );

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
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.metadata.requestId, "request-123");
});

test("rejects combining structured output with tool calling before transport", async () => {
  const provider = new QwenProvider({
    baseUrl: "http://model.test/v1",
    model: "qwen-test",
    reasoningEffort: "none",
  });

  await assert.rejects(
    provider.generate({
      messages: [{ role: "user", content: "Return JSON or call a tool" }],
      tools: [getMetricDefinitionToolDefinition],
      responseFormat: {
        type: "json_schema",
        name: "test_schema",
        schema: { type: "object" },
        strict: true,
      },
    }),
    /cannot combine structured output with tool calling/,
  );
});

async function generateWithMockedTransport(
  request: ModelRequest,
  responseBody: unknown,
) {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "x-request-id": "request-123" },
    });
  };

  try {
    const provider = new QwenProvider({
      baseUrl: "http://model.test/v1",
      model: "qwen-test",
      reasoningEffort: "none",
    });
    const result = await provider.generate(request);
    return { requestBody, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function completionResponse(
  message: Record<string, unknown>,
  finishReason = "stop",
) {
  return {
    model: "qwen-test",
    choices: [
      {
        finish_reason: finishReason,
        message,
      },
    ],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 5,
      total_tokens: 16,
    },
  };
}
