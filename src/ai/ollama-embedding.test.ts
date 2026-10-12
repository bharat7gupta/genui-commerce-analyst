import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { embed, EMBEDDING_MODEL, resolveEmbeddingRevision } from "./ollama-embedding.js";

afterEach(() => mock.restoreAll());

test("resolves a full installed model digest and normalizes its prefix", async () => {
  const digest = "a".repeat(64);
  for (const suppliedDigest of [digest, `sha256:${digest}`]) {
    mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      assert.equal(url, "http://127.0.0.1:11434/api/tags");
      return Response.json({ models: [{ name: EMBEDDING_MODEL, digest: suppliedDigest }] });
    });
    assert.equal(await resolveEmbeddingRevision(), `sha256:${digest}`);
    mock.restoreAll();
  }
});

test("fails instead of inventing a revision for missing or malformed metadata", async () => {
  for (const payload of [
    {},
    { models: [] },
    { models: [{ name: EMBEDDING_MODEL, digest: "latest" }] },
    { models: [{ name: EMBEDDING_MODEL }] },
    { models: [{ name: "other-model", digest: "a".repeat(64) }] },
    { models: Array.from({ length: 2 }, () => ({ name: EMBEDDING_MODEL, digest: "a".repeat(64) })) },
  ]) {
    mock.method(globalThis, "fetch", async () => Response.json(payload));
    await assert.rejects(resolveEmbeddingRevision(), /Cannot resolve/);
    mock.restoreAll();
  }
  mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(resolveEmbeddingRevision(), /HTTP 503/);
});

test("preserves the Day 8 embedding request and validates the response", async () => {
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "http://127.0.0.1:11434/api/embed");
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.headers, { "content-type": "application/json" });
    assert.equal(init?.body, JSON.stringify({ model: EMBEDDING_MODEL, input: ["Synthetic text"] }));
    return Response.json({ model: EMBEDDING_MODEL, embeddings: [[1, 2, 3]] });
  });
  assert.deepEqual(await embed(["Synthetic text"]), [[1, 2, 3]]);
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => Response.json({ model: EMBEDDING_MODEL, embeddings: [["bad"]] }));
  await assert.rejects(embed(["Synthetic text"]), /invalid embedding response/);
});
