import { createHash } from "node:crypto";

import * as sqliteVec from "sqlite-vec";

import type { CivitaiResourceType } from "@/features/civitai-lora-library/types";

import {
  CIVITAI_SEARCH_INDEX_TABLE,
  buildCivitaiResourceSearchText,
  isCivitaiSearchIndexAvailable,
} from "./civitai-search-index";
import type { SceneForgeSqliteDatabase } from "./sqlite-storage";

export const CIVITAI_EMBEDDING_INDEX_TABLE = "civitai_resource_embedding_vec";
export const CIVITAI_EMBEDDING_INDEX_METADATA_TABLE = "civitai_resource_embedding_index_metadata";
export const CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE =
  "Civitai embedding index is missing or unusable. Configure LITELLM_CIVITAI_EMBEDDING_MODEL, run npm run civitai:reindex-embeddings, then try the recommendation again.";
export const CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE =
  "Civitai BM25/FTS index is missing or stale. Run npm run civitai:reindex before npm run civitai:reindex-embeddings.";
export const CIVITAI_EMBEDDING_INDEX_SCHEMA_VERSION = "2";
export const CIVITAI_EMBEDDING_CHUNK_MAX_CHARS = 4000;
export const CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS = 400;

type Metadata = {
  chunkMaxChars: number;
  chunkOverlapChars: number;
  dimensions: number;
  model: string;
  schemaVersion: string;
  sourceFingerprint: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextColumn(row: unknown, column: string): string | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function readNumberColumn(row: unknown, column: string): number | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const value = row[column];
  return typeof value === "number" ? value : undefined;
}

function tableExists(db: SceneForgeSqliteDatabase, tableName: string): boolean {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);

  return readTextColumn(row, "name") === tableName;
}

function tableColumnNames(db: SceneForgeSqliteDatabase, tableName: string): Set<string> {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all()
      .map((row) => readTextColumn(row, "name") ?? "")
      .filter((name) => name.length > 0),
  );
}

function hasExpectedEmbeddingIndexSchema(db: SceneForgeSqliteDatabase): boolean {
  if (!tableExists(db, CIVITAI_EMBEDDING_INDEX_TABLE)) {
    return false;
  }

  const columns = tableColumnNames(db, CIVITAI_EMBEDDING_INDEX_TABLE);
  return [
    "chunk_id",
    "resource_id",
    "resource_type",
    "chunk_index",
    "source_fingerprint",
    "chunk_fingerprint",
    "embedding",
  ].every((column) => columns.has(column));
}

function normalizeEmbeddingModel(model: string | null | undefined): string {
  return (model ?? "").trim();
}

function fingerprintText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sanitizeCivitaiEmbeddingTextForUtf8(text: string): string {
  let sanitized = "";

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = text.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        sanitized += text[index] + text[index + 1];
        index += 1;
      } else {
        sanitized += "\uFFFD";
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      sanitized += "\uFFFD";
      continue;
    }

    sanitized += text[index];
  }

  return sanitized;
}

export function chunkCivitaiEmbeddingText(
  text: string,
  maxChars = CIVITAI_EMBEDDING_CHUNK_MAX_CHARS,
  overlapChars = CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS,
): string[] {
  const normalized = sanitizeCivitaiEmbeddingTextForUtf8(text).trim();
  if (!normalized) {
    return [];
  }

  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error("Civitai embedding chunk size must be a positive integer.");
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("Civitai embedding chunk overlap must be smaller than the chunk size.");
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    chunks.push(sanitizeCivitaiEmbeddingTextForUtf8(normalized.slice(start, end)));
    if (end >= normalized.length) {
      break;
    }
    start = end - overlapChars;
  }

  return chunks;
}

function fingerprintEmbeddingSources(
  rows: Array<{
    resourceId: string;
    resourceType: Extract<CivitaiResourceType, "model" | "lora">;
    text: string;
  }>,
): string {
  const hash = createHash("sha256");

  for (const row of rows) {
    hash.update(row.resourceType);
    hash.update("\0");
    hash.update(row.resourceId);
    hash.update("\0");
    hash.update(row.text);
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function assertCivitaiSearchIndexReadyForEmbeddings(db: SceneForgeSqliteDatabase): void {
  if (!isCivitaiSearchIndexAvailable(db)) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE);
  }

  const resourceCount = readNumberColumn(db.prepare(`
    SELECT COUNT(*) AS count
    FROM civitai_resources
    WHERE resource_type IN ('model', 'lora')
  `).get(), "count") ?? 0;
  const searchIndexCount = readNumberColumn(db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${CIVITAI_SEARCH_INDEX_TABLE}
  `).get(), "count") ?? 0;

  if (resourceCount !== searchIndexCount) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE);
  }
}

export function isCivitaiEmbeddingIndexBm25ReadinessError(error: unknown): error is Error {
  return error instanceof Error && error.message === CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE;
}

function isSqliteVecLoaded(db: SceneForgeSqliteDatabase): boolean {
  try {
    db.prepare("SELECT vec_version() AS version").get();
    return true;
  } catch {
    return false;
  }
}

export function loadSqliteVecExtension(db: SceneForgeSqliteDatabase): void {
  if (isSqliteVecLoaded(db)) {
    return;
  }

  if (typeof db.loadExtension !== "function") {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  try {
    db.enableLoadExtension?.(true);
    sqliteVec.load(db as Parameters<typeof sqliteVec.load>[0]);
  } finally {
    db.enableLoadExtension?.(false);
  }
}

export function float32EmbeddingBlob(embedding: number[]): Uint8Array {
  if (embedding.length === 0) {
    throw new Error("Embedding vector must not be empty.");
  }

  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains a non-finite value.");
    }
  }

  return new Uint8Array(new Float32Array(embedding).buffer);
}

export function readCivitaiEmbeddingIndexMetadata(db: SceneForgeSqliteDatabase): Metadata | null {
  if (!tableExists(db, CIVITAI_EMBEDDING_INDEX_METADATA_TABLE)) {
    return null;
  }

  const rows = db.prepare(`
    SELECT key, value
    FROM ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE}
  `).all();
  const values = new Map(
    rows.map((row) => [readTextColumn(row, "key") ?? "", readTextColumn(row, "value") ?? ""]),
  );
  const dimensions = Number(values.get("dimensions"));
  const chunkMaxChars = Number(values.get("chunk_max_chars"));
  const chunkOverlapChars = Number(values.get("chunk_overlap_chars"));
  const model = normalizeEmbeddingModel(values.get("model"));
  const schemaVersion = values.get("schema_version") ?? "";
  const sourceFingerprint = values.get("source_fingerprint") ?? "";

  if (
    !Number.isInteger(dimensions) ||
    dimensions <= 0 ||
    !Number.isInteger(chunkMaxChars) ||
    chunkMaxChars !== CIVITAI_EMBEDDING_CHUNK_MAX_CHARS ||
    !Number.isInteger(chunkOverlapChars) ||
    chunkOverlapChars !== CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS ||
    !model ||
    schemaVersion !== CIVITAI_EMBEDDING_INDEX_SCHEMA_VERSION ||
    !sourceFingerprint
  ) {
    return null;
  }

  return { chunkMaxChars, chunkOverlapChars, dimensions, model, schemaVersion, sourceFingerprint };
}

export function isCivitaiEmbeddingIndexAvailable(
  db: SceneForgeSqliteDatabase,
  expectedModel: string | null | undefined,
): boolean {
  try {
    loadSqliteVecExtension(db);
  } catch {
    return false;
  }

  const model = normalizeEmbeddingModel(expectedModel);
  const metadata = readCivitaiEmbeddingIndexMetadata(db);

  if (!model || !metadata || metadata.model !== model || !hasExpectedEmbeddingIndexSchema(db)) {
    return false;
  }

  try {
    return metadata.sourceFingerprint === fingerprintEmbeddingSources(listCivitaiResourceEmbeddingSourceInputs(db));
  } catch {
    return false;
  }
}

export function assertCivitaiEmbeddingIndexReady(
  db: SceneForgeSqliteDatabase,
  expectedModel: string | null | undefined,
): Metadata {
  const model = normalizeEmbeddingModel(expectedModel);
  if (!model) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  assertCivitaiSearchIndexReadyForEmbeddings(db);

  try {
    loadSqliteVecExtension(db);
  } catch (error) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE, { cause: error });
  }

  const metadata = readCivitaiEmbeddingIndexMetadata(db);
  if (!metadata || metadata.model !== model || !hasExpectedEmbeddingIndexSchema(db)) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  if (metadata.sourceFingerprint !== fingerprintEmbeddingSources(listCivitaiResourceEmbeddingSourceInputs(db))) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  return metadata;
}

export function rebuildCivitaiEmbeddingIndex(
  db: SceneForgeSqliteDatabase,
  input: {
    embeddings: Array<{
      chunkFingerprint: string;
      chunkIndex: number;
      embedding: number[];
      resourceId: string;
      resourceType: Extract<CivitaiResourceType, "model" | "lora">;
      sourceFingerprint: string;
    }>;
    model: string;
  },
): { indexedCount: number; dimensions: number } {
  assertCivitaiSearchIndexReadyForEmbeddings(db);
  loadSqliteVecExtension(db);

  const sourceFingerprint = fingerprintEmbeddingSources(listCivitaiResourceEmbeddingSourceInputs(db));
  const model = normalizeEmbeddingModel(input.model);
  const firstEmbedding = input.embeddings[0]?.embedding;
  const dimensions = firstEmbedding?.length ?? 0;
  if (!model || dimensions <= 0) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  for (const entry of input.embeddings) {
    if (entry.embedding.length !== dimensions) {
      throw new Error("Civitai embedding index rebuild received inconsistent vector dimensions.");
    }
    if (!Number.isInteger(entry.chunkIndex) || entry.chunkIndex < 0) {
      throw new Error("Civitai embedding index rebuild received an invalid chunk index.");
    }
    if (!entry.sourceFingerprint || !entry.chunkFingerprint) {
      throw new Error("Civitai embedding index rebuild received missing chunk metadata.");
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DROP TABLE IF EXISTS ${CIVITAI_EMBEDDING_INDEX_TABLE};
      DROP TABLE IF EXISTS ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE};

      CREATE VIRTUAL TABLE ${CIVITAI_EMBEDDING_INDEX_TABLE}
      USING vec0(
        chunk_id TEXT PRIMARY KEY,
        resource_id TEXT,
        resource_type TEXT,
        chunk_index TEXT,
        source_fingerprint TEXT,
        chunk_fingerprint TEXT,
        embedding float[${dimensions}]
      );

      CREATE TABLE ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const insert = db.prepare(`
      INSERT INTO ${CIVITAI_EMBEDDING_INDEX_TABLE} (
        chunk_id,
        resource_id,
        resource_type,
        chunk_index,
        source_fingerprint,
        chunk_fingerprint,
        embedding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of input.embeddings) {
      insert.run(
        `${entry.resourceType}:${entry.resourceId}:${entry.chunkIndex}`,
        entry.resourceId,
        entry.resourceType,
        String(entry.chunkIndex),
        entry.sourceFingerprint,
        entry.chunkFingerprint,
        float32EmbeddingBlob(entry.embedding),
      );
    }

    const writeMetadata = db.prepare(`
      INSERT INTO ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE} (key, value)
      VALUES (?, ?)
    `);
    writeMetadata.run("model", model);
    writeMetadata.run("schema_version", CIVITAI_EMBEDDING_INDEX_SCHEMA_VERSION);
    writeMetadata.run("chunk_max_chars", String(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS));
    writeMetadata.run("chunk_overlap_chars", String(CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS));
    writeMetadata.run("dimensions", String(dimensions));
    writeMetadata.run("source_fingerprint", sourceFingerprint);
    writeMetadata.run("indexed_at", new Date().toISOString());
    writeMetadata.run("indexed_count", String(input.embeddings.length));

    db.exec("COMMIT");
    return { indexedCount: input.embeddings.length, dimensions };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function listCivitaiResourceEmbeddingSourceInputs(db: SceneForgeSqliteDatabase): Array<{
  resourceId: string;
  resourceType: Extract<CivitaiResourceType, "model" | "lora">;
  text: string;
}> {
  assertCivitaiSearchIndexReadyForEmbeddings(db);

  return db.prepare(`
    SELECT resource_id, resource_type, search_text
    FROM ${CIVITAI_SEARCH_INDEX_TABLE}
    WHERE resource_type IN ('model', 'lora')
    ORDER BY resource_type, resource_id
  `).all().map((row) => {
    const resourceType: Extract<CivitaiResourceType, "model" | "lora"> =
      readTextColumn(row, "resource_type") === "model" ? "model" : "lora";

    return {
      resourceId: readTextColumn(row, "resource_id") ?? "",
      resourceType,
      text: readTextColumn(row, "search_text") ?? "",
    };
  }).filter((row) => row.resourceId.length > 0 && row.text.trim().length > 0);
}

export function listCivitaiResourceEmbeddingInputs(db: SceneForgeSqliteDatabase): Array<{
  chunkFingerprint: string;
  chunkIndex: number;
  resourceId: string;
  resourceType: Extract<CivitaiResourceType, "model" | "lora">;
  sourceFingerprint: string;
  text: string;
}> {
  return listCivitaiResourceEmbeddingSourceInputs(db).flatMap((row) => {
    const sourceFingerprint = fingerprintText(row.text);

    return chunkCivitaiEmbeddingText(row.text).map((text, chunkIndex) => ({
      chunkFingerprint: fingerprintText(text),
      chunkIndex,
      resourceId: row.resourceId,
      resourceType: row.resourceType,
      sourceFingerprint,
      text,
    }));
  });
}

export function rankCivitaiResourceIdsByEmbeddingIndex(
  db: SceneForgeSqliteDatabase,
  input: {
    embedding: number[];
    resourceIds: string[];
    resourceType: Extract<CivitaiResourceType, "model" | "lora">;
  },
): Map<string, number> {
  if (input.resourceIds.length === 0) {
    return new Map();
  }

  const placeholders = input.resourceIds.map(() => "?").join(", ");
  const indexedResourceCount = readNumberColumn(db.prepare(`
    SELECT COUNT(DISTINCT resource_id) AS count
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
    WHERE resource_type = ?
      AND resource_id IN (${placeholders})
  `).get(input.resourceType, ...input.resourceIds), "count") ?? 0;

  if (indexedResourceCount !== input.resourceIds.length) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  const indexedChunkCount = readNumberColumn(db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
    WHERE resource_type = ?
      AND resource_id IN (${placeholders})
  `).get(input.resourceType, ...input.resourceIds), "count") ?? 0;

  const rows = db.prepare(`
    SELECT resource_id, distance
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
    WHERE embedding MATCH ?
      AND k = ?
      AND resource_type = ?
      AND resource_id IN (${placeholders})
    ORDER BY distance ASC
  `).all(float32EmbeddingBlob(input.embedding), indexedChunkCount, input.resourceType, ...input.resourceIds);

  const bestDistanceByResourceId = new Map<string, number>();
  for (const [index, row] of rows.entries()) {
    const resourceId = readTextColumn(row, "resource_id") ?? "";
    const distance = readNumberColumn(row, "distance") ?? index;
    const previousDistance = bestDistanceByResourceId.get(resourceId);
    if (resourceId && (previousDistance === undefined || distance < previousDistance)) {
      bestDistanceByResourceId.set(resourceId, distance);
    }
  }

  return new Map(
    Array.from(bestDistanceByResourceId.entries()).sort((left, right) => {
      if (left[1] !== right[1]) {
        return left[1] - right[1];
      }

      return left[0].localeCompare(right[0]);
    }),
  );
}

export { buildCivitaiResourceSearchText };
