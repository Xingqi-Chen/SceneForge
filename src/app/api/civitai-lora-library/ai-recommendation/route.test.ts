// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CivitaiResourceUpsertInput } from "@/features/civitai-lora-library";
import {
  openSceneForgeSqliteDatabase,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

const mockCompleteChat = vi.hoisted(() => vi.fn());

vi.mock("@/features/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm")>();

  return {
    ...actual,
    createLiteLlmClient: vi.fn(() => ({
      completeChat: mockCompleteChat,
    })),
  };
});

vi.mock("@/features/llm/llm-local-log", () => ({
  appendLlmLocalLog: vi.fn(async () => undefined),
  serializeErrorForLlmLog: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}));

import { POST } from "./route";

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
    baseModel: "Illustrious",
    trainedWords: resourceType === "lora" ? [`${name} trigger`] : [],
    tags: resourceType === "lora" ? ["cyberpunk", "lighting"] : ["realistic", "cinematic"],
    description: `<p>${name} description with useful metadata.</p>`,
    creator: "resource creator",
    downloadUrl: "https://download.test/model.safetensors",
    filesJson: { private: "files" },
    officialImagesJson: [{ type: "image", url: `https://image.civitai.test/${name}.jpeg` }],
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style"] : [],
    usageGuide: "Use for neon cinematic lighting.",
    recommendations: [
      {
        condition: "default",
        baseModel: "Illustrious",
        checkpoint: resourceType === "model" ? name : null,
        sampler: "DPM++ 2M",
        loraWeightMin: resourceType === "lora" ? 0.6 : null,
        loraWeightMax: resourceType === "lora" ? 0.9 : null,
        loraWeight: resourceType === "lora" ? 0.75 : null,
        hdRedrawRate: null,
        notes: "Reference recommendation.",
      },
    ],
    enrichmentStatus: "ai_enriched",
    enrichmentError: null,
    nsfw: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: { private: "raw" },
    ...overrides,
  };
}

describe("Civitai AI recommendation route", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;
  let previousSqliteFile: string | undefined;

  beforeEach(async () => {
    mockCompleteChat.mockReset();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-ai-rec-"));
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

  it("returns an error before calling the LLM when no checkpoint exists", async () => {
    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({ desiredEffect: "赛博朋克霓虹" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toContain("checkpoint");
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("recommends a verified checkpoint and LoRA selection from local candidates", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    const loraA = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "Neon Rain")).resource;
    const loraB = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "Glow Detail")).resource;

    mockCompleteChat.mockResolvedValue({
      content: JSON.stringify({
        checkpointId: checkpoint.id,
        checkpointReason: "这个 checkpoint 适合作为霓虹写实基底。",
        loras: [
          { id: loraA.id, suggestedWeight: 0.72, reason: "增强雨夜霓虹反射。" },
          { id: loraB.id, suggestedWeight: 0.55, reason: "补强高光细节。" },
        ],
        recommendationReason: "组合能覆盖用户想要的赛博朋克霓虹效果。",
        overallEffect: "画面会偏电影感、霓虹反射强、细节锐利。",
      }),
      role: "assistant",
    });

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desiredEffect: "赛博朋克霓虹雨夜", maxLoras: 3 }),
      }),
    );
    const payload = await response.json();
    const request = mockCompleteChat.mock.calls[0]?.[0];
    const userContent = JSON.parse(request.messages[1].content);

    expect(response.status).toBe(200);
    expect(payload.checkpoint.resource.id).toBe(checkpoint.id);
    expect(payload.loras.map((entry: { resource: { id: string } }) => entry.resource.id)).toEqual([
      loraA.id,
      loraB.id,
    ]);
    expect(payload.loras[0].suggestedWeight).toBe(0.72);
    expect(userContent.checkpointCandidates).toHaveLength(1);
    expect(userContent.loraCandidates.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(userContent)).not.toContain("model.safetensors");
    expect(JSON.stringify(userContent)).not.toContain(`${loraA.name}-hash`);
  });

  it("passes promptProfile through and only sends matching profile candidates to the LLM", async () => {
    upsertCivitaiResourceToSqlite(db, makeResourceInput("model", "Illustrious Checkpoint"));
    upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "Illustrious LoRA"));
    const animaCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Anima Checkpoint", {
        baseModel: "Anima",
        recommendations: [
          {
            condition: "default",
            baseModel: "Anima",
            checkpoint: "Anima Checkpoint",
            sampler: "DPM++ 2M",
            loraWeightMin: null,
            loraWeightMax: null,
            loraWeight: null,
            hdRedrawRate: null,
            notes: "Anima recommendation.",
          },
        ],
      }),
    ).resource;
    const animaLora = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Anima LoRA", {
        baseModel: "Anima",
        recommendations: [
          {
            condition: "default",
            baseModel: "Anima",
            checkpoint: null,
            sampler: "DPM++ 2M",
            loraWeightMin: 0.6,
            loraWeightMax: 0.9,
            loraWeight: 0.7,
            hdRedrawRate: null,
            notes: "Anima LoRA recommendation.",
          },
        ],
      }),
    ).resource;

    mockCompleteChat.mockResolvedValue({
      content: JSON.stringify({
        checkpointId: animaCheckpoint.id,
        checkpointReason: "Anima checkpoint matches the selected profile.",
        loras: [
          { id: animaLora.id, suggestedWeight: 0.7, reason: "Anima LoRA matches the selected profile." },
        ],
        recommendationReason: "Selected only Anima resources.",
        overallEffect: "Anima-styled render.",
      }),
      role: "assistant",
    });

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          desiredEffect: "rainy anime courier",
          maxLoras: 3,
          promptProfile: "anima",
        }),
      }),
    );
    const payload = await response.json();
    const request = mockCompleteChat.mock.calls[0]?.[0];
    const userContent = JSON.parse(request.messages[1].content);

    expect(response.status).toBe(200);
    expect(payload.checkpoint.resource.id).toBe(animaCheckpoint.id);
    expect(payload.loras.map((entry: { resource: { id: string } }) => entry.resource.id)).toEqual([
      animaLora.id,
    ]);
    expect(userContent.promptProfile).toBe("anima");
    expect(userContent.checkpointCandidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      animaCheckpoint.id,
    ]);
    expect(userContent.loraCandidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      animaLora.id,
    ]);
    expect(request.messages[0].content).toContain("selected prompt/base-model profile is Anima (anima)");
  });

  it("keeps unprofiled recommendation requests backward compatible with all local candidates", async () => {
    const illustriousCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Illustrious Checkpoint"),
    ).resource;
    const sdxlCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "SDXL Checkpoint", {
        baseModel: "SDXL 1.0",
        recommendations: [
          {
            condition: "default",
            baseModel: "SDXL 1.0",
            checkpoint: "SDXL Checkpoint",
            sampler: "DPM++ 2M",
            loraWeightMin: null,
            loraWeightMax: null,
            loraWeight: null,
            hdRedrawRate: null,
            notes: "SDXL recommendation.",
          },
        ],
      }),
    ).resource;

    mockCompleteChat.mockResolvedValue({
      content: JSON.stringify({
        checkpointId: sdxlCheckpoint.id,
        checkpointReason: "SDXL remains available when no prompt profile is provided.",
        loras: [],
        recommendationReason: "Selected a generic local checkpoint.",
        overallEffect: "Generic SDXL render.",
      }),
      role: "assistant",
    });

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          desiredEffect: "generic cinematic portrait",
          maxLoras: 3,
        }),
      }),
    );
    const payload = await response.json();
    const request = mockCompleteChat.mock.calls[0]?.[0];
    const userContent = JSON.parse(request.messages[1].content);

    expect(response.status).toBe(200);
    expect(payload.checkpoint.resource.id).toBe(sdxlCheckpoint.id);
    expect(userContent.promptProfile).toBeUndefined();
    expect(userContent.checkpointCandidates.map((candidate: { id: string }) => candidate.id)).toEqual(
      expect.arrayContaining([illustriousCheckpoint.id, sdxlCheckpoint.id]),
    );
    expect(request.messages[0].content).toContain("No prompt/base-model profile was provided");
  });
});
