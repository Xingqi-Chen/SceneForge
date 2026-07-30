// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmEmbeddingRequest, LlmEmbeddingResponse } from "@/features/llm";
import {
  assertCivitaiEmbeddingIndexReady,
  listCivitaiResourceEmbeddingInputs,
  rankCivitaiResourceIdsByEmbeddingIndex,
  readCivitaiEmbeddingIndexMetadata,
  rebuildCivitaiEmbeddingIndex,
} from "@/features/persistence/civitai-embedding-index";
import {
  rankCivitaiResourceIdsBySearchIndex,
  rebuildCivitaiSearchIndex,
} from "@/features/persistence/civitai-search-index";
import {
  getCivitaiResourceDetailFromSqlite,
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

import type { CivitaiClient } from "./client";
import {
  applyCivitaiResourceReanalysisToSqlite,
  importCivitaiImageUrlToSqlite,
  parseCivitaiImageUrl,
} from "./service";
import type { CivitaiResourceUpsertInput } from "./types";

function makeVersion(modelVersionId: number, resourceType: "lora" | "model") {
  return {
    resourceType,
    civitaiModelId: modelVersionId + 1000,
    civitaiModelVersionId: modelVersionId,
    name: resourceType === "lora" ? `Incremental LoRA ${modelVersionId}` : `Incremental Model ${modelVersionId}`,
    versionName: "v1",
    hash: `hash-${modelVersionId}`,
    baseModel: "Illustrious",
    trainedWords: resourceType === "lora" ? [`trigger_${modelVersionId}`] : [],
    tags: ["incremental", resourceType],
    description: `Searchable incremental resource ${modelVersionId}.`,
    creator: "fixture",
    downloadUrl: null,
    filesJson: null,
    officialImagesJson: null,
    nsfw: false,
    rawVersionJson: {},
  };
}

function makeClient(imageId: number, versions: Array<ReturnType<typeof makeVersion>>): CivitaiClient {
  return {
    async getImageById() {
      return {
        civitaiImageId: imageId,
        civitaiImagePageUrl: `https://civitai.com/images/${imageId}`,
        imageUrl: null,
        width: 1024,
        height: 1024,
        nsfw: false,
        nsfwLevel: null,
        browsingLevel: 1,
        createdAtOnCivitai: null,
        postId: null,
        username: "fixture",
        baseModel: "Illustrious",
        prompt: "incremental neon portrait",
        negativePrompt: null,
        sampler: "Euler a",
        steps: 24,
        cfgScale: 5,
        seed: "42",
        modelVersionIds: versions.map((version) => version.civitaiModelVersionId),
        resources: [],
        rawMetaJson: {},
      };
    },
    async getModelVersion(modelVersionId) {
      const version = versions.find((candidate) => candidate.civitaiModelVersionId === modelVersionId);
      if (!version) {
        throw new Error("Missing fixture version.");
      }
      return version;
    },
    async getModelVersionByHash() {
      throw new Error("Hash lookup is not used by this fixture.");
    },
    async searchModelVersionByName() {
      return null;
    },
  };
}

const fallbackEnricher = async () => ({
  usageGuide: null,
  categories: ["other" as const],
  triggerWords: [],
  recommendations: [],
  aiNsfwLevel: "unknown" as const,
  aiNsfwConfidence: null,
  aiNsfwReason: null,
  status: "fallback" as const,
  error: null,
});

function embeddingResponse(request: LlmEmbeddingRequest): LlmEmbeddingResponse {
  return {
    embeddings: (Array.isArray(request.input) ? request.input : [request.input]).map(
      (_, index) => [index === 0 ? 1 : 0, index === 0 ? 0 : 1],
    ),
  };
}

function makeResourceInput(
  resourceType: "lora" | "model",
  modelVersionId: number,
  overrides: Partial<CivitaiResourceUpsertInput> = {},
): CivitaiResourceUpsertInput {
  const version = makeVersion(modelVersionId, resourceType);
  return {
    ...version,
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style"] : [],
    usageGuide: "",
    recommendations: [],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    ...overrides,
  };
}

describe("Civitai incremental import and reanalysis integration", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;
  let previousEmbeddingModel: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-incremental-"));
    previousEmbeddingModel = process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
    process.env.LITELLM_CIVITAI_EMBEDDING_MODEL = "test-embedding-model";
    db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"), {
      allowExtensions: true,
    });
  });

  afterEach(async () => {
    db.close();
    if (previousEmbeddingModel === undefined) {
      delete process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
    } else {
      process.env.LITELLM_CIVITAI_EMBEDDING_MODEL = previousEmbeddingModel;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("keeps parse preview free of embedding calls and derived-index or business writes", async () => {
    const client = makeClient(8101, [makeVersion(8102, "lora")]);

    const preview = await parseCivitaiImageUrl({
      client,
      db,
      enricher: fallbackEnricher,
      imageUrl: "https://civitai.com/images/8101",
    });

    expect(preview.resources).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM imported_images").get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name IN (
        'civitai_resource_search_fts',
        'civitai_resource_embedding_vec',
        'civitai_resource_embedding_index_metadata'
      )
    `).get()).toEqual({ count: 0 });
  });

  it("bootstraps a multi-resource import atomically and makes both resources immediately recommendable", async () => {
    const client = makeClient(8201, [
      makeVersion(8202, "model"),
      makeVersion(8203, "lora"),
    ]);
    const createEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => embeddingResponse(request));

    const result = await importCivitaiImageUrlToSqlite({
      client,
      createEmbedding,
      db,
      enricher: fallbackEnricher,
      imageUrl: "https://civitai.com/images/8201",
    });

    expect(result.resources).toHaveLength(2);
    expect(createEmbedding).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM imported_images").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM image_resource_usages").get()).toEqual({ count: 2 });
    const metadata = assertCivitaiEmbeddingIndexReady(db, "test-embedding-model");
    expect(metadata.indexedCount).toBe(2);

    for (const entry of result.resources) {
      expect(rankCivitaiResourceIdsBySearchIndex(db, {
        desiredEffect: "incremental",
        resourceIds: [entry.resource.id],
        resourceType: entry.resource.resourceType as "lora" | "model",
      }).has(entry.resource.id)).toBe(true);
      expect(Array.from(rankCivitaiResourceIdsByEmbeddingIndex(db, {
        embedding: entry.resource.resourceType === "model" ? [1, 0] : [0, 1],
        resourceIds: [entry.resource.id],
        resourceType: entry.resource.resourceType as "lora" | "model",
      }).keys())).toEqual([entry.resource.id]);
    }
  });

  it("re-prepares once after an import baseline conflict without duplicating results or writes", async () => {
    const existingInput = makeResourceInput("lora", 8251);
    const existing = upsertCivitaiResourceToSqlite(db, existingInput).resource;
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((input) => ({
        chunkFingerprint: input.chunkFingerprint,
        chunkIndex: input.chunkIndex,
        embedding: [1, 0],
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        sourceFingerprint: input.sourceFingerprint,
      })),
    });
    const client = makeClient(8250, [
      makeVersion(8251, "lora"),
      makeVersion(8252, "model"),
    ]);
    let embeddingCallCount = 0;
    const createEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => {
      embeddingCallCount += 1;
      if (embeddingCallCount === 1) {
        db.prepare(`
          UPDATE civitai_resource_embedding_index_metadata
          SET value = ?
          WHERE key = 'indexed_at'
        `).run("2026-07-30T01:00:00.000Z");
      }
      return embeddingResponse(request);
    });

    const result = await importCivitaiImageUrlToSqlite({
      client,
      createEmbedding,
      db,
      enricher: fallbackEnricher,
      imageUrl: "https://civitai.com/images/8250",
    });

    expect(createEmbedding).toHaveBeenCalledTimes(2);
    expect(result.resources).toHaveLength(2);
    expect(result.resources.filter((entry) => entry.isNewResource)).toHaveLength(1);
    expect(new Set(result.resources.map((entry) => entry.resource.id)).size).toBe(2);
    expect(result.resources.find((entry) => !entry.isNewResource)?.resource.id).toBe(existing.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM imported_images").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM image_resource_usages").get()).toEqual({ count: 2 });
    expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toBeTruthy();
  });

  it("stops after one import retry when the baseline changes twice", async () => {
    const existingInput = makeResourceInput("lora", 8261);
    upsertCivitaiResourceToSqlite(db, existingInput);
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((input) => ({
        chunkFingerprint: input.chunkFingerprint,
        chunkIndex: input.chunkIndex,
        embedding: [1, 0],
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        sourceFingerprint: input.sourceFingerprint,
      })),
    });
    const client = makeClient(8260, [
      makeVersion(8261, "lora"),
      makeVersion(8262, "model"),
    ]);
    let embeddingCallCount = 0;
    const createEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => {
      embeddingCallCount += 1;
      db.prepare(`
        UPDATE civitai_resource_embedding_index_metadata
        SET value = ?
        WHERE key = 'indexed_at'
      `).run(`2026-07-30T02:00:0${embeddingCallCount}.000Z`);
      return embeddingResponse(request);
    });

    await expect(importCivitaiImageUrlToSqlite({
      client,
      createEmbedding,
      db,
      enricher: fallbackEnricher,
      imageUrl: "https://civitai.com/images/8260",
    })).rejects.toMatchObject({
      message: "The Civitai library or recommendation indexes changed during indexing. No database changes were saved. Try the operation again.",
      statusCode: 409,
    });

    expect(createEmbedding).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM imported_images").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM image_resource_usages").get()).toEqual({ count: 0 });
    expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toBeTruthy();
  });

  it("does not retry stale import classification when the target becomes existing", async () => {
    const targetVersionId = 8272;
    const client = makeClient(8270, [makeVersion(targetVersionId, "model")]);
    const concurrentInput = makeResourceInput("model", targetVersionId, {
      usageGuide: "Concurrent importer owns this metadata.",
    });
    const createEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => {
      upsertCivitaiResourceToSqlite(db, concurrentInput);
      rebuildCivitaiSearchIndex(db);
      rebuildCivitaiEmbeddingIndex(db, {
        model: "test-embedding-model",
        embeddings: listCivitaiResourceEmbeddingInputs(db).map((input) => ({
          chunkFingerprint: input.chunkFingerprint,
          chunkIndex: input.chunkIndex,
          embedding: [1, 0],
          resourceId: input.resourceId,
          resourceType: input.resourceType,
          sourceFingerprint: input.sourceFingerprint,
        })),
      });
      return embeddingResponse(request);
    });

    await expect(importCivitaiImageUrlToSqlite({
      client,
      createEmbedding,
      db,
      enricher: fallbackEnricher,
      imageUrl: "https://civitai.com/images/8270",
    })).rejects.toMatchObject({
      message: "The Civitai library or recommendation indexes changed during indexing. No database changes were saved. Try the operation again.",
      statusCode: 409,
    });

    expect(createEmbedding).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM imported_images").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM image_resource_usages").get()).toEqual({ count: 0 });
    const concurrentResource = db.prepare(`
      SELECT id
      FROM civitai_resources
      WHERE civitai_model_version_id = ?
    `).get(targetVersionId) as { id: string };
    expect(getCivitaiResourceDetailFromSqlite(db, concurrentResource.id)?.usageGuide).toBe(
      "Concurrent importer owns this metadata.",
    );
    expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toBeTruthy();
  });

  it.each([
    {
      name: "provider rejection",
      createEmbedding: async () => {
        throw new Error("private provider failure");
      },
    },
    {
      name: "wrong vector count",
      createEmbedding: async () => ({ embeddings: [[1, 0]] }),
    },
    {
      name: "non-finite vector",
      createEmbedding: async () => ({ embeddings: [[1, 0], [Number.POSITIVE_INFINITY, 0]] }),
    },
    {
      name: "mixed dimensions",
      createEmbedding: async () => ({ embeddings: [[1, 0], [1, 0, 0]] }),
    },
  ])("leaves no partial multi-resource import after $name", async ({ createEmbedding }) => {
    const client = makeClient(8301, [
      makeVersion(8302, "model"),
      makeVersion(8303, "lora"),
    ]);

    await expect(importCivitaiImageUrlToSqlite({
      client,
      createEmbedding,
      db,
      enricher: fallbackEnricher,
      imageUrl: "https://civitai.com/images/8301",
    })).rejects.toMatchObject({
      statusCode: 502,
    });

    expect(db.prepare("SELECT COUNT(*) AS count FROM imported_images").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM image_resource_usages").get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name IN (
        'civitai_resource_search_fts',
        'civitai_resource_embedding_vec',
        'civitai_resource_embedding_index_metadata'
      )
    `).get()).toEqual({ count: 0 });
  });

  it("skips embedding for unchanged search text and replaces only the changed resource", async () => {
    const firstInput = makeResourceInput("lora", 8401);
    const secondInput = makeResourceInput("model", 8402);
    const first = upsertCivitaiResourceToSqlite(db, firstInput).resource;
    const second = upsertCivitaiResourceToSqlite(db, secondInput).resource;
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((input) => ({
        chunkFingerprint: input.chunkFingerprint,
        chunkIndex: input.chunkIndex,
        embedding: input.resourceId === first.id ? [1, 0] : [0, 1],
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        sourceFingerprint: input.sourceFingerprint,
      })),
    });
    const secondVectorBefore = db.prepare(`
      SELECT chunk_fingerprint, source_fingerprint
      FROM civitai_resource_embedding_vec
      WHERE resource_id = ?
    `).all(second.id);
    const unchangedEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => embeddingResponse(request));
    const current = getCivitaiResourceDetailFromSqlite(db, first.id);
    expect(current).toBeDefined();

    await applyCivitaiResourceReanalysisToSqlite({
      createEmbedding: unchangedEmbedding,
      currentResource: current!,
      db,
      updatedInput: {
        ...firstInput,
        enrichmentStatus: "ai_enriched",
      },
    });

    expect(unchangedEmbedding).not.toHaveBeenCalled();
    expect(getCivitaiResourceDetailFromSqlite(db, first.id)?.enrichmentStatus).toBe("ai_enriched");

    const changedEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => embeddingResponse(request));
    const refreshed = getCivitaiResourceDetailFromSqlite(db, first.id);
    await applyCivitaiResourceReanalysisToSqlite({
      createEmbedding: changedEmbedding,
      currentResource: refreshed!,
      db,
      updatedInput: {
        ...firstInput,
        enrichmentStatus: "ai_enriched",
        usageGuide: "Changed cinematic neon guidance.",
      },
    });

    expect(changedEmbedding).toHaveBeenCalledTimes(1);
    expect(getCivitaiResourceDetailFromSqlite(db, first.id)?.usageGuide).toBe(
      "Changed cinematic neon guidance.",
    );
    expect(db.prepare(`
      SELECT chunk_fingerprint, source_fingerprint
      FROM civitai_resource_embedding_vec
      WHERE resource_id = ?
    `).all(second.id)).toEqual(secondVectorBefore);
    expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toBeTruthy();
  });

  it("re-prepares once after a reanalysis baseline conflict", async () => {
    const input = makeResourceInput("lora", 8451);
    const resource = upsertCivitaiResourceToSqlite(db, input).resource;
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((entry) => ({
        chunkFingerprint: entry.chunkFingerprint,
        chunkIndex: entry.chunkIndex,
        embedding: [1, 0],
        resourceId: entry.resourceId,
        resourceType: entry.resourceType,
        sourceFingerprint: entry.sourceFingerprint,
      })),
    });
    let embeddingCallCount = 0;
    const createEmbedding = vi.fn(async (request: LlmEmbeddingRequest) => {
      embeddingCallCount += 1;
      if (embeddingCallCount === 1) {
        db.prepare(`
          UPDATE civitai_resource_embedding_index_metadata
          SET value = ?
          WHERE key = 'indexed_at'
        `).run("2026-07-30T03:00:00.000Z");
      }
      return embeddingResponse(request);
    });
    const current = getCivitaiResourceDetailFromSqlite(db, resource.id);

    const updated = await applyCivitaiResourceReanalysisToSqlite({
      createEmbedding,
      currentResource: current!,
      db,
      updatedInput: {
        ...input,
        usageGuide: "Updated after one baseline retry.",
      },
    });

    expect(createEmbedding).toHaveBeenCalledTimes(2);
    expect(updated.id).toBe(resource.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 1 });
    expect(getCivitaiResourceDetailFromSqlite(db, resource.id)?.usageGuide).toBe(
      "Updated after one baseline retry.",
    );
    expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toBeTruthy();
  });

  it("does not retry unchanged reanalysis over a concurrent source update", async () => {
    const input = makeResourceInput("lora", 8461);
    const resource = upsertCivitaiResourceToSqlite(db, input).resource;
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((entry) => ({
        chunkFingerprint: entry.chunkFingerprint,
        chunkIndex: entry.chunkIndex,
        embedding: [1, 0],
        resourceId: entry.resourceId,
        resourceType: entry.resourceType,
        sourceFingerprint: entry.sourceFingerprint,
      })),
    });
    const current = getCivitaiResourceDetailFromSqlite(db, resource.id);
    const reanalysis = applyCivitaiResourceReanalysisToSqlite({
      createEmbedding: vi.fn(async (request: LlmEmbeddingRequest) => embeddingResponse(request)),
      currentResource: current!,
      db,
      updatedInput: {
        ...input,
        enrichmentStatus: "ai_enriched",
      },
    });

    upsertCivitaiResourceToSqlite(db, {
      ...input,
      enrichmentStatus: "ai_enriched",
      usageGuide: "Concurrent reanalysis source text.",
    });
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((entry) => ({
        chunkFingerprint: entry.chunkFingerprint,
        chunkIndex: entry.chunkIndex,
        embedding: [1, 0],
        resourceId: entry.resourceId,
        resourceType: entry.resourceType,
        sourceFingerprint: entry.sourceFingerprint,
      })),
    });

    await expect(reanalysis).rejects.toMatchObject({
      message: "The Civitai library or recommendation indexes changed during indexing. No database changes were saved. Try the operation again.",
      statusCode: 409,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM civitai_resources").get()).toEqual({ count: 1 });
    expect(getCivitaiResourceDetailFromSqlite(db, resource.id)?.usageGuide).toBe(
      "Concurrent reanalysis source text.",
    );
    expect(assertCivitaiEmbeddingIndexReady(db, "test-embedding-model")).toBeTruthy();
  });

  it("keeps resource, FTS, vectors, and metadata unchanged when reanalysis embedding fails", async () => {
    const input = makeResourceInput("lora", 8501);
    const resource = upsertCivitaiResourceToSqlite(db, input).resource;
    rebuildCivitaiSearchIndex(db);
    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: listCivitaiResourceEmbeddingInputs(db).map((entry) => ({
        chunkFingerprint: entry.chunkFingerprint,
        chunkIndex: entry.chunkIndex,
        embedding: [1, 0],
        resourceId: entry.resourceId,
        resourceType: entry.resourceType,
        sourceFingerprint: entry.sourceFingerprint,
      })),
    });
    const resourceBefore = getCivitaiResourceDetailFromSqlite(db, resource.id);
    const searchBefore = db.prepare(`
      SELECT resource_id, resource_type, search_text
      FROM civitai_resource_search_fts
      WHERE resource_id = ?
    `).all(resource.id);
    const vectorsBefore = db.prepare(`
      SELECT chunk_id, chunk_fingerprint, source_fingerprint
      FROM civitai_resource_embedding_vec
      WHERE resource_id = ?
    `).all(resource.id);
    const metadataBefore = readCivitaiEmbeddingIndexMetadata(db);

    await expect(applyCivitaiResourceReanalysisToSqlite({
      createEmbedding: async () => {
        throw new Error("provider detail must be sanitized");
      },
      currentResource: resourceBefore!,
      db,
      updatedInput: {
        ...input,
        usageGuide: "This must not be stored.",
      },
    })).rejects.toMatchObject({ statusCode: 502 });

    expect(getCivitaiResourceDetailFromSqlite(db, resource.id)).toEqual(resourceBefore);
    expect(db.prepare(`
      SELECT resource_id, resource_type, search_text
      FROM civitai_resource_search_fts
      WHERE resource_id = ?
    `).all(resource.id)).toEqual(searchBefore);
    expect(db.prepare(`
      SELECT chunk_id, chunk_fingerprint, source_fingerprint
      FROM civitai_resource_embedding_vec
      WHERE resource_id = ?
    `).all(resource.id)).toEqual(vectorsBefore);
    expect(readCivitaiEmbeddingIndexMetadata(db)).toEqual(metadataBefore);
  });
});
