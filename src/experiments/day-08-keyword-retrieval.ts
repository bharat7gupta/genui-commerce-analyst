import { readFile } from "node:fs/promises";

const CORPUS_DIRECTORY = new URL(
  "../../experiments/retrieval/corpus/",
  import.meta.url,
);
const CORPUS_FILES = Object.freeze([
  "gross-revenue.md",
  "net-revenue.md",
  "refunds.md",
  "date-ranges.md",
]);
const MAX_RESULTS = 3;
const PREVIEW_LENGTH = 140;

type Document = Readonly<{
  documentId: string;
  title: string;
  body: string;
  words: ReadonlySet<string>;
}>;

type SearchResult = Readonly<{
  document: Document;
  score: number;
}>;

const query = process.argv.slice(2).join(" ").trim();

if (query.length === 0) {
  console.error(
    'Usage: npm run experiment:keyword-retrieval -- "net revenue"',
  );
  process.exitCode = 1;
} else {
  const documents = await Promise.all(CORPUS_FILES.map(loadDocument));
  assertUniqueDocumentIds(documents);

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

async function loadDocument(fileName: string): Promise<Document> {
  const markdown = await readFile(new URL(fileName, CORPUS_DIRECTORY), "utf8");
  const { documentId, content } = removeFrontMatter(markdown, fileName);
  const lines = content.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.startsWith("# "));

  if (titleIndex === -1) {
    throw new Error(`${fileName} must contain a level-one Markdown title`);
  }

  const title = lines[titleIndex]!.slice(2).trim();
  const body = lines
    .filter((_, index) => index !== titleIndex)
    .join("\n")
    .trim();

  return {
    documentId,
    title,
    body,
    words: new Set(tokenize(`${title}\n${body}`)),
  };
}

function removeFrontMatter(
  markdown: string,
  fileName: string,
): { documentId: string; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  if (!match) {
    throw new Error(`${fileName} must begin with YAML front matter`);
  }

  const documentIdMatch = /^document_id:\s*(\S+)\s*$/m.exec(match[1]!);
  if (!documentIdMatch) {
    throw new Error(`${fileName} front matter must contain document_id`);
  }

  return {
    documentId: documentIdMatch[1]!,
    content: markdown.slice(match[0].length),
  };
}

// Lowercase, then treat each contiguous ASCII letter-or-digit sequence as a
// word. Punctuation, Markdown syntax, hyphens, and underscores are separators.
function tokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function search(
  documents: readonly Document[],
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

function preview(body: string): string {
  const compactBody = body.replace(/\s+/g, " ").trim();
  return compactBody.length <= PREVIEW_LENGTH
    ? compactBody
    : `${compactBody.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

function assertUniqueDocumentIds(documents: readonly Document[]): void {
  const ids = documents.map(({ documentId }) => documentId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Corpus document_id values must be unique");
  }
}
