import {
  loadRetrievalCorpus,
  preview,
  tokenize,
  type RetrievalDocument,
} from "./day-08-retrieval-corpus.js";

const K1 = 1.2;
const B = 0.75;
const MAX_RESULTS = 3;

type TermContribution = Readonly<{
  term: string;
  contribution: number;
}>;

type Bm25Result = Readonly<{
  document: RetrievalDocument;
  score: number;
  termContributions: readonly TermContribution[];
}>;

const query = process.argv.slice(2).join(" ").trim();

if (query.length === 0) {
  console.error('Usage: npm run experiment:bm25-retrieval -- "net revenue"');
  process.exitCode = 1;
} else {
  const documents = await loadRetrievalCorpus();
  const results = searchBm25(documents, query);

  if (results.length === 0) {
    console.log("No matching documents.");
  } else {
    for (const { document, score, termContributions } of results) {
      console.log(`document_id: ${document.documentId}`);
      console.log(`title: ${document.title}`);
      console.log(`score: ${score.toFixed(6)}`);
      console.log("matched_terms:");
      for (const { term, contribution } of termContributions) {
        console.log(`  ${term}: ${contribution.toFixed(6)}`);
      }
      console.log(`preview: ${preview(document.body)}`);
      console.log();
    }
  }
}

function searchBm25(
  documents: readonly RetrievalDocument[],
  searchQuery: string,
): readonly Bm25Result[] {
  const queryTerms = [...new Set(tokenize(searchQuery))];
  const documentCount = documents.length;
  const averageLength =
    documents.reduce((sum, document) => sum + document.tokens.length, 0) /
    documentCount;
  const documentFrequencies = new Map(
    queryTerms.map((term) => [
      term,
      documents.filter((document) => document.words.has(term)).length,
    ]),
  );

  return documents
    .map((document): Bm25Result => {
      const termFrequencies = countTerms(document.tokens);
      const termContributions = queryTerms.flatMap((term) => {
        const termFrequency = termFrequencies.get(term) ?? 0;
        if (termFrequency === 0) return [];

        const documentFrequency = documentFrequencies.get(term)!;
        const inverseDocumentFrequency = Math.log(
          1 +
            (documentCount - documentFrequency + 0.5) /
              (documentFrequency + 0.5),
        );
        const lengthNormalization =
          termFrequency +
          K1 * (1 - B + B * (document.tokens.length / averageLength));

        return [
          {
            term,
            contribution:
              (inverseDocumentFrequency * termFrequency * (K1 + 1)) /
              lengthNormalization,
          },
        ];
      });

      return {
        document,
        score: termContributions.reduce(
          (sum, { contribution }) => sum + contribution,
          0,
        ),
        termContributions,
      };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.documentId.localeCompare(right.document.documentId),
    )
    .slice(0, MAX_RESULTS);
}

function countTerms(tokens: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
