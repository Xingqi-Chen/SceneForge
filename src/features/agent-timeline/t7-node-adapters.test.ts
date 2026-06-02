import { describe, expect, it } from "vitest";

import type {
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library";

import {
  createTimelineParameterRecommendation,
  validateTimelineResourceRecommendation,
} from "./t7-node-adapters";
import type {
  ResourceRecommendationTimelineResult,
  ScenePromptTimelineResult,
} from "./types";

function makeResource(
  resourceType: "model" | "lora",
  id: string,
  name: string,
  baseModel = "Pony",
): SelectedCivitaiResourcePreview {
  return {
    id,
    resourceType,
    name,
    versionName: "v1",
    baseModel,
    creator: "creator",
    trainedWords: resourceType === "lora" ? ["neon_style"] : [],
    tags: ["neon"],
    categories: [],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: resourceType === "lora" ? 0.7 : null,
    minWeight: null,
    maxWeight: null,
    recommendations: [
      {
        condition: "neon",
        baseModel,
        checkpoint: null,
        sampler: "DPM++ 2M Karras",
        loraWeightMin: null,
        loraWeightMax: null,
        loraWeight: resourceType === "lora" ? 0.7 : null,
        hdRedrawRate: null,
        notes: null,
      },
    ],
    previewImage: null,
    modelFileName: `${name}.safetensors`,
    ...(resourceType === "model" ? { modelStorageKind: "checkpoint" as const } : {}),
  };
}

function makeCandidate(resource: SelectedCivitaiResourcePreview): CivitaiRecommendationCandidate {
  return {
    resource,
    importedImageCount: 1,
    commonCheckpoints: [],
    commonLoras: [],
    score: 1,
  };
}

function makeScenePrompt(): ScenePromptTimelineResult {
  return {
    primaryCharacter: {
      name: "Courier",
      identity: "A courier in a neon alley",
      publicFacts: [],
    },
    sceneIntent: "A vertical portrait of a courier in a neon alley",
    styleTone: "cinematic anime",
    setting: "neon alley",
    sharedFacts: [],
    positivePrompt: "courier, neon alley, cinematic anime",
    negativeSuggestions: ["low quality", "bad hands"],
    style: [],
    camera: [{ label: "Portrait", prompt: "vertical portrait framing" }],
    lighting: [],
  };
}

describe("T7 timeline adapters", () => {
  it("rejects an invented checkpoint that is not in the local candidate set", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint");
    const invented = makeResource("model", "checkpoint-invented", "Invented Checkpoint");

    expect(() =>
      validateTimelineResourceRecommendation({
        candidates: {
          checkpoints: [makeCandidate(checkpoint)],
          loras: [],
        },
        recommendation: {
          checkpoint: {
            resource: invented,
            reason: "The LLM invented this.",
          },
          loras: [],
          recommendationReason: "Bad recommendation.",
          overallEffect: "Unavailable.",
          warnings: [],
        },
      }),
    ).toThrow("Recommended checkpoint is not in the local candidate set.");
  });

  it("keeps only compatible local LoRAs from the recommendation", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Pony");
    const compatible = makeResource("lora", "lora-compatible", "Compatible LoRA", "Pony");
    const incompatible = makeResource("lora", "lora-incompatible", "Incompatible LoRA", "SDXL");
    const invented = makeResource("lora", "lora-invented", "Invented LoRA", "Pony");

    const result = validateTimelineResourceRecommendation({
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [makeCandidate(compatible), makeCandidate(incompatible)],
      },
      recommendation: {
        checkpoint: {
          resource: checkpoint,
          reason: "Local checkpoint.",
        },
        loras: [
          { resource: compatible, suggestedWeight: 0.65, reason: "Local match." },
          { resource: incompatible, suggestedWeight: 0.7, reason: "Wrong base." },
          { resource: invented, suggestedWeight: 0.8, reason: "Unavailable." },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
    });

    expect(result.loras.map((lora) => lora.resource.id)).toEqual(["lora-compatible"]);
    expect(result.warnings).toEqual([
      "Ignored incompatible LoRA Incompatible LoRA.",
      "Ignored unavailable LoRA Invented LoRA.",
    ]);
  });

  it("keeps only the first local LoRA when a recommendation duplicates it", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Pony");
    const duplicated = makeResource("lora", "lora-duplicated", "Duplicated LoRA", "Pony");

    const result = validateTimelineResourceRecommendation({
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [makeCandidate(duplicated)],
      },
      recommendation: {
        checkpoint: {
          resource: checkpoint,
          reason: "Local checkpoint.",
        },
        loras: [
          { resource: duplicated, suggestedWeight: 0.65, reason: "First local match." },
          { resource: duplicated, suggestedWeight: 1.1, reason: "Duplicate match." },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
    });

    expect(result.loras).toHaveLength(1);
    expect(result.loras[0]).toMatchObject({
      reason: "First local match.",
      resource: { id: "lora-duplicated" },
      suggestedWeight: 0.65,
    });
    expect(result.warnings).toEqual(["Ignored duplicate LoRA Duplicated LoRA."]);
  });

  it("creates a ComfyUI request preview from resource and prompt context", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint");
    const lora = makeResource("lora", "lora-local", "Local LoRA");
    const resourceResult: ResourceRecommendationTimelineResult = {
      checkpoint: {
        resource: checkpoint,
        reason: "Local checkpoint.",
      },
      loras: [
        {
          resource: lora,
          suggestedWeight: 0.72,
          reason: "Local LoRA.",
        },
      ],
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [makeCandidate(lora)],
      },
      recommendationReason: "Local recommendation.",
      overallEffect: "Neon portrait.",
      warnings: [],
    };

    const result = createTimelineParameterRecommendation({
      resourceResult,
      scenePrompt: makeScenePrompt(),
      canvasBinding: null,
      samplerOptions: {
        samplers: ["euler", "dpmpp_2m"],
        schedulers: ["normal", "karras"],
      },
    });

    expect(result).toMatchObject({
      availableSamplers: ["euler", "dpmpp_2m"],
      availableSchedulers: ["normal", "karras"],
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 7,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
      negativeAdditions: ["low quality", "bad hands"],
    });
    expect(result.seedPolicy.mode).toBe("random");
    expect(result.requestPreview).toMatchObject({
      checkpointName: "Local Checkpoint.safetensors",
      positivePrompt: "courier, neon alley, cinematic anime",
      negativePrompt: "low quality, bad hands",
      loras: [
        {
          loraName: "Local LoRA.safetensors",
          strengthModel: 0.72,
          strengthClip: 0.72,
        },
      ],
    });
  });

  it("normalizes fallback sampler and scheduler to the live ComfyUI option set", () => {
    const checkpoint = {
      ...makeResource("model", "checkpoint-local", "Local Checkpoint"),
      recommendations: [],
    };
    const resourceResult: ResourceRecommendationTimelineResult = {
      checkpoint: {
        resource: checkpoint,
        reason: "Local checkpoint.",
      },
      loras: [],
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [],
      },
      recommendationReason: "Local recommendation.",
      overallEffect: "Neon portrait.",
      warnings: [],
    };

    const result = createTimelineParameterRecommendation({
      resourceResult,
      scenePrompt: makeScenePrompt(),
      canvasBinding: null,
      samplerOptions: {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    });

    expect(result).toMatchObject({
      availableSamplers: ["uni_pc"],
      availableSchedulers: ["sgm_uniform"],
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
      requestPreview: {
        samplerName: "uni_pc",
        scheduler: "sgm_uniform",
      },
    });
  });
});
