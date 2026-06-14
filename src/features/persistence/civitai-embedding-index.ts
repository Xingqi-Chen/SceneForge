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

type Metadata = {
  dimensions: number;
  model: string;
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

function normalizeEmbeddingModel(model: string | null | undefined): string {
  return (model ?? "").trim();
}

function fingerprintEmbeddingInputs(
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
  const model = normalizeEmbeddingModel(values.get("model"));
  const sourceFingerprint = values.get("source_fingerprint") ?? "";

  if (!Number.isInteger(dimensions) || dimensions <= 0 || !model || !sourceFingerprint) {
    return null;
  }

  return { dimensions, model, sourceFingerprint };
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

  if (!model || !metadata || metadata.model !== model || !tableExists(db, CIVITAI_EMBEDDING_INDEX_TABLE)) {
    return false;
  }

  try {
    return metadata.sourceFingerprint === fingerprintEmbeddingInputs(listCivitaiResourceEmbeddingInputs(db));
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
  if (!metadata || metadata.model !== model || !tableExists(db, CIVITAI_EMBEDDING_INDEX_TABLE)) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  if (metadata.sourceFingerprint !== fingerprintEmbeddingInputs(listCivitaiResourceEmbeddingInputs(db))) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  return metadata;
}

export function rebuildCivitaiEmbeddingIndex(
  db: SceneForgeSqliteDatabase,
  input: {
    embeddings: Array<{
      embedding: number[];
      resourceId: string;
      resourceType: Extract<CivitaiResourceType, "model" | "lora">;
    }>;
    model: string;
  },
): { indexedCount: number; dimensions: number } {
  assertCivitaiSearchIndexReadyForEmbeddings(db);
  loadSqliteVecExtension(db);

  const sourceFingerprint = fingerprintEmbeddingInputs(listCivitaiResourceEmbeddingInputs(db));
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
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DROP TABLE IF EXISTS ${CIVITAI_EMBEDDING_INDEX_TABLE};
      DROP TABLE IF EXISTS ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE};

      CREATE VIRTUAL TABLE ${CIVITAI_EMBEDDING_INDEX_TABLE}
      USING vec0(
        resource_id TEXT PRIMARY KEY,
        resource_type TEXT,
        embedding float[${dimensions}]
      );

      CREATE TABLE ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const insert = db.prepare(`
      INSERT INTO ${CIVITAI_EMBEDDING_INDEX_TABLE} (resource_id, resource_type, embedding)
      VALUES (?, ?, ?)
    `);
    for (const entry of input.embeddings) {
      insert.run(entry.resourceId, entry.resourceType, float32EmbeddingBlob(entry.embedding));
    }

    const writeMetadata = db.prepare(`
      INSERT INTO ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE} (key, value)
      VALUES (?, ?)
    `);
    writeMetadata.run("model", model);
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

export function listCivitaiResourceEmbeddingInputs(db: SceneForgeSqliteDatabase): Array<{
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
  const indexedCount = readNumberColumn(db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
    WHERE resource_type = ?
      AND resource_id IN (${placeholders})
  `).get(input.resourceType, ...input.resourceIds), "count") ?? 0;

  if (indexedCount !== input.resourceIds.length) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  const rows = db.prepare(`
    SELECT resource_id, distance
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
    WHERE embedding MATCH ?
      AND k = ?
      AND resource_type = ?
      AND resource_id IN (${placeholders})
    ORDER BY distance ASC
  `).all(float32EmbeddingBlob(input.embedding), input.resourceIds.length, input.resourceType, ...input.resourceIds);

  return new Map(
    rows.map((row, index) => [
      readTextColumn(row, "resource_id") ?? "",
      readNumberColumn(row, "distance") ?? index,
    ]),
  );
}

export { buildCivitaiResourceSearchText };
