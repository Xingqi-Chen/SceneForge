// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { CivitaiResourceDetail } from "./types";
import {
  rankCivitaiRecommendationCandidates,
  parseCivitaiCombinationRecommendationContent,
  reciprocalRankFuseCivitaiRecommendationCandidates,
  toLlmCivitaiRecommendationCandidate,
  validateCivitaiCombinationRecommendation,
} from "./ai-recommendation";

function makeDetail(overrides: Partial<CivitaiResourceDetail> = {}): CivitaiResourceDetail {
  const resourceType = overrides.resourceType ?? "lora";

  return {
    id: "resource-a",
    resourceType,
    civitaiModelId: 1,
    civitaiModelVersionId: 2,
    name: "Cyber Neon Detail",
    versionName: "v1",
    hash: "secret-hash",
    baseModel: "SDXL 1.0",
    trainedWords: ["cyber armor", "neon trim"],
    tags: ["cyberpunk", "lighting", "detail"],
    description: "<p>Cyberpunk neon detail enhancer with rain reflections and glowing texture.</p>",
    creator: "creator",
    downloadUrl: "https://download.test/model.safetensors",
    filesJson: { private: "file-metadata" },
    officialImagesJson: [{ type: "image", url: "https://image.test/a.jpeg" }],
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style", "lighting"] : [],
    usageGuide: "Use for neon cyberpunk lighting.",
    recommendations: [
      {
        condition: "default",
        baseModel: "SDXL 1.0",
        checkpoint: null,
        sampler: "DPM++ 2M",
        loraWeightMin: 0.6,
        loraWeightMax: 0.9,
        loraWeight: 0.75,
        hdRedrawRate: null,
        notes: "Keep weight moderate for clean neon details.",
      },
    ],
    enrichmentStatus: "ai_enriched",
    enrichmentError: null,
    nsfw: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: { private: "raw-version" },
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    importedImageCount: 2,
    averageWeight: 0.7,
    minWeight: 0.5,
    maxWeight: 0.9,
    previewImage: "https://image.test/a.jpeg",
    usages: [],
    commonCheckpoints: [{ resourceId: "checkpoint-a", name: "Cyber Checkpoint", count: 3 }],
    commonLoras: [{ resourceId: "lora-b", name: "Rain FX", count: 2 }],
    ...overrides,
  };
}

describe("Civitai AI recommendation helpers", () => {
  it("ranks local candidates with keyword matching and trims LLM payload fields", () => {
    const cyber = makeDetail({ id: "cyber", importedImageCount: 1 });
    const portrait = makeDetail({
      id: "portrait",
      name: "Soft Portrait",
      tags: ["portrait"],
      trainedWords: ["soft face"],
      description: "Gentle portrait style.",
      usageGuide: "Use for warm portraits.",
      importedImageCount: 20,
    });

    const [first] = rankCivitaiRecommendationCandidates([portrait, cyber], "赛博朋克霓虹雨夜");

    expect(first.resource.id).toBe("cyber");

    const payload = toLlmCivitaiRecommendationCandidate(first);
    expect(payload).toMatchObject({
      id: "cyber",
      name: "Cyber Neon Detail",
      importedImageCount: 1,
      observedWeight: {
        average: 0.7,
        min: 0.5,
        max: 0.9,
      },
    });
    expect(Object.keys(payload)).not.toContain("previewImage");
    expect(Object.keys(payload)).not.toContain("hash");
    expect(Object.keys(payload)).not.toContain("downloadUrl");
    expect(JSON.stringify(payload)).not.toContain("secret-hash");
    expect(JSON.stringify(payload)).not.toContain("model.safetensors");
    expect(JSON.stringify(payload)).not.toContain("raw-version");
  });

  it("parses fenced JSON and normalizes illegal LoRA weights", () => {
    const parsed = parseCivitaiCombinationRecommendationContent(
      "```json\n{\"checkpointId\":\"checkpoint-a\",\"loras\":[{\"id\":\"lora-a\",\"suggestedWeight\":\"wild\"},{\"id\":\"lora-b\",\"suggestedWeight\":\"75%\"}],\"recommendationReason\":\"适合目标效果\",\"overallEffect\":\"霓虹质感更强\"}\n```",
    );

    expect(parsed.checkpointId).toBe("checkpoint-a");
    expect(parsed.loras).toEqual([
      { id: "lora-a", suggestedWeight: null, reason: "" },
      { id: "lora-b", suggestedWeight: 0.75, reason: "" },
    ]);
  });

  it("merges independent BM25 and embedding ranks with fixed reciprocal rank fusion", () => {
    const bm25First = rankCivitaiRecommendationCandidates(
      [makeDetail({ id: "bm25-first", name: "Cyber Neon Detail", importedImageCount: 1 })],
      "cyber neon",
    )[0];
    const bm25Second = rankCivitaiRecommendationCandidates(
      [makeDetail({ id: "shared", name: "Cyber Shared Detail", importedImageCount: 1 })],
      "cyber",
    )[0];
    const embeddingFirst = rankCivitaiRecommendationCandidates(
      [makeDetail({ id: "shared", name: "Embedding Shared Detail", importedImageCount: 1 })],
      "embedding",
    )[0];
    const embeddingSecond = rankCivitaiRecommendationCandidates(
      [makeDetail({ id: "embedding-second", name: "Embedding Second Detail", importedImageCount: 1 })],
      "embedding",
    )[0];

    const fused = reciprocalRankFuseCivitaiRecommendationCandidates([
      [bm25First, bm25Second],
      [embeddingFirst, embeddingSecond],
    ]);

    expect(fused.map((candidate) => candidate.resource.id)).toEqual([
      "shared",
      "bm25-first",
      "embedding-second",
    ]);
    expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61, 6);
  });

  it("validates ids, dedupes LoRAs, and enforces the max LoRA count", () => {
    const checkpoint = rankCivitaiRecommendationCandidates(
      [makeDetail({ id: "checkpoint-a", resourceType: "model", name: "Cyber Checkpoint" })],
      "cyber",
    );
    const loras = rankCivitaiRecommendationCandidates(
      [
        makeDetail({ id: "lora-a", name: "LoRA A" }),
        makeDetail({ id: "lora-b", name: "LoRA B" }),
        makeDetail({ id: "lora-c", name: "LoRA C" }),
      ],
      "cyber",
    );
    const warnings: string[] = [];

    const result = validateCivitaiCombinationRecommendation({
      checkpointCandidates: checkpoint,
      loraCandidates: loras,
      maxLoras: 2,
      parsed: {
        checkpointId: "checkpoint-a",
        checkpointReason: "checkpoint reason",
        loras: [
          { id: "missing", suggestedWeight: 0.5, reason: "" },
          { id: "lora-a", suggestedWeight: 0.7, reason: "a" },
          { id: "lora-a", suggestedWeight: 0.8, reason: "duplicate" },
          { id: "lora-b", suggestedWeight: 0.6, reason: "b" },
          { id: "lora-c", suggestedWeight: 0.4, reason: "c" },
        ],
        recommendationReason: "overall reason",
        overallEffect: "effect",
      },
      warnings,
    });

    expect(result.loras.map((entry) => entry.resource.id)).toEqual(["lora-a", "lora-b"]);
    expect(result.warnings).toEqual([
      "AI 返回的 LoRA missing 不在候选列表中，已忽略。",
      "AI 重复返回了 LoRA LoRA A，已保留第一次推荐。",
      "AI 返回的 LoRA 超过 2 个，已只保留前 2 个。",
    ]);
  });

  it("ignores LoRAs whose base model does not match the recommended checkpoint", () => {
    const checkpoint = rankCivitaiRecommendationCandidates(
      [
        makeDetail({
          id: "anima-checkpoint",
          resourceType: "model",
          name: "Anima Checkpoint",
          baseModel: "Anima",
        }),
      ],
      "anima",
    );
    const loras = rankCivitaiRecommendationCandidates(
      [
        makeDetail({ id: "anima-lora", name: "Anima LoRA", baseModel: "Anima" }),
        makeDetail({ id: "pony-lora", name: "Pony LoRA", baseModel: "Pony" }),
      ],
      "lora",
    );
    const result = validateCivitaiCombinationRecommendation({
      checkpointCandidates: checkpoint,
      loraCandidates: loras,
      maxLoras: 3,
      parsed: {
        checkpointId: "anima-checkpoint",
        checkpointReason: "checkpoint reason",
        loras: [
          { id: "pony-lora", suggestedWeight: 0.7, reason: "wrong base" },
          { id: "anima-lora", suggestedWeight: 0.6, reason: "right base" },
        ],
        recommendationReason: "overall reason",
        overallEffect: "effect",
      },
    });

    expect(result.loras.map((entry) => entry.resource.id)).toEqual(["anima-lora"]);
    expect(result.warnings).toContain(
      "AI returned incompatible LoRA Pony LoRA for checkpoint baseModel Anima; ignored.",
    );
  });
});
