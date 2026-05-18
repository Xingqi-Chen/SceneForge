// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { importCivitaiImageUrlToSqlite, parseCivitaiImageUrl } from "./service";
import type { CivitaiClient } from "./client";
import {
  getCivitaiResourceDetailFromSqlite,
  openSceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

describe("Civitai LoRA import service", () => {
  it("uses modelVersionIds as the primary resource source and reports filtered resources", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 78251046,
          civitaiImagePageUrl: "https://civitai.com/images/78251046",
          imageUrl: "https://image.civitai.com/example.jpeg",
          width: 2240,
          height: 3840,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: 1,
          createdAtOnCivitai: "2025-05-24T16:50:39.100Z",
          postId: 17382159,
          username: "Yoruuu",
          baseModel: "Illustrious",
          prompt: "masterpiece",
          negativePrompt: "bad",
          sampler: "Euler a",
          steps: 25,
          cfgScale: 5,
          seed: "1",
          modelVersionIds: [100, 200, 300, 400],
          resources: [
            {
              type: "other",
              name: null,
              hash: null,
              modelVersionId: 100,
              modelId: null,
              weight: 0.4,
              raw: { weight: 0.4, modelVersionId: 100 },
            },
            {
              type: "other",
              name: null,
              hash: null,
              modelVersionId: 200,
              modelId: null,
              weight: 1,
              raw: { weight: 1, modelVersionId: 200 },
            },
          ],
          rawMetaJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async getModelVersion(modelVersionId) {
        if (modelVersionId === 100) {
          return {
            resourceType: "lora",
            civitaiModelId: 10,
            civitaiModelVersionId: 100,
            name: "Real LoRA",
            versionName: "v1",
            hash: null,
            baseModel: "Illustrious",
            trainedWords: [],
            tags: [],
            description: null,
            creator: null,
            downloadUrl: null,
            filesJson: null,
            officialImagesJson: null,
            nsfw: false,
            rawVersionJson: {},
          };
        }

        if (modelVersionId === 400) {
          return {
            resourceType: "model",
            civitaiModelId: 40,
            civitaiModelVersionId: 400,
            name: "Resolved Checkpoint",
            versionName: "v2",
            hash: null,
            baseModel: "Illustrious",
            trainedWords: [],
            tags: [],
            description: null,
            creator: null,
            downloadUrl: null,
            filesJson: null,
            officialImagesJson: null,
            nsfw: false,
            rawVersionJson: {},
          };
        }

        return {
          resourceType: modelVersionId === 200 ? "embedding" : "vae",
          civitaiModelId: modelVersionId,
          civitaiModelVersionId: modelVersionId,
          name: modelVersionId === 200 ? "Lazy Embedding" : "Example VAE",
          versionName: "v1",
          hash: null,
          baseModel: "Illustrious",
          trainedWords: [],
          tags: [],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async searchModelVersionByName() {
        return null;
      },
    };

    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/78251046",
      client,
    });

    expect(preview.resources).toHaveLength(2);
    expect(preview.resources[0]).toMatchObject({
      resourceType: "lora",
      name: "Real LoRA",
      modelVersionId: 100,
      weight: 0.4,
    });
    expect(preview.resources[1]).toMatchObject({
      resourceType: "model",
      name: "Resolved Checkpoint",
      modelVersionId: 400,
      weight: null,
    });
    expect(preview.ignoredResources.map((resource) => resource.resourceType)).toEqual([
      "embedding",
      "vae",
    ]);
  });

  it("resolves hash-only Civitai resources from image metadata", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 6,
          civitaiImagePageUrl: "https://civitai.com/images/6",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Pony",
          prompt: "masterpiece, hash_only_token",
          negativePrompt: null,
          sampler: "Euler a",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [],
          resources: [
            {
              type: "lora",
              name: "Hash Only LoRA",
              hash: "ABC123",
              modelVersionId: null,
              modelId: null,
              weight: 0.65,
              raw: { type: "lora", name: "Hash Only LoRA", hash: "ABC123" },
            },
          ],
          rawMetaJson: {},
        };
      },
      async getModelVersionByHash(hash) {
        expect(hash).toBe("ABC123");
        return {
          resourceType: "lora",
          civitaiModelId: 60,
          civitaiModelVersionId: 600,
          name: "Resolved Hash LoRA",
          versionName: "v1",
          hash: "ABC123",
          baseModel: "Pony",
          trainedWords: ["hash_only_token"],
          tags: ["style"],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async getModelVersion() {
        throw new Error("model version lookup should not be used");
      },
      async searchModelVersionByName() {
        return null;
      },
    };

    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/6",
      client,
      async enricher() {
        return {
          usageGuide: null,
          categories: ["style"],
          triggerWords: [],
          recommendations: [],
          aiNsfwLevel: "unknown",
          aiNsfwConfidence: null,
          aiNsfwReason: null,
          status: "fallback",
          error: null,
        };
      },
    });

    expect(preview.resources).toHaveLength(1);
    expect(preview.resources[0]).toMatchObject({
      resourceType: "lora",
      name: "Resolved Hash LoRA",
      modelVersionId: 600,
      hash: "ABC123",
      weight: 0.65,
      resolveStatus: "resolved_by_hash",
      trainedWords: ["hash_only_token"],
    });
  });

  it("merges hash-only resources with matching modelVersionIds before previewing", async () => {
    const versionById = new Map([
      [
        1280074,
        {
          resourceType: "lora" as const,
          civitaiModelId: 1138294,
          civitaiModelVersionId: 1280074,
          name: "Melancholy Anime - Illustrious",
          versionName: "v1.0",
          hash: "46FA9D5BFB",
          baseModel: "Illustrious",
          trainedWords: ["melanch0ly"],
          tags: ["style"],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        },
      ],
      [
        1345990,
        {
          resourceType: "lora" as const,
          civitaiModelId: 971952,
          civitaiModelVersionId: 1345990,
          name: "Stabilizer IL/NAI/CK",
          versionName: "illus01 v1.23",
          hash: "A2EFEE207A",
          baseModel: "Illustrious",
          trainedWords: [],
          tags: ["utility"],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        },
      ],
      [
        1356500,
        {
          resourceType: "lora" as const,
          civitaiModelId: 1204563,
          civitaiModelVersionId: 1356500,
          name: "ma1ma1helmes | Shiiro's Styles | Niji",
          versionName: "Style_A",
          hash: "23F0ACE9A1",
          baseModel: "Illustrious",
          trainedWords: ["xxx667_illu"],
          tags: ["style"],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        },
      ],
    ]);
    const versionByHash = new Map([...versionById.values()].map((version) => [version.hash, version]));

    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 57187119,
          civitaiImagePageUrl: "https://civitai.com/images/57187119",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt:
            "<lora:illustriousXL_stabilizer_v1.23:0.3> <lora:XXX667:0.7> <lora:MelancholyAnime:0.8>",
          negativePrompt: null,
          sampler: null,
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [1280074, 1345990, 1356500],
          resources: [
            {
              type: "lora",
              name: "illustriousXL_stabilizer_v1.23",
              hash: "A2EFEE207A",
              modelVersionId: null,
              modelId: null,
              weight: 0.3,
              raw: { source: "resources", hash: "A2EFEE207A" },
            },
            {
              type: "lora",
              name: "XXX667",
              hash: "23F0ACE9A1",
              modelVersionId: null,
              modelId: null,
              weight: 0.7,
              raw: { source: "resources", hash: "23F0ACE9A1" },
            },
            {
              type: "lora",
              name: "MelancholyAnime",
              hash: "46FA9D5BFB",
              modelVersionId: null,
              modelId: null,
              weight: 0.8,
              raw: { source: "resources", hash: "46FA9D5BFB" },
            },
          ],
          rawMetaJson: {},
        };
      },
      async getModelVersionByHash(hash) {
        const version = versionByHash.get(hash);
        if (!version) {
          throw new Error(`unexpected hash ${hash}`);
        }
        return version;
      },
      async getModelVersion(modelVersionId) {
        const version = versionById.get(modelVersionId);
        if (!version) {
          throw new Error(`unexpected modelVersionId ${modelVersionId}`);
        }
        return version;
      },
      async searchModelVersionByName() {
        return null;
      },
    };

    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/57187119",
      client,
      async enricher(input) {
        return {
          usageGuide: null,
          categories: input.tags.includes("utility") ? ["detail"] : ["style"],
          triggerWords: [],
          recommendations: [],
          aiNsfwLevel: "unknown",
          aiNsfwConfidence: null,
          aiNsfwReason: null,
          status: "fallback",
          error: null,
        };
      },
    });

    expect(preview.resources).toHaveLength(3);
    expect(preview.resources.map((resource) => resource.name).sort()).toEqual([
      "Melancholy Anime - Illustrious",
      "Stabilizer IL/NAI/CK",
      "ma1ma1helmes | Shiiro's Styles | Niji",
    ]);
    expect(
      Object.fromEntries(preview.resources.map((resource) => [resource.modelVersionId, resource.weight])),
    ).toEqual({
      1280074: 0.8,
      1345990: 0.3,
      1356500: 0.7,
    });
  });

  it("merges hash-only metadata into a resolved modelVersionId even if hash lookup fails", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 7,
          civitaiImagePageUrl: "https://civitai.com/images/7",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt: "<lora:ExampleAlias:0.42>",
          negativePrompt: null,
          sampler: null,
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [777],
          resources: [
            {
              type: "lora",
              name: "ExampleAlias",
              hash: "DEADBEEF01",
              modelVersionId: null,
              modelId: null,
              weight: 0.42,
              raw: { source: "resources", hash: "DEADBEEF01" },
            },
          ],
          rawMetaJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("hash lookup temporarily unavailable");
      },
      async getModelVersion() {
        return {
          resourceType: "lora",
          civitaiModelId: 70,
          civitaiModelVersionId: 777,
          name: "Example Official LoRA",
          versionName: "v1",
          hash: "DEADBEEF01",
          baseModel: "Illustrious",
          trainedWords: [],
          tags: ["style"],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async searchModelVersionByName() {
        return null;
      },
    };

    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/7",
      client,
      async enricher() {
        return {
          usageGuide: null,
          categories: ["style"],
          triggerWords: [],
          recommendations: [],
          aiNsfwLevel: "unknown",
          aiNsfwConfidence: null,
          aiNsfwReason: null,
          status: "fallback",
          error: null,
        };
      },
    });

    expect(preview.resources).toHaveLength(1);
    expect(preview.resources[0]).toMatchObject({
      name: "Example Official LoRA",
      modelVersionId: 777,
      hash: "DEADBEEF01",
      weight: 0.42,
    });
  });

  it("applies LLM enrichment to previews and merges extracted trigger words", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 1,
          civitaiImagePageUrl: "https://civitai.com/images/1",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Pony",
          prompt: "XUER guangying, masterpiece",
          negativePrompt: null,
          sampler: "DPM++ 2M",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [101],
          resources: [{ type: "other", name: null, hash: null, modelVersionId: 101, modelId: null, weight: 0.8, raw: {} }],
          rawMetaJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async getModelVersion() {
        return {
          resourceType: "lora",
          civitaiModelId: 10,
          civitaiModelVersionId: 101,
          name: "Painterly LoRA",
          versionName: "v1",
          hash: null,
          baseModel: "Pony",
          trainedWords: ["painterly"],
          tags: ["style"],
          description: "Recommended LORA weight: 0.8-0.9. Trigger word: XUER guangying.",
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async searchModelVersionByName() {
        return null;
      },
    };

    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/1",
      client,
      async enricher() {
        return {
          usageGuide: "适合绘画风格和降低 AI 感。",
          categories: ["style", "lighting"],
          triggerWords: ["XUER guangying"],
          recommendations: [
            {
              condition: "通用",
              baseModel: null,
              checkpoint: null,
              sampler: null,
              loraWeightMin: 0.8,
              loraWeightMax: 0.9,
              loraWeight: null,
              hdRedrawRate: 0.42,
              notes: null,
            },
          ],
          aiNsfwLevel: "sfw",
          aiNsfwConfidence: 0.9,
          aiNsfwReason: "No adult content in description.",
          status: "ai_enriched",
          error: null,
        };
      },
    });

    expect(preview.resources[0]).toMatchObject({
      categories: ["style", "lighting"],
      usageGuide: "适合绘画风格和降低 AI 感。",
      trainedWords: ["painterly", "XUER guangying"],
      triggerWordsUsed: ["XUER guangying"],
      enrichmentStatus: "ai_enriched",
      nsfw: false,
      aiNsfwLevel: "sfw",
      aiNsfwConfidence: 0.9,
    });
    expect(preview.resources[0]?.recommendations[0]).toMatchObject({
      loraWeightMin: 0.8,
      loraWeightMax: 0.9,
      hdRedrawRate: 0.42,
    });
  });

  it("uses prompt LoRA token weight as current-image usage when Civitai resources omit weight", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 2,
          civitaiImagePageUrl: "https://civitai.com/images/2",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt: "masterpiece, <lora:VRAZKARv2_rank32_fp16:1>, vr4_zk4r1",
          negativePrompt: null,
          sampler: "Euler a",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [2429870],
          resources: [],
          rawMetaJson: {},
        };
      },
      async getModelVersion() {
        return {
          resourceType: "lora",
          civitaiModelId: 1,
          civitaiModelVersionId: 2429870,
          name: "VRAZKAR",
          versionName: "soft",
          hash: null,
          baseModel: "Illustrious",
          trainedWords: ["vr4_zk4r1"],
          tags: ["style"],
          description: "Trigger word: vr4_zk4r1",
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async searchModelVersionByName() {
        return null;
      },
    };

    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/2",
      client,
      async enricher() {
        return {
          usageGuide: null,
          categories: ["style"],
          triggerWords: [],
          recommendations: [],
          aiNsfwLevel: "unknown",
          aiNsfwConfidence: null,
          aiNsfwReason: null,
          status: "ai_enriched",
          error: null,
        };
      },
    });

    expect(preview.resources[0]?.weight).toBe(1);
    expect(preview.resources[0]?.recommendations).toEqual([]);
  });

  it("imports only selected parsed resources when resource keys are provided", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 3,
          civitaiImagePageUrl: "https://civitai.com/images/3",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt: "masterpiece",
          negativePrompt: null,
          sampler: "Euler a",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [301, 302],
          resources: [],
          rawMetaJson: {},
        };
      },
      async getModelVersion(modelVersionId) {
        return {
          resourceType: modelVersionId === 301 ? "lora" : "model",
          civitaiModelId: modelVersionId,
          civitaiModelVersionId: modelVersionId,
          name: modelVersionId === 301 ? "Selected LoRA" : "Skipped Checkpoint",
          versionName: "v1",
          hash: null,
          baseModel: "Illustrious",
          trainedWords: [],
          tags: [],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async searchModelVersionByName() {
        return null;
      },
    };
    const enricher = async () =>
      ({
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
    const preview = await parseCivitaiImageUrl({
      imageUrl: "https://civitai.com/images/3",
      client,
      enricher,
    });
    const selectedKey = preview.resources.find((resource) => resource.name === "Selected LoRA")?.importResourceKey;
    expect(selectedKey).toBeDefined();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-import-"));
    const db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
    try {
      const result = await importCivitaiImageUrlToSqlite({
        db,
        imageUrl: "https://civitai.com/images/3",
        client,
        enricher,
        selectedImportResourceKeys: [selectedKey!],
      });

      expect(result.resources.map((entry) => entry.resource.name)).toEqual(["Selected LoRA"]);
      const skippedCheckpoint = db
        .prepare("SELECT COUNT(*) AS count FROM civitai_resources WHERE name = ?")
        .get("Skipped Checkpoint");
      expect((skippedCheckpoint as { count: number }).count).toBe(0);
    } finally {
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("links existing checkpoints for the image even when importing a selected LoRA subset", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 4,
          civitaiImagePageUrl: "https://civitai.com/images/4",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt: "masterpiece",
          negativePrompt: null,
          sampler: "Euler a",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [401, 402],
          resources: [],
          rawMetaJson: {},
        };
      },
      async getModelVersion(modelVersionId) {
        return {
          resourceType: modelVersionId === 401 ? "lora" : "model",
          civitaiModelId: modelVersionId,
          civitaiModelVersionId: modelVersionId,
          name: modelVersionId === 401 ? "Kept LoRA" : "Removed Checkpoint",
          versionName: "v1",
          hash: null,
          baseModel: "Illustrious",
          trainedWords: [],
          tags: [],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async searchModelVersionByName() {
        return null;
      },
    };
    const enricher = async () =>
      ({
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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-reimport-"));
    const db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
    try {
      await importCivitaiImageUrlToSqlite({
        db,
        imageUrl: "https://civitai.com/images/4",
        client,
        enricher,
      });
      const preview = await parseCivitaiImageUrl({
        db,
        imageUrl: "https://civitai.com/images/4",
        client,
        enricher,
      });
      const selectedKey = preview.resources.find((resource) => resource.name === "Kept LoRA")?.importResourceKey;
      expect(selectedKey).toBeDefined();

      const result = await importCivitaiImageUrlToSqlite({
        db,
        imageUrl: "https://civitai.com/images/4",
        client,
        enricher,
        selectedImportResourceKeys: [selectedKey!],
      });

      expect(result.resources.map((entry) => entry.resource.name)).toEqual(["Kept LoRA", "Removed Checkpoint"]);
      const checkpoint = preview.resources.find((resource) => resource.name === "Removed Checkpoint");
      expect(checkpoint?.existingResourceId).toBeDefined();
      const rows = db
        .prepare("SELECT COUNT(*) AS count FROM image_resource_usages WHERE resource_id = ?")
        .get(checkpoint!.existingResourceId!);
      expect((rows as { count: number }).count).toBe(1);
      const lora = result.resources.find((entry) => entry.resource.name === "Kept LoRA");
      expect(lora).toBeDefined();
      expect(getCivitaiResourceDetailFromSqlite(db, lora!.resource.id)?.commonCheckpoints).toEqual([
        {
          resourceId: checkpoint!.existingResourceId!,
          name: "Removed Checkpoint",
          count: 1,
        },
      ]);
    } finally {
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("links a new image to existing resources even when none are selected", async () => {
    const client: CivitaiClient = {
      async getImageById(imageId) {
        return {
          civitaiImageId: imageId,
          civitaiImagePageUrl: `https://civitai.com/images/${imageId}`,
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt: "masterpiece, <lora:StoredLora:0.7>",
          negativePrompt: null,
          sampler: "Euler a",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [601],
          resources: [],
          rawMetaJson: {},
        };
      },
      async getModelVersion() {
        return {
          resourceType: "lora",
          civitaiModelId: 601,
          civitaiModelVersionId: 601,
          name: "Stored LoRA",
          versionName: "v1",
          hash: null,
          baseModel: "Illustrious",
          trainedWords: [],
          tags: ["style"],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async searchModelVersionByName() {
        return null;
      },
    };
    let enrichCalls = 0;
    const enricher = async () => {
      enrichCalls += 1;
      return {
        usageGuide: null,
        categories: ["style" as const],
        triggerWords: [],
        recommendations: [],
        aiNsfwLevel: "unknown" as const,
        aiNsfwConfidence: null,
        aiNsfwReason: null,
        status: "fallback" as const,
        error: null,
      };
    };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-existing-link-"));
    const db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
    try {
      await importCivitaiImageUrlToSqlite({
        db,
        imageUrl: "https://civitai.com/images/8",
        client,
        enricher,
      });
      expect(enrichCalls).toBe(1);

      const preview = await parseCivitaiImageUrl({
        db,
        imageUrl: "https://civitai.com/images/9",
        client,
        enricher,
      });
      const existingResource = preview.resources[0];
      expect(existingResource?.existingResourceId).toBeDefined();
      expect(enrichCalls).toBe(1);
      const resourceBefore = db
        .prepare("SELECT * FROM civitai_resources WHERE id = ?")
        .get(existingResource!.existingResourceId!);

      const result = await importCivitaiImageUrlToSqlite({
        db,
        imageUrl: "https://civitai.com/images/9",
        client,
        enricher,
        selectedImportResourceKeys: [],
      });

      expect(result.resources[0]?.isNewResource).toBe(false);
      expect(result.resources[0]?.usage.importedImageId).toBe(result.importedImage.id);
      expect(enrichCalls).toBe(1);
      const resourceAfter = db
        .prepare("SELECT * FROM civitai_resources WHERE id = ?")
        .get(existingResource!.existingResourceId!);
      expect(resourceAfter).toEqual(resourceBefore);

      const selectedExistingPreview = await parseCivitaiImageUrl({
        db,
        imageUrl: "https://civitai.com/images/10",
        client,
        enricher,
      });
      const selectedExistingResource = selectedExistingPreview.resources[0];
      expect(selectedExistingResource?.existingResourceId).toBe(existingResource!.existingResourceId);
      expect(enrichCalls).toBe(1);

      const selectedResourceBefore = db
        .prepare("SELECT * FROM civitai_resources WHERE id = ?")
        .get(existingResource!.existingResourceId!);
      const selectedExistingResult = await importCivitaiImageUrlToSqlite({
        db,
        imageUrl: "https://civitai.com/images/10",
        client,
        enricher,
        selectedImportResourceKeys: [selectedExistingResource!.importResourceKey],
      });

      expect(selectedExistingResult.resources[0]?.isNewResource).toBe(false);
      expect(enrichCalls).toBe(1);
      const selectedResourceAfter = db
        .prepare("SELECT * FROM civitai_resources WHERE id = ?")
        .get(existingResource!.existingResourceId!);
      expect(selectedResourceAfter).toEqual(selectedResourceBefore);

      const detail = getCivitaiResourceDetailFromSqlite(db, existingResource!.existingResourceId!);
      expect(detail?.usages.map((usage) => usage.importedImage.civitaiImageId).sort((a, b) => a - b)).toEqual([
        8,
        9,
        10,
      ]);
    } finally {
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects imports when all parsed resources are deselected", async () => {
    const client: CivitaiClient = {
      async getImageById() {
        return {
          civitaiImageId: 5,
          civitaiImagePageUrl: "https://civitai.com/images/5",
          imageUrl: null,
          width: null,
          height: null,
          nsfw: false,
          nsfwLevel: null,
          browsingLevel: null,
          createdAtOnCivitai: null,
          postId: null,
          username: null,
          baseModel: "Illustrious",
          prompt: "masterpiece",
          negativePrompt: null,
          sampler: "Euler a",
          steps: null,
          cfgScale: null,
          seed: null,
          modelVersionIds: [501],
          resources: [],
          rawMetaJson: {},
        };
      },
      async getModelVersion() {
        return {
          resourceType: "lora",
          civitaiModelId: 501,
          civitaiModelVersionId: 501,
          name: "Deselected LoRA",
          versionName: "v1",
          hash: null,
          baseModel: "Illustrious",
          trainedWords: [],
          tags: [],
          description: null,
          creator: null,
          downloadUrl: null,
          filesJson: null,
          officialImagesJson: null,
          nsfw: false,
          rawVersionJson: {},
        };
      },
      async getModelVersionByHash() {
        throw new Error("not used");
      },
      async searchModelVersionByName() {
        return null;
      },
    };
    const enricher = async () =>
      ({
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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-empty-import-"));
    const db = await openSceneForgeSqliteDatabase(path.join(tempDir, "sceneforge.sqlite"));
    try {
      await expect(
        importCivitaiImageUrlToSqlite({
          db,
          imageUrl: "https://civitai.com/images/5",
          client,
          enricher,
          selectedImportResourceKeys: [],
        }),
      ).rejects.toThrow("请至少选择一个");
    } finally {
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
