import { readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  loadRetrievalCorpus,
  tokenize,
  type RetrievalDocument,
} from "./day-08-retrieval-corpus.js";

const EXPERIMENT = "day-08-retrieval-development-evaluation-v1";
const LABEL_STATUS = "draft_for_human_review";
const EMBEDDING_MODEL = "all-minilm:latest";
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const K1 = 1.2;
const B = 0.75;
const TOP_K = 3;
const queriesUrl = new URL(
  "../../experiments/retrieval/queries.dev.json",
  import.meta.url,
);
const resultsUrl = new URL(
  "../../experiments/retrieval/results.dev.60-docs.json",
  import.meta.url,
);

const evidenceSchema = z
  .object({ document_id: z.string().min(1), excerpt: z.string().min(1) })
  .strict();
const querySchema = z
  .object({
    id: z.string().min(1),
    query: z.string().min(1),
    relevant_document_ids: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1),
    evidence: z.array(evidenceSchema).min(1),
  })
  .strict();
const queriesSchema = z.array(querySchema).length(8);

type DevelopmentQuery = z.infer<typeof querySchema>;
type Method = "keyword" | "bm25" | "embedding";
type QueryMetrics = Readonly<{
  hitAt1: 0 | 1;
  hitAt3: 0 | 1;
  recallAt3: number;
}>;
type MethodResult = QueryMetrics &
  Readonly<{ topThreeDocumentIds: readonly string[] }>;
type EvaluatedQuery = Readonly<{
  id: string;
  group: "direct" | "paraphrase";
  query: string;
  relevantDocumentIds: readonly string[];
  rationale: string;
  evidence: DevelopmentQuery["evidence"];
  methods: Readonly<Record<Method, MethodResult>>;
}>;

const documents = await loadRetrievalCorpus();
const queries = queriesSchema.parse(
  JSON.parse(await readFile(queriesUrl, "utf8")),
);
validateInputs(documents, queries);

// One document-embedding request and one batched query-embedding request.
const documentEmbeddings = await embed(
  documents.map(({ title, body }) => `${title}\n${body}`),
);
const queryEmbeddings = await embed(queries.map(({ query }) => query));
assertEmbeddingBatch(documentEmbeddings, documents.length);
assertEmbeddingBatch(queryEmbeddings, queries.length);
assertSameDimension([...documentEmbeddings, ...queryEmbeddings]);

const evaluatedQueries: EvaluatedQuery[] = queries.map((item, index) => {
  const relevantIds = new Set(item.relevant_document_ids);
  const keywordIds = keywordSearch(documents, item.query);
  const bm25Ids = bm25Search(documents, item.query);
  const embeddingIds = embeddingSearch(
    documents,
    documentEmbeddings,
    queryEmbeddings[index]!,
  );

  return {
    id: item.id,
    group: item.id.includes("-direct-") ? "direct" : "paraphrase",
    query: item.query,
    relevantDocumentIds: item.relevant_document_ids,
    rationale: item.rationale,
    evidence: item.evidence,
    methods: {
      keyword: evaluateRanking(keywordIds, relevantIds),
      bm25: evaluateRanking(bm25Ids, relevantIds),
      embedding: evaluateRanking(embeddingIds, relevantIds),
    },
  };
});

const results = {
  experiment: EXPERIMENT,
  labelStatus: LABEL_STATUS,
  corpusSize: documents.length,
  queryCount: queries.length,
  embeddingModel: EMBEDDING_MODEL,
  embeddingDimension: documentEmbeddings[0]!.length,
  bm25Parameters: { k1: K1, b: B },
  topK: TOP_K,
  summary: {
    overall: summarize(evaluatedQueries),
    direct: summarize(
      evaluatedQueries.filter(({ group }) => group === "direct"),
    ),
    paraphrase: summarize(
      evaluatedQueries.filter(({ group }) => group === "paraphrase"),
    ),
  },
  queries: evaluatedQueries,
};

await writeFile(resultsUrl, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(JSON.stringify(results, null, 2));

function keywordSearch(
  corpus: readonly RetrievalDocument[],
  query: string,
): readonly string[] {
  const distinctQueryWords = new Set(tokenize(query));
  return corpus
    .map((document) => ({
      document,
      score: [...distinctQueryWords].filter((word) => document.words.has(word))
        .length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.documentId.localeCompare(right.document.documentId),
    )
    .slice(0, TOP_K)
    .map(({ document }) => document.documentId);
}

function bm25Search(
  corpus: readonly RetrievalDocument[],
  query: string,
): readonly string[] {
  const queryTerms = [...new Set(tokenize(query))];
  const documentCount = corpus.length;
  const averageLength =
    corpus.reduce((sum, document) => sum + document.tokens.length, 0) /
    documentCount;
  const documentFrequencies = new Map(
    queryTerms.map((term) => [
      term,
      corpus.filter((document) => document.words.has(term)).length,
    ]),
  );

  return corpus
    .map((document) => {
      const termFrequencies = countTerms(document.tokens);
      const score = queryTerms.reduce((sum, term) => {
        const termFrequency = termFrequencies.get(term) ?? 0;
        if (termFrequency === 0) return sum;
        const documentFrequency = documentFrequencies.get(term)!;
        const inverseDocumentFrequency = Math.log(
          1 +
            (documentCount - documentFrequency + 0.5) /
              (documentFrequency + 0.5),
        );
        const denominator =
          termFrequency +
          K1 * (1 - B + B * (document.tokens.length / averageLength));
        return (
          sum +
          (inverseDocumentFrequency * termFrequency * (K1 + 1)) / denominator
        );
      }, 0);
      return { document, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.documentId.localeCompare(right.document.documentId),
    )
    .slice(0, TOP_K)
    .map(({ document }) => document.documentId);
}

function embeddingSearch(
  corpus: readonly RetrievalDocument[],
  embeddings: readonly (readonly number[])[],
  queryEmbedding: readonly number[],
): readonly string[] {
  return corpus
    .map((document, index) => ({
      document,
      score: cosineSimilarity(queryEmbedding, embeddings[index]!),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.documentId.localeCompare(right.document.documentId),
    )
    .slice(0, TOP_K)
    .map(({ document }) => document.documentId);
}

function evaluateRanking(
  ids: readonly string[],
  relevantIds: ReadonlySet<string>,
): MethodResult {
  const relevantRetrieved = new Set(ids.filter((id) => relevantIds.has(id)));
  return {
    topThreeDocumentIds: ids,
    hitAt1: ids[0] !== undefined && relevantIds.has(ids[0]) ? 1 : 0,
    hitAt3: relevantRetrieved.size > 0 ? 1 : 0,
    recallAt3: round(relevantRetrieved.size / relevantIds.size),
  };
}

function summarize(items: readonly EvaluatedQuery[]) {
  return Object.fromEntries(
    (["keyword", "bm25", "embedding"] as const).map((method) => [
      method,
      {
        hitAt1: average(items.map(({ methods }) => methods[method].hitAt1)),
        hitAt3: average(items.map(({ methods }) => methods[method].hitAt3)),
        recallAt3: average(
          items.map(({ methods }) => methods[method].recallAt3),
        ),
      },
    ]),
  ) as Record<Method, QueryMetrics>;
}

function average(values: readonly number[]): number {
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function countTerms(tokens: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
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
  if (!isRecord(payload) || !Array.isArray(payload.embeddings)) {
    throw new Error("Ollama returned an invalid embedding response");
  }
  const embeddings = payload.embeddings;
  if (
    !embeddings.every(
      (embedding) =>
        Array.isArray(embedding) &&
        embedding.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
  ) {
    throw new Error("Ollama returned invalid embedding vectors");
  }
  return embeddings;
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (denominator === 0) throw new Error("Cannot compare a zero vector");
  return dotProduct / denominator;
}

function assertEmbeddingBatch(
  embeddings: readonly (readonly number[])[],
  expectedCount: number,
): void {
  if (embeddings.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} embeddings, received ${embeddings.length}`);
  }
}

function assertSameDimension(
  embeddings: readonly (readonly number[])[],
): void {
  const dimension = embeddings[0]?.length;
  if (!dimension || embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Embeddings must have one non-zero shared dimension");
  }
}

function validateInputs(
  corpus: readonly RetrievalDocument[],
  developmentQueries: readonly DevelopmentQuery[],
): void {
  if (corpus.length !== 60) throw new Error(`Expected 60 documents, received ${corpus.length}`);
  const ids = new Set(corpus.map(({ documentId }) => documentId));
  for (const item of developmentQueries) {
    for (const id of item.relevant_document_ids) {
      if (!ids.has(id)) throw new Error(`${item.id} references unknown document ${id}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
