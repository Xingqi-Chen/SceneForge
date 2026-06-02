import { describe, expect, it } from "vitest";

import type {
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library";

import {
  buildTimelineFinalPositivePrompt,
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
  overrides: Partial<SelectedCivitaiResourcePreview> = {},
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
    ...overrides,
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
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
    });

    expect(result.loras.map((lora) => lora.resource.id)).toEqual(["lora-compatible"]);
    expect(result.warnings).toEqual([
      "Ignored incompatible LoRA Incompatible LoRA.",
    ]);
  });

  it("rejects an invented LoRA that is not in the local candidate set", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Pony");
    const invented = makeResource("lora", "lora-invented", "Invented LoRA", "Pony");

    expect(() =>
      validateTimelineResourceRecommendation({
        candidates: {
          checkpoints: [makeCandidate(checkpoint)],
          loras: [],
        },
        recommendation: {
          checkpoint: {
            resource: checkpoint,
            reason: "Local checkpoint.",
          },
          loras: [
            { resource: invented, suggestedWeight: 0.8, reason: "Unavailable." },
          ],
          recommendationReason: "Bad recommendation.",
          overallEffect: "Unavailable.",
          warnings: [],
        },
      }),
    ).toThrow("Recommended LoRA is not in the local candidate set.");
  });

  it("maps a recommendation to an unambiguous local candidate name match", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Pony");
    const localLora = makeResource("lora", "lora-local", "Local LoRA", "Pony");
    const wrongIdLora = makeResource("lora", "lora-invented-id", "Local LoRA", "Pony");

    const result = validateTimelineResourceRecommendation({
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [makeCandidate(localLora)],
      },
      recommendation: {
        checkpoint: {
          resource: checkpoint,
          reason: "Local checkpoint.",
        },
        loras: [
          { resource: wrongIdLora, suggestedWeight: 0.8, reason: "Same local name." },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
    });

    expect(result.loras[0]?.resource.id).toBe("lora-local");
    expect(result.warnings).toEqual([
      "Mapped recommended LoRA Local LoRA to local candidate Local LoRA.",
    ]);
  });

  it("rejects ambiguous checkpoint alias matches in the local candidate set", () => {
    const checkpointA = makeResource("model", "checkpoint-a", "Shared Checkpoint", "Pony");
    const checkpointB = makeResource("model", "checkpoint-b", "Shared Checkpoint", "Pony");
    const recommended = makeResource("model", "checkpoint-invented", "Shared Checkpoint", "Pony");

    expect(() =>
      validateTimelineResourceRecommendation({
        candidates: {
          checkpoints: [makeCandidate(checkpointA), makeCandidate(checkpointB)],
          loras: [],
        },
        recommendation: {
          checkpoint: {
            resource: recommended,
            reason: "Ambiguous name.",
          },
          loras: [],
          recommendationReason: "Bad recommendation.",
          overallEffect: "Ambiguous.",
          warnings: [],
        },
      }),
    ).toThrow("Recommended checkpoint is not in the local candidate set.");
  });

  it("rejects ambiguous LoRA alias matches in the local candidate set", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Pony");
    const loraA = makeResource("lora", "lora-a", "Shared LoRA", "Pony");
    const loraB = makeResource("lora", "lora-b", "Shared LoRA", "Pony");
    const recommended = makeResource("lora", "lora-invented", "Shared LoRA", "Pony");

    expect(() =>
      validateTimelineResourceRecommendation({
        candidates: {
          checkpoints: [makeCandidate(checkpoint)],
          loras: [makeCandidate(loraA), makeCandidate(loraB)],
        },
        recommendation: {
          checkpoint: {
            resource: checkpoint,
            reason: "Local checkpoint.",
          },
          loras: [
            { resource: recommended, suggestedWeight: 0.8, reason: "Ambiguous name." },
          ],
          recommendationReason: "Bad recommendation.",
          overallEffect: "Ambiguous.",
          warnings: [],
        },
      }),
    ).toThrow("Recommended LoRA is not in the local candidate set.");
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

  it("uses resolved local resource metadata for final prompt and ComfyUI request fields", () => {
    const localCheckpoint = makeResource("model", "checkpoint-local", "Shared Checkpoint", "Pony", {
      modelFileName: "local-checkpoint.safetensors",
    });
    const recommendedCheckpoint = makeResource("model", "checkpoint-invented", "Shared Checkpoint", "Illustrious", {
      modelFileName: "invented-checkpoint.safetensors",
    });
    const localLora = makeResource("lora", "lora-local", "Shared LoRA", "Pony", {
      modelFileName: "local-lora.safetensors",
      trainedWords: ["local_trigger"],
    });
    const recommendedLora = makeResource("lora", "lora-invented", "Shared LoRA", "Pony", {
      modelFileName: "invented-lora.safetensors",
      trainedWords: ["invented_trigger"],
    });

    const resourceResult = validateTimelineResourceRecommendation({
      candidates: {
        checkpoints: [makeCandidate(localCheckpoint)],
        loras: [makeCandidate(localLora)],
      },
      recommendation: {
        checkpoint: {
          resource: recommendedCheckpoint,
          reason: "Same local name.",
        },
        loras: [
          { resource: recommendedLora, suggestedWeight: 0.74, reason: "Same local name." },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
    });

    const result = createTimelineParameterRecommendation({
      resourceResult,
      scenePrompt: makeScenePrompt(),
      canvasBinding: null,
      samplerOptions: {
        samplers: ["euler"],
        schedulers: ["normal"],
      },
    });

    expect(resourceResult.checkpoint.resource.id).toBe("checkpoint-local");
    expect(resourceResult.loras[0]?.resource.id).toBe("lora-local");
    expect(result.requestPreview).toMatchObject({
      checkpointName: "local-checkpoint.safetensors",
      modelBaseModel: "Pony",
      positivePrompt: "score_9, score_8_up, score_7_up, courier, neon alley, cinematic anime, local_trigger",
      loras: [
        {
          loraName: "local-lora.safetensors",
          strengthModel: 0.74,
          strengthClip: 0.74,
        },
      ],
      workflowProfile: "default",
    });
    expect(result.requestPreview.positivePrompt).not.toContain("invented_trigger");
    expect(result.requestPreview.checkpointName).not.toBe("invented-checkpoint.safetensors");
    expect(result.requestPreview.loras?.[0]?.loraName).not.toBe("invented-lora.safetensors");
  });

  it("assembles the final prompt after selected resources are known", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "SDXL");
    const lora = makeResource("lora", "lora-local", "Local LoRA", "SDXL", {
      trainedWords: ["neon_style", "cinematic anime"],
    });
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

    expect(buildTimelineFinalPositivePrompt({
      resourceResult,
      scenePrompt: makeScenePrompt(),
    })).toBe("courier, neon alley, cinematic anime, neon_style");
  });

  it("creates a ComfyUI request preview from the final formatted prompt", () => {
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
    expect(result.finalPositivePrompt).toBe("score_9, score_8_up, score_7_up, courier, neon alley, cinematic anime, neon_style");
    expect(result.requestPreview).toMatchObject({
      checkpointName: "Local Checkpoint.safetensors",
      positivePrompt: "score_9, score_8_up, score_7_up, courier, neon alley, cinematic anime, neon_style",
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

  it("succeeds when a selected LoRA has no trained words", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "SDXL");
    const lora = makeResource("lora", "lora-local", "Local LoRA", "SDXL", {
      trainedWords: [],
    });
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
    });

    expect(result.requestPreview.positivePrompt).toBe("courier, neon alley, cinematic anime");
    expect(result.requestPreview.loras).toEqual([
      {
        loraName: "Local LoRA.safetensors",
        strengthModel: 0.72,
        strengthClip: 0.72,
      },
    ]);
  });

  it("formats Anima and Illustrious/generic prompts differently by checkpoint base model", () => {
    const scenePrompt = makeScenePrompt();
    const animaCheckpoint = makeResource("model", "checkpoint-anima", "Anima Checkpoint", "Anima");
    const illustriousCheckpoint = makeResource(
      "model",
      "checkpoint-illustrious",
      "Illustrious Checkpoint",
      "Illustrious",
    );
    const genericCheckpoint = makeResource("model", "checkpoint-generic", "Generic Checkpoint", "SDXL");

    const makeResourceResult = (
      checkpoint: SelectedCivitaiResourcePreview,
    ): ResourceRecommendationTimelineResult => ({
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
    });

    const anima = buildTimelineFinalPositivePrompt({
      resourceResult: makeResourceResult(animaCheckpoint),
      scenePrompt,
    });
    const illustrious = buildTimelineFinalPositivePrompt({
      resourceResult: makeResourceResult(illustriousCheckpoint),
      scenePrompt,
    });
    const generic = buildTimelineFinalPositivePrompt({
      resourceResult: makeResourceResult(genericCheckpoint),
      scenePrompt,
    });

    expect(anima).toContain("score_7");
    expect(illustrious).toContain("amazing quality");
    expect(generic).toBe(scenePrompt.positivePrompt);
    expect(anima).not.toBe(generic);
    expect(illustrious).not.toBe(generic);
  });

  it("does not format an assembled Anima prompt a second time in the request preview", () => {
    const checkpoint = makeResource("model", "checkpoint-anima", "Anima Checkpoint", "Anima");
    const lora = makeResource("lora", "lora-anima", "Anima LoRA", "Anima", {
      trainedWords: ["neon_style"],
    });
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
    });

    expect(result.requestPreview.workflowProfile).toBe("anima");
    expect(result.finalPositivePrompt).toBe(result.requestPreview.positivePrompt);
    expect(result.requestPreview.positivePrompt.match(/masterpiece/g)).toHaveLength(1);
    expect(result.requestPreview.positivePrompt.match(/score_7/g)).toHaveLength(1);
    expect(result.requestPreview.positivePrompt.match(/neon_style/g)).toHaveLength(1);
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
