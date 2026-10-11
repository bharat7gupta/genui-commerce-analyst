import {
  otherTenantRefundPolicyFixture,
  refundPolicyV2Fixture,
} from "../retrieval/day-09-ingestion-fixtures.js";
import { refundPolicyFixture } from "../retrieval/day-09-refund-policy-fixture.js";
import type { DocumentChunk } from "../retrieval/document-chunker.js";
import { InMemoryDocumentStore } from "../retrieval/in-memory-document-store.js";

const store = new InMemoryDocumentStore({
  maxCharacters: 700,
  overlapCharacters: 0,
});
const documentId = refundPolicyFixture.documentId;

store.upsertDocument(refundPolicyFixture);
const inserted = store.listChunks("demo-commerce", documentId);
printStage("1-insert-version-1", { chunks: summarize(inserted) });

const originalIds = inserted.map(({ chunkId }) => chunkId);
store.upsertDocument(refundPolicyFixture);
const repeated = store.listChunks("demo-commerce", documentId);
printStage("2-upsert-unchanged", {
  countUnchanged: repeated.length === inserted.length,
  idsUnchanged: equalIds(repeated, originalIds),
  chunks: summarize(repeated),
});

store.upsertDocument(refundPolicyV2Fixture);
const updated = store.listChunks("demo-commerce", documentId);
printStage("3-update-to-version-2", {
  allVersionOneChunkIdsAbsent: originalIds.every(
    (id) => !updated.some(({ chunkId }) => chunkId === id),
  ),
  chunks: summarize(updated),
});

store.upsertDocument(otherTenantRefundPolicyFixture);
printStage("4-insert-same-id-other-tenant", {
  originalTenantChunks: summarize(store.listChunks("demo-commerce", documentId)),
  otherTenantChunks: summarize(store.listChunks("other-shop", documentId)),
});

store.deleteDocument("demo-commerce", documentId);
printStage("5-delete-original-tenant", {
  originalTenantChunks: summarize(store.listChunks("demo-commerce", documentId)),
  otherTenantChunks: summarize(store.listChunks("other-shop", documentId)),
});

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

function equalIds(chunks: readonly DocumentChunk[], expectedIds: readonly string[]): boolean {
  return (
    chunks.length === expectedIds.length &&
    chunks.every(({ chunkId }, index) => chunkId === expectedIds[index])
  );
}

function printStage(label: string, value: unknown): void {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}
