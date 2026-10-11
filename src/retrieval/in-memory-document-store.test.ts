import assert from "node:assert/strict";
import test from "node:test";

import {
  otherTenantRefundPolicyFixture,
  refundPolicyV2Fixture,
} from "./day-09-ingestion-fixtures.js";
import { refundPolicyFixture } from "./day-09-refund-policy-fixture.js";
import type {
  ChunkingConfiguration,
  SourceDocument,
} from "./document-chunker.js";
import { InMemoryDocumentStore } from "./in-memory-document-store.js";

const configuration: ChunkingConfiguration = {
  maxCharacters: 700,
  overlapCharacters: 0,
};

test("replaces complete chunk sets without duplicates and isolates tenants", () => {
  const store = new InMemoryDocumentStore(configuration);

  store.upsertDocument(refundPolicyFixture);
  const versionOneChunks = store.listChunks("demo-commerce", "refund-policy-long");
  const versionOneIds = versionOneChunks.map(({ chunkId }) => chunkId);
  assert.equal(versionOneChunks.length, 2);
  assert.deepEqual(
    versionOneChunks.map(({ chunkIndex }) => chunkIndex),
    [0, 1],
  );

  store.upsertDocument(refundPolicyFixture);
  const repeatedChunks = store.listChunks("demo-commerce", "refund-policy-long");
  assert.equal(repeatedChunks.length, 2);
  assert.deepEqual(repeatedChunks.map(({ chunkId }) => chunkId), versionOneIds);

  store.upsertDocument(refundPolicyV2Fixture);
  const versionTwoChunks = store.listChunks("demo-commerce", "refund-policy-long");
  assert.equal(versionTwoChunks.length, 1);
  assert.equal(versionTwoChunks[0]!.sourceDocumentVersion, 2);
  assert.deepEqual(versionTwoChunks[0]!.metadata, refundPolicyV2Fixture.metadata);
  assert.ok(
    versionOneIds.every(
      (id) => !versionTwoChunks.some(({ chunkId }) => chunkId === id),
    ),
  );

  store.upsertDocument(otherTenantRefundPolicyFixture);
  const otherTenantChunks = store.listChunks("other-shop", "refund-policy-long");
  assert.equal(otherTenantChunks.length, 1);
  assert.equal(otherTenantChunks[0]!.metadata.tenant, "other-shop");
  assert.equal(store.listChunks("demo-commerce", "refund-policy-long").length, 1);

  store.deleteDocument("demo-commerce", "refund-policy-long");
  assert.deepEqual(store.listChunks("demo-commerce", "refund-policy-long"), []);
  assert.deepEqual(
    store.listChunks("other-shop", "refund-policy-long"),
    otherTenantChunks,
  );
});

test("keeps current state when replacement chunk generation fails", () => {
  const store = new InMemoryDocumentStore(configuration);
  store.upsertDocument(refundPolicyFixture);
  const before = store.listChunks("demo-commerce", "refund-policy-long");

  assert.throws(
    () =>
      store.upsertDocument({
        ...refundPolicyFixture,
        version: "",
        text: "This invalid replacement must not replace the current chunks.",
      }),
    /version must not be empty/,
  );
  assert.deepEqual(
    store.listChunks("demo-commerce", "refund-policy-long"),
    before,
  );
});

test("re-indexes retained source repeatably while preserving identity and isolation", () => {
  const store = new InMemoryDocumentStore(configuration);
  const siblingDocument: SourceDocument = {
    documentId: "shipping-policy",
    version: 1,
    text: "Standard shipping takes three business days.",
    metadata: {
      tenant: "demo-commerce",
      effectiveDate: "2026-10-11",
      source: "test-fixture",
      title: "Shipping policy",
    },
  };
  store.upsertDocument(refundPolicyFixture);
  store.upsertDocument(otherTenantRefundPolicyFixture);
  store.upsertDocument(siblingDocument);
  const previousChunks = store.listChunks("demo-commerce", "refund-policy-long");
  const previousIds = previousChunks.map(({ chunkId }) => chunkId);
  const otherTenantBefore = store.listChunks("other-shop", "refund-policy-long");
  const siblingBefore = store.listChunks("demo-commerce", "shipping-policy");

  const first = store.reindexDocument("demo-commerce", "refund-policy-long", {
    maxCharacters: 1_200,
    overlapCharacters: 0,
  });
  assert.equal(first.status, "reindexed");
  if (first.status !== "reindexed") throw new Error("Expected re-indexing to succeed");
  assert.equal(first.chunks.length, 1);
  assert.match(first.chunks[0]!.text, /Refund rule\./);
  assert.match(first.chunks[0]!.text, /Exception\./);
  assert.equal(first.chunks[0]!.sourceDocumentVersion, refundPolicyFixture.version);
  assert.deepEqual(first.chunks[0]!.metadata, refundPolicyFixture.metadata);
  assert.ok(
    previousIds.every(
      (id) => !first.chunks.some(({ chunkId }) => chunkId === id),
    ),
  );
  assert.deepEqual(
    store.listChunks("other-shop", "refund-policy-long"),
    otherTenantBefore,
  );
  assert.deepEqual(
    store.listChunks("demo-commerce", "shipping-policy"),
    siblingBefore,
  );

  const second = store.reindexDocument("demo-commerce", "refund-policy-long", {
    overlapCharacters: 0,
    maxCharacters: 1_200,
  });
  assert.equal(second.status, "reindexed");
  if (second.status !== "reindexed") throw new Error("Expected re-indexing to succeed");
  assert.equal(second.chunks.length, 1);
  assert.deepEqual(
    second.chunks.map(({ chunkId }) => chunkId),
    first.chunks.map(({ chunkId }) => chunkId),
  );
});

test("reports a missing source and preserves current chunks if re-indexing fails", () => {
  const store = new InMemoryDocumentStore(configuration);
  store.upsertDocument(refundPolicyFixture);
  const before = store.listChunks("demo-commerce", "refund-policy-long");

  assert.deepEqual(
    store.reindexDocument("demo-commerce", "missing-document", {
      maxCharacters: 1_200,
      overlapCharacters: 0,
    }),
    {
      status: "not_found",
      tenant: "demo-commerce",
      documentId: "missing-document",
    },
  );
  assert.throws(
    () =>
      store.reindexDocument("demo-commerce", "refund-policy-long", {
        maxCharacters: 0,
        overlapCharacters: 0,
      }),
    /maxCharacters must be a positive safe integer/,
  );
  assert.deepEqual(
    store.listChunks("demo-commerce", "refund-policy-long"),
    before,
  );
});
