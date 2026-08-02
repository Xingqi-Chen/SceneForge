// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCivitaiResourceSearchTextFromUpsertInput,
  listCivitaiResourceSearchSources,
  listCivitaiSearchIndexSources,
  rankCivitaiResourceIdsBySearchIndex,
  rebuildCivitaiSearchIndex,
} from "./civitai-search-index";
import {
  CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE,
  CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
  CIVITAI_EMBEDDING_CHUNK_MAX_CHARS,
  CIVITAI_EMBEDDING_CHUNK_OVERLAP_CHARS,
  CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE,
  CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE,
  CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
  applyPreparedCivitaiIncrementalEmbeddingUpdate,
  assertCivitaiEmbeddingIndexReady,
  assertCivitaiIncrementalIndexBaselineUnchanged,
  chunkCivitaiEmbeddingText,
  fingerprintCivitaiEmbeddingSources,
  float32EmbeddingBlob,
  isCivitaiEmbeddingIndexAvailable,
  listCivitaiResourceEmbeddingInputs,
  loadSqliteVecExtension,
  prepareCivitaiIncrementalEmbeddingUpdate,
  rankCivitaiResourceIdsByEmbeddingIndex,
  readCivitaiIncrementalIndexBaseline,
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

function rebuildHealthyIndexes(
  db: SceneForgeSqliteDatabase,
  model = "embedding-model",
): ReturnType<typeof listCivitaiResourceEmbeddingInputs> {
  rebuildCivitaiSearchIndex(db);
  const inputs = listCivitaiResourceEmbeddingInputs(db);
  rebuildCivitaiEmbeddingIndex(db, {
    model,
    embeddings: inputs.map((input, index) => ({
      chunkFingerprint: input.chunkFingerprint,
      chunkIndex: input.chunkIndex,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      sourceFingerprint: input.sourceFingerprint,
      embedding: index % 2 === 0 ? [1, 0] : [0, 1],
    })),
  });
  return inputs;
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

  it("canonicalizes category permutations and duplicates in resource search text", () => {
    const resourceInput = makeResource("lora", "Canonical Category LoRA", {
      categories: ["style", "lighting"],
    });
    const canonicalSearchText = buildCivitaiResourceSearchTextFromUpsertInput(resourceInput);

    expect(buildCivitaiResourceSearchTextFromUpsertInput({
      ...resourceInput,
      categories: ["lighting", "style"],
    })).toBe(canonicalSearchText);
    expect(buildCivitaiResourceSearchTextFromUpsertInput({
      ...resourceInput,
      categories: ["style", "lighting", "style"],
    })).toBe(canonicalSearchText);
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
      CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE,
    );
  });

  it("bootstraps an empty library and writes ready FTS, vector, and global metadata", async () => {
    const resourceInput = makeResource("lora", "Bootstrap Neon LoRA", {
      civitaiModelId: 7001,
      civitaiModelVersionId: 7002,
      tags: ["bootstrap", "neon"],
    });
    const searchText = buildCivitaiResourceSearchTextFromUpsertInput(resourceInput);
    const createEmbedding = vi.fn(async (request: { input: string | string[] }) => ({
      embeddings: (Array.isArray(request.input) ? request.input : [request.input]).map(() => [0, 1]),
    }));

    const prepared = await prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding,
      model: "embedding-model",
      sources: [{
        resourceKey: "bootstrap-lora",
        resourceType: "lora",
        searchText,
      }],
    });

    expect(prepared.baseline.mode).toBe("bootstrap");
    db.exec("BEGIN IMMEDIATE");
    try {
      assertCivitaiIncrementalIndexBaselineUnchanged(db, prepared.baseline);
      const resource = upsertCivitaiResourceToSqlite(db, resourceInput).resource;
      applyPreparedCivitaiIncrementalEmbeddingUpdate(db, {
        prepared,
        resources: [{
          resourceId: resource.id,
          resourceKey: "bootstrap-lora",
          resourceType: "lora",
          searchText,
        }],
      });
      db.exec("COMMIT");

      const metadata = assertCivitaiEmbeddingIndexReady(db, "embedding-model");
      const indexedSources = listCivitaiSearchIndexSources(db);
      expect(createEmbedding).toHaveBeenCalledTimes(1);
      expect(metadata).toMatchObject({
        dimensions: 2,
        indexedCount: prepared.embeddings.length,
        model: "embedding-model",
      });
      expect(metadata.indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(metadata.sourceFingerprint).toBe(fingerprintCivitaiEmbeddingSources(
        indexedSources.map((source) => ({
          resourceId: source.resourceId,
          resourceType: source.resourceType,
          text: source.searchText,
        })),
      ));
      expect(rankCivitaiResourceIdsBySearchIndex(db, {
        desiredEffect: "bootstrap neon",
        resourceIds: [resource.id],
        resourceType: "lora",
      }).has(resource.id)).toBe(true);
      expect(Array.from(rankCivitaiResourceIdsByEmbeddingIndex(db, {
        embedding: [0, 1],
        resourceIds: [resource.id],
        resourceType: "lora",
      }).keys())).toEqual([resource.id]);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  it("embeds only new chunks against a healthy index and keeps existing resources recommendable", async () => {
    const existing = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Existing Portrait Checkpoint", {
        civitaiModelId: 7101,
        civitaiModelVersionId: 7102,
      }),
    ).resource;
    const existingInputs = rebuildHealthyIndexes(db);
    const metadataBefore = readCivitaiEmbeddingIndexMetadata(db);
    const resourceInput = makeResource("lora", "Incremental Neon LoRA", {
      civitaiModelId: 7103,
      civitaiModelVersionId: 7104,
      description: "incremental neon rain ".repeat(300),
      tags: ["incremental", "neon"],
    });
    const searchText = buildCivitaiResourceSearchTextFromUpsertInput(resourceInput);
    const expectedChunks = chunkCivitaiEmbeddingText(searchText);
    const createEmbedding = vi.fn(async (request: { input: string | string[]; model?: string }) => ({
      embeddings: (Array.isArray(request.input) ? request.input : [request.input]).map(() => [0, 1]),
    }));

    const prepared = await prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding,
      model: "embedding-model",
      sources: [{
        resourceKey: "new-lora",
        resourceType: "lora",
        searchText,
      }],
    });
    const embeddedTexts = createEmbedding.mock.calls.flatMap(([request]) =>
      Array.isArray(request.input) ? request.input : [request.input]
    );

    expect(prepared.baseline.mode).toBe("incremental");
    expect(embeddedTexts).toEqual(expectedChunks);
    expect(embeddedTexts).not.toContain(existingInputs[0]?.text);

    db.exec("BEGIN IMMEDIATE");
    try {
      assertCivitaiIncrementalIndexBaselineUnchanged(db, prepared.baseline);
      const added = upsertCivitaiResourceToSqlite(db, resourceInput).resource;
      applyPreparedCivitaiIncrementalEmbeddingUpdate(db, {
        prepared,
        resources: [{
          resourceId: added.id,
          resourceKey: "new-lora",
          resourceType: "lora",
          searchText,
        }],
      });
      db.exec("COMMIT");

      const metadataAfter = assertCivitaiEmbeddingIndexReady(db, "embedding-model");
      expect(metadataAfter.indexedCount).toBe(existingInputs.length + expectedChunks.length);
      expect(metadataAfter.sourceFingerprint).not.toBe(metadataBefore?.sourceFingerprint);
      expect(Array.from(rankCivitaiResourceIdsByEmbeddingIndex(db, {
        embedding: [1, 0],
        resourceIds: [existing.id],
        resourceType: "model",
      }).keys())).toEqual([existing.id]);
      expect(rankCivitaiResourceIdsBySearchIndex(db, {
        desiredEffect: "incremental neon",
        resourceIds: [added.id],
        resourceType: "lora",
      }).has(added.id)).toBe(true);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  it("preserves multi-category order when applying an incremental resource update", async () => {
    upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Multi-category Baseline Checkpoint", {
        civitaiModelId: 7151,
        civitaiModelVersionId: 7152,
      }),
    );
    rebuildHealthyIndexes(db);
    const resourceInput = makeResource("lora", "Image 136499926 Multi-category LoRA", {
      civitaiModelId: 7153,
      civitaiModelVersionId: 7154,
      category: "style",
      categories: ["style", "lighting"],
    });
    const searchText = buildCivitaiResourceSearchTextFromUpsertInput(resourceInput);
    const prepared = await prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding: async ({ input }) => ({
        embeddings: (Array.isArray(input) ? input : [input]).map(() => [0, 1]),
      }),
      model: "embedding-model",
      sources: [{
        resourceKey: "image-136499926-multi-category-lora",
        resourceType: "lora",
        searchText,
      }],
    });

    db.exec("BEGIN IMMEDIATE");
    try {
      assertCivitaiIncrementalIndexBaselineUnchanged(db, prepared.baseline);
      const added = upsertCivitaiResourceToSqlite(db, resourceInput).resource;

      expect(added.categories).toEqual(["style", "lighting"]);
      expect(db.prepare(`
        SELECT category, sort_order
        FROM civitai_resource_categories
        WHERE resource_id = ?
        ORDER BY sort_order, category
      `).all(added.id)).toEqual([
        { category: "style", sort_order: 0 },
        { category: "lighting", sort_order: 1 },
      ]);
      expect(listCivitaiResourceSearchSources(db).find(
        (source) => source.resourceId === added.id,
      )?.searchText).toBe(searchText);

      expect(() => applyPreparedCivitaiIncrementalEmbeddingUpdate(db, {
        prepared,
        resources: [{
          resourceId: added.id,
          resourceKey: "image-136499926-multi-category-lora",
          resourceType: "lora",
          searchText,
        }],
      })).not.toThrow();
      db.exec("COMMIT");

      expect(listCivitaiSearchIndexSources(db).find(
        (source) => source.resourceId === added.id,
      )?.searchText).toBe(searchText);
      expect(assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toBeTruthy();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  it.each([
    {
      name: "provider rejection",
      createEmbedding: async () => {
        throw new Error("provider-secret-detail");
      },
    },
    {
      name: "wrong vector count",
      createEmbedding: async () => ({ embeddings: [] }),
    },
    {
      name: "malformed vector",
      createEmbedding: async () => ({ embeddings: [["not-a-number"]] as unknown as number[][] }),
    },
    {
      name: "non-finite vector",
      createEmbedding: async () => ({ embeddings: [[Number.NaN, 0]] }),
    },
    {
      name: "Float32 overflow",
      createEmbedding: async () => ({ embeddings: [[Number.MAX_VALUE, 0]] }),
    },
    {
      name: "dimension mismatch",
      createEmbedding: async () => ({ embeddings: [[1, 0, 0]] }),
    },
  ])("sanitizes $name and leaves a healthy baseline untouched", async ({ createEmbedding }) => {
    const existing = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Atomic Baseline Checkpoint", {
        civitaiModelId: 7201,
        civitaiModelVersionId: 7202,
      }),
    ).resource;
    rebuildHealthyIndexes(db);
    const metadataBefore = readCivitaiEmbeddingIndexMetadata(db);
    const vectorCountBefore = db.prepare(`
      SELECT COUNT(*) AS count
      FROM civitai_resource_embedding_vec
    `).get();
    const sourceText = "private source text that must not leak";

    await expect(prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding,
      model: "embedding-model",
      sources: [{
        resourceKey: "failing-resource",
        resourceType: "lora",
        searchText: sourceText,
      }],
    })).rejects.toMatchObject({
      message: CIVITAI_INCREMENTAL_EMBEDDING_FAILED_MESSAGE,
      statusCode: 502,
    });

    expect(getCivitaiResourceDetailFromSqlite(db, existing.id)?.name).toBe("Atomic Baseline Checkpoint");
    expect(readCivitaiEmbeddingIndexMetadata(db)).toEqual(metadataBefore);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM civitai_resource_embedding_vec
    `).get()).toEqual(vectorCountBefore);
    await expect(prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding,
      model: "embedding-model",
      sources: [{
        resourceKey: "failing-resource",
        resourceType: "lora",
        searchText: sourceText,
      }],
    })).rejects.not.toThrow(/provider-secret-detail|private source text/);
  });

  it.each([
    {
      name: "ordinary table",
      createSql: `
        CREATE TABLE civitai_resource_search_fts (
          resource_id TEXT,
          resource_type TEXT,
          search_text TEXT
        )
      `,
    },
    {
      name: "wrong virtual-table module",
      createSql: `
        CREATE VIRTUAL TABLE civitai_resource_search_fts
        USING fts4(
          resource_id,
          resource_type,
          search_text,
          tokenize=unicode61
        )
      `,
    },
    {
      name: "wrong FTS5 tokenizer",
      createSql: `
        CREATE VIRTUAL TABLE civitai_resource_search_fts
        USING fts5(
          resource_id UNINDEXED,
          resource_type UNINDEXED,
          search_text,
          tokenize='porter'
        )
      `,
    },
  ])("rejects a $name FTS baseline before requesting embeddings", async ({ createSql }) => {
    upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Schema Validation Checkpoint", {
        civitaiModelId: 7251,
        civitaiModelVersionId: 7252,
      }),
    );
    rebuildHealthyIndexes(db);
    const indexedSources = listCivitaiSearchIndexSources(db);
    db.exec("DROP TABLE civitai_resource_search_fts");
    db.exec(createSql);
    const insert = db.prepare(`
      INSERT INTO civitai_resource_search_fts (resource_id, resource_type, search_text)
      VALUES (?, ?, ?)
    `);
    for (const source of indexedSources) {
      insert.run(source.resourceId, source.resourceType, source.searchText);
    }
    const createEmbedding = vi.fn(async () => ({ embeddings: [[0, 1]] }));

    await expect(prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding,
      model: "embedding-model",
      sources: [{
        resourceKey: "schema-new",
        resourceType: "lora",
        searchText: "Schema validation LoRA",
      }],
    })).rejects.toMatchObject({
      message: CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
      statusCode: 409,
    });
    expect(createEmbedding).not.toHaveBeenCalled();
  });

  it("rejects a vec0 embedding dimension that disagrees with metadata before requesting embeddings", async () => {
    upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Vector Schema Checkpoint", {
        civitaiModelId: 7261,
        civitaiModelVersionId: 7262,
      }),
    );
    rebuildHealthyIndexes(db);
    db.prepare(`
      UPDATE civitai_resource_embedding_index_metadata
      SET value = '3'
      WHERE key = 'dimensions'
    `).run();
    const createEmbedding = vi.fn(async () => ({ embeddings: [[0, 1, 0]] }));

    await expect(prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding,
      model: "embedding-model",
      sources: [{
        resourceKey: "vector-schema-new",
        resourceType: "lora",
        searchText: "Vector schema validation LoRA",
      }],
    })).rejects.toMatchObject({
      message: CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
      statusCode: 409,
    });
    expect(createEmbedding).not.toHaveBeenCalled();
  });

  it("requires full rebuild guidance for nonempty missing, stale, and incompatible indexes", () => {
    const input = makeResource("model", "Needs Repair Checkpoint", {
      civitaiModelId: 7301,
      civitaiModelVersionId: 7302,
    });
    upsertCivitaiResourceToSqlite(db, input);

    expect(() => readCivitaiIncrementalIndexBaseline(db, "embedding-model")).toThrow(
      CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
    );

    rebuildHealthyIndexes(db);
    expect(() => readCivitaiIncrementalIndexBaseline(db, "other-model")).toThrow(
      CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
    );

    upsertCivitaiResourceToSqlite(db, {
      ...input,
      description: "Business search text changed without derived-index repair.",
    });
    expect(() => readCivitaiIncrementalIndexBaseline(db, "embedding-model")).toThrow(
      CIVITAI_INCREMENTAL_INDEX_REBUILD_MESSAGE,
    );
  });

  it("detects a concurrent baseline metadata change before business writes begin", async () => {
    upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Concurrent Baseline Checkpoint", {
        civitaiModelId: 7401,
        civitaiModelVersionId: 7402,
      }),
    );
    rebuildHealthyIndexes(db);
    const prepared = await prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding: async () => ({ embeddings: [[0, 1]] }),
      model: "embedding-model",
      sources: [{
        resourceKey: "concurrent-new",
        resourceType: "lora",
        searchText: "Concurrent new LoRA",
      }],
    });
    db.prepare(`
      UPDATE civitai_resource_embedding_index_metadata
      SET value = ?
      WHERE key = 'indexed_at'
    `).run("2099-01-01T00:00:00.000Z");

    expect(() => assertCivitaiIncrementalIndexBaselineUnchanged(db, prepared.baseline)).toThrow(
      CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE,
    );
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM civitai_resources
      WHERE name = 'Concurrent new LoRA'
    `).get()).toEqual({ count: 0 });
  });

  it("rolls back business and derived rows when prepared resource identities no longer match", async () => {
    upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Rollback Baseline", {
        civitaiModelId: 7501,
        civitaiModelVersionId: 7502,
      }),
    );
    rebuildHealthyIndexes(db);
    const input = makeResource("lora", "Rollback New LoRA", {
      civitaiModelId: 7503,
      civitaiModelVersionId: 7504,
    });
    const searchText = buildCivitaiResourceSearchTextFromUpsertInput(input);
    const prepared = await prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding: async () => ({ embeddings: [[0, 1]] }),
      model: "embedding-model",
      sources: [{
        resourceKey: "rollback-new",
        resourceType: "lora",
        searchText,
      }],
    });
    const metadataBefore = readCivitaiEmbeddingIndexMetadata(db);

    db.exec("BEGIN IMMEDIATE");
    try {
      const resource = upsertCivitaiResourceToSqlite(db, input).resource;
      applyPreparedCivitaiIncrementalEmbeddingUpdate(db, {
        prepared,
        resources: [{
          resourceId: resource.id,
          resourceKey: "rollback-new",
          resourceType: "lora",
          searchText: `${searchText} changed-after-prepare`,
        }],
      });
      db.exec("COMMIT");
      throw new Error("Expected apply to fail.");
    } catch (error) {
      db.exec("ROLLBACK");
      expect(error).toMatchObject({ message: CIVITAI_INCREMENTAL_BASELINE_CHANGED_MESSAGE });
    }

    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM civitai_resources
      WHERE civitai_model_version_id = 7504
    `).get()).toEqual({ count: 0 });
    expect(readCivitaiEmbeddingIndexMetadata(db)).toEqual(metadataBefore);
    expect(assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toBeTruthy();
  });

  it("removes obsolete business, FTS, and vector rows in the same committed update", async () => {
    const obsoleteInput = makeResource("lora", "Obsolete Conflict LoRA", {
      civitaiModelId: 7601,
      civitaiModelVersionId: 7602,
    });
    const keptInput = makeResource("model", "Kept Conflict Checkpoint", {
      civitaiModelId: 7603,
      civitaiModelVersionId: 7604,
    });
    const obsolete = upsertCivitaiResourceToSqlite(db, obsoleteInput).resource;
    const kept = upsertCivitaiResourceToSqlite(db, keptInput).resource;
    rebuildHealthyIndexes(db);
    const changedInput = {
      ...keptInput,
      usageGuide: "Changed and re-embedded guidance.",
    };
    const changedSearchText = buildCivitaiResourceSearchTextFromUpsertInput(changedInput);
    const prepared = await prepareCivitaiIncrementalEmbeddingUpdate(db, {
      createEmbedding: async () => ({ embeddings: [[0, 1]] }),
      model: "embedding-model",
      sources: [{
        resourceKey: kept.id,
        resourceType: "model",
        searchText: changedSearchText,
      }],
    });

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM civitai_resources WHERE id = ?").run(obsolete.id);
      const updated = upsertCivitaiResourceToSqlite(db, changedInput).resource;
      applyPreparedCivitaiIncrementalEmbeddingUpdate(db, {
        obsoleteResourceIds: [obsolete.id],
        prepared,
        resources: [{
          resourceId: updated.id,
          resourceKey: kept.id,
          resourceType: "model",
          searchText: changedSearchText,
        }],
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM civitai_resource_search_fts
      WHERE resource_id = ?
    `).get(obsolete.id)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM civitai_resource_embedding_vec
      WHERE resource_id = ?
    `).get(obsolete.id)).toEqual({ count: 0 });
    expect(assertCivitaiEmbeddingIndexReady(db, "embedding-model")).toBeTruthy();
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
