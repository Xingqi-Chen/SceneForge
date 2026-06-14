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

  return db.prepare(`
    SELECT resource_id, resource_type, search_text
    FROM ${SEARCH_INDEX_TABLE}
    WHERE resource_type IN ('model', 'lora')
    ORDER BY resource_type, resource_id
  `).all().filter((row) => row.resource_id && row.search_text?.trim());
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
        embedding,
        resourceId: row.resource_id,
        resourceType: row.resource_type,
      });
    }

    console.log(`Embedded ${Math.min(index + batch.length, rows.length)} / ${rows.length} resources.`);
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
        resource_id TEXT PRIMARY KEY,
        resource_type TEXT,
        embedding float[${dimensions}]
      );

      CREATE TABLE ${EMBEDDING_METADATA_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const insert = db.prepare(`
      INSERT INTO ${EMBEDDING_INDEX_TABLE} (resource_id, resource_type, embedding)
      VALUES (?, ?, ?)
    `);
    for (const entry of embeddings) {
      insert.run(entry.resourceId, entry.resourceType, embeddingBlob(entry.embedding));
    }

    const meta = db.prepare(`
      INSERT INTO ${EMBEDDING_METADATA_TABLE} (key, value)
      VALUES (?, ?)
    `);
    meta.run("model", model);
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
  const rows = loadEmbeddingInputs(db);
  const sourceFingerprint = fingerprintEmbeddingInputs(rows);
  const embeddings = await buildEmbeddings(rows, {
    apiKey,
    baseUrl: normalizeLiteLlmBaseUrl(baseUrl),
    model,
  });
  const result = rebuildEmbeddingIndex(db, embeddings, model, sourceFingerprint);

  console.log(
    `Rebuilt Civitai sqlite-vec embedding index at ${filePath}. Indexed ${result.indexedCount} resources with ${result.dimensions} dimensions.`,
  );
} catch (error) {
  console.error("Failed to rebuild Civitai sqlite-vec embedding index.");
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}
