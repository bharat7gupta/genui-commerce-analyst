import { cosineSimilarity } from "../retrieval/cosine-similarity.js";
import { embed, EMBEDDING_MODEL } from "../ai/ollama-embedding.js";
import {
  loadRetrievalCorpus,
  preview,
  type RetrievalDocument,
} from "./day-08-retrieval-corpus.js";

const MAX_RESULTS = 3;

type EmbeddingResult = Readonly<{
  document: RetrievalDocument;
  similarity: number;
}>;

const query = process.argv.slice(2).join(" ").trim();

if (query.length === 0) {
  console.error(
    'Usage: npm run experiment:embedding-retrieval -- "net revenue"',
  );
  process.exitCode = 1;
} else {
  const documents = await loadRetrievalCorpus();
  const documentEmbeddings = await embed(
    documents.map(({ title, body }) => `${title}\n${body}`),
  );
  const [queryEmbedding] = await embed([query]);

  if (queryEmbedding === undefined) {
    throw new Error("Ollama returned no query embedding");
  }

  assertEmbeddingBatch(documentEmbeddings, documents.length);
  assertSameDimension([...documentEmbeddings, queryEmbedding]);

  const sampleEmbedding = documentEmbeddings[0]!;
  console.log(`embedding_model: ${EMBEDDING_MODEL}`);
  console.log(`vector_dimension: ${sampleEmbedding.length}`);
  console.log(`sample_document_id: ${documents[0]!.documentId}`);
  console.log(
    `sample_vector_first_five: ${JSON.stringify(sampleEmbedding.slice(0, 5))}`,
  );
  console.log();

  const results = documents
    .map(
      (document, index): EmbeddingResult => ({
        document,
        similarity: cosineSimilarity(
          queryEmbedding,
          documentEmbeddings[index]!,
        ),
      }),
    )
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.document.documentId.localeCompare(right.document.documentId),
    )
    .slice(0, MAX_RESULTS);

  for (const { document, similarity } of results) {
    console.log(`document_id: ${document.documentId}`);
    console.log(`title: ${document.title}`);
    console.log(`similarity: ${similarity.toFixed(6)}`);
    console.log(`preview: ${preview(document.body)}`);
    console.log();
  }
}

function assertEmbeddingBatch(
  embeddings: readonly (readonly number[])[],
  expectedCount: number,
): void {
  if (embeddings.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} document embeddings, received ${embeddings.length}`,
    );
  }
}

function assertSameDimension(
  embeddings: readonly (readonly number[])[],
): void {
  const dimension = embeddings[0]?.length;
  if (dimension === undefined || dimension === 0) {
    throw new Error("Ollama returned an empty embedding vector");
  }

  if (embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Ollama returned embeddings with inconsistent dimensions");
  }
}
