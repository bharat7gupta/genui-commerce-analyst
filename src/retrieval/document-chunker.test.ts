import assert from "node:assert/strict";
import test from "node:test";

import { refundPolicyFixture } from "./day-09-refund-policy-fixture.js";
import {
  chunkDocument,
  type ChunkingConfiguration,
  type SourceDocument,
} from "./document-chunker.js";

const configuration: ChunkingConfiguration = {
  maxCharacters: 700,
  overlapCharacters: 0,
};

test("is repeatable, ordered, and inherits metadata", () => {
  const first = chunkDocument(refundPolicyFixture, configuration);
  const second = chunkDocument(refundPolicyFixture, {
    overlapCharacters: 0,
    maxCharacters: 700,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map(({ chunkIndex }) => chunkIndex),
    first.map((_, index) => index),
  );
  for (const chunk of first) {
    assert.equal(chunk.parentDocumentId, refundPolicyFixture.documentId);
    assert.equal(chunk.sourceDocumentVersion, refundPolicyFixture.version);
    assert.deepEqual(chunk.metadata, refundPolicyFixture.metadata);
    assert.notEqual(chunk.metadata, refundPolicyFixture.metadata);
    assert.ok(chunk.text.length <= configuration.maxCharacters);
  }
});

test("preserves all non-whitespace source text without mutating the input", () => {
  const inputSnapshot = structuredClone(refundPolicyFixture);
  const chunks = chunkDocument(refundPolicyFixture, configuration);

  assert.equal(
    removeWhitespace(chunks.map(({ text }) => text).join("")),
    removeWhitespace(refundPolicyFixture.text),
  );
  assert.deepEqual(refundPolicyFixture, inputSnapshot);
});

test("separates the refund rule from its exception at their paragraph boundary", () => {
  const chunks = chunkDocument(refundPolicyFixture, configuration);

  assert.equal(chunks.length, 2);
  assert.match(chunks[0]!.text, /^Refund rule\./);
  assert.doesNotMatch(chunks[0]!.text, /Exception\./);
  assert.match(chunks[1]!.text, /^Exception\./);
});

test("keeps a short document whole and scopes chunk identity by tenant", () => {
  const document: SourceDocument = {
    documentId: "policy-1",
    version: "v1",
    text: "A short policy remains whole.",
    metadata: {
      tenant: "tenant-a",
      effectiveDate: "2026-10-11",
      source: "test",
      title: "Short policy",
    },
  };
  const [chunk] = chunkDocument(document, configuration);
  const [otherTenantChunk] = chunkDocument(
    { ...document, metadata: { ...document.metadata, tenant: "tenant-b" } },
    configuration,
  );

  assert.equal(chunk?.text, document.text);
  assert.notEqual(chunk?.chunkId, otherTenantChunk?.chunkId);
});

test("splits an oversized paragraph at a word boundary when possible", () => {
  const chunks = chunkDocument(
    {
      documentId: "oversized",
      version: 1,
      text: "alpha beta gamma delta",
      metadata: {},
    },
    { maxCharacters: 12, overlapCharacters: 0 },
  );

  assert.deepEqual(
    chunks.map(({ text }) => text),
    ["alpha beta", "gamma delta"],
  );
});

function removeWhitespace(text: string): string {
  return text.replace(/\s/g, "");
}
