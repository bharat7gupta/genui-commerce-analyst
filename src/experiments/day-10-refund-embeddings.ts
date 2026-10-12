import { performance } from "node:perf_hooks";

import { embed, EMBEDDING_MODEL, resolveEmbeddingRevision } from "../ai/ollama-embedding.js";
import { createChunkEmbedding, type ChunkEmbedding } from "../retrieval/chunk-embedding.js";
import { chunkDocument } from "../retrieval/document-chunker.js";
import { refundPolicyFixture } from "../retrieval/day-09-refund-policy-fixture.js";


export type RefundChunkEmbedding = Readonly<{ record: ChunkEmbedding; embeddingLatencyMs: number }>;

export async function embedRefundChunks(): Promise<readonly RefundChunkEmbedding[]> {
  // Fixed for this demonstration: Day 8's local endpoint/model and embed request
  // defaults, unmodified chunk text, native 384 dimensions, and no retries.
  const dimension = 384;
  const chunks = chunkDocument(refundPolicyFixture, {
    maxCharacters: 700,
    overlapCharacters: 0,
  });
  if (chunks.length !== 2) {
    throw new Error(`Expected two refund fixture chunks, received ${chunks.length}`);
  }

  const revision = await resolveEmbeddingRevision();
  const results: RefundChunkEmbedding[] = [];
  for (const chunk of chunks) {
    const startedAt = performance.now();
    const vectors = await embed([chunk.text]);
    const latencyMs = performance.now() - startedAt;
    const vector = vectors[0];
    if (vectors.length !== 1 || vector === undefined) {
      throw new Error(`Expected one embedding for ${chunk.chunkId}, received ${vectors.length}`);
    }
    if (await resolveEmbeddingRevision() !== revision) {
      throw new Error("Installed embedding model revision changed during the demonstration");
    }
    const record = createChunkEmbedding({
      chunk,
      vector,
      embeddingModel: EMBEDDING_MODEL,
      embeddingRevision: revision,
      dimension,
    });
    results.push({ record, embeddingLatencyMs: Number(latencyMs.toFixed(3)) });
  }

  return results;
}
