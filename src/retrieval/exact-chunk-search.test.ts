import assert from "node:assert/strict";
import test from "node:test";

import { createChunkEmbedding, type VectorEmbedding } from "./chunk-embedding.js";
import { exactChunkSearch } from "./exact-chunk-search.js";

const query: VectorEmbedding = {
  vector: [1, 0],
  embeddingModel: "synthetic-model",
  embeddingRevision: "synthetic-revision-1",
  dimension: 2,
};

function chunk(chunkId: string, vector: readonly number[]) {
  return createChunkEmbedding({
    ...query, vector,
    chunk: {
      chunkId, parentDocumentId: "synthetic-policy", sourceDocumentVersion: 1,
      chunkIndex: 0, text: "Synthetic text", metadata: { tenant: "test-shop" },
    },
  });
}

test("ranks all chunks by cosine rather than magnitude without mutating input", () => {
  const records = [chunk("orthogonal", [0, 10]), chunk("opposite", [-1, 0]), chunk("aligned", [2, 0])];
  const snapshot = structuredClone(records);
  const ranked = exactChunkSearch(query, records);
  assert.deepEqual(ranked.map(({ record, score }) => [record.chunk.chunkId, score]), [
    ["aligned", 1], ["orthogonal", 0], ["opposite", -1],
  ]);
  assert.deepEqual(records, snapshot);
});

test("breaks equal-score ties by chunk ID deterministically", () => {
  assert.deepEqual(exactChunkSearch(query, [chunk("b", [2, 0]), chunk("a", [1, 0])])
    .map(({ record }) => record.chunk.chunkId), ["a", "b"]);
});

test("rejects mismatched model identifiers and immutable revisions", () => {
  const record = chunk("test", [1, 0]);
  for (const field of ["embeddingModel", "embeddingRevision"] as const) {
    assert.throws(() => exactChunkSearch(query, [{ ...record, [field]: "other" }]),
      new RegExp(`Incompatible embedding identity: ${field}`));
  }
});

test("rejects different dimensions even when each vector is individually valid", () => {
  const record = { ...chunk("test", [1, 0]), dimension: 3, vector: [1, 0, 0] };
  assert.throws(() => exactChunkSearch(query, [record]), /Incompatible embedding identity: dimension/);
});

test("rejects malformed query and chunk vectors before comparison", () => {
  assert.throws(() => exactChunkSearch({ ...query, vector: [0, 0] }, []), /non-zero magnitude/);
  assert.throws(() => exactChunkSearch(query, [{ ...chunk("test", [1, 0]), vector: [1] }]), /match dimension/);
});
