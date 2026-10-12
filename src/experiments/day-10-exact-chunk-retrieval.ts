import { performance } from "node:perf_hooks";

import { embed, EMBEDDING_MODEL, resolveEmbeddingRevision } from "../ai/ollama-embedding.js";
import { validateVectorEmbedding, type VectorEmbedding } from "../retrieval/chunk-embedding.js";
import { exactChunkSearch } from "../retrieval/exact-chunk-search.js";
import { embedRefundChunks } from "./day-10-refund-embeddings.js";

const queryText = "What happens if the original payment method is closed?";
const chunks = (await embedRefundChunks()).map(({ record }) => record);
const revision = await resolveEmbeddingRevision();
const queryStartedAt = performance.now();
// Same adapter, unchanged request defaults, and text-only input as the chunks.
const vectors = await embed([queryText]);
const queryEmbeddingLatencyMs = performance.now() - queryStartedAt;
if (vectors.length !== 1 || vectors[0] === undefined) {
  throw new Error(`Expected one query embedding, received ${vectors.length}`);
}
if (await resolveEmbeddingRevision() !== revision) {
  throw new Error("Installed embedding model revision changed during query embedding");
}
const query: VectorEmbedding = {
  vector: vectors[0],
  embeddingModel: EMBEDDING_MODEL,
  embeddingRevision: revision,
  dimension: 384,
};
validateVectorEmbedding(query);
const searchStartedAt = performance.now();
const ranked = exactChunkSearch(query, chunks);
const searchLatencyMs = performance.now() - searchStartedAt;

console.log(JSON.stringify({
  query: queryText,
  embeddingModel: query.embeddingModel,
  embeddingRevision: query.embeddingRevision,
  dimension: query.dimension,
  configuration: "maxCharacters=700 overlapCharacters=0; Day 8 embed request defaults; text-only input",
  queryEmbeddingLatencyMs: Number(queryEmbeddingLatencyMs.toFixed(3)),
  searchLatencyMs: Number(searchLatencyMs.toFixed(3)),
}));
for (const [index, { record, score }] of ranked.entries()) {
  console.log(`\nrank: ${index + 1}`);
  console.log(`chunk_id: ${record.chunk.chunkId}`);
  console.log(`cosine_similarity: ${score}`);
  console.log(`text: ${record.chunk.text}`);
}
