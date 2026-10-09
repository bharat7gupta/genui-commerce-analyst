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
const PREVIEW_LENGTH = 140;

export type RetrievalDocument = Readonly<{
  documentId: string;
  title: string;
  body: string;
  tokens: readonly string[];
  words: ReadonlySet<string>;
}>;

export async function loadRetrievalCorpus(): Promise<
  readonly RetrievalDocument[]
> {
  const documents = await Promise.all(CORPUS_FILES.map(loadDocument));
  const ids = documents.map(({ documentId }) => documentId);

  if (new Set(ids).size !== ids.length) {
    throw new Error("Corpus document_id values must be unique");
  }

  return documents;
}

// Lowercase, then treat each contiguous ASCII letter-or-digit sequence as a
// word. Punctuation, Markdown syntax, hyphens, and underscores are separators.
export function tokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function preview(body: string): string {
  const compactBody = body.replace(/\s+/g, " ").trim();
  return compactBody.length <= PREVIEW_LENGTH
    ? compactBody
    : `${compactBody.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

async function loadDocument(fileName: string): Promise<RetrievalDocument> {
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
  const tokens = tokenize(`${title}\n${body}`);

  return {
    documentId,
    title,
    body,
    tokens,
    words: new Set(tokens),
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
