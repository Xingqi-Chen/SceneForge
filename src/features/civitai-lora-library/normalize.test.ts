import { describe, expect, it } from "vitest";

import { classifyCivitaiLora } from "./classification";
import {
  chooseResourceUpsertKey,
  getOfficialPreviewImage,
  mergeResourceVersion,
  normalizeCivitaiImageResponse,
  normalizeCivitaiModelVersionResponse,
} from "./normalize";

describe("Civitai normalization", () => {
  it("normalizes image API responses into SceneForge DTOs", () => {
    const normalized = normalizeCivitaiImageResponse(
      {
        items: [
          {
            id: 29900440,
            url: "https://image.civitai.com/example.jpeg",
            width: 1024,
            height: 1536,
            nsfw: false,
            nsfwLevel: 1,
            browsingLevel: 2,
            createdAt: "2026-05-01T00:00:00.000Z",
            username: "artist",
            postId: 123,
            modelVersionIds: [11, "22"],
            meta: {
              prompt: "masterpiece, <lora:Light Filter:0.8>",
              negativePrompt: "low quality",
              sampler: "Euler a",
              steps: 30,
              cfgScale: "7",
              seed: 42,
              baseModel: "Illustrious",
              resources: [
                {
                  type: "lora",
                  name: "Light Filter",
                  hash: "ABC",
                  modelVersionId: 22,
                },
              ],
            },
          },
        ],
      },
      29900440,
    );

    expect(normalized).toMatchObject({
      civitaiImageId: 29900440,
      imageUrl: "https://image.civitai.com/example.jpeg",
      width: 1024,
      height: 1536,
      nsfw: false,
      nsfwLevel: 1,
      browsingLevel: 2,
      username: "artist",
      baseModel: "Illustrious",
      prompt: "masterpiece, <lora:Light Filter:0.8>",
      negativePrompt: "low quality",
      sampler: "Euler a",
      steps: 30,
      cfgScale: 7,
      seed: "42",
      modelVersionIds: [11, 22],
    });
    expect(normalized.resources).toHaveLength(1);
    expect(normalized.resources[0]).toMatchObject({
      type: "lora",
      name: "Light Filter",
      hash: "ABC",
      modelVersionId: 22,
    });
  });

  it("normalizes Civitai image responses with nested meta.meta resources", () => {
    const normalized = normalizeCivitaiImageResponse(
      {
        items: [
          {
            id: 29900440,
            url: "https://image.civitai.com/example.jpeg",
            width: 1280,
            height: 2048,
            nsfw: false,
            nsfwLevel: "None",
            browsingLevel: 1,
            createdAt: "2024-09-17T14:49:28.633Z",
            postId: 6690302,
            username: "XUERYCJ",
            baseModel: "Pony",
            modelVersionIds: [792734, 860001],
            meta: {
              id: 29900440,
              meta: {
                Size: "800x1280",
                seed: 309870281,
                Model: "B站绪儿已成精 红蓝幻想 V2 pony",
                steps: 35,
                hashes: {
                  model: "01592e2e49",
                  "lora:绪儿 光影滤镜 XUER guangying": "47d18bcc7c82",
                },
                prompt: "XUER guangying,<lora:绪儿 光影滤镜 XUER guangying:0.8>",
                sampler: "DPM++ 2M",
                cfgScale: 5,
                resources: [
                  {
                    hash: "47d18bcc7c82",
                    name: "绪儿 光影滤镜 XUER guangying",
                    type: "lora",
                  },
                  {
                    hash: "01592e2e49",
                    name: "B站绪儿已成精 红蓝幻想 V2 pony",
                    type: "model",
                  },
                ],
                negativePrompt: "low quality",
              },
            },
          },
        ],
      },
      29900440,
    );

    expect(normalized.baseModel).toBe("Pony");
    expect(normalized.prompt).toContain("<lora:绪儿 光影滤镜 XUER guangying:0.8>");
    expect(normalized.resources).toEqual([
      {
        type: "lora",
        name: "绪儿 光影滤镜 XUER guangying",
        hash: "47d18bcc7c82",
        modelVersionId: null,
        modelId: null,
        weight: null,
        raw: {
          hash: "47d18bcc7c82",
          name: "绪儿 光影滤镜 XUER guangying",
          type: "lora",
        },
      },
      {
        type: "model",
        name: "B站绪儿已成精 红蓝幻想 V2 pony",
        hash: "01592e2e49",
        modelVersionId: null,
        modelId: null,
        weight: null,
        raw: {
          hash: "01592e2e49",
          name: "B站绪儿已成精 红蓝幻想 V2 pony",
          type: "model",
        },
      },
    ]);
  });

  it("normalizes Civitai image responses with civitaiResources when resources is empty", () => {
    const normalized = normalizeCivitaiImageResponse(
      {
        items: [
          {
            id: 67188663,
            url: "https://image.civitai.com/example.jpeg",
            width: 832,
            height: 1216,
            nsfw: false,
            baseModel: "Illustrious",
            modelVersionIds: [1240288, 1597055],
            meta: {
              id: 67188663,
              meta: {
                prompt: "masterpiece, CivChan",
                baseModel: "Illustrious",
                resources: [],
                civitaiResources: [
                  {
                    type: "checkpoint",
                    modelVersionId: 1240288,
                    modelVersionName: "v1.3 - Style A",
                  },
                  {
                    type: "lora",
                    weight: 1,
                    modelVersionId: 1597055,
                    modelVersionName: "V1",
                  },
                ],
              },
            },
          },
        ],
      },
      67188663,
    );

    expect(normalized.baseModel).toBe("Illustrious");
    expect(normalized.resources).toEqual([
      {
        type: "model",
        name: "v1.3 - Style A",
        hash: null,
        modelVersionId: 1240288,
        modelId: null,
        weight: null,
        raw: {
          type: "checkpoint",
          modelVersionId: 1240288,
          modelVersionName: "v1.3 - Style A",
        },
      },
      {
        type: "lora",
        name: "V1",
        hash: null,
        modelVersionId: 1597055,
        modelId: null,
        weight: 1,
        raw: {
          type: "lora",
          weight: 1,
          modelVersionId: 1597055,
          modelVersionName: "V1",
        },
      },
    ]);
  });

  it("keeps modelVersionId-only civitaiResources as unresolved candidates until model-version lookup", () => {
    const normalized = normalizeCivitaiImageResponse(
      {
        items: [
          {
            id: 78251046,
            url: "https://image.civitai.com/example.jpeg",
            baseModel: "Illustrious",
            modelVersionIds: [164821, 1370636],
            meta: {
              meta: {
                prompt: "masterpiece",
                resources: [],
                civitaiResources: [
                  {
                    weight: 0.5,
                    modelVersionId: 1370636,
                  },
                  {
                    type: "upscaler",
                    modelVersionId: 164821,
                  },
                ],
              },
            },
          },
        ],
      },
      78251046,
    );

    expect(normalized.resources).toEqual([
      {
        type: "other",
        name: null,
        hash: null,
        modelVersionId: 1370636,
        modelId: null,
        weight: 0.5,
        raw: {
          weight: 0.5,
          modelVersionId: 1370636,
        },
      },
      {
        type: "other",
        name: null,
        hash: null,
        modelVersionId: 164821,
        modelId: null,
        weight: null,
        raw: {
          type: "upscaler",
          modelVersionId: 164821,
        },
      },
    ]);
  });

  it("infers resource type from model version responses for modelVersionId-only resources", () => {
    const version = normalizeCivitaiModelVersionResponse({
      id: 1370636,
      name: "v1",
      baseModel: "Illustrious",
      modelId: 100,
      model: {
        id: 100,
        name: "Resolved LoRA",
        type: "LORA",
      },
    });

    expect(version.resourceType).toBe("lora");
    expect(
      mergeResourceVersion(
        {
          type: "other",
          name: null,
          hash: null,
          modelVersionId: 1370636,
          modelId: null,
          weight: 0.5,
          raw: {},
        },
        version,
      ).resourceType,
    ).toBe("lora");
  });

  it("normalizes full Civitai model responses with creator and selected model version", () => {
    const version = normalizeCivitaiModelVersionResponse(
      {
        id: 313098,
        name: "Red-blue fantasy",
        type: "Checkpoint",
        nsfw: false,
        creator: {
          username: "XUERYCJ",
          image: "https://image.civitai.com/avatar.jpeg",
        },
        tags: ["anime", "style"],
        modelVersions: [
          {
            id: 992725,
            name: "PONYv4.0",
            baseModel: "Pony",
            downloadUrl: "https://civitai.com/api/download/models/992725",
            files: [
              {
                primary: true,
                hashes: {
                  AutoV2: "32BD8C1961",
                  SHA256: "32BD8C19614161F583A2625D877655150F496EEAE22340F24439DF4C97B4DF13",
                },
              },
            ],
            images: [{ type: "image", url: "https://image.civitai.com/ref.jpeg" }],
          },
          {
            id: 913744,
            name: "PONYv3.0",
            baseModel: "Pony",
          },
        ],
      },
      { preferredModelVersionId: 992725 },
    );

    expect(version).toMatchObject({
      resourceType: "model",
      civitaiModelId: 313098,
      civitaiModelVersionId: 992725,
      name: "Red-blue fantasy",
      versionName: "PONYv4.0",
      hash: "32BD8C1961",
      baseModel: "Pony",
      creator: "XUERYCJ",
      downloadUrl: "https://civitai.com/api/download/models/992725",
      tags: ["anime", "style"],
      nsfw: false,
    });
    expect(version.officialImagesJson).toEqual([{ type: "image", url: "https://image.civitai.com/ref.jpeg" }]);
  });

  it("filters non-LoRA modelVersionId-only resources after resolved type is known", () => {
    const embedding = normalizeCivitaiModelVersionResponse({
      id: 10,
      name: "v1",
      model: {
        id: 20,
        name: "Lazy Embeddings",
        type: "TextualInversion",
      },
    });
    const vae = normalizeCivitaiModelVersionResponse({
      id: 11,
      name: "v1",
      model: {
        id: 21,
        name: "Neptunia VAE",
        type: "VAE",
      },
    });
    const upscaler = normalizeCivitaiModelVersionResponse({
      id: 12,
      name: "v1",
      model: {
        id: 22,
        name: "Remacri",
        type: "Upscaler",
      },
    });

    expect(embedding.resourceType).toBe("embedding");
    expect(vae.resourceType).toBe("vae");
    expect(upscaler.resourceType).toBe("other");
    expect(
      mergeResourceVersion(
        { type: "other", name: null, hash: null, modelVersionId: 10, modelId: null, weight: 1, raw: {} },
        embedding,
      ).resourceType,
    ).toBe("embedding");
  });

  it("treats LoCon and DoRA model-version types as LoRA-family resources", () => {
    expect(
      normalizeCivitaiModelVersionResponse({
        id: 1,
        model: { id: 2, name: "LoCon Resource", type: "LoCon" },
      }).resourceType,
    ).toBe("lora");
    expect(
      normalizeCivitaiModelVersionResponse({
        id: 3,
        model: { id: 4, name: "DoRA Resource", type: "DoRA" },
      }).resourceType,
    ).toBe("lora");
  });

  it("filters videos when selecting official preview images", () => {
    expect(
      getOfficialPreviewImage([
        { type: "video", url: "https://image.civitai.com/example.mp4" },
        { mimeType: "video/webm", url: "https://image.civitai.com/example-webm" },
        { type: "image", url: "https://image.civitai.com/example.jpeg" },
      ]),
    ).toBe("https://image.civitai.com/example.jpeg");
  });

  it("selects resource upsert keys by priority", () => {
    expect(
      chooseResourceUpsertKey({
        civitaiModelId: 1,
        civitaiModelVersionId: 2,
        name: "Name",
        versionName: "v1",
        hash: "HASH",
        baseModel: "Pony",
      }),
    ).toEqual({ kind: "civitaiModelVersionId", value: 2 });

    expect(
      chooseResourceUpsertKey({
        civitaiModelId: 1,
        civitaiModelVersionId: null,
        name: "Name",
        versionName: "v1",
        hash: "HASH",
        baseModel: "Pony",
      }),
    ).toEqual({ kind: "hash", value: "hash" });

    expect(
      chooseResourceUpsertKey({
        civitaiModelId: 1,
        civitaiModelVersionId: null,
        name: "Name",
        versionName: " V1 ",
        hash: null,
        baseModel: "Pony",
      }),
    ).toEqual({ kind: "modelVersionName", civitaiModelId: 1, versionName: "v1" });

    expect(
      chooseResourceUpsertKey({
        civitaiModelId: null,
        civitaiModelVersionId: null,
        name: "  Same   Name ",
        versionName: null,
        hash: null,
        baseModel: "Pony XL",
      }),
    ).toEqual({ kind: "normalizedNameBaseModel", normalizedName: "same name", baseModel: "pony xl" });
  });

  it("classifies LoRAs using rule keywords", () => {
    expect(classifyCivitaiLora({ name: "cinematic light and shadow" })).toBe("lighting");
    expect(classifyCivitaiLora({ tags: ["kimono", "uniform"] })).toBe("clothing");
    expect(classifyCivitaiLora({ description: "A city background scene helper" })).toBe("scene");
    expect(classifyCivitaiLora({ name: "unknown helper" })).toBe("other");
  });
});
