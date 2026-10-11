import {
  loadRetrievalCorpus,
  preview,
  type RetrievalDocument,
} from "./day-08-retrieval-corpus.js";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const EMBEDDING_MODEL = "all-minilm:latest";
const MAX_RESULTS = 3;

type EmbeddingResponse = Readonly<{
  model: string;
  embeddings: readonly (readonly number[])[];
}>;

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

async function embed(input: readonly string[]): Promise<readonly number[][]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama embedding request failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const payload: unknown = await response.json();
  if (!isEmbeddingResponse(payload)) {
    throw new Error("Ollama returned an invalid embedding response");
  }

  return payload.embeddings.map((embedding) => [...embedding]);
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dotProduct = 0;
  let leftSquaredMagnitude = 0;
  let rightSquaredMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dotProduct += leftValue * rightValue;
    leftSquaredMagnitude += leftValue * leftValue;
    rightSquaredMagnitude += rightValue * rightValue;
  }

  const denominator =
    Math.sqrt(leftSquaredMagnitude) * Math.sqrt(rightSquaredMagnitude);
  if (denominator === 0) {
    throw new Error("Cannot compute cosine similarity for a zero vector");
  }

  return dotProduct / denominator;
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

function isEmbeddingResponse(value: unknown): value is EmbeddingResponse {
  if (!isRecord(value) || typeof value.model !== "string") return false;
  if (!Array.isArray(value.embeddings)) return false;

  return value.embeddings.every(
    (embedding) =>
      Array.isArray(embedding) &&
      embedding.every(
        (item) => typeof item === "number" && Number.isFinite(item),
      ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
