import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { arch, platform } from "node:process";

import * as sqliteVec from "sqlite-vec";

import type { CivitaiResourceType } from "@/features/civitai-lora-library/types";
import type {
  LlmEmbeddingRequest,
  LlmEmbeddingResponse,
} from "@/features/llm";

import {
  CIVITAI_SEARCH_INDEX_TABLE,
  buildCivitaiResourceSearchText,
  createCivitaiSearchIndexTable,
  deleteCivitaiSearchIndexResource,
  isCivitaiSearchIndexAvailable,
  listCivitaiResourceSearchSources,
  listCivitaiSearchIndexSources,
  replaceCivitaiSearchIndexResource,
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
export const CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE =
  "Civitai recommendation indexes are missing, stale, or incompatible. Run npm run civitai:reindex and then npm run civitai:reindex-embeddings before trying again.";
export const CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE =
  "Unable to prepare Civitai recommendation embeddings. No database changes were saved. Verify the LiteLLM embedding configuration and try again.";
export const CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE =
  "The Civitai library or recommendation indexes changed during indexing. No database changes were saved. Try the operation again.";
export const CIVITAI_EMBEDDING_BATCH_SIZE = 16;

type Metadata = {
  chunkMaxChars: number;
  chunkOverlapChars: number;
  dimensions: number;
  indexedAt: string;
  indexedCount: number;
  model: string;
  schemaVersion: string;
  sourceFingerprint: string;
};

export class CivitaiIncrementalIndexError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "CivitaiIncrementalIndexError";
    this.statusCode = statusCode;
  }
}

export type CivitaiIncrementalIndexBaseline = {
  dimensions: number | null;
  indexedAt: string | null;
  indexedCount: number;
  mode: "bootstrap" | "incremental";
  model: string;
  sourceFingerprint: string;
};

export type CivitaiIncrementalEmbeddingSource = {
  resourceKey: string;
  resourceType: Extract<CivitaiResourceType, "model" | "lora">;
  searchText: string;
};

export type PreparedCivitaiIncrementalEmbeddingUpdate = {
  baseline: CivitaiIncrementalIndexBaseline;
  dimensions: number;
  embeddings: Array<{
    chunkFingerprint: string;
    chunkIndex: number;
    embedding: number[];
    resourceKey: string;
    sourceFingerprint: string;
  }>;
  sources: CivitaiIncrementalEmbeddingSource[];
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

function tableCreationSql(db: SceneForgeSqliteDatabase, tableName: string): string | null {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);

  return readTextColumn(row, "sql") ?? null;
}

function tableColumnNames(db: SceneForgeSqliteDatabase, tableName: string): Set<string> {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all()
      .map((row) => readTextColumn(row, "name") ?? "")
      .filter((name) => name.length > 0),
  );
}

function normalizeVirtualTableSql(sql: string): string {
  return sql
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasExactTableColumns(columns: Set<string>, expectedColumns: string[]): boolean {
  return (
    columns.size === expectedColumns.length &&
    expectedColumns.every((column) => columns.has(column))
  );
}

function hasExpectedSearchIndexSchema(db: SceneForgeSqliteDatabase): boolean {
  const creationSql = tableCreationSql(db, CIVITAI_SEARCH_INDEX_TABLE);
  if (!creationSql) {
    return false;
  }

  const normalizedSql = normalizeVirtualTableSql(creationSql);
  const columns = tableColumnNames(db, CIVITAI_SEARCH_INDEX_TABLE);

  return (
    /^create\s+virtual\s+table\b/i.test(normalizedSql) &&
    /\busing\s+fts5\s*\(/i.test(normalizedSql) &&
    /\bresource_id\s+unindexed\b/i.test(normalizedSql) &&
    /\bresource_type\s+unindexed\b/i.test(normalizedSql) &&
    /\bsearch_text\b/i.test(normalizedSql) &&
    /\btokenize\s*=\s*(?:'unicode61'|unicode61)\s*(?=[,)])/i.test(normalizedSql) &&
    hasExactTableColumns(columns, ["resource_id", "resource_type", "search_text"])
  );
}

function hasExpectedEmbeddingIndexSchema(
  db: SceneForgeSqliteDatabase,
  dimensions: number,
): boolean {
  const creationSql = tableCreationSql(db, CIVITAI_EMBEDDING_INDEX_TABLE);
  if (!creationSql) {
    return false;
  }

  const normalizedSql = normalizeVirtualTableSql(creationSql);
  const columns = tableColumnNames(db, CIVITAI_EMBEDDING_INDEX_TABLE);
  const expectedEmbeddingDeclaration = new RegExp(
    `\\bembedding\\s+float\\s*\\[\\s*${dimensions}\\s*\\]`,
    "i",
  );

  return (
    /^create\s+virtual\s+table\b/i.test(normalizedSql) &&
    /\busing\s+vec0\s*\(/i.test(normalizedSql) &&
    expectedEmbeddingDeclaration.test(normalizedSql) &&
    hasExactTableColumns(columns, [
      "chunk_id",
      "resource_id",
      "resource_type",
      "chunk_index",
      "source_fingerprint",
      "chunk_fingerprint",
      "embedding",
    ])
  );
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

export function fingerprintCivitaiEmbeddingSources(
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

  const resources = listCivitaiResourceSearchSources(db);
  const indexed = listCivitaiSearchIndexSources(db);
  if (
    resources.length !== indexed.length ||
    resources.some((row, index) => {
      const indexedRow = indexed[index];
      return (
        !indexedRow ||
        row.resourceId !== indexedRow.resourceId ||
        row.resourceType !== indexedRow.resourceType ||
        row.searchText !== indexedRow.searchText
      );
    })
  ) {
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

function sqliteVecPlatformPackage(): { extensionFileName: string; packageName: string } {
  const suffix = platform === "win32" ? "dll" : platform === "darwin" ? "dylib" : "so";
  const os = platform === "win32" ? "windows" : platform;

  return {
    extensionFileName: `vec0.${suffix}`,
    packageName: `sqlite-vec-${os}-${arch}`,
  };
}

function resolveSqliteVecLoadablePath(): string {
  const { extensionFileName, packageName } = sqliteVecPlatformPackage();
  const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));

  return requireFromProject.resolve(`${packageName}/${extensionFileName}`);
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
    try {
      sqliteVec.load(db as Parameters<typeof sqliteVec.load>[0]);
    } catch (error) {
      db.loadExtension(resolveSqliteVecLoadablePath());
      if (!isSqliteVecLoaded(db)) {
        throw error;
      }
    }
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

  const float32Embedding = new Float32Array(embedding);
  for (const value of float32Embedding) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains a value outside the Float32 range.");
    }
  }

  return new Uint8Array(float32Embedding.buffer);
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
  const indexedAt = values.get("indexed_at") ?? "";
  const indexedCount = Number(values.get("indexed_count"));

  if (
    !Number.isInteger(dimensions) ||
    dimensions <= 0 ||
    !Number.isInteger(chunkMaxChars) ||
    chunkMaxChars !== CIVITAI_EMBEDDING_CHUNK_MAX_CHARS ||
    !Number.isInteger(chunkOverlapChars) ||
    chunkOverlapChars !== CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS ||
    !model ||
    schemaVersion !== CIVITAI_EMBEDDING_INDEX_SCHEMA_VERSION ||
    !sourceFingerprint ||
    !indexedAt ||
    !Number.isInteger(indexedCount) ||
    indexedCount < 0
  ) {
    return null;
  }

  return {
    chunkMaxChars,
    chunkOverlapChars,
    dimensions,
    indexedAt,
    indexedCount,
    model,
    schemaVersion,
    sourceFingerprint,
  };
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

  if (
    !model ||
    !metadata ||
    metadata.model !== model ||
    !hasExpectedEmbeddingIndexSchema(db, metadata.dimensions)
  ) {
    return false;
  }

  try {
    return metadata.sourceFingerprint === fingerprintCivitaiEmbeddingSources(listCivitaiResourceEmbeddingSourceInputs(db));
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
  if (
    !metadata ||
    metadata.model !== model ||
    !hasExpectedEmbeddingIndexSchema(db, metadata.dimensions)
  ) {
    throw new Error(CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE);
  }

  if (metadata.sourceFingerprint !== fingerprintCivitaiEmbeddingSources(listCivitaiResourceEmbeddingSourceInputs(db))) {
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

  const sourceFingerprint = fingerprintCivitaiEmbeddingSources(listCivitaiResourceEmbeddingSourceInputs(db));
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

function assertEmbeddingChunkRowsMatch(
  db: SceneForgeSqliteDatabase,
  expected: ReturnType<typeof listCivitaiResourceEmbeddingInputs>,
): void {
  const rows = db.prepare(`
    SELECT
      resource_id,
      resource_type,
      chunk_index,
      source_fingerprint,
      chunk_fingerprint
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
    ORDER BY resource_type, resource_id, CAST(chunk_index AS INTEGER)
  `).all();

  if (rows.length !== expected.length) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
  }

  for (const [index, input] of expected.entries()) {
    const row = rows[index];
    if (
      readTextColumn(row, "resource_id") !== input.resourceId ||
      readTextColumn(row, "resource_type") !== input.resourceType ||
      Number(readTextColumn(row, "chunk_index")) !== input.chunkIndex ||
      readTextColumn(row, "source_fingerprint") !== input.sourceFingerprint ||
      readTextColumn(row, "chunk_fingerprint") !== input.chunkFingerprint
    ) {
      throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
    }
  }
}

export function readCivitaiIncrementalIndexBaseline(
  db: SceneForgeSqliteDatabase,
  expectedModel: string | null | undefined,
): CivitaiIncrementalIndexBaseline {
  const model = normalizeEmbeddingModel(expectedModel);
  if (!model) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
  }

  const resources = listCivitaiResourceSearchSources(db);
  try {
    loadSqliteVecExtension(db);
  } catch {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
  }

  if (resources.length === 0) {
    return {
      dimensions: null,
      indexedAt: null,
      indexedCount: 0,
      mode: "bootstrap",
      model,
      sourceFingerprint: fingerprintCivitaiEmbeddingSources([]),
    };
  }

  try {
    assertCivitaiSearchIndexReadyForEmbeddings(db);
  } catch {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
  }

  const metadata = readCivitaiEmbeddingIndexMetadata(db);
  if (
    !metadata ||
    metadata.model !== model ||
    !hasExpectedSearchIndexSchema(db) ||
    !hasExpectedEmbeddingIndexSchema(db, metadata.dimensions)
  ) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
  }

  const inputs = listCivitaiResourceEmbeddingInputs(db);
  const sourceFingerprint = fingerprintCivitaiEmbeddingSources(
    listCivitaiResourceEmbeddingSourceInputs(db),
  );
  if (
    metadata.sourceFingerprint !== sourceFingerprint ||
    metadata.indexedCount !== inputs.length
  ) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE);
  }
  assertEmbeddingChunkRowsMatch(db, inputs);

  return {
    dimensions: metadata.dimensions,
    indexedAt: metadata.indexedAt,
    indexedCount: metadata.indexedCount,
    mode: "incremental",
    model,
    sourceFingerprint,
  };
}

function sameCivitaiIncrementalIndexBaseline(
  left: CivitaiIncrementalIndexBaseline,
  right: CivitaiIncrementalIndexBaseline,
): boolean {
  return (
    left.dimensions === right.dimensions &&
    left.indexedAt === right.indexedAt &&
    left.indexedCount === right.indexedCount &&
    left.mode === right.mode &&
    left.model === right.model &&
    left.sourceFingerprint === right.sourceFingerprint
  );
}

export function assertCivitaiIncrementalIndexBaselineUnchanged(
  db: SceneForgeSqliteDatabase,
  baseline: CivitaiIncrementalIndexBaseline,
): void {
  let current: CivitaiIncrementalIndexBaseline;
  try {
    current = readCivitaiIncrementalIndexBaseline(db, baseline.model);
  } catch {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE);
  }

  if (!sameCivitaiIncrementalIndexBaseline(current, baseline)) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE);
  }
}

export async function prepareCivitaiIncrementalEmbeddingUpdate(
  db: SceneForgeSqliteDatabase,
  input: {
    createEmbedding: (request: LlmEmbeddingRequest) => Promise<LlmEmbeddingResponse>;
    model: string | null | undefined;
    sources: CivitaiIncrementalEmbeddingSource[];
  },
): Promise<PreparedCivitaiIncrementalEmbeddingUpdate> {
  const baseline = readCivitaiIncrementalIndexBaseline(db, input.model);
  const resourceKeys = new Set<string>();
  const chunkInputs = input.sources.flatMap((source) => {
    if (!source.resourceKey || resourceKeys.has(source.resourceKey)) {
      throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE, 502);
    }
    resourceKeys.add(source.resourceKey);
    const sourceFingerprint = fingerprintText(source.searchText);

    return chunkCivitaiEmbeddingText(source.searchText).map((text, chunkIndex) => ({
      chunkFingerprint: fingerprintText(text),
      chunkIndex,
      resourceKey: source.resourceKey,
      sourceFingerprint,
      text,
    }));
  });

  if (input.sources.length > 0 && chunkInputs.length === 0) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE, 502);
  }

  const embeddings: PreparedCivitaiIncrementalEmbeddingUpdate["embeddings"] = [];
  try {
    for (let index = 0; index < chunkInputs.length; index += CIVITAI_EMBEDDING_BATCH_SIZE) {
      const batch = chunkInputs.slice(index, index + CIVITAI_EMBEDDING_BATCH_SIZE);
      const response = await input.createEmbedding({
        input: batch.map((entry) => entry.text),
        model: baseline.model,
      });
      if (response.embeddings.length !== batch.length) {
        throw new Error("Unexpected embedding count.");
      }

      for (const [offset, embedding] of response.embeddings.entries()) {
        float32EmbeddingBlob(embedding);
        const chunk = batch[offset]!;
        embeddings.push({
          chunkFingerprint: chunk.chunkFingerprint,
          chunkIndex: chunk.chunkIndex,
          embedding,
          resourceKey: chunk.resourceKey,
          sourceFingerprint: chunk.sourceFingerprint,
        });
      }
    }
  } catch {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE, 502);
  }

  const dimensions = baseline.dimensions ?? embeddings[0]?.embedding.length ?? 0;
  if (
    (input.sources.length > 0 && dimensions <= 0) ||
    embeddings.some((entry) => entry.embedding.length !== dimensions)
  ) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE, 502);
  }

  return {
    baseline,
    dimensions,
    embeddings,
    sources: input.sources,
  };
}

function createCivitaiEmbeddingIndexTables(
  db: SceneForgeSqliteDatabase,
  dimensions: number,
): void {
  db.exec(`
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
}

function writeCivitaiEmbeddingIndexMetadata(
  db: SceneForgeSqliteDatabase,
  input: {
    dimensions: number;
    model: string;
  },
): void {
  const sources = listCivitaiSearchIndexSources(db);
  const sourceFingerprint = fingerprintCivitaiEmbeddingSources(
    sources.map((source) => ({
      resourceId: source.resourceId,
      resourceType: source.resourceType,
      text: source.searchText,
    })),
  );
  const indexedCount = readNumberColumn(db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
  `).get(), "count") ?? 0;
  const writeMetadata = db.prepare(`
    INSERT INTO ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  writeMetadata.run("model", input.model);
  writeMetadata.run("schema_version", CIVITAI_EMBEDDING_INDEX_SCHEMA_VERSION);
  writeMetadata.run("chunk_max_chars", String(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS));
  writeMetadata.run("chunk_overlap_chars", String(CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS));
  writeMetadata.run("dimensions", String(input.dimensions));
  writeMetadata.run("source_fingerprint", sourceFingerprint);
  writeMetadata.run("indexed_at", new Date().toISOString());
  writeMetadata.run("indexed_count", String(indexedCount));
}

export function applyPreparedCivitaiIncrementalEmbeddingUpdate(
  db: SceneForgeSqliteDatabase,
  input: {
    obsoleteResourceIds?: string[];
    prepared: PreparedCivitaiIncrementalEmbeddingUpdate;
    resources: Array<{
      resourceId: string;
      resourceKey: string;
      resourceType: Extract<CivitaiResourceType, "model" | "lora">;
      searchText: string;
    }>;
  },
): void {
  const { prepared } = input;
  if (prepared.sources.length !== input.resources.length) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE);
  }

  if (prepared.baseline.mode === "bootstrap") {
    db.exec(`
      DROP TABLE IF EXISTS ${CIVITAI_SEARCH_INDEX_TABLE};
      DROP TABLE IF EXISTS ${CIVITAI_EMBEDDING_INDEX_TABLE};
      DROP TABLE IF EXISTS ${CIVITAI_EMBEDDING_INDEX_METADATA_TABLE};
    `);
    createCivitaiSearchIndexTable(db);
    createCivitaiEmbeddingIndexTables(db, prepared.dimensions);
  }

  for (const resourceId of input.obsoleteResourceIds ?? []) {
    deleteCivitaiSearchIndexResource(db, resourceId);
    db.prepare(`
      DELETE FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
      WHERE resource_id = ?
    `).run(resourceId);
  }

  const resourcesByKey = new Map(input.resources.map((resource) => [resource.resourceKey, resource]));
  for (const resource of input.resources) {
    const preparedSource = prepared.sources.find((source) => source.resourceKey === resource.resourceKey);
    if (
      !preparedSource ||
      preparedSource.resourceType !== resource.resourceType ||
      preparedSource.searchText !== resource.searchText
    ) {
      throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE);
    }

    replaceCivitaiSearchIndexResource(db, {
      resourceId: resource.resourceId,
      resourceType: resource.resourceType,
      searchText: resource.searchText,
    });
    db.prepare(`
      DELETE FROM ${CIVITAI_EMBEDDING_INDEX_TABLE}
      WHERE resource_id = ?
    `).run(resource.resourceId);
  }

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
  for (const entry of prepared.embeddings) {
    const resource = resourcesByKey.get(entry.resourceKey);
    if (!resource) {
      throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE);
    }
    insert.run(
      `${resource.resourceType}:${resource.resourceId}:${entry.chunkIndex}`,
      resource.resourceId,
      resource.resourceType,
      String(entry.chunkIndex),
      entry.sourceFingerprint,
      entry.chunkFingerprint,
      float32EmbeddingBlob(entry.embedding),
    );
  }

  const resourcesFromRows = listCivitaiResourceSearchSources(db);
  const indexedSources = listCivitaiSearchIndexSources(db);
  if (
    resourcesFromRows.length !== indexedSources.length ||
    resourcesFromRows.some((resource, index) => {
      const indexed = indexedSources[index];
      return (
        !indexed ||
        resource.resourceId !== indexed.resourceId ||
        resource.resourceType !== indexed.resourceType ||
        resource.searchText !== indexed.searchText
      );
    })
  ) {
    throw new CivitaiIncrementalIndexError(CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE);
  }

  writeCivitaiEmbeddingIndexMetadata(db, {
    dimensions: prepared.dimensions,
    model: prepared.baseline.model,
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
