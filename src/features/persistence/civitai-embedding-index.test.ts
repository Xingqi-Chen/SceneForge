// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rebuildCivitaiSearchIndex } from "./civitai-search-index";
import {
  CIVITAI_EMBEDDING_INDEX_BM25_MISSING_MESSAGE,
  CIVITAI_EMBEDDING_INDEX_MISSING_MESSAGE,
  CIVITAI_EMBEDDING_TEXT_MAX_CHARS,
  assertCivitaiEmbeddingIndexReady,
  isCivitaiEmbeddingIndexAvailable,
  listCivitaiResourceEmbeddingInputs,
  loadSqliteVecExtension,
  rankCivitaiResourceIdsByEmbeddingIndex,
  readCivitaiEmbeddingIndexMetadata,
  rebuildCivitaiEmbeddingIndex,
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
        embeddings: [{ resourceId: cyberLora.id, resourceType: "lora", embedding: [1, 0] }],
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

  it("truncates long FTS source text before embedding", () => {
    const longDescription = "cinematic neon detail ".repeat(700);
    const resource = upsertCivitaiResourceToSqlite(
      db,
      makeResource("lora", "Long Text LoRA", {
        description: longDescription,
      }),
    ).resource;

    rebuildCivitaiSearchIndex(db);

    const input = listCivitaiResourceEmbeddingInputs(db).find((entry) => entry.resourceId === resource.id);

    expect(input?.text.length).toBe(CIVITAI_EMBEDDING_TEXT_MAX_CHARS);
    expect(input?.text.startsWith("Long Text LoRA")).toBe(true);
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
          resourceId: input.resourceId,
          resourceType: input.resourceType,
          embedding: input.resourceId === checkpoint.id ? [1, 0, 0] : [0, 1, 0],
        })),
      }),
    ).toEqual({ indexedCount: 3, dimensions: 3 });

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
        resourceId: input.resourceId,
        resourceType: input.resourceType,
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
});
