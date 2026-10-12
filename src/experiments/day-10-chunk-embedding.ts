import { embedRefundChunks } from "./day-10-refund-embeddings.js";

console.log("revision_source: GET http://127.0.0.1:11434/api/tags → model.name → model.digest");
console.log("configuration: maxCharacters=700 overlapCharacters=0 dimension=384; Day 8 embed request defaults");
const results = await embedRefundChunks();
for (const { record, embeddingLatencyMs } of results) {
  console.log(JSON.stringify({
    chunkId: record.chunk.chunkId,
    embeddingModel: record.embeddingModel,
    embeddingRevision: record.embeddingRevision,
    dimension: record.dimension,
    textLength: record.chunk.text.length,
    embeddingLatencyMs,
  }));
}
console.log(`validated_records_in_memory: ${results.length}`);
