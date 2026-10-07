import assert from "node:assert/strict";
import test from "node:test";

import { selectDisplay, displaySelectionJsonSchema } from "../ui/display-selection.js";
import { QwenProvider, QwenStreamError } from "./qwen-provider.js";
import type { ModelRequest } from "./provider.js";

const TEXT = '{"type":"table","resultField":"net_revenue"}';
const request: ModelRequest = {
  messages: [{ role: "user", content: "Show table" }], temperature: 0, maxTokens: 128,
  responseFormat: { type: "json_schema", name: "display_selection_v1", schema: displaySelectionJsonSchema, strict: true },
};
const provider = new QwenProvider({ baseUrl: "http://model.test/v1", model: "qwen-test", reasoningEffort: "none" });
function event(content: string | null, finishReason: string | null = null) {
  return `data: ${JSON.stringify({ model: "qwen-测试", choices: [{ index: 0, delta: { content }, finish_reason: finishReason }], usage: null })}\r\n\r\n`;
}
async function mockTransport(body: ReadableStream<Uint8Array>, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const parsed: unknown = JSON.parse(String(init?.body));
    assert.ok(parsed && typeof parsed === "object" && "stream" in parsed && parsed.stream === true);
    assert.ok("response_format" in parsed);
    assert.deepEqual(parsed.response_format, { type: "json_schema", json_schema: {
      name: "display_selection_v1", schema: displaySelectionJsonSchema, strict: true,
    } });
    assert.ok("stream_options" in parsed);
    assert.deepEqual(parsed.stream_options, { include_usage: true });
    return new Response(body, { headers: { "content-type": "text/event-stream", "x-request-id": "stream-123" } });
  };
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}
function fragmented(text: string) {
  const bytes = new TextEncoder().encode(text);
  let position = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (position >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(position, position + 2));
    position += 2;
  } });
}

test("accumulates deltas across UTF-8/SSE boundaries and captures usage after stop", async () => {
  const parts = [TEXT.slice(0, 10), TEXT.slice(10, 25), TEXT.slice(25)];
  const wire = ": heartbeat\r\n\r\n" + event("") + parts.map(part => event(part)).join("") + event(null, "stop") +
    'data: {"choices":[],"usage":{"prompt_tokens":99,"completion_tokens":16,"total_tokens":115}}\r\n\r\n' +
    "data: [DONE]\r\n\r\n";
  await mockTransport(fragmented(wire), async () => {
    const observed: string[] = [];
    const result = await provider.generateStreaming(request, chunk => observed.push(chunk.text));
    assert.deepEqual(observed, parts);
    assert.equal(result.text, TEXT);
    assert.equal(result.metadata.model, "qwen-测试");
    assert.equal(result.metadata.requestId, "stream-123");
    assert.deepEqual(result.metadata.tokenUsage, { inputTokens: 99, outputTokens: 16, totalTokens: 115 });
    assert.equal(result.stream.completion, "completed");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.stream.timeToFirstContentMs, result.stream.chunks[0]?.elapsedMs);
    assert.ok(result.stream.totalDurationMs >= (result.stream.timeToFirstContentMs ?? 0));
  });
});

test("complete-looking JSON is not validated when the stream ends without DONE", async () => {
  await mockTransport(fragmented(event(TEXT) + event(null, "stop")), async () => {
    const selection = await selectDisplay({ generate: input => provider.generateStreaming(input) }, "Show table");
    assert.equal(selection.outcome, "generation_error");
    assert.match(selection.error, /ended before the terminal completion marker/);
    assert.ok(!("specification" in selection));
  });
});

test("DONE alone and truncated finish reasons never count as normal completion", async () => {
  for (const reason of [null, "length", "content_filter", "tool_calls"]) {
    const wire = event(TEXT) + (reason === null ? "" : event(null, reason)) + "data: [DONE]\n\n";
    await mockTransport(fragmented(wire), async () => {
      await assert.rejects(provider.generateStreaming(request), (error) => {
        assert.ok(error instanceof QwenStreamError);
        assert.equal(error.finishReason, reason);
        assert.equal(error.chunks.map(chunk => chunk.text).join(""), TEXT);
        assert.match(error.message, /did not complete normally/);
        return true;
      });
    });
  }
});

test("a disconnected reader and malformed event fail rather than repairing output", async () => {
  const disconnected = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("Disconnected")); } });
  await mockTransport(disconnected, async () => {
    await assert.rejects(provider.generateStreaming(request), /Qwen stream failed: Disconnected/);
  });
  await mockTransport(fragmented("data: {broken}\n\n"), async () => {
    await assert.rejects(provider.generateStreaming(request), QwenStreamError);
  });
});

test("tool streaming is rejected before sending a request", async () => {
  await assert.rejects(provider.generateStreaming({ ...request, tools: [{ name: "test", description: "test", parameters: {} }] }), /does not support tool calls/);
});
