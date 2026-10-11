import { loadRetrievalCorpus } from "./day-08-retrieval-corpus.js";
import { refundPolicyFixture } from "../retrieval/day-09-refund-policy-fixture.js";
import {
  chunkDocument,
  type ChunkingConfiguration,
  type SourceDocument,
} from "../retrieval/document-chunker.js";

const configuration: ChunkingConfiguration = {
  maxCharacters: 700,
  overlapCharacters: 0,
};
const existing = (await loadRetrievalCorpus()).find(
  ({ documentId }) => documentId === "demo-commerce-dataset-seed-coverage",
);
if (existing === undefined) throw new Error("Expected Day 8 corpus document is missing");

const shortDocument: SourceDocument = {
  documentId: existing.documentId,
  version: 1,
  text: existing.body,
  metadata: {
    tenant: "demo-commerce",
    effectiveDate: "2025-08-01",
    source: "data/seed.sql",
    title: existing.title,
  },
};

console.log(JSON.stringify({ configuration, note: "Character size is not token size." }, null, 2));
printExample("existing-short-corpus-document", shortDocument);
printExample("separate-long-refund-fixture", refundPolicyFixture);

function printExample(label: string, document: SourceDocument): void {
  const chunks = chunkDocument(document, configuration);
  console.log(`\n${label}`);
  console.log(JSON.stringify(chunks, null, 2));
}
