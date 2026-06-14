// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CivitaiLibrarySettings, CivitaiResourceRecord, CivitaiResourceUpsertInput } from "@/features/civitai-lora-library";
import {
  getCivitaiResourceConfiguredDownloadPath,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library";
import type { LlmChatRequest } from "@/features/llm";
import {
  openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";
import { rebuildCivitaiSearchIndex } from "@/features/persistence/civitai-search-index";
import {
  listCivitaiResourceEmbeddingInputs,
  readCivitaiEmbeddingIndexMetadata,
  rebuildCivitaiEmbeddingIndex,
} from "@/features/persistence/civitai-embedding-index";

const mockCompleteChat = vi.hoisted(() => vi.fn());
const mockCreateEmbedding = vi.hoisted(() => vi.fn());

vi.mock("@/features/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/llm")>();

  return {
    ...actual,
    createLiteLlmClient: vi.fn(() => ({
      completeChat: mockCompleteChat,
      createEmbedding: mockCreateEmbedding,
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
  let settings: CivitaiLibrarySettings;
  let previousSqliteFile: string | undefined;
  let previousEmbeddingModel: string | undefined;
  let previousNsfwModel: string | undefined;

  beforeEach(async () => {
    mockCompleteChat.mockReset();
    mockCreateEmbedding.mockReset();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-ai-rec-"));
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    previousEmbeddingModel = process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
    previousNsfwModel = process.env.LITELLM_NSFW_MODEL;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    process.env.LITELLM_CIVITAI_EMBEDDING_MODEL = "test-embedding-model";
    mockCreateEmbedding.mockResolvedValue({
      embeddings: [[1, 0, 0]],
    });
    db = await openSceneForgeSqliteDatabase(undefined, { allowExtensions: true });
    settings = {
      checkpointDownloadPath: path.join(tempDir, "checkpoints"),
      controlNetModelPath: path.join(tempDir, "controlnet"),
      diffusionModelPath: path.join(tempDir, "diffusion"),
      loraDownloadPath: path.join(tempDir, "loras"),
    };
    await Promise.all(Object.values(settings).map((directory) => fs.mkdir(directory, { recursive: true })));
    saveCivitaiLibrarySettingsToSqlite(db, settings);
  });

  afterEach(async () => {
    db.close();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    if (previousNsfwModel === undefined) {
      delete process.env.LITELLM_NSFW_MODEL;
    } else {
      process.env.LITELLM_NSFW_MODEL = previousNsfwModel;
    }
    if (previousEmbeddingModel === undefined) {
      delete process.env.LITELLM_CIVITAI_EMBEDDING_MODEL;
    } else {
      process.env.LITELLM_CIVITAI_EMBEDDING_MODEL = previousEmbeddingModel;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function markDownloaded(resource: CivitaiResourceRecord) {
    const downloadPath = getCivitaiResourceConfiguredDownloadPath(resource, settings);
    await fs.writeFile(path.join(downloadPath, makeCivitaiResourceTargetFileName(resource)), "downloaded");
  }

  function rebuildTestEmbeddingIndex() {
    const inputs = listCivitaiResourceEmbeddingInputs(db);

    rebuildCivitaiEmbeddingIndex(db, {
      model: "test-embedding-model",
      embeddings: inputs.map((input) => {
        const text = input.text.toLocaleLowerCase();

        return {
          chunkFingerprint: input.chunkFingerprint,
          chunkIndex: input.chunkIndex,
          resourceId: input.resourceId,
          resourceType: input.resourceType,
          sourceFingerprint: input.sourceFingerprint,
          embedding: text.includes("cyber") || text.includes("neon") ? [1, 0, 0] : [0, 1, 0],
        };
      }),
    });
  }

  it("returns an actionable error when the Civitai FTS index is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({ desiredEffect: "cyber neon" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.message).toContain("npm run civitai:reindex");
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("returns an error before calling the LLM when no checkpoint exists", async () => {
    const lora = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "Only LoRA")).resource;
    await markDownloaded(lora);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

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

  it("returns an actionable error when the Civitai embedding index is missing", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    await markDownloaded(checkpoint);
    rebuildCivitaiSearchIndex(db);

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({ desiredEffect: "cyber neon" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.message).toContain("npm run civitai:reindex-embeddings");
    expect(readCivitaiEmbeddingIndexMetadata(db)).toBeNull();
    expect(mockCreateEmbedding).not.toHaveBeenCalled();
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("returns an actionable error when query embedding generation fails", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    await markDownloaded(checkpoint);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();
    mockCreateEmbedding.mockRejectedValue(new Error("embedding server unavailable"));

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({ desiredEffect: "cyber neon" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.message).toContain("npm run civitai:reindex-embeddings");
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("sanitizes query text before creating a recommendation embedding", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    await markDownloaded(checkpoint);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

    const unpairedLowSurrogate = String.fromCharCode(0xdd27);
    const unpairedHighSurrogate = String.fromCharCode(0xd83d);

    mockCompleteChat.mockResolvedValue({
      content: JSON.stringify({
        checkpointId: checkpoint.id,
        checkpointReason: "Matches the requested effect.",
        loras: [],
        recommendationReason: "Selected the available local checkpoint.",
        overallEffect: "Cinematic portrait.",
      }),
      role: "assistant",
    });

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({
          desiredEffect: `cinematic ${unpairedLowSurrogate} portrait ${unpairedHighSurrogate}`,
        }),
      }),
    );
    const embeddingRequest = mockCreateEmbedding.mock.calls[0]?.[0];
    const chatRequest = mockCompleteChat.mock.calls[0]?.[0] as LlmChatRequest | undefined;
    const chatContent = chatRequest?.messages.map((message) => message.content).join("\n") ?? "";

    expect(response.status).toBe(200);
    expect(embeddingRequest?.input).toContain("\uFFFD");
    expect(() => encodeURIComponent(String(embeddingRequest?.input))).not.toThrow();
    expect(chatContent).toContain("\uFFFD");
    expect(() => encodeURIComponent(chatContent)).not.toThrow();
  });

  it("returns an actionable error when the embedding source text fingerprint is stale", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    await markDownloaded(checkpoint);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

    db.prepare(`
      UPDATE civitai_resource_search_fts
      SET search_text = ?
      WHERE resource_id = ?
    `).run("changed semantic source text", checkpoint.id);

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({ desiredEffect: "cyber neon" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.message).toContain("npm run civitai:reindex-embeddings");
    expect(mockCreateEmbedding).not.toHaveBeenCalled();
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("returns BM25 reindex remediation when the FTS index is stale before embedding readiness", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    await markDownloaded(checkpoint);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

    const lateCheckpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Late Checkpoint"),
    ).resource;
    await markDownloaded(lateCheckpoint);

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        body: JSON.stringify({ desiredEffect: "cyber neon" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.message).toContain("npm run civitai:reindex before npm run civitai:reindex-embeddings");
    expect(mockCreateEmbedding).not.toHaveBeenCalled();
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("uses the NSFW model for NSFW recommendation requests", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "NSFW Checkpoint"),
    ).resource;
    await markDownloaded(checkpoint);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();
    process.env.LITELLM_NSFW_MODEL = "nsfw-model";

    mockCompleteChat.mockResolvedValue({
      content: JSON.stringify({
        checkpointId: checkpoint.id,
        checkpointReason: "Matches the requested effect.",
        loras: [],
        recommendationReason: "Selected the available local checkpoint.",
        overallEffect: "Cinematic portrait.",
      }),
      role: "assistant",
    });

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desiredEffect: "cinematic portrait", maxLoras: 3, nsfw: true }),
      }),
    );
    const request = mockCompleteChat.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(request.nsfw).toBe(true);
    expect(request.model).toBe("nsfw-model");
  });

  it("recommends a downloaded checkpoint and LoRA selection from local candidates", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Checkpoint"),
    ).resource;
    const loraA = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "Neon Rain")).resource;
    const loraB = upsertCivitaiResourceToSqlite(db, makeResourceInput("lora", "Glow Detail")).resource;
    const notDownloadedLora = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Not Downloaded"),
    ).resource;
    await Promise.all([markDownloaded(checkpoint), markDownloaded(loraA), markDownloaded(loraB)]);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

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
    expect(userContent.loraCandidates.map((candidate: { id: string }) => candidate.id)).not.toContain(
      notDownloadedLora.id,
    );
    expect(JSON.stringify(userContent)).not.toContain("model.safetensors");
    expect(JSON.stringify(userContent)).not.toContain(`${loraA.name}-hash`);
  });

  it("sends BM25-ranked local candidates to the LLM before recommendation parsing", async () => {
    const checkpoint = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Cyber Neon Checkpoint", {
        tags: ["cyberpunk", "neon", "cinematic"],
        usageGuide: "Use for cyberpunk neon rain scenes.",
      }),
    ).resource;
    const exactLora = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Neon Rain Reflections", {
        trainedWords: ["neon rain reflections"],
        tags: ["cyberpunk", "neon", "rain"],
        usageGuide: "Adds cyberpunk neon rain reflections.",
      }),
    ).resource;
    const fallbackLora = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("lora", "Soft Portrait Utility", {
        trainedWords: ["soft portrait"],
        tags: ["portrait", "skin"],
        usageGuide: "Use for gentle portrait cleanup.",
      }),
    ).resource;
    await Promise.all([markDownloaded(checkpoint), markDownloaded(exactLora), markDownloaded(fallbackLora)]);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

    mockCompleteChat.mockResolvedValue({
      content: JSON.stringify({
        checkpointId: checkpoint.id,
        checkpointReason: "Best BM25 checkpoint match.",
        loras: [{ id: exactLora.id, suggestedWeight: 0.65, reason: "Best BM25 LoRA match." }],
        recommendationReason: "Selected the first ranked candidates.",
        overallEffect: "Cyberpunk neon rain reflections.",
      }),
      role: "assistant",
    });

    const response = await POST(
      new Request("http://localhost/api/civitai-lora-library/ai-recommendation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desiredEffect: "cyberpunk neon rain reflections", maxLoras: 3 }),
      }),
    );
    const request = mockCompleteChat.mock.calls[0]?.[0];
    const userContent = JSON.parse(request.messages[1].content);

    expect(response.status).toBe(200);
    expect(userContent.loraCandidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      exactLora.id,
      fallbackLora.id,
    ]);
    expect(userContent.checkpointCandidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      checkpoint.id,
    ]);
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
    await Promise.all([markDownloaded(animaCheckpoint), markDownloaded(animaLora)]);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

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
    await Promise.all([markDownloaded(illustriousCheckpoint), markDownloaded(sdxlCheckpoint)]);
    rebuildCivitaiSearchIndex(db);
    rebuildTestEmbeddingIndex();

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
