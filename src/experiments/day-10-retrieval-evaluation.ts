import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { z } from "zod";

import { embed, EMBEDDING_MODEL, resolveEmbeddingRevision } from "../ai/ollama-embedding.js";
import { evaluateParents, parentKey, roundMetric, topThreeParents } from "../evals/day-10-parent-ranking.js";
import { createChunkEmbedding, validateVectorEmbedding, type VectorEmbedding } from "../retrieval/chunk-embedding.js";
import { chunkDocument } from "../retrieval/document-chunker.js";
import { exactChunkSearch } from "../retrieval/exact-chunk-search.js";
import { loadRetrievalCorpus } from "./day-08-retrieval-corpus.js";

const experiment = "day-10-chunk-retrieval-development-v1";
const tenant = "demo-commerce";
const dimension = 384;
const configuration = { maxCharacters: 700, overlapCharacters: 0 } as const;
const root = new URL("../../", import.meta.url);
const labelsPath = "experiments/retrieval/queries.dev.json";
const baselinePath = "experiments/retrieval/results.dev.60-docs.json";
const corpusPath = "experiments/retrieval/corpus/";
const nonEmpty = z.string().trim().min(1);
const querySchema = z.object({
  id: nonEmpty, query: z.string().min(1),
  relevant_document_ids: z.array(nonEmpty).min(1), rationale: z.string().min(1),
  evidence: z.array(z.object({ document_id: nonEmpty, excerpt: z.string().min(1) }).strict()).min(1),
}).strict();
const metricsSchema = z.object({ hitAt1: z.union([z.literal(0), z.literal(1)]),
  hitAt3: z.union([z.literal(0), z.literal(1)]), recallAt3: z.number().min(0).max(1) });
const baselineSchema = z.object({
  corpusSize: z.literal(60), queryCount: z.literal(8), topK: z.literal(3),
  embeddingModel: z.literal(EMBEDDING_MODEL), embeddingDimension: z.literal(dimension),
  labelStatus: nonEmpty,
  queries: z.array(z.object({
    id: nonEmpty, query: z.string(), relevantDocumentIds: z.array(nonEmpty),
    methods: z.object({ embedding: metricsSchema.extend({ topThreeDocumentIds: z.array(nonEmpty).length(3) }) }),
  })).length(8),
});

type EvaluatedQuery = Readonly<{
  id: string;
  query: string;
  group: string;
  relevantDocumentIds: readonly string[];
  day10: ReturnType<typeof evaluateParents> & Readonly<{ parents: ReturnType<typeof topThreeParents> }>;
  day8Embedding: z.infer<typeof baselineSchema>["queries"][number]["methods"]["embedding"];
  queryEmbeddingLatencyMs: number;
  searchLatencyMs: number;
  chunkRanking: readonly Readonly<{ chunkId: string; tenant: string; parentDocumentId: string; score: number }>[];
}>;

// Freeze source/data checksums and validate every input before the first call.
const corpusFiles = (await readdir(new URL(corpusPath, root))).filter((name) => name.endsWith(".md")).sort();
const frozenPaths = [labelsPath, baselinePath, ...corpusFiles.map((name) => corpusPath + name),
  "src/experiments/day-10-retrieval-evaluation.ts", "src/experiments/day-08-retrieval-corpus.ts",
  "src/ai/ollama-embedding.ts", "src/retrieval/document-chunker.ts", "src/retrieval/chunk-embedding.ts",
  "src/retrieval/exact-chunk-search.ts", "src/retrieval/cosine-similarity.ts", "src/evals/day-10-parent-ranking.ts"];
const before = await checksums();
const queries = z.array(querySchema).length(8).parse(JSON.parse(await readFile(new URL(labelsPath, root), "utf8")));
const baseline = baselineSchema.parse(JSON.parse(await readFile(new URL(baselinePath, root), "utf8")));
const documents = await loadRetrievalCorpus();
if (documents.length !== 60) throw new Error(`Expected 60 documents, received ${documents.length}`);
if (new Set(queries.map(({ id }) => id)).size !== 8 || new Set(baseline.queries.map(({ id }) => id)).size !== 8) {
  throw new Error("Development query IDs must be unique");
}
const metadata = new Map<string, { tenant: string; version: number; source: string; effectiveDate: string }>();
for (const name of corpusFiles) {
  const raw = await readFile(new URL(corpusPath + name, root), "utf8");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1];
  if (frontMatter === undefined) throw new Error(`Missing front matter in ${name}`);
  const field = (key: string) => {
    const value = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(frontMatter)?.[1]?.trim();
    if (!value) throw new Error(`Missing ${key} in ${name}`);
    return value;
  };
  const id = field("document_id");
  const versionText = field("version");
  if (!/^\d+$/.test(versionText)) throw new Error(`Invalid version in ${name}`);
  const version = z.number().int().positive().safe().parse(Number(versionText));
  const sourceTenant = field("tenant");
  if (sourceTenant !== tenant || metadata.has(id)) throw new Error(`Invalid tenant or duplicate ID in ${name}`);
  metadata.set(id, { tenant: sourceTenant, version, source: field("source"), effectiveDate: field("effective_date") });
}
const documentIds = new Set(documents.map(({ documentId }) => documentId));
for (const query of queries) {
  if (new Set(query.relevant_document_ids).size !== query.relevant_document_ids.length) {
    throw new Error(`Duplicate judgments in ${query.id}`);
  }
  for (const id of query.relevant_document_ids) {
    if (!documentIds.has(id)) throw new Error(`${query.id} references missing ${id}`);
  }
  const saved = baseline.queries.find(({ id }) => id === query.id);
  if (!saved || saved.query !== query.query || JSON.stringify(saved.relevantDocumentIds) !== JSON.stringify(query.relevant_document_ids)) {
    throw new Error(`Saved Day 8 judgments/query differ for ${query.id}`);
  }
  if (new Set(saved.methods.embedding.topThreeDocumentIds).size !== 3 ||
      saved.methods.embedding.topThreeDocumentIds.some((id) => !documentIds.has(id))) {
    throw new Error(`Invalid saved Day 8 ranking for ${query.id}`);
  }
}
const chunks = documents.flatMap(({ documentId, title, body }) => {
  const source = metadata.get(documentId);
  if (!source) throw new Error(`Missing metadata for ${documentId}`);
  const result = chunkDocument({ documentId, version: source.version, text: `${title}\n${body}`,
    metadata: { tenant: source.tenant, source: source.source, effectiveDate: source.effectiveDate, title } }, configuration);
  if (result.length === 0) throw new Error(`No chunks for ${documentId}`);
  return result;
});
const revision = await resolveEmbeddingRevision();
const startedAt = new Date().toISOString();
const directory = new URL(`results/day-10-retrieval-development-${startedAt.replace(/[:.]/g, "-")}/`, root);
await mkdir(directory); // Exclusive directory and file creation preserve earlier runs.
const invocationsUrl = new URL("invocations.jsonl", directory);
await writeFile(invocationsUrl, "", { flag: "wx" });
await writeFile(new URL("protocol.json", directory), JSON.stringify({ experiment, startedAt, before,
  embeddingModel: EMBEDDING_MODEL, embeddingRevision: revision, dimension, chunking: configuration,
  encoding: "title + newline + body; chunk text only; unchanged Day 8 adapter request defaults",
  tenant, documentCount: documents.length, chunkCount: chunks.length, topK: 3,
  parentRule: "rank all chunks; deduplicate tenant + parent ID in ranked order; take three",
  retries: 0 }, null, 2) + "\n", { flag: "wx" });

async function recordedEmbed(caseId: string, input: readonly string[]) {
  const started = performance.now();
  let output: readonly number[][] | null = null;
  try {
    if (await resolveEmbeddingRevision() !== revision) throw new Error("Embedding revision changed before call");
    const embeddingStart = performance.now();
    output = await embed(input);
    const embeddingLatencyMs = performance.now() - embeddingStart;
    if (output.length !== input.length) throw new Error(`Expected ${input.length} embeddings, received ${output.length}`);
    for (const vector of output) validateVectorEmbedding(identity(vector));
    if (await resolveEmbeddingRevision() !== revision) throw new Error("Embedding revision changed after call");
    await appendFile(invocationsUrl, JSON.stringify({ experiment, caseId, repetition: 1,
      model: EMBEDDING_MODEL, revision, dimension, inputHashes: input.map(hash), returnedEmbeddings: output,
      embeddingLatencyMs, usage: null, requestId: null, error: null }) + "\n");
    return { vectors: output, embeddingLatencyMs };
  } catch (error) {
    await appendFile(invocationsUrl, JSON.stringify({ experiment, caseId, repetition: 1,
      model: EMBEDDING_MODEL, revision, dimension, inputHashes: input.map(hash), returnedEmbeddings: output,
      elapsedMs: performance.now() - started, usage: null, requestId: null,
      error: error instanceof Error ? error.message : String(error) }) + "\n");
    throw error;
  }
}

function identity(vector: readonly number[]): VectorEmbedding {
  return { vector, embeddingModel: EMBEDDING_MODEL, embeddingRevision: revision, dimension };
}
console.log(`Embedding ${documents.length} documents as ${chunks.length} chunks once; ${queries.length} queries.`);
const chunkBatch = await recordedEmbed("corpus-chunks", chunks.map(({ text }) => text));
const records = chunks.map((chunk, index) => {
  const vector = chunkBatch.vectors[index];
  if (!vector) throw new Error(`Missing vector for ${chunk.chunkId}`);
  return createChunkEmbedding({ ...identity(vector), chunk });
});
const evaluated: EvaluatedQuery[] = [];
for (const item of queries) {
  const queryBatch = await recordedEmbed(item.id, [item.query]);
  const vector = queryBatch.vectors[0];
  if (!vector) throw new Error(`Missing query vector for ${item.id}`);
  const searchStarted = performance.now();
  const ranked = exactChunkSearch(identity(vector), records);
  const parents = topThreeParents(ranked);
  const searchLatencyMs = performance.now() - searchStarted;
  const relevant = new Set(item.relevant_document_ids.map((id) => parentKey(tenant, id)));
  // Judgments enter only here, after embedding and ranking.
  const metrics = evaluateParents(parents, relevant);
  const saved = baseline.queries.find(({ id }) => id === item.id);
  if (!saved) throw new Error(`Missing baseline for ${item.id}`);
  const result = { id: item.id, query: item.query,
    group: item.id.includes("-direct-") ? "direct" : "paraphrase",
    relevantDocumentIds: item.relevant_document_ids,
    day10: { parents, ...metrics }, day8Embedding: saved.methods.embedding,
    queryEmbeddingLatencyMs: queryBatch.embeddingLatencyMs, searchLatencyMs,
    chunkRanking: ranked.map(({ record, score }) => ({ chunkId: record.chunk.chunkId,
      tenant, parentDocumentId: record.chunk.parentDocumentId, score })) };
  evaluated.push(result);
  await writeFile(new URL(`${item.id}.json`, directory), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ id: item.id, day10: parents.map(({ parentDocumentId }) => parentDocumentId),
    day8: saved.methods.embedding.topThreeDocumentIds, ...metrics }));
}
const after = await checksums();
if (JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(corpusFiles) !== JSON.stringify((await readdir(new URL(corpusPath, root))).filter((name) => name.endsWith(".md")).sort())) {
  throw new Error("Frozen source or corpus/labels/baseline changed during evaluation");
}
function summarize(items: typeof evaluated, method: "day10" | "day8Embedding") {
  const average = (key: "hitAt1" | "hitAt3" | "recallAt3") =>
    roundMetric(items.reduce((sum, item) => sum + item[method][key], 0) / items.length);
  return { hitAt1: average("hitAt1"), hitAt3: average("hitAt3"), recallAt3: average("recallAt3") };
}
const summary = {
  day10: summarize(evaluated, "day10"), day8Embedding: summarize(evaluated, "day8Embedding"),
  direct: { day10: summarize(evaluated.filter(({ group }) => group === "direct"), "day10"),
    day8Embedding: summarize(evaluated.filter(({ group }) => group === "direct"), "day8Embedding") },
  paraphrase: { day10: summarize(evaluated.filter(({ group }) => group === "paraphrase"), "day10"),
    day8Embedding: summarize(evaluated.filter(({ group }) => group === "paraphrase"), "day8Embedding") },
};
const report = { experiment, startedAt, completedAt: new Date().toISOString(), tenant,
  documentCount: documents.length, chunkCount: chunks.length, queryCount: queries.length,
  embeddingModel: EMBEDDING_MODEL, embeddingRevision: revision, dimension, chunking: configuration,
  chunkEmbeddingLatencyMs: chunkBatch.embeddingLatencyMs, topK: 3, labelStatus: baseline.labelStatus,
  baselinePath, baselineRevision: null, checksumsBefore: before, checksumsAfter: after,
  limitations: ["Eight exposed development queries; synthetic corpus content; no held-out evaluation",
    "Unchanged overlapping and partial-answer labels, including the previously documented inconsistency",
    "Document-level metrics do not establish chunk evidence completeness",
    "No chunk-size tuning; 700 characters is not evaluated as optimal",
    "Day 8 saved artifact records no immutable model revision; identical weights across runs are not established",
    "Metadata checks detect observed model changes but do not atomically pin concurrent model updates"],
  summary, chunks, queries: evaluated };
await writeFile(new URL("report.json", directory), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ summary, resultFile: new URL("report.json", directory).pathname }, null, 2));

function hash(content: string): string { return createHash("sha256").update(content).digest("hex"); }
async function checksums() {
  return Object.fromEntries(await Promise.all(frozenPaths.map(async (path) =>
    [path, hash(await readFile(new URL(path, root), "utf8"))] as const)));
}
