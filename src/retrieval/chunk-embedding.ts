import type { DocumentChunk } from "./document-chunker.js";

export type VectorEmbedding = Readonly<{
  vector: readonly number[];
  embeddingModel: string;
  /**
   * An immutable model revision or artifact digest supplied by the caller.
   * A mutable model tag is insufficient; this is independent of the chunk's
   * sourceDocumentVersion. Local validation cannot verify provider provenance.
   */
  embeddingRevision: string;
  dimension: number;
}>;

export type ChunkEmbedding = VectorEmbedding & Readonly<{ chunk: DocumentChunk }>;

/** Shared validation for query vectors and chunk vectors. */
export function validateVectorEmbedding(record: VectorEmbedding): void {
  if (record.embeddingModel.trim().length === 0) {
    throw new Error("embeddingModel must not be empty");
  }
  if (record.embeddingRevision.trim().length === 0) {
    throw new Error("An explicit embeddingRevision is required");
  }
  if (record.embeddingRevision.trim() === record.embeddingModel.trim()) {
    throw new Error("embeddingRevision must be separate from the model identifier");
  }
  if (!Number.isSafeInteger(record.dimension) || record.dimension < 1) {
    throw new Error("dimension must be a positive safe integer");
  }
  if (record.vector.length === 0) {
    throw new Error("Embedding vector must not be empty");
  }
  if (record.vector.length !== record.dimension) {
    throw new Error("Embedding vector length must match dimension");
  }
  // Iteration also rejects sparse arrays, whose missing elements are undefined.
  let hasNonZeroComponent = false;
  for (const value of record.vector) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector components must be finite numbers");
    }
    if (value !== 0) hasNonZeroComponent = true;
  }
  // Avoid squaring components: tiny valid values can underflow to zero.
  if (!hasNonZeroComponent) {
    throw new Error("Embedding vector must have non-zero magnitude");
  }

}

/** Validates a record and copies its vector and chunk metadata. */
export function createChunkEmbedding(record: ChunkEmbedding): ChunkEmbedding {
  validateVectorEmbedding(record);
  return {
    ...record,
    chunk: { ...record.chunk, metadata: { ...record.chunk.metadata } },
    vector: [...record.vector],
  };
}
