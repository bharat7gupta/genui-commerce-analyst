import {
  chunkDocument,
  type ChunkingConfiguration,
  type DocumentChunk,
  type SourceDocument,
} from "./document-chunker.js";

type StoredDocument = Readonly<{
  document: SourceDocument;
  chunks: readonly DocumentChunk[];
}>;

export type ReindexDocumentResult =
  | Readonly<{
      status: "reindexed";
      chunks: readonly DocumentChunk[];
    }>
  | Readonly<{
      status: "not_found";
      tenant: string;
      documentId: string;
    }>;

export class InMemoryDocumentStore {
  readonly #configuration: ChunkingConfiguration;
  readonly #documentsByTenant = new Map<string, Map<string, StoredDocument>>();

  constructor(configuration: ChunkingConfiguration) {
    this.#configuration = { ...configuration };
  }

  upsertDocument(document: SourceDocument): void {
    this.#replaceDocument(document, this.#configuration);
  }

  reindexDocument(
    tenant: string,
    documentId: string,
    configuration: ChunkingConfiguration,
  ): ReindexDocumentResult {
    const document = this.#documentsByTenant
      .get(tenant)
      ?.get(documentId)?.document;
    if (document === undefined) {
      return { status: "not_found", tenant, documentId };
    }

    const chunks = this.#replaceDocument(document, configuration);
    return { status: "reindexed", chunks: [...chunks] };
  }

  #replaceDocument(
    document: SourceDocument,
    configuration: ChunkingConfiguration,
  ): readonly DocumentChunk[] {
    const tenant = requireTenant(document);

    // Complete chunk generation must succeed before current state is replaced.
    const chunks = chunkDocument(document, configuration);
    const storedDocument: StoredDocument = {
      document: {
        ...document,
        metadata: { ...document.metadata },
      },
      chunks,
    };

    const tenantDocuments = this.#documentsByTenant.get(tenant);
    if (tenantDocuments === undefined) {
      this.#documentsByTenant.set(
        tenant,
        new Map([[document.documentId, storedDocument]]),
      );
      return chunks;
    }

    tenantDocuments.set(document.documentId, storedDocument);
    return chunks;
  }

  deleteDocument(tenant: string, documentId: string): void {
    const tenantDocuments = this.#documentsByTenant.get(tenant);
    if (tenantDocuments === undefined) return;

    tenantDocuments.delete(documentId);
    if (tenantDocuments.size === 0) this.#documentsByTenant.delete(tenant);
  }

  listChunks(tenant: string, documentId: string): readonly DocumentChunk[] {
    const chunks = this.#documentsByTenant
      .get(tenant)
      ?.get(documentId)?.chunks;

    return chunks === undefined ? [] : [...chunks];
  }
}

function requireTenant(document: SourceDocument): string {
  const tenant = document.metadata.tenant;
  if (typeof tenant !== "string" || tenant.trim().length === 0) {
    throw new Error("A non-empty metadata.tenant is required for ingestion");
  }
  return tenant;
}
