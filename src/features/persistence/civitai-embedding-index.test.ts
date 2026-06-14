// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rebuildCivitaiSearchIndex } from "./civitai-search-index";
import {
  CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE,
  CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
  CIVITAI_EMBEDDING_CHUNK_MAX_CHARS,
  CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS,
  assertCivitaiEmbeddingIndexReady,
  chunkCivitaiEmbeddingText,
  float32EmbeddingBlob,
  isCivitaiEmbeddingIndexAvailable,
  listCivitaiResourceEmbeddingInputs,
  loadSqliteVecExtension,
  rankCivitaiResourceIdsByEmbeddingIndex,
  readCivitaiEmbeddingIndexMetadata,
  rebuildCivitaiEmbeddingIndex,
  sanitizeCivitaiEmbeddingTextForUtf8,
} from "./civitai-embedding-index";
import {
  getCivitaiResourceDetailFromSqlite,
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "./sqlite-storage";

function makeResource(
  resourceType: "lora" | "model",
  name: string,
  overrides: Partial<Parameters<typeof upsertCivitaiResourceToSqlite>[1]> = {},
): Parameters<typeof upsertCivitaiResourceToSqlite>[1] {
  return {
    resourceType,
    civitaiModelId: Math.floor(Math.random() * 1000000),
    civitaiModelVersionId: Math.floor(Math.random() * 1000000),
    name,
    versionName: "v1",
    hash: `${name}-hash`,
    baseModel: "Illustrious",
    trainedWords: resourceType === "lora" ? [`${name} trigger`] : [],
    tags: ["portrait"],
    description: `${name} description.`,
    creator: "maker",
    downloadUrl: "https://civitai.com/download/models/1",
    filesJson: [],
    officialImagesJson: [],
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style"] : [],
    usageGuide: "",
    recommendations: [],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: false,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: null,
    ...overrides,
  };
}

describe("Civitai sqlite-vec embedding index", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-embedding-index-"));
    db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"), {
      allowExtensions: true,
    });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("keeps extension loading disabled outside sqlite-vec load windows", () => {
    expect(() => db.loadExtension?.("missing-extension")).toThrow("extension loading is not allowed");

    loadSqliteVecExtension(db);

    expect(() => db.loadExtension?.("missing-extension")).toThrow("extension loading is not allowed");
  });

  it("requires the BM25 index to exist and match source resources before embedding-only reindexing", () => {
    const cyberLora = upsertCivitaiResourceToSqlite(
      db,
      makeResource("lora", "Cyber Neon LoRA", {
        tags: ["cyberpunk", "neon"],
        trainedWords: ["neon rain"],
      }),
    ).resource;

    expect(() => listCivitaiResourceEmbeddingInputs(db)).toThrow(CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE);
    expect(() =>
      rebuildCivitaiEmbeddingIndex(db, {
        model: "embedding-model",
        embeddings: [{
          chunkFingerprint: "chunk",
          chunkIndex: 0,
          resourceId: cyberLora.id,
          resourceType: "lora",
          sourceFingerprint: "source",
          embedding: [1, 0],
        }],
      }),
    ).toThrow(CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE);

    rebuildCivitaiSearchIndex(db);
    upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Late Checkpoint", {
        tags: ["checkpoint"],
      }),
    );

    expect(() => listCivitaiResourceEmbeddingInputs(db)).toThrow(CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE);
    expect(readCivitaiEmbeddingIndexMetadata(db)).toBeNull();
  });

  it("splits long FTS source text into overlapping embedding chunks", () => {
    const longDescription = "cinematic neon detail ".repeat(700);
    const resource = upsertCivitaiResourceToSqlite(
      db,
      makeResource("lora", "Long Text LoRA", {
        description: longDescription,
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);

    const input = listCivitaiResourceEmbeddingInputs(db).find((entry) => entry.resourceId === resource.id);
    const inputs = listCivitaiResourceEmbeddingInputs(db).filter((entry) => entry.resourceId === resource.id);

    expect(inputs.length).toBeGreaterThan(1);
    expect(input?.text.length).toBe(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS);
    expect(input?.text.startsWith("Long Text LoRA")).toBe(true);
    expect(input).toBeDefined();
    expect(inputs[1]?.text.startsWith(input?.text.slice(-CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS) ?? "")).toBe(true);
  });

  it("replaces unpaired surrogate code units before embedding", () => {
    const unpairedLowSurrogate = String.fromCharCode(0xdd27);
    const unpairedHighSurrogate = String.fromCharCode(0xd83d);
    const validEmoji = "🧰";

    const raw = `valid ${validEmoji} bad-low ${unpairedLowSurrogate} bad-high ${unpairedHighSurrogate}`;
    const sanitized = sanitizeCivitaiEmbeddingTextForUtf8(raw);

    expect(sanitized).toContain(validEmoji);
    expect(sanitized).toContain("\uFFFD");
    expect(() => encodeURIComponent(sanitized)).not.toThrow();

    const chunks = chunkCivitaiEmbeddingText(raw);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(sanitized);
  });

  it("keeps embedding chunks encodable when surrogate pairs cross chunk boundaries", () => {
    const raw = `${"a".repeat(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS - 1)}🧰tail`;
    const chunks = chunkCivitaiEmbeddingText(raw);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(() => encodeURIComponent(chunk)).not.toThrow();
    }
  });

  it("uses complete source text for freshness instead of chunk text", () => {
    const firstChunk = `${"a".repeat(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS)}tail-a`;
    const changedTail = `${"a".repeat(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS)}tail-b`;

    expect(chunkCivitaiEmbeddingText(firstChunk)[0]).toBe(chunkCivitaiEmbeddingText(changedTail)[0]);

    const resource = upsertCivitaiResourceToSqlite(
      db,
      makeResource("lora", "Tail Freshness LoRA", {
        description: firstChunk,
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((input) => ({
        chunkFingerprint: input.chunkFingerprint,
        chunkIndex: input.chunkIndex,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        sourceFingerprint: input.sourceFingerprint,
        embedding: [1, 0],
      })),
    });

    db.prepare(`
      UPDATE civitai_resource_search_fts
      SET search_text = ?
      WHERE resource_id = ?
    `).run(changedTail, resource.id);

    expect(isCivitaiEmbeddingIndexAvailable(db, "embedding-model")).toBe(false);
  });

  it("stores only derived vectors and metadata while preserving Civitai resource business rows", () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Cyber Neon Checkpoint", {
        tags: ["cyberpunk", "neon"],
        usageGuide: "Use for cinematic cyberpunk neon rain.",
      }),
    ).resource;
    const lora = upsertCivitaiResourceToSqlite(
      db,
      makeResource("lora", "Soft Portrait LoRA", {
        tags: ["portrait", "soft"],
        trainedWords: ["soft portrait"],
      }),
    ).resource;
    const portraitCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Soft Portrait Checkpoint", {
        tags: ["portrait", "soft"],
      }),
    ).resource;
    const beforeCheckpoint = getCivitaiResourceDetailFromSqlite(db, checkpoint.id);

    rebuildCivitaiSearchIndex(db);
    const inputs = listCivitaiResourceEmbeddingInputs(db);

    expect(inputs.map((input) => input.resourceId).sort()).toEqual(
      [checkpoint.id, lora.id, portraitCheckpoint.id].sort(),
    );
    expect(inputs.find((input) => input.resourceId === checkpoint.id)?.text).toContain("Cyber Neon Checkpoint");

    expect(
      rebuildCivitaiEmbeddingIndex(db, {
        model: "embedding-model",
        embeddings: inputs.map((input) => ({
          chunkFingerprint: input.chunkFingerprint,
          chunkIndex: input.chunkIndex,
          resourceId: input.resourceId,
          resourceType: input.resourceType,
          sourceFingerprint: input.sourceFingerprint,
          embedding: input.resourceId === checkpoint.id ? [1, 0, 0] : [0, 1, 0],
        })),
      }),
    ).toEqual({ indexedCount: inputs.length, dimensions: 3 });

    const metadata = readCivitaiEmbeddingIndexMetadata(db);
    expect(metadata).toMatchObject({
      dimensions: 3,
      model: "embedding-model",
    });
    expect(metadata?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(isCivitaiEmbeddingIndexAvailable(db, "embedding-model")).toBe(true);
    expect(isCivitaiEmbeddingIndexAvailable(db, "other-model")).toBe(false);
    expect(getCivitaiResourceDetailFromSqlite(db, checkpoint.id)).toEqual(beforeCheckpoint);

    const ranked = rankCivitaiResourceIdsByEmbeddingIndex(db, {
      embedding: [1, 0, 0],
      resourceIds: [portraitCheckpoint.id, checkpoint.id],
      resourceType: "model",
    });

    expect(Array.from(ranked.keys())).toEqual([checkpoint.id, portraitCheckpoint.id]);
  });

  it("rejects legacy single-vector embedding tables even when metadata source is current", () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Legacy Single Vector Checkpoint", {
        tags: ["legacy", "vector"],
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);
    const inputs = listCivitaiResourceEmbeddingInputs(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "embedding-model",
      embeddings: inputs.map((input) => ({
        chunkFingerprint: input.chunkFingerprint,
        chunkIndex: input.chunkIndex,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        sourceFingerprint: input.sourceFingerprint,
        embedding: [1, 0],
      })),
    });
    const sourceFingerprint = readCivitaiEmbeddingIndexMetadata(db)?.sourceFingerprint;
    expect(sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);

    db.exec(`
      DROP TABLE IF EXISTS civitai_resource_embedding_vec;
      DROP TABLE IF EXISTS civitai_resource_embedding_index_metadata;

      CREATE VIRTUAL TABLE civitai_resource_embedding_vec
      USING vec0(
        resource_id TEXT PRIMARY KEY,
        resource_type TEXT,
        embedding float[2]
      );

      CREATE TABLE civitai_resource_embedding_index_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO civitai_resource_embedding_vec (resource_id, resource_type, embedding)
      VALUES (?, ?, ?)
    `).run(checkpoint.id, "model", float32EmbeddingBlob([1, 0]));
    const writeMetadata = db.prepare(`
      INSERT INTO civitai_resource_embedding_index_metadata (key, value)
      VALUES (?, ?)
    `);
    writeMetadata.run("model", "embedding-model");
    writeMetadata.run("dimensions", "2");
    writeMetadata.run("source_fingerprint", sourceFingerprint ?? "");
    writeMetadata.run("indexed_at", new Date().toISOString());
    writeMetadata.run("indexed_count", "1");

    expect(isCivitaiEmbeddingIndexAvailable(db, "embedding-model")).toBe(false);
    expect(() => assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toThrow(
      CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
    );

    writeMetadata.run("schema_version", "2");
    writeMetadata.run("chunk_max_chars", String(CIVITAI_EMBEDDING_CHUNK_MAX_CHARS));
    writeMetadata.run("chunk_overlap_chars", String(CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS));

    expect(isCivitaiEmbeddingIndexAvailable(db, "embedding-model")).toBe(false);
    expect(() => assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toThrow(
      CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
    );
  });

  it("rolls back vector table replacement when chunk insertion fails", () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Rollback Checkpoint", {
        tags: ["rollback", "stable"],
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);
    const input = listCivitaiResourceEmbeddingInputs(db).find((entry) => entry.resourceId === checkpoint.id);
    expect(input).toBeDefined();

    rebuildCivitaiEmbeddingIndex(db, {
      model: "embedding-model",
      embeddings: [{
        chunkFingerprint: input?.chunkFingerprint ?? "",
        chunkIndex: input?.chunkIndex ?? 0,
        resourceId: checkpoint.id,
        resourceType: "model",
        sourceFingerprint: input?.sourceFingerprint ?? "",
        embedding: [1, 0],
      }],
    });

    expect(() =>
      rebuildCivitaiEmbeddingIndex(db, {
        model: "embedding-model",
        embeddings: [{
          chunkFingerprint: input?.chunkFingerprint ?? "",
          chunkIndex: input?.chunkIndex ?? 0,
          resourceId: checkpoint.id,
          resourceType: "model",
          sourceFingerprint: input?.sourceFingerprint ?? "",
          embedding: [Number.NaN, 1],
        }],
      }),
    ).toThrow("Embedding vector contains a non-finite value.");

    expect(assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toMatchObject({
      dimensions: 2,
      model: "embedding-model",
    });
    const ranked = rankCivitaiResourceIdsByEmbeddingIndex(db, {
      embedding: [1, 0],
      resourceIds: [checkpoint.id],
      resourceType: "model",
    });
    expect(Array.from(ranked.keys())).toEqual([checkpoint.id]);
  });

  it("detects stale embedding metadata when BM25 source text changes after reindexing", () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Cyber Neon Checkpoint", {
        tags: ["cyberpunk", "neon"],
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((input) => ({
        chunkFingerprint: input.chunkFingerprint,
        chunkIndex: input.chunkIndex,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        sourceFingerprint: input.sourceFingerprint,
        embedding: [1, 0],
      })),
    });

    expect(assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toMatchObject({
      model: "embedding-model",
      dimensions: 2,
    });

    db.prepare(`
      UPDATE civitai_resource_search_fts
      SET search_text = ?
      WHERE resource_id = ?
    `).run("changed source text", checkpoint.id);

    expect(isCivitaiEmbeddingIndexAvailable(db, "embedding-model")).toBe(false);
    expect(() => assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toThrow(
      CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
    );
  });

  it("ranks each resource by its nearest embedding chunk", () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Chunked Checkpoint", {
        description: "chunked semantic source",
      }),
    ).resource;
    const portraitCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Portrait Checkpoint", {
        description: "portrait source",
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);
    const inputs = listCivitaiResourceEmbeddingInputs(db);
    const checkpointInput = inputs.find((input) => input.resourceId === checkpoint.id);
    const portraitInput = inputs.find((input) => input.resourceId === portraitCheckpoint.id);
    expect(checkpointInput).toBeDefined();
    expect(portraitInput).toBeDefined();

    rebuildCivitaiEmbeddingIndex(db, {
      model: "embedding-model",
      embeddings: [
        {
          chunkFingerprint: `${checkpointInput?.chunkFingerprint}-far`,
          chunkIndex: 0,
          resourceId: checkpoint.id,
          resourceType: "model",
          sourceFingerprint: checkpointInput?.sourceFingerprint ?? "",
          embedding: [0, 1],
        },
        {
          chunkFingerprint: `${checkpointInput?.chunkFingerprint}-near`,
          chunkIndex: 1,
          resourceId: checkpoint.id,
          resourceType: "model",
          sourceFingerprint: checkpointInput?.sourceFingerprint ?? "",
          embedding: [1, 0],
        },
        {
          chunkFingerprint: portraitInput?.chunkFingerprint ?? "",
          chunkIndex: 0,
          resourceId: portraitCheckpoint.id,
          resourceType: "model",
          sourceFingerprint: portraitInput?.sourceFingerprint ?? "",
          embedding: [0, 1],
        },
      ],
    });

    const ranked = rankCivitaiResourceIdsByEmbeddingIndex(db, {
      embedding: [1, 0],
      resourceIds: [portraitCheckpoint.id, checkpoint.id],
      resourceType: "model",
    });

    expect(Array.from(ranked.keys())).toEqual([checkpoint.id, portraitCheckpoint.id]);
  });
});
