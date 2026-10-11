import { createHash } from "node:crypto";

export type DocumentMetadata = Readonly<{
  tenant?: string;
  effectiveDate?: string;
  source?: string;
  title?: string;
  [key: string]: unknown;
}>;

export type SourceDocument = Readonly<{
  documentId: string;
  version: string | number;
  text: string;
  metadata: DocumentMetadata;
}>;

export type ChunkingConfiguration = Readonly<{
  /** Maximum JavaScript string length, measured in characters rather than tokens. */
  maxCharacters: number;
  /** Day 9 supports only deterministic, non-overlapping chunks. */
  overlapCharacters: 0;
}>;

export type DocumentChunk = Readonly<{
  chunkId: string;
  parentDocumentId: string;
  sourceDocumentVersion: string | number;
  chunkIndex: number;
  text: string;
  metadata: DocumentMetadata;
}>;

/**
 * Splits a document at paragraph boundaries when possible, falling back to
 * word boundaries and then a hard character boundary for an oversized word.
 * Character counts are not token counts and zero overlap is intentional.
 */
export function chunkDocument(
  document: SourceDocument,
  configuration: ChunkingConfiguration,
): readonly DocumentChunk[] {
  validateInput(document, configuration);

  const paragraphs = document.text
    .trim()
    .split(/\r?\n[\t ]*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const pieces = paragraphs.flatMap((paragraph) =>
    splitOversizedParagraph(paragraph, configuration.maxCharacters),
  );
  const texts = combinePieces(pieces, configuration.maxCharacters);
  const identity = JSON.stringify({
    tenant: document.metadata.tenant ?? null,
    documentId: document.documentId,
    version: document.version,
    content: document.text,
    configuration: {
      maxCharacters: configuration.maxCharacters,
      overlapCharacters: configuration.overlapCharacters,
    },
  });

  return texts.map((text, chunkIndex) => ({
    chunkId: `chunk-${createHash("sha256")
      .update(identity)
      .update("\0")
      .update(String(chunkIndex))
      .digest("hex")}`,
    parentDocumentId: document.documentId,
    sourceDocumentVersion: document.version,
    chunkIndex,
    text,
    metadata: { ...document.metadata },
  }));
}

function splitOversizedParagraph(
  paragraph: string,
  maxCharacters: number,
): readonly string[] {
  const pieces: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maxCharacters) {
    const window = remaining.slice(0, maxCharacters + 1);
    let boundary = -1;
    for (let index = Math.min(maxCharacters, window.length - 1); index > 0; index -= 1) {
      if (/\s/.test(window[index]!)) {
        boundary = index;
        break;
      }
    }

    const splitAt = boundary === -1 ? maxCharacters : boundary;
    pieces.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) pieces.push(remaining);
  return pieces;
}

function combinePieces(
  pieces: readonly string[],
  maxCharacters: number,
): readonly string[] {
  const chunks: string[] = [];

  for (const piece of pieces) {
    const current = chunks.at(-1);
    if (current === undefined) {
      chunks.push(piece);
      continue;
    }

    const combined = `${current}\n\n${piece}`;
    if (combined.length <= maxCharacters) {
      chunks[chunks.length - 1] = combined;
    } else {
      chunks.push(piece);
    }
  }

  return chunks;
}

function validateInput(
  document: SourceDocument,
  configuration: ChunkingConfiguration,
): void {
  if (document.documentId.trim().length === 0) {
    throw new Error("documentId must not be empty");
  }
  if (String(document.version).trim().length === 0) {
    throw new Error("version must not be empty");
  }
  if (!Number.isSafeInteger(configuration.maxCharacters) || configuration.maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive safe integer");
  }
  if (configuration.overlapCharacters !== 0) {
    throw new Error("Only zero overlap is supported");
  }
}
