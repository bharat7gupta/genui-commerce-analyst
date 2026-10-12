import {
  validateVectorEmbedding,
  type ChunkEmbedding,
  type VectorEmbedding,
} from "./chunk-embedding.js";
import { cosineSimilarity } from "./cosine-similarity.js";

export type ScoredChunk = Readonly<{ record: ChunkEmbedding; score: number }>;

/** Scores every chunk after validating the entire comparison set. */
export function exactChunkSearch(
  query: VectorEmbedding,
  chunks: readonly ChunkEmbedding[],
): readonly ScoredChunk[] {
  validateVectorEmbedding(query);
  for (const chunk of chunks) {
    validateVectorEmbedding(chunk);
    for (const field of ["embeddingModel", "embeddingRevision", "dimension"] as const) {
      if (query[field] !== chunk[field]) {
        throw new Error(`Incompatible embedding identity: ${field} differs for ${chunk.chunk.chunkId}`);
      }
    }
  }

  return chunks.map((record): ScoredChunk => {
    const score = cosineSimilarity(query.vector, record.vector);
    if (!Number.isFinite(score)) {
      throw new Error(`Non-finite cosine score for ${record.chunk.chunkId}`);
    }
    return { record, score };
  }).sort((left, right) =>
    right.score - left.score || left.record.chunk.chunkId.localeCompare(right.record.chunk.chunkId),
  );
}
