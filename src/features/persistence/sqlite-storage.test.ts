// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject, createDefaultPromptBindingState } from "@/features/editor/store/defaults";
import { formatArtistStringForPlatform, parseNovelAiArtistString } from "@/features/artist-string-library";

import { stripSharedPromptStateFromProject } from "./project-serialization";
import {
  isCivitaiSearchIndexAvailable,
  rankCivitaiResourceIdsBySearchIndex,
  rebuildCivitaiSearchIndex,
  tokenizeCivitaiSearchText,
} from "./civitai-search-index";
import {
  deleteProjectFromSqlite,
  getCivitaiResourceDetailFromSqlite,
  getImportedImageDetailFromSqlite,
  listArtistStringItemsFromSqlite,
  listArtistStringPlatformsFromSqlite,
  listReferencedArtistStringLocalImageUrlsFromSqlite,
  loadCivitaiLibrarySettingsFromSqlite,
  listCivitaiImageCacheReferencesFromSqlite,
  listImportedImagesFromSqlite,
  listReferencedCivitaiLocalImageUrlsFromSqlite,
  listProjectSummariesFromSqlite,
  listCivitaiResourcesFromSqlite,
  loadProjectFromSqlite,
  loadPromptBindingsFromSqlite,
  loadPromptLibraryFromSqlite,
  loadSceneForgeUserSettingsFromSqlite,
  openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite,
  saveProjectToSqlite,
  savePromptBindingsToSqlite,
  savePromptLibraryToSqlite,
  saveSceneForgeUserSettingsToSqlite,
  type SceneForgeSqliteDatabase,
  updateImportedImageLoraUsageWeightsFromSqlite,
  upsertArtistStringSyncToSqlite,
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

  it("stores Civitai library download path settings in SQLite", () => {
    expect(loadCivitaiLibrarySettingsFromSqlite(db)).toEqual({
      loraDownloadPath: "",
      checkpointDownloadPath: "",
      diffusionModelPath: "",
      controlNetModelPath: "",
    });

    expect(
      saveCivitaiLibrarySettingsToSqlite(db, {
        loraDownloadPath: "  D:/models/loras  ",
        checkpointDownloadPath: "  D:/models/checkpoints  ",
        diffusionModelPath: "  D:/ComfyUI/models/diffusion_models  ",
        controlNetModelPath: "  D:/ComfyUI/models/controlnet  ",
      }),
    ).toEqual({
      loraDownloadPath: "D:/models/loras",
      checkpointDownloadPath: "D:/models/checkpoints",
      diffusionModelPath: "D:/ComfyUI/models/diffusion_models",
      controlNetModelPath: "D:/ComfyUI/models/controlnet",
    });
    expect(loadCivitaiLibrarySettingsFromSqlite(db)).toEqual({
      loraDownloadPath: "D:/models/loras",
      checkpointDownloadPath: "D:/models/checkpoints",
      diffusionModelPath: "D:/ComfyUI/models/diffusion_models",
      controlNetModelPath: "D:/ComfyUI/models/controlnet",
    });

    saveCivitaiLibrarySettingsToSqlite(db, {
      loraDownloadPath: 123,
    });
    expect(loadCivitaiLibrarySettingsFromSqlite(db)).toEqual({
      loraDownloadPath: "",
      checkpointDownloadPath: "",
      diffusionModelPath: "",
      controlNetModelPath: "",
    });
  });

  it("stores SceneForge user workflow settings in SQLite", () => {
    expect(loadSceneForgeUserSettingsFromSqlite(db)).toEqual({
      supportsNsfw: false,
      workflow: {
        characterTagNewTermDefaultOption: "ask",
        autoReview: false,
        displayMode: "simple",
      },
    });

    expect(
      saveSceneForgeUserSettingsToSqlite(db, {
        supportsNsfw: true,
        workflow: {
          characterTagNewTermDefaultOption: "import",
          autoReview: true,
          displayMode: "detailed",
        },
      }),
    ).toEqual({
      supportsNsfw: true,
      workflow: {
        characterTagNewTermDefaultOption: "import",
        autoReview: true,
        displayMode: "detailed",
      },
    });
    expect(loadSceneForgeUserSettingsFromSqlite(db)).toEqual({
      supportsNsfw: true,
      workflow: {
        characterTagNewTermDefaultOption: "import",
        autoReview: true,
        displayMode: "detailed",
      },
    });

    saveSceneForgeUserSettingsToSqlite(db, {
      supportsNsfw: "yes",
      workflow: {
        characterTagNewTermDefaultOption: "bad",
        autoReview: "yes",
        displayMode: "expanded",
      },
    });
    expect(loadSceneForgeUserSettingsFromSqlite(db)).toEqual({
      supportsNsfw: false,
      workflow: {
        characterTagNewTermDefaultOption: "ask",
        autoReview: false,
        displayMode: "simple",
      },
    });
  });

  it("stores structured artist strings and local reference image urls in SQLite", () => {
    const structuredArtistString = parseNovelAiArtistString("{artist:wlop},[[murata range]],");
    const formattedPrompt = formatArtistStringForPlatform(structuredArtistString, "novelai");

    const platform = upsertArtistStringSyncToSqlite(db, {
      platform: {
        id: "nai_bot_artists_gallery",
        name: "nai-bot 300 artists gallery",
        sourceUrl: "https://nai-bot.pages.dev/%E6%B3%95%E5%85%B8/artists-gallery/",
        promptFormat: "novelai",
        sourceUpdatedAtText: "2025/9/6",
        rawMetaJson: { parsedItemCount: 1 },
      },
      items: [
        {
          platformId: "nai_bot_artists_gallery",
          sourceSequence: 0,
          categoryKey: "independent",
          categoryName: "Independent style",
          rawArtistString: "{artist:wlop},[[murata range]],",
          structuredArtistString,
          promptFormat: "novelai",
          parseStatus: "parsed",
          parseError: null,
          formattedPrompt,
          sourceUrl: "https://nai-bot.pages.dev/%E6%B3%95%E5%85%B8/artists-gallery/",
          referenceImages: [
            {
              role: "SMEA False",
              sourceUrl: "https://nai-bot.pages.dev/assets/300_artists/artist_000/img_1.webp",
              alt: "000 - SMEA False",
              localUrl: "/api/artist-string-library/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
              width: 512,
              height: 512,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    expect(platform.sourceUpdatedAtText).toBe("2025/9/6");
    expect(listArtistStringPlatformsFromSqlite(db)).toHaveLength(1);
    expect(listReferencedArtistStringLocalImageUrlsFromSqlite(db)).toEqual([
      "/api/artist-string-library/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
    ]);

    const items = listArtistStringItemsFromSqlite(db, {
      platformId: "nai_bot_artists_gallery",
      query: "murata",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceSequence: 0,
      parseStatus: "parsed",
      formattedPrompt: "(artist:wlop:1.1),(murata range:0.8)",
      normalizedArtistString: "(artist:wlop:1.1),(murata range:0.8)",
    });
    expect(items[0]?.structuredArtistString.nodes).toHaveLength(2);
    expect(items[0]?.referenceImages[0]).toMatchObject({
      role: "SMEA False",
      width: 512,
      height: 512,
    });
  });

  it("rebuilds a derived Civitai FTS index and ranks resource ids with BM25", () => {
    const makeResource = (
      resourceType: "lora" | "model",
      name: string,
      overrides: Partial<Parameters<typeof upsertCivitaiResourceToSqlite>[1]> = {},
    ) => ({
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
    } satisfies Parameters<typeof upsertCivitaiResourceToSqlite>[1]);

    const cyberCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Cyber Neon Checkpoint", {
        tags: ["cyberpunk", "neon"],
        usageGuide: "赛博霓虹写实电影感",
      }),
    ).resource;
    const portraitCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResource("model", "Soft Portrait Checkpoint", {
        tags: ["portrait"],
        usageGuide: "soft portrait",
      }),
    ).resource;
    const neonLora = upsertCivitaiResourceToSqlite(
      db,
      makeResource("lora", "Neon Rain LoRA", {
        tags: ["lighting"],
        trainedWords: ["neon rain"],
      }),
    ).resource;
    const embedding = upsertCivitaiResourceToSqlite(db, {
      ...makeResource("lora", "Cyber Textual Embedding", {
        tags: ["cyberpunk", "neon"],
        trainedWords: ["cyber embedding"],
      }),
      resourceType: "embedding",
    }).resource;
    const vae = upsertCivitaiResourceToSqlite(db, {
      ...makeResource("model", "Cinematic VAE", {
        tags: ["cinematic", "realistic"],
      }),
      resourceType: "vae",
    }).resource;
    const before = getCivitaiResourceDetailFromSqlite(db, cyberCheckpoint.id);

    expect(isCivitaiSearchIndexAvailable(db)).toBe(false);
    expect(tokenizeCivitaiSearchText("赛博霓虹 LoRA")).toEqual(
      expect.arrayContaining(["赛博", "霓虹", "cyberpunk", "neon", "lora"]),
    );
    expect(tokenizeCivitaiSearchText("写实电影灯光")).toEqual(
      expect.arrayContaining(["写实", "电影", "灯光", "realistic", "cinematic", "lighting"]),
    );
    expect(tokenizeCivitaiSearchText("二次元插画触发词")).toEqual(
      expect.arrayContaining(["二次元", "插画", "触发词", "anime", "illustration", "trigger"]),
    );

    expect(rebuildCivitaiSearchIndex(db)).toEqual({ indexedCount: 3 });
    expect(isCivitaiSearchIndexAvailable(db)).toBe(true);
    expect(getCivitaiResourceDetailFromSqlite(db, cyberCheckpoint.id)).toEqual(before);
    const indexedRows = db.prepare(`
      SELECT resource_id, resource_type
      FROM civitai_resource_search_fts
      ORDER BY resource_type, resource_id
    `).all() as Array<{ resource_id: string; resource_type: string }>;
    expect(indexedRows).toHaveLength(3);
    expect(indexedRows).toEqual(
      expect.arrayContaining([
        { resource_id: neonLora.id, resource_type: "lora" },
        { resource_id: cyberCheckpoint.id, resource_type: "model" },
        { resource_id: portraitCheckpoint.id, resource_type: "model" },
      ]),
    );
    expect(indexedRows.map((row) => row.resource_id)).not.toEqual(
      expect.arrayContaining([embedding.id, vae.id]),
    );

    const rankedCheckpoints = rankCivitaiResourceIdsBySearchIndex(db, {
      desiredEffect: "赛博霓虹电影感",
      resourceIds: [portraitCheckpoint.id, cyberCheckpoint.id, neonLora.id],
      resourceType: "model",
    });

    expect(Array.from(rankedCheckpoints.keys())).toEqual([cyberCheckpoint.id]);
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

    const conflictImportedImage = upsertImportedCivitaiImageToSqlite(db, {
      ...localImportedImage,
      civitaiImageId: 29900442,
      civitaiImagePageUrl: "https://civitai.com/images/29900442",
      imageUrl: "https://image.civitai.com/conflict.jpeg",
      sourceImageUrl: "https://image.civitai.com/conflict.jpeg",
      seed: "44",
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

    const hashOnly = upsertCivitaiResourceToSqlite(db, {
      ...first.resource,
      civitaiModelId: null,
      civitaiModelVersionId: null,
      name: "Hash Only Light",
      versionName: null,
      hash: "duplicate-hash",
      rawVersionJson: null,
    });
    const resolvedHashOnly = upsertCivitaiResourceToSqlite(db, {
      ...hashOnly.resource,
      civitaiModelId: 500,
      civitaiModelVersionId: 501,
      name: "Resolved Hash Only Light",
      versionName: "v1 resolved",
      hash: "duplicate-hash",
      rawVersionJson: { id: 501 },
    });
    expect(resolvedHashOnly.isNew).toBe(false);
    expect(resolvedHashOnly.resource.id).toBe(hashOnly.resource.id);
    expect(resolvedHashOnly.resource.civitaiModelVersionId).toBe(501);

    const weakVersionNameMatch = upsertCivitaiResourceToSqlite(db, {
      ...first.resource,
      civitaiModelId: 700,
      civitaiModelVersionId: null,
      name: "Weak Version Match",
      versionName: "same-name",
      hash: null,
    });
    const weakVersionNameDuplicate = upsertCivitaiResourceToSqlite(db, {
      ...weakVersionNameMatch.resource,
      hash: null,
    });
    expect(weakVersionNameDuplicate.isNew).toBe(true);
    expect(weakVersionNameDuplicate.resource.id).not.toBe(weakVersionNameMatch.resource.id);

    const weakNameBaseModelMatch = upsertCivitaiResourceToSqlite(db, {
      ...first.resource,
      civitaiModelId: null,
      civitaiModelVersionId: null,
      name: "Shared LoRA Name",
      versionName: null,
      hash: null,
      baseModel: "Illustrious",
    });
    const weakNameBaseModelDuplicate = upsertCivitaiResourceToSqlite(db, {
      ...weakNameBaseModelMatch.resource,
      hash: null,
    });
    expect(weakNameBaseModelDuplicate.isNew).toBe(true);
    expect(weakNameBaseModelDuplicate.resource.id).not.toBe(weakNameBaseModelMatch.resource.id);

    const versionOnly = upsertCivitaiResourceToSqlite(db, {
      ...first.resource,
      civitaiModelId: 600,
      civitaiModelVersionId: 601,
      name: "Version Only Resource",
      versionName: "version-only",
      hash: null,
    });
    const hashConflict = upsertCivitaiResourceToSqlite(db, {
      ...first.resource,
      civitaiModelId: null,
      civitaiModelVersionId: null,
      name: "Hash Conflict Resource",
      versionName: null,
      hash: "merge-hash",
    });
    upsertImageResourceUsageToSqlite(db, {
      importedImageId: conflictImportedImage.id,
      resourceId: versionOnly.resource.id,
      weight: null,
      triggerWordsUsed: [],
      source: "civitai_image_meta",
      resolveStatus: "resolved_by_model_version_id",
      rawResourceJson: { source: "target" },
    });
    upsertImageResourceUsageToSqlite(db, {
      importedImageId: conflictImportedImage.id,
      resourceId: hashConflict.resource.id,
      weight: 0.6,
      triggerWordsUsed: ["glow"],
      source: "civitai_image_meta",
      resolveStatus: "metadata_only",
      rawResourceJson: { type: "lora" },
    });
    const mergedConflict = upsertCivitaiResourceToSqlite(db, {
      ...versionOnly.resource,
      hash: "merge-hash",
      rawVersionJson: { id: 601 },
    });
    expect(mergedConflict.isNew).toBe(false);
    expect(mergedConflict.resource.id).toBe(versionOnly.resource.id);
    expect(mergedConflict.resource.hash).toBe("merge-hash");
    const mergedConflictUsage = getCivitaiResourceDetailFromSqlite(db, mergedConflict.resource.id)?.usages.find(
      (usage) => usage.importedImage.id === conflictImportedImage.id,
    );
    expect(mergedConflictUsage?.weight).toBe(0.6);
    expect(mergedConflictUsage?.triggerWordsUsed).toEqual(["glow"]);
    expect(mergedConflictUsage?.resolveStatus).toBe("resolved_by_model_version_id");

    const loraUsage = upsertImageResourceUsageToSqlite(db, {
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

    const listItem = listCivitaiResourcesFromSqlite(db).find((resource) => resource.id === first.resource.id);
    expect(listItem).toBeDefined();
    expect(listItem!.importedImageCount).toBe(1);
    expect(listItem!.averageWeight).toBe(0.7);
    expect(listItem!.previewImage).toBe("/api/civitai-lora-library/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp");
    expect(listItem!.categories).toEqual(["lighting", "style"]);
    expect(listItem!.usageGuide).toBe("适合光影风格增强。");
    expect(listItem!.recommendations[0]?.hdRedrawRate).toBe(0.42);
    expect(listItem!.aiNsfwLevel).toBe("sfw");
    expect(listItem!.aiNsfwConfidence).toBe(0.95);
    expect(listCivitaiResourcesFromSqlite(db, { category: "style" }).some((resource) => resource.id === first.resource.id)).toBe(true);

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
    expect(listImportedImagesFromSqlite(db).find((image) => image.id === localImportedImage.id)).toMatchObject({
      id: localImportedImage.id,
      civitaiImageId: 29900441,
      resourceCount: 0,
      loraCount: 0,
      checkpointCount: 0,
    });
    expect(listImportedImagesFromSqlite(db, { resourceCount: "with" }).find((image) => image.id === importedImage.id)).toMatchObject({
      id: importedImage.id,
      resourceCount: 2,
      loraCount: 1,
      checkpointCount: 1,
    });
    expect(listImportedImagesFromSqlite(db, { query: "Scene Checkpoint" })[0]?.id).toBe(importedImage.id);
    expect(getImportedImageDetailFromSqlite(db, importedImage.id)?.usages.map((usage) => usage.resource.name)).toEqual([
      "Light Filter",
      "Scene Checkpoint",
    ]);
    const updatedImageDetail = updateImportedImageLoraUsageWeightsFromSqlite(db, importedImage.id, [
      { usageId: loraUsage.id, weight: 0.65 },
    ]);
    expect(updatedImageDetail?.usages.find((usage) => usage.id === loraUsage.id)?.weight).toBe(0.65);
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
