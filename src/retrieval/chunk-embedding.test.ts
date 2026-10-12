import assert from "node:assert/strict";
import test from "node:test";

import { createChunkEmbedding, type ChunkEmbedding } from "./chunk-embedding.js";

function fixture(): ChunkEmbedding {
  return {
    chunk: {
      chunkId: "chunk-test",
      parentDocumentId: "policy-test",
      sourceDocumentVersion: 7,
      chunkIndex: 0,
      text: "Synthetic policy text.",
      metadata: { tenant: "test-shop", source: "synthetic", title: "Policy" },
    },
    vector: [3, -4, 0],
    embeddingModel: "synthetic-model:latest",
    embeddingRevision: "synthetic-immutable-revision-1",
    dimension: 3,
  };
}

test("preserves chunk provenance and keeps embedding revision independent", () => {
  const input = fixture();
  const snapshot = structuredClone(input);
  const record = createChunkEmbedding(input);

  assert.deepEqual(record, snapshot);
  assert.deepEqual(input, snapshot);
  assert.notEqual(record.vector, input.vector);
  assert.notEqual(record.chunk, input.chunk);
  assert.notEqual(record.chunk.metadata, input.chunk.metadata);

  const revised = createChunkEmbedding({ ...input, embeddingRevision: "revision-2" });
  assert.equal(revised.chunk.sourceDocumentVersion, 7);
  assert.equal(revised.embeddingRevision, "revision-2");
});

test("rejects empty vectors and dimension mismatches", () => {
  assert.throws(() => createChunkEmbedding({ ...fixture(), vector: [] }), /empty/);
  assert.throws(() => createChunkEmbedding({ ...fixture(), vector: [1, 2] }), /match dimension/);
});

test("rejects invalid declared dimensions", () => {
  for (const dimension of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createChunkEmbedding({ ...fixture(), dimension }), /positive safe integer/);
  }
});

test("rejects non-finite components and sparse vectors", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => createChunkEmbedding({ ...fixture(), vector: [1, value, 0] }), /finite/);
  }
  const sparse: number[] = [];
  sparse.length = 3;
  sparse[0] = 1;
  assert.throws(() => createChunkEmbedding({ ...fixture(), vector: sparse }), /finite/);
});

test("rejects zero-magnitude vectors including negative zero", () => {
  assert.throws(() => createChunkEmbedding({ ...fixture(), vector: [0, -0, 0] }), /non-zero magnitude/);
});

test("accepts finite non-zero components without magnitude underflow or overflow", () => {
  for (const value of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.deepEqual(createChunkEmbedding({ ...fixture(), vector: [value, 0, 0] }).vector, [value, 0, 0]);
  }
});

test("requires explicit model and revision identifiers", () => {
  assert.throws(() => createChunkEmbedding({ ...fixture(), embeddingModel: " " }), /embeddingModel/);
  assert.throws(() => createChunkEmbedding({ ...fixture(), embeddingRevision: " " }), /explicit embeddingRevision/);
  assert.throws(() => createChunkEmbedding({ ...fixture(), embeddingRevision: "synthetic-model:latest" }), /separate/);
});
