import { refundPolicyFixture } from "../retrieval/day-09-refund-policy-fixture.js";
import type { DocumentChunk } from "../retrieval/document-chunker.js";
import {
  InMemoryDocumentStore,
  type ReindexDocumentResult,
} from "../retrieval/in-memory-document-store.js";

const tenant = "demo-commerce";
const documentId = refundPolicyFixture.documentId;
const store = new InMemoryDocumentStore({
  maxCharacters: 700,
  overlapCharacters: 0,
});

store.upsertDocument(refundPolicyFixture);
const ingested = store.listChunks(tenant, documentId);
const previousIds = ingested.map(({ chunkId }) => chunkId);
printStage("1-ingest-at-700-characters", {
  count: ingested.length,
  chunks: summarize(ingested),
});

const firstResult = store.reindexDocument(tenant, documentId, {
  maxCharacters: 1_200,
  overlapCharacters: 0,
});
const firstReindex = requireSuccess(firstResult);
printStage("2-reindex-at-1200-characters", {
  count: firstReindex.length,
  containsRule: firstReindex[0]?.text.includes("Refund rule.") ?? false,
  containsException: firstReindex[0]?.text.includes("Exception.") ?? false,
  allPreviousChunkIdsAbsent: previousIds.every(
    (id) => !firstReindex.some(({ chunkId }) => chunkId === id),
  ),
  sourceVersionUnchanged:
    firstReindex[0]?.sourceDocumentVersion === refundPolicyFixture.version,
  metadataUnchanged:
    JSON.stringify(firstReindex[0]?.metadata) ===
    JSON.stringify(refundPolicyFixture.metadata),
  chunks: summarize(firstReindex),
});

const repeatedResult = store.reindexDocument(tenant, documentId, {
  overlapCharacters: 0,
  maxCharacters: 1_200,
});
const repeated = requireSuccess(repeatedResult);
printStage("3-repeat-same-reindex", {
  count: repeated.length,
  idsUnchanged:
    repeated.length === firstReindex.length &&
    repeated.every(
      ({ chunkId }, index) => chunkId === firstReindex[index]?.chunkId,
    ),
  chunks: summarize(repeated),
});

function requireSuccess(result: ReindexDocumentResult): readonly DocumentChunk[] {
  if (result.status === "not_found") {
    throw new Error(`Missing source ${result.tenant}/${result.documentId}`);
  }
  return result.chunks;
}

function summarize(chunks: readonly DocumentChunk[]) {
  return chunks.map(
    ({ chunkId, parentDocumentId, sourceDocumentVersion, chunkIndex, text, metadata }) => ({
      chunkId,
      parentDocumentId,
      sourceDocumentVersion,
      chunkIndex,
      text,
      metadata,
    }),
  );
}

function printStage(label: string, value: unknown): void {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}
