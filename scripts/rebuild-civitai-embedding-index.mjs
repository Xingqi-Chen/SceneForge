import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as sqliteVec from "sqlite-vec";

const SEARCH_INDEX_TABLE = "civitai_resource_search_fts";
const EMBEDDING_INDEX_TABLE = "civitai_resource_embedding_vec";
const EMBEDDING_METADATA_TABLE = "civitai_resource_embedding_index_metadata";
const SQLITE_ENV_KEY = "SCENEFORGE_SQLITE_FILE";
const EMBEDDING_MODEL_ENV_KEY = "LITELLM_CIVITAI_EMBEDDING_MODEL";
const LITELLM_BASE_URL_ENV_KEY = "LITELLM_BASE_URL";
const LITELLM_API_KEY_ENV_KEY = "LITELLM_API_KEY";
const BATCH_SIZE = 16;
const EMBEDDING_INDEX_SCHEMA_VERSION = "2";
const EMBEDDING_CHUNK_MAX_CHARS = 4000;
const EMBEDDING_CHUNK_OVERLAP_CHARS = 400;

function parseEnvValue(rawValue) {
  let value = rawValue.trim();
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return value;
}

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = parseEnvValue(match[2]);
  }
}

function loadLocalEnv() {
  loadEnvFromFile(path.join(process.cwd(), ".env.local"));
  loadEnvFromFile(path.join(process.cwd(), ".env"));
}

function sqlitePath() {
  const override = process.env[SQLITE_ENV_KEY]?.trim();
  return path.resolve(override || path.join(process.cwd(), "data", "sceneforge.sqlite"));
}

function normalizeLiteLlmBaseUrl(baseUrl) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function assertSearchIndexReady(db) {
  const table = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(SEARCH_INDEX_TABLE);

  if (table?.name !== SEARCH_INDEX_TABLE) {
    throw new Error("Civitai BM25/FTS index is missing. Run npm run civitai:reindex before npm run civitai:reindex-embeddings.");
  }

  const resourceCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM civitai_resources
    WHERE resource_type IN ('model', 'lora')
  `).get().count;
  const searchIndexCount = db.prepare(`SELECT COUNT(*) AS count FROM ${SEARCH_INDEX_TABLE}`).get().count;

  if (resourceCount !== searchIndexCount) {
    throw new Error("Civitai BM25/FTS index is stale. Run npm run civitai:reindex before npm run civitai:reindex-embeddings.");
  }
}

function loadEmbeddingInputs(db) {
  assertSearchIndexReady(db);

  const rows = db.prepare(`
    SELECT resource_id, resource_type, search_text
    FROM ${SEARCH_INDEX_TABLE}
    WHERE resource_type IN ('model', 'lora')
    ORDER BY resource_type, resource_id
  `).all()
    .map((row) => ({
      ...row,
      search_text: String(row.search_text ?? ""),
    }))
    .filter((row) => row.resource_id && row.search_text.trim());

  return rows.flatMap((row) => {
    const sourceFingerprint = fingerprintText(row.search_text);

    return chunkEmbeddingText(row.search_text).map((text, chunkIndex) => ({
      chunk_fingerprint: fingerprintText(text),
      chunk_index: chunkIndex,
      resource_id: row.resource_id,
      resource_type: row.resource_type,
      search_text: text,
      source_fingerprint: sourceFingerprint,
    }));
  });
}

function embeddingBlob(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("LiteLLM returned an empty or malformed embedding vector.");
  }

  for (const value of embedding) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("LiteLLM returned an embedding vector with a non-finite value.");
    }
  }

  return new Uint8Array(new Float32Array(embedding).buffer);
}

function fingerprintEmbeddingInputs(rows) {
  const hash = createHash("sha256");

  for (const row of rows) {
    hash.update(row.resource_type);
    hash.update("\0");
    hash.update(row.resource_id);
    hash.update("\0");
    hash.update(row.search_text);
    hash.update("\0");
  }

  return hash.digest("hex");
}

function fingerprintText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function sanitizeEmbeddingTextForUtf8(text) {
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

function chunkEmbeddingText(text) {
  const normalized = sanitizeEmbeddingTextForUtf8(text).trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + EMBEDDING_CHUNK_MAX_CHARS, normalized.length);
    chunks.push(sanitizeEmbeddingTextForUtf8(normalized.slice(start, end)));
    if (end >= normalized.length) {
      break;
    }
    start = end - EMBEDDING_CHUNK_OVERLAP_CHARS;
  }

  return chunks;
}

function loadEmbeddingSourceRows(db) {
  assertSearchIndexReady(db);

  return db.prepare(`
    SELECT resource_id, resource_type, search_text
    FROM ${SEARCH_INDEX_TABLE}
    WHERE resource_type IN ('model', 'lora')
    ORDER BY resource_type, resource_id
  `).all()
    .map((row) => ({
      ...row,
      search_text: String(row.search_text ?? ""),
    }))
    .filter((row) => row.resource_id && row.search_text.trim());
}

async function fetchEmbeddingBatch({ apiKey, baseUrl, inputs, model }) {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      input: inputs,
    }),
  });
  const payload = await response.json().catch(async () => response.text());

  if (!response.ok) {
    throw new Error(`LiteLLM embedding request failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const data = Array.isArray(payload.data) ? payload.data : [];
  if (data.length !== inputs.length) {
    throw new Error(`LiteLLM returned ${data.length} embeddings for ${inputs.length} inputs.`);
  }

  return data
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((entry) => entry.embedding);
}

async function buildEmbeddings(rows, { apiKey, baseUrl, model }) {
  const embeddings = [];

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const vectors = await fetchEmbeddingBatch({
      apiKey,
      baseUrl,
      inputs: batch.map((row) => row.search_text),
      model,
    });

    for (const [offset, embedding] of vectors.entries()) {
      const row = batch[offset];
      embeddings.push({
        chunkFingerprint: row.chunk_fingerprint,
        chunkIndex: row.chunk_index,
        embedding,
        resourceId: row.resource_id,
        resourceType: row.resource_type,
        sourceFingerprint: row.source_fingerprint,
      });
    }

    console.log(`Embedded ${Math.min(index + batch.length, rows.length)} / ${rows.length} chunks.`);
  }

  return embeddings;
}

function rebuildEmbeddingIndex(db, embeddings, model, sourceFingerprint) {
  const dimensions = embeddings[0]?.embedding.length ?? 0;
  if (dimensions <= 0) {
    throw new Error("No Civitai model/LoRA resources were available to embed.");
  }

  for (const entry of embeddings) {
    if (entry.embedding.length !== dimensions) {
      throw new Error("LiteLLM returned inconsistent embedding dimensions.");
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DROP TABLE IF EXISTS ${EMBEDDING_INDEX_TABLE};
      DROP TABLE IF EXISTS ${EMBEDDING_METADATA_TABLE};

      CREATE VIRTUAL TABLE ${EMBEDDING_INDEX_TABLE}
      USING vec0(
        chunk_id TEXT PRIMARY KEY,
        resource_id TEXT,
        resource_type TEXT,
        chunk_index TEXT,
        source_fingerprint TEXT,
        chunk_fingerprint TEXT,
        embedding float[${dimensions}]
      );

      CREATE TABLE ${EMBEDDING_METADATA_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const insert = db.prepare(`
      INSERT INTO ${EMBEDDING_INDEX_TABLE} (
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
    for (const entry of embeddings) {
      insert.run(
        `${entry.resourceType}:${entry.resourceId}:${entry.chunkIndex}`,
        entry.resourceId,
        entry.resourceType,
        String(entry.chunkIndex),
        entry.sourceFingerprint,
        entry.chunkFingerprint,
        embeddingBlob(entry.embedding),
      );
    }

    const meta = db.prepare(`
      INSERT INTO ${EMBEDDING_METADATA_TABLE} (key, value)
      VALUES (?, ?)
    `);
    meta.run("model", model);
    meta.run("schema_version", EMBEDDING_INDEX_SCHEMA_VERSION);
    meta.run("chunk_max_chars", String(EMBEDDING_CHUNK_MAX_CHARS));
    meta.run("chunk_overlap_chars", String(EMBEDDING_CHUNK_OVERLAP_CHARS));
    meta.run("dimensions", String(dimensions));
    meta.run("source_fingerprint", sourceFingerprint);
    meta.run("indexed_at", new Date().toISOString());
    meta.run("indexed_count", String(embeddings.length));

    db.exec("COMMIT");
    return { dimensions, indexedCount: embeddings.length };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

loadLocalEnv();

const model = process.env[EMBEDDING_MODEL_ENV_KEY]?.trim();
const baseUrl = process.env[LITELLM_BASE_URL_ENV_KEY]?.trim();
const apiKey = process.env[LITELLM_API_KEY_ENV_KEY]?.trim();

if (!model) {
  console.error(`${EMBEDDING_MODEL_ENV_KEY} is required. Set it in .env.local or the shell before running npm run civitai:reindex-embeddings.`);
  process.exit(1);
}

if (!baseUrl) {
  console.error(`${LITELLM_BASE_URL_ENV_KEY} is required. Set it in .env.local or the shell before running npm run civitai:reindex-embeddings.`);
  process.exit(1);
}

const filePath = sqlitePath();
const db = new DatabaseSync(filePath, { allowExtension: true });
db.enableLoadExtension?.(false);

try {
  try {
    db.enableLoadExtension?.(true);
    sqliteVec.load(db);
  } finally {
    db.enableLoadExtension?.(false);
  }
  const sourceRows = loadEmbeddingSourceRows(db);
  const chunks = loadEmbeddingInputs(db);
  const sourceFingerprint = fingerprintEmbeddingInputs(sourceRows);
  const embeddings = await buildEmbeddings(chunks, {
    apiKey,
    baseUrl: normalizeLiteLlmBaseUrl(baseUrl),
    model,
  });
  const result = rebuildEmbeddingIndex(db, embeddings, model, sourceFingerprint);

  console.log(
    `Rebuilt Civitai sqlite-vec embedding index at ${filePath}. Indexed ${result.indexedCount} chunks from ${sourceRows.length} resources with ${result.dimensions} dimensions.`,
  );
} catch (error) {
  console.error("Failed to rebuild Civitai sqlite-vec embedding index.");
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}
