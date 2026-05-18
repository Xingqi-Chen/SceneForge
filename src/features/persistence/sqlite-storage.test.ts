// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject, createDefaultPromptBindingState } from "@/features/editor/store/defaults";

import { stripSharedPromptStateFromProject } from "./project-serialization";
import {
  deleteProjectFromSqlite,
  getCivitaiResourceDetailFromSqlite,
  listCivitaiImageCacheReferencesFromSqlite,
  listReferencedCivitaiLocalImageUrlsFromSqlite,
  listProjectSummariesFromSqlite,
  listCivitaiResourcesFromSqlite,
  loadProjectFromSqlite,
  loadPromptBindingsFromSqlite,
  loadPromptLibraryFromSqlite,
  openSceneForgeSqliteDatabase,
  saveProjectToSqlite,
  savePromptBindingsToSqlite,
  savePromptLibraryToSqlite,
  type SceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
  upsertImportedCivitaiImageToSqlite,
  upsertImageResourceUsageToSqlite,
} from "./sqlite-storage";

describe("sqlite persistence support", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-sqlite-"));
    db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips projects through SQLite without changing the active disk flow", () => {
    const project = createDefaultProject();
    project.id = "sqlite-project";
    project.name = "SQLite Project";
    project.updatedAt = "2026-05-17T00:00:00.000Z";
    project.settings.promptLibraryTags = [
      {
        id: "shared-tag",
        label: "Shared",
        prompt: "shared prompt",
        category: "style",
        weight: { enabled: false, value: 1 },
      },
    ];

    saveProjectToSqlite(db, project);

    expect(listProjectSummariesFromSqlite(db)).toEqual([
      {
        id: "sqlite-project",
        name: "SQLite Project",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ]);
    expect(stripSharedPromptStateFromProject(loadProjectFromSqlite(db, project.id)!)).toEqual(
      stripSharedPromptStateFromProject(project),
    );
    expect(deleteProjectFromSqlite(db, project.id)).toBe(true);
    expect(loadProjectFromSqlite(db, project.id)).toBeUndefined();
  });

  it("stores shared prompt library and binding state in SQLite", () => {
    const library = {
      promptLibraryTags: [
        {
          id: "tag-1",
          label: "Tag",
          prompt: "prompt",
          category: "style" as const,
          weight: { enabled: false, value: 1 },
        },
      ],
      deletedBuiltInPromptLibraryTagIds: ["builtin-1"],
    };
    const bindings = createDefaultPromptBindingState();
    bindings.scene.promptCategoryBindings = ["scene"];

    savePromptLibraryToSqlite(db, library);
    savePromptBindingsToSqlite(db, bindings);

    expect(loadPromptLibraryFromSqlite(db)).toEqual(library);
    expect(loadPromptBindingsFromSqlite(db)).toEqual(bindings);
  });

  it("stores Civitai image resource usages and deduplicates resources", () => {
    const importedImage = upsertImportedCivitaiImageToSqlite(db, {
      civitaiImageId: 29900440,
      civitaiImagePageUrl: "https://civitai.com/images/29900440",
      imageUrl: "https://image.civitai.com/example.jpeg",
      width: 1024,
      height: 1536,
      nsfw: false,
      nsfwLevel: 1,
      browsingLevel: 1,
      createdAtOnCivitai: "2026-05-01T00:00:00.000Z",
      postId: 10,
      username: "artist",
      baseModel: "Illustrious",
      prompt: "masterpiece, <lora:Light Filter:0.8>, glow",
      negativePrompt: "low quality",
      sampler: "Euler a",
      steps: 30,
      cfgScale: 7,
      seed: "42",
      modelVersionIds: [200],
      resources: [],
      rawMetaJson: { prompt: "masterpiece" },
    });

    const localImportedImage = upsertImportedCivitaiImageToSqlite(db, {
      civitaiImageId: 29900441,
      civitaiImagePageUrl: "https://civitai.com/images/29900441",
      imageUrl: "/api/civitai-lora-library/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
      sourceImageUrl: "https://image.civitai.com/source.jpeg",
      width: 1024,
      height: 1536,
      nsfw: false,
      nsfwLevel: 1,
      browsingLevel: 1,
      createdAtOnCivitai: "2026-05-01T00:00:00.000Z",
      postId: 11,
      username: "artist",
      baseModel: "Illustrious",
      prompt: "masterpiece",
      negativePrompt: "low quality",
      sampler: "Euler a",
      steps: 30,
      cfgScale: 7,
      seed: "43",
      modelVersionIds: [200],
      resources: [],
      rawMetaJson: { prompt: "masterpiece" },
    });

    const first = upsertCivitaiResourceToSqlite(db, {
      resourceType: "lora",
      civitaiModelId: 100,
      civitaiModelVersionId: 200,
      name: "Light Filter",
      versionName: "v1",
      hash: "abc",
      baseModel: "Illustrious",
      trainedWords: ["glow"],
      tags: ["lighting"],
      description: "cinematic light helper",
      creator: "maker",
      downloadUrl: "https://civitai.com/download/models/200",
      filesJson: [],
      officialImagesJson: [
        {
          sourceUrl: "https://image.civitai.com/ref.jpeg",
          url: "/api/civitai-lora-library/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
        },
      ],
      category: "lighting",
      categories: ["lighting", "style"],
      usageGuide: "适合光影风格增强。",
      recommendations: [
        {
          condition: "通用",
          baseModel: null,
          checkpoint: null,
          sampler: null,
          loraWeightMin: 0.7,
          loraWeightMax: 0.9,
          loraWeight: null,
          hdRedrawRate: 0.42,
          notes: null,
        },
      ],
      enrichmentStatus: "ai_enriched",
      enrichmentError: null,
      nsfw: false,
      aiNsfwLevel: "sfw",
      aiNsfwConfidence: 0.95,
      aiNsfwReason: "No adult terms in the model metadata.",
      rawVersionJson: { id: 200 },
    });
    const second = upsertCivitaiResourceToSqlite(db, {
      ...first.resource,
      trainedWords: ["glow", "shadow"],
    });
    const checkpoint = upsertCivitaiResourceToSqlite(db, {
      resourceType: "model",
      civitaiModelId: 300,
      civitaiModelVersionId: 400,
      name: "Scene Checkpoint",
      versionName: "v2",
      hash: "checkpoint-hash",
      baseModel: "Illustrious",
      trainedWords: [],
      tags: ["checkpoint"],
      description: "paired checkpoint",
      creator: "maker",
      downloadUrl: "https://civitai.com/download/models/400",
      filesJson: [],
      officialImagesJson: [],
      category: null,
      categories: ["style"],
      usageGuide: "适合作为基础 checkpoint。",
      recommendations: [],
      enrichmentStatus: "ai_enriched",
      enrichmentError: null,
      nsfw: false,
      aiNsfwLevel: "unknown",
      aiNsfwConfidence: null,
      aiNsfwReason: null,
      rawVersionJson: { id: 400 },
    });

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.resource.id).toBe(first.resource.id);
    expect(checkpoint.isNew).toBe(true);

    upsertImageResourceUsageToSqlite(db, {
      importedImageId: importedImage.id,
      resourceId: first.resource.id,
      weight: 0.8,
      triggerWordsUsed: ["glow"],
      source: "civitai_image_meta",
      resolveStatus: "resolved_by_model_version_id",
      rawResourceJson: { type: "lora" },
    });
    upsertImageResourceUsageToSqlite(db, {
      importedImageId: importedImage.id,
      resourceId: first.resource.id,
      weight: 0.7,
      triggerWordsUsed: ["glow"],
      source: "civitai_image_meta",
      resolveStatus: "resolved_by_model_version_id",
      rawResourceJson: { type: "lora" },
    });
    upsertImageResourceUsageToSqlite(db, {
      importedImageId: importedImage.id,
      resourceId: checkpoint.resource.id,
      weight: null,
      triggerWordsUsed: [],
      source: "civitai_image_meta",
      resolveStatus: "resolved_by_model_version_id",
      rawResourceJson: { type: "model" },
    });

    const [listItem] = listCivitaiResourcesFromSqlite(db);
    expect(listItem).toBeDefined();
    expect(listItem!.importedImageCount).toBe(1);
    expect(listItem!.averageWeight).toBe(0.7);
    expect(listItem!.previewImage).toBe("/api/civitai-lora-library/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp");
    expect(listItem!.categories).toEqual(["lighting", "style"]);
    expect(listItem!.usageGuide).toBe("适合光影风格增强。");
    expect(listItem!.recommendations[0]?.hdRedrawRate).toBe(0.42);
    expect(listItem!.aiNsfwLevel).toBe("sfw");
    expect(listItem!.aiNsfwConfidence).toBe(0.95);
    expect(listCivitaiResourcesFromSqlite(db, { category: "style" })[0]?.id).toBe(first.resource.id);

    const [checkpointListItem] = listCivitaiResourcesFromSqlite(db, { resourceType: "model" });
    expect(checkpointListItem).toBeDefined();
    expect(checkpointListItem!.id).toBe(checkpoint.resource.id);
    expect(checkpointListItem!.importedImageCount).toBe(1);

    const detail = getCivitaiResourceDetailFromSqlite(db, first.resource.id);
    expect(detail?.usages).toHaveLength(1);
    expect(detail?.usages[0].importedImage.civitaiImageId).toBe(29900440);
    expect(detail?.commonCheckpoints).toEqual([
      {
        resourceId: checkpoint.resource.id,
        name: "Scene Checkpoint",
        count: 1,
      },
    ]);
    expect(localImportedImage.imageUrl).toBe("/api/civitai-lora-library/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp");
    expect(localImportedImage.sourceImageUrl).toBe("https://image.civitai.com/source.jpeg");
    expect(listReferencedCivitaiLocalImageUrlsFromSqlite(db).sort()).toEqual([
      "/api/civitai-lora-library/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
      "/api/civitai-lora-library/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
    ]);
    expect(listCivitaiImageCacheReferencesFromSqlite(db).sort((a, b) => a.localUrl.localeCompare(b.localUrl))).toEqual([
      {
        sourceUrl: "https://image.civitai.com/source.jpeg",
        localUrl: "/api/civitai-lora-library/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
      },
      {
        sourceUrl: "https://image.civitai.com/ref.jpeg",
        localUrl: "/api/civitai-lora-library/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
      },
    ]);
  });
});
