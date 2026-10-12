import type { ScoredChunk } from "../retrieval/exact-chunk-search.js";

export type RankedParent = Readonly<{
  tenant: string;
  parentDocumentId: string;
  firstChunkId: string;
  score: number;
}>;

export function parentKey(tenant: string, documentId: string): string {
  return JSON.stringify([tenant, documentId]);
}

/** Deduplicate the complete ranking before reserving three document slots. */
export function topThreeParents(ranked: readonly ScoredChunk[]): readonly RankedParent[] {
  const seen = new Set<string>();
  const parents: RankedParent[] = [];
  for (const { record, score } of ranked) {
    const tenant = record.chunk.metadata.tenant;
    if (typeof tenant !== "string" || tenant.trim().length === 0) {
      throw new Error("A tenant is required for parent ranking");
    }
    const parentDocumentId = record.chunk.parentDocumentId;
    const key = parentKey(tenant, parentDocumentId);
    if (seen.has(key)) continue;
    seen.add(key);
    parents.push({ tenant, parentDocumentId, firstChunkId: record.chunk.chunkId, score });
  }
  return parents.slice(0, 3);
}

export function evaluateParents(
  parents: readonly RankedParent[],
  relevantKeys: ReadonlySet<string>,
) {
  if (relevantKeys.size === 0) throw new Error("Relevant parent judgments must not be empty");
  const keys = parents.slice(0, 3).map(({ tenant, parentDocumentId }) => parentKey(tenant, parentDocumentId));
  const matches = new Set(keys.filter((key) => relevantKeys.has(key)));
  return {
    hitAt1: keys[0] !== undefined && relevantKeys.has(keys[0]) ? 1 : 0,
    hitAt3: matches.size > 0 ? 1 : 0,
    recallAt3: roundMetric(matches.size / relevantKeys.size),
  };
}

export function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
