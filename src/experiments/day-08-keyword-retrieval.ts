import {
  loadRetrievalCorpus,
  preview,
  tokenize,
  type RetrievalDocument,
} from "./day-08-retrieval-corpus.js";

const MAX_RESULTS = 3;

type SearchResult = Readonly<{
  document: RetrievalDocument;
  score: number;
}>;

const query = process.argv.slice(2).join(" ").trim();

if (query.length === 0) {
  console.error(
    'Usage: npm run experiment:keyword-retrieval -- "net revenue"',
  );
  process.exitCode = 1;
} else {
  const documents = await loadRetrievalCorpus();

  const results = search(documents, query);
  if (results.length === 0) {
    console.log("No matching documents.");
  } else {
    for (const { document, score } of results) {
      console.log(`document_id: ${document.documentId}`);
      console.log(`title: ${document.title}`);
      console.log(`score: ${score}`);
      console.log(`preview: ${preview(document.body)}`);
      console.log();
    }
  }
}

function search(
  documents: readonly RetrievalDocument[],
  searchQuery: string,
): readonly SearchResult[] {
  const distinctQueryWords = new Set(tokenize(searchQuery));

  return documents
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
    .slice(0, MAX_RESULTS);
}
