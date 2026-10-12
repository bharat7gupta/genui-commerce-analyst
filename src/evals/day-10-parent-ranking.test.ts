import assert from "node:assert/strict";
import test from "node:test";

import { createChunkEmbedding } from "../retrieval/chunk-embedding.js";
import { evaluateParents, parentKey, topThreeParents } from "./day-10-parent-ranking.js";

function scored(tenant: string, parentDocumentId: string, chunkId: string, score: number) {
  return { score, record: createChunkEmbedding({
    vector: [1], dimension: 1, embeddingModel: "synthetic", embeddingRevision: "revision-1",
    chunk: { chunkId, parentDocumentId, sourceDocumentVersion: 1, chunkIndex: 0,
      text: "Synthetic", metadata: { tenant } },
  }) };
}

test("deduplicates before Top 3 while preserving first-ranked parent scores", () => {
  const parents = topThreeParents([
    scored("shop", "a", "a1", 0.9), scored("shop", "a", "a2", 0.8),
    scored("shop", "b", "b1", 0.7), scored("shop", "c", "c1", 0.6),
    scored("shop", "d", "d1", 0.5),
  ]);
  assert.deepEqual(parents.map(({ parentDocumentId }) => parentDocumentId), ["a", "b", "c"]);
  assert.equal(parents[0]?.firstChunkId, "a1");
  assert.equal(parents[0]?.score, 0.9);
  assert.deepEqual(evaluateParents(parents, new Set([parentKey("shop", "b"), parentKey("shop", "c"), parentKey("shop", "d")])),
    { hitAt1: 0, hitAt3: 1, recallAt3: 0.666667 });
});

test("keeps same document IDs in different tenants distinct", () => {
  const parents = topThreeParents([scored("one", "a", "1", 0.9), scored("two", "a", "2", 0.8)]);
  assert.equal(parents.length, 2);
  assert.deepEqual(evaluateParents(parents, new Set([parentKey("two", "a")])),
    { hitAt1: 0, hitAt3: 1, recallAt3: 1 });
});

test("reports misses and rejects empty judgments or missing tenants", () => {
  assert.deepEqual(evaluateParents([], new Set([parentKey("shop", "a")])),
    { hitAt1: 0, hitAt3: 0, recallAt3: 0 });
  assert.throws(() => evaluateParents([], new Set()), /must not be empty/);
  assert.throws(() => topThreeParents([scored("", "a", "1", 1)]), /tenant/);
});
