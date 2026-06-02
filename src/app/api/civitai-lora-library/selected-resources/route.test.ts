// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CivitaiResourceUpsertInput, NormalizedCivitaiImage } from "@/features/civitai-lora-library";
import {
  openSceneForgeSqliteDatabase,
  upsertImportedCivitaiImageToSqlite,
  upsertImageResourceUsageToSqlite,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

import { GET } from "./route";

function makeResourceInput(
  resourceType: "lora" | "model",
  name: string,
  overrides: Partial<CivitaiResourceUpsertInput> = {},
): CivitaiResourceUpsertInput {
  return {
    resourceType,
    civitaiModelId: Math.floor(Math.random() * 100000),
    civitaiModelVersionId: Math.floor(Math.random() * 100000),
    name,
    versionName: "v1",
    hash: `${name}-hash`,
    baseModel: "Pony",
    trainedWords: resourceType === "lora" ? [`${name} trigger`] : [],
    tags: resourceType === "lora" ? ["cinematic", "detail"] : ["realistic"],
    description: `<p>${name} description&nbsp;with <strong>HTML</strong>.</p>`,
    creator: "resource creator",
    downloadUrl: null,
    filesJson: null,
    officialImagesJson: [
      { type: "video", url: `https://image.civitai.test/${name}.mp4` },
      { type: "image", url: `https://image.civitai.test/${name}.jpeg` },
    ],
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style"] : [],
    usageGuide: "Use with balanced lighting.",
    recommendations: [
      {
        condition: "default",
        baseModel: "Pony",
        checkpoint: resourceType === "model" ? name : null,
        sampler: "DPM++ 2M",
        loraWeightMin: resourceType === "lora" ? 0.6 : null,
        loraWeightMax: resourceType === "lora" ? 0.9 : null,
        loraWeight: resourceType === "lora" ? 0.75 : null,
        hdRedrawRate: null,
        notes: "Reference recommendation.",
      },
    ],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: null,
    ...overrides,
  };
}

function makeImage(id: number, prompt: string, overrides: Partial<NormalizedCivitaiImage> = {}): NormalizedCivitaiImage {
  return {
    baseModel: "Pony",
    browsingLevel: null,
    cfgScale: 5.5,
    civitaiImageId: id,
    civitaiImagePageUrl: `https://civitai.com/images/${id}`,
    createdAtOnCivitai: `2025-01-${String(id).padStart(2, "0")}T00:00:00.000Z`,
    height: 1024,
    imageUrl: `https://image.civitai.test/${id}.jpeg`,
    modelVersionIds: [],
    negativePrompt: "worst quality",
    nsfw: false,
    nsfwLevel: 1,
    postId: null,
    prompt,
    rawMetaJson: null,
    resources: [],
    sampler: "DPM++ 2M SDE",
    seed: String(id * 100),
    sourceImageUrl: null,
    steps: 28,
    username: "artist",
    width: 768,
    ...overrides,
  };
}

describe("selected Civitai resources route", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;
  let previousSqliteFile: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-selected-civitai-"));
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    db = await openSceneForgeSqliteDatabase();
  });

  afterEach(async () => {
    db.close();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns the selected checkpoint first and LoRAs in request order", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(db, makeResourceInput("model", "Checkpoint")).resource;
    const loraA = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "LoRA A")).resource;
    const loraB = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "LoRA B")).resource;

    const response = await GET(
      new Request(
        `http://localhost/api?checkpointId=${checkpoint.id}&loraIds=${loraB.id},${checkpoint.id},missing,${loraA.id}`,
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      checkpoint: {
        id: checkpoint.id,
        resourceType: "model",
        name: "Checkpoint",
        baseModel: "Pony",
        creator: "resource creator",
        tags: ["realistic"],
        usageGuide: "Use with balanced lighting.",
        descriptionSnippet: "Checkpoint description with HTML.",
        averageWeight: null,
        minWeight: null,
        maxWeight: null,
        previewImage: "https://image.civitai.test/Checkpoint.jpeg",
      },
      loras: [
        {
          id: loraB.id,
          resourceType: "lora",
          name: "LoRA B",
          trainedWords: ["LoRA B trigger"],
          tags: ["cinematic", "detail"],
          categories: ["style"],
          recommendations: [
            {
              condition: "default",
              baseModel: "Pony",
              sampler: "DPM++ 2M",
              loraWeight: 0.75,
            },
          ],
          previewImage: "https://image.civitai.test/LoRA B.jpeg",
        },
        {
          id: loraA.id,
          resourceType: "lora",
          name: "LoRA A",
          trainedWords: ["LoRA A trigger"],
        },
      ],
    });
  });

  it("filters missing resources and type mismatches", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(db, makeResourceInput("model", "Checkpoint")).resource;
    const lora = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "LoRA")).resource;

    const response = await GET(
      new Request(`http://localhost/api?checkpointId=${lora.id}&loraIds=${checkpoint.id},missing`),
    );

    await expect(response.json()).resolves.toEqual({
      checkpoint: null,
      loras: [],
    });
  });

  it("filters LoRAs that do not match the selected checkpoint base model", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Anima Checkpoint", { baseModel: "Anima" }),
    ).resource;
    const compatible = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Anima LoRA", { baseModel: "Anima" }),
    ).resource;
    const incompatible = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Pony LoRA", { baseModel: "Pony" }),
    ).resource;

    const response = await GET(
      new Request(`http://localhost/api?checkpointId=${checkpoint.id}&loraIds=${incompatible.id},${compatible.id}`),
    );
    const payload = await response.json();

    expect(payload.checkpoint).toMatchObject({
      id: checkpoint.id,
      baseModel: "Anima",
      modelStorageKind: "diffusion",
    });
    expect(payload.loras.map((lora: { id: string }) => lora.id)).toEqual([compatible.id]);
  });

  it("returns model filename aliases for selected Anima checkpoints", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Anima", {
        baseModel: "Anima",
        civitaiModelVersionId: 2945208,
        filesJson: [
          {
            primary: true,
            name: "pencil-xl-diffusion.safetensors",
            type: "Model",
            downloadUrl: "https://civitai.test/pencil-xl-diffusion.safetensors",
            hashes: {
              AutoV2: "BD43B7CFFE",
            },
          },
        ],
        versionName: "base-v1.0",
      }),
    ).resource;

    const response = await GET(new Request(`http://localhost/api?checkpointId=${checkpoint.id}`));
    const payload = await response.json();

    expect(payload.checkpoint.modelFileName).toBe("Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors");
    expect(payload.checkpoint.modelFileNameAliases).toEqual([
      "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
      "pencil-xl-diffusion.safetensors",
    ]);
  });

  it("trims HTML descriptions to a short LLM-safe snippet", async () => {
    const longDescription = `<div>${"alpha ".repeat(180)}<strong>omega</strong></div>`;
    const lora = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Long Description LoRA", {
        description: longDescription,
      }),
    ).resource;

    const response = await GET(new Request(`http://localhost/api?loraIds=${lora.id}`));
    const payload = await response.json();

    expect(payload.loras[0].descriptionSnippet).toMatch(/^alpha alpha/);
    expect(payload.loras[0].descriptionSnippet).not.toContain("<strong>");
    expect(payload.loras[0].descriptionSnippet.length).toBeLessThanOrEqual(803);
    expect(payload.loras[0].descriptionSnippet.endsWith("...")).toBe(true);
  });

  it("includes prompt references from images that use the selected checkpoint", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(db, makeResourceInput("model", "Checkpoint")).resource;
    const image = upsertImportedCivitaiImageToSqlite(
      db,
      makeImage(41, "masterpiece, cinematic portrait, detailed eyes"),
    );
    upsertImageResourceUsageToSqlite(db, {
      importedImageId: image.id,
      rawResourceJson: null,
      resolveStatus: "resolved_by_model_version_id",
      resourceId: checkpoint.id,
      source: "civitai_image_meta",
      triggerWordsUsed: [],
      weight: null,
    });

    const response = await GET(new Request(`http://localhost/api?checkpointId=${checkpoint.id}`));
    const payload = await response.json();

    expect(payload.checkpoint.promptReferences).toEqual([
      {
        cfgScale: 5.5,
        civitaiImagePageUrl: "https://civitai.com/images/41",
        negativePrompt: "worst quality",
        prompt: "masterpiece, cinematic portrait, detailed eyes",
        sampler: "DPM++ 2M SDE",
        seed: "4100",
        steps: 28,
      },
    ]);
  });
});
