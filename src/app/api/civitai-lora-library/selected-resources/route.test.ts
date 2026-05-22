// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CivitaiResourceUpsertInput } from "@/features/civitai-lora-library";
import {
  openSceneForgeSqliteDatabase,
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
});
