import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { apiCost, recordingInvestigationProvider } from "./investigation-recorder.js";

test("persists exact raw output before returning a provider result with unavailable cost", async () => {
  const directory = await mkdtemp(join(tmpdir(), "investigation-recorder-"));
  const callsPath = pathToFileURL(join(directory, "calls.jsonl"));
  try {
    const provider = recordingInvestigationProvider({ async generate() { return { text: "{broken raw", toolCalls: [],
      metadata: { model: "fake", latencyMs: 2, tokenUsage: null, requestId: null } }; } },
      { caseId: "synthetic", callsPath, model: "fake", reasoningEffort: "none", pricing: null });
    const result = await provider.generate({ messages: [{ role: "user", content: "Test" }] });
    const record = JSON.parse(await readFile(callsPath, "utf8"));
    assert.equal(record.rawOutput, result.text);
    assert.equal(record.apiCost.status, "unavailable");
    assert.equal(record.apiCost.usd, null);
    assert.equal(apiCost(null, { inputTokens: 10, outputTokens: 2, totalTokens: 12 }).usd, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
