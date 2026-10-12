const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const EMBEDDING_MODEL = "all-minilm:latest";

/** Resolves the installed model's content digest, never its mutable tag. */
export async function resolveEmbeddingRevision(): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama model metadata request failed with HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error("Cannot resolve embedding revision: invalid Ollama model metadata");
  }
  const matches = payload.models.filter(
    (model: unknown): model is Record<string, unknown> =>
      isRecord(model) && model.name === EMBEDDING_MODEL,
  );
  const digest = matches[0]?.digest;
  if (matches.length !== 1 || typeof digest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Cannot resolve immutable revision for installed ${EMBEDDING_MODEL}: expected one model with a SHA-256 digest`);
  }
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
}

type EmbeddingResponse = Readonly<{
  model: string;
  embeddings: readonly (readonly number[])[];
}>;

export async function embed(input: readonly string[]): Promise<readonly number[][]> {
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
