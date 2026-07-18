import { describe, expect, it, vi } from "vitest";

import type {
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library";

import {
  buildTimelineFinalPositivePrompt,
  createTimelineParameterRecommendation,
  createTimelineT7NodeAdapters,
  filterTimelineResourceCandidatesForPromptProfile,
  type TimelineStyleAdviceRequest,
  validateTimelineResourceRecommendation,
} from "./t7-node-adapters";
import {
  completeTimelineNode,
  createTimelineWorkflowState,
} from "./state";
import type {
  ParameterRecommendationTimelineResult,
  ResourceRecommendationTimelineResult,
  ScenePromptTimelineResult,
} from "./types";
import type { PromptProfileId } from "@/shared/prompt-profile";

function makeResource(
  resourceType: "model" | "lora",
  id: string,
  name: string,
  baseModel: string | null = "Pony",
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

function makeScenePrompt(promptProfile: PromptProfileId = "illustrious"): ScenePromptTimelineResult {
  return {
    promptProfile,
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
  it("uses explicit Run resources without calling the recommendation provider", async () => {
    const checkpoint = makeResource("model", "checkpoint-manual", "Manual Checkpoint", "Illustrious");
    const lora = makeResource("lora", "lora-manual", "Manual LoRA", "Illustrious");
    const candidates = {
      checkpoints: [makeCandidate(checkpoint)],
      loras: [makeCandidate(lora)],
    };
    const recommendResources = vi.fn();
    let workflow = createTimelineWorkflowState({
      promptProfile: "illustrious",
      sceneRequest: "A manually styled courier",
      settingsSnapshot: {
        stylePalette: {
          checkpointId: checkpoint.id,
          loras: [{ id: lora.id, enabled: true, strengthModel: 0.61, strengthClip: 0.48 }],
        },
      },
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", makeScenePrompt(), "ai");
    const adapter = createTimelineT7NodeAdapters({
      loadResourceCandidates: () => candidates,
      recommendResources,
    })["resource-recommendation"];

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-prompt"]],
      nodeId: "resource-recommendation",
      workflow,
    });

    expect(recommendResources).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "manual",
      value: {
        checkpoint: { resource: { id: "checkpoint-manual" } },
        loras: [{
          resource: { id: "lora-manual" },
          strengthModel: 0.61,
          strengthClip: 0.48,
          suggestedWeight: 0.61,
        }],
      },
    });
  });

  it("rejects an unavailable explicit Run resource before recommendation", async () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Illustrious");
    const recommendResources = vi.fn();
    let workflow = createTimelineWorkflowState({
      promptProfile: "illustrious",
      sceneRequest: "A manually styled courier",
      settingsSnapshot: {
        stylePalette: {
          checkpointId: "checkpoint-missing",
          loras: [],
        },
      },
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", makeScenePrompt(), "ai");
    const adapter = createTimelineT7NodeAdapters({
      loadResourceCandidates: () => ({ checkpoints: [makeCandidate(checkpoint)], loras: [] }),
      recommendResources,
    })["resource-recommendation"];

    await expect(adapter?.({
      dependencies: [workflow.nodes["scene-prompt"]],
      nodeId: "resource-recommendation",
      workflow,
    })).rejects.toThrow("Selected Run checkpoint is missing, unavailable, or not a ready local checkpoint.");
    expect(recommendResources).not.toHaveBeenCalled();
  });

  it("uses saved Run parameters and LoRA strengths without calling Style Advice", async () => {
    const checkpoint = makeResource("model", "checkpoint-manual", "Manual Checkpoint", "Illustrious", {
      modelFileName: "manual-checkpoint.safetensors",
    });
    const lora = makeResource("lora", "lora-manual", "Manual LoRA", "Illustrious", {
      modelFileName: "manual-lora.safetensors",
    });
    const resourceResult: ResourceRecommendationTimelineResult = {
      checkpoint: { resource: checkpoint, reason: "Manual checkpoint." },
      loras: [{ resource: lora, suggestedWeight: 0.7, reason: "Manual LoRA." }],
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: [makeCandidate(lora)],
      },
      recommendationReason: "Manual resources.",
      overallEffect: "Manual style.",
      warnings: [],
    };
    const adviseStyle = vi.fn();
    let workflow = createTimelineWorkflowState({
      promptProfile: "illustrious",
      sceneRequest: "A manually parameterized courier",
      settingsSnapshot: {
        stylePalette: {
          checkpointId: checkpoint.id,
          loras: [{ id: lora.id, enabled: true, strengthModel: 0.63, strengthClip: 0.47 }],
          parameters: {
            width: 960,
            height: 1280,
            steps: 42,
            cfg: 5.5,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.82,
            seed: 1234,
          },
        },
      },
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", makeScenePrompt(), "ai");
    workflow = completeTimelineNode(workflow, "resource-recommendation", resourceResult, "manual");
    const adapter = createTimelineT7NodeAdapters({
      adviseStyle,
      loadResourceCandidates: () => resourceResult.candidates,
      loadSamplerOptions: () => ({ samplers: ["euler"], schedulers: ["normal"] }),
      recommendResources: vi.fn(),
    })["parameter-recommendation"];

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-prompt"], workflow.nodes["resource-recommendation"]],
      nodeId: "parameter-recommendation",
      workflow,
    });

    expect(adviseStyle).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "manual",
      value: {
        width: 960,
        height: 1280,
        steps: 42,
        cfg: 5.5,
        denoise: 0.82,
        seedPolicy: { mode: "fixed", seed: 1234 },
        requestPreview: {
          checkpointName: "manual-checkpoint.safetensors",
          loras: [{
            loraName: "manual-lora.safetensors",
            strengthModel: 0.63,
            strengthClip: 0.47,
          }],
        },
      },
    });
  });

  it("lets img2img source dimensions and Composer denoise override saved Run values", async () => {
    const checkpoint = makeResource("model", "checkpoint-manual", "Manual Checkpoint", "Illustrious");
    const resourceResult: ResourceRecommendationTimelineResult = {
      checkpoint: { resource: checkpoint, reason: "Manual checkpoint." },
      loras: [],
      candidates: { checkpoints: [makeCandidate(checkpoint)], loras: [] },
      recommendationReason: "Manual resources.",
      overallEffect: "Manual style.",
      warnings: [],
    };
    const adviseStyle = vi.fn();
    let workflow = createTimelineWorkflowState({
      promptProfile: "illustrious",
      sceneRequest: "A source-guided courier",
      sourceDenoise: 0.37,
      sourceImage: {
        dataUrl: "data:image/png;base64,c291cmNl",
        filename: "source.png",
        height: 770,
        mimeType: "image/png",
        uploadedAt: "2026-07-18T00:00:00.000Z",
        width: 1025,
      },
      settingsSnapshot: {
        stylePalette: {
          checkpointId: checkpoint.id,
          loras: [],
          parameters: {
            width: 512,
            height: 512,
            steps: 44,
            cfg: 6.25,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.91,
          },
        },
      },
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", makeScenePrompt(), "ai");
    workflow = completeTimelineNode(workflow, "resource-recommendation", resourceResult, "manual");
    const adapter = createTimelineT7NodeAdapters({
      adviseStyle,
      loadResourceCandidates: () => resourceResult.candidates,
      loadSamplerOptions: () => ({ samplers: ["euler"], schedulers: ["normal"] }),
      recommendResources: vi.fn(),
    })["parameter-recommendation"];

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-prompt"], workflow.nodes["resource-recommendation"]],
      nodeId: "parameter-recommendation",
      workflow,
    });

    expect(adviseStyle).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "manual",
      value: {
        width: 1024,
        height: 768,
        denoise: 0.37,
        steps: 44,
        cfg: 6.25,
        requestPreview: {
          batchSize: 1,
          imageWidth: 1025,
          imageHeight: 770,
          width: 1024,
          height: 768,
          denoise: 0.37,
        },
      },
    });
  });

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

  it("filters local resource candidates by selected prompt profile", () => {
    const illustriousCheckpoint = makeResource("model", "checkpoint-illustrious", "Illustrious", "Illustrious");
    const animaCheckpoint = makeResource("model", "checkpoint-anima", "Anima", "Anima");
    const unknownCheckpoint = makeResource("model", "checkpoint-unknown", "Unknown", null);
    const illustriousLora = makeResource("lora", "lora-illustrious", "Illustrious LoRA", "Illustrious");
    const animaLora = makeResource("lora", "lora-anima", "Anima LoRA", "Anima");

    const candidates = {
      checkpoints: [
        makeCandidate(illustriousCheckpoint),
        makeCandidate(animaCheckpoint),
        makeCandidate(unknownCheckpoint),
      ],
      loras: [
        makeCandidate(illustriousLora),
        makeCandidate(animaLora),
      ],
    };

    expect(
      filterTimelineResourceCandidatesForPromptProfile(candidates, undefined)
        .checkpoints.map((candidate) => candidate.resource.id),
    ).toEqual(["checkpoint-illustrious"]);
    expect(
      filterTimelineResourceCandidatesForPromptProfile(candidates, "anima")
        .loras.map((candidate) => candidate.resource.id),
    ).toEqual(["lora-anima"]);
    expect(
      filterTimelineResourceCandidatesForPromptProfile(candidates, "illustrious")
        .loras.map((candidate) => candidate.resource.id),
    ).toEqual(["lora-illustrious"]);
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

  it("keeps only the first three local LoRAs from a recommendation", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Pony");
    const loras = [
      makeResource("lora", "lora-1", "First LoRA", "Pony"),
      makeResource("lora", "lora-2", "Second LoRA", "Pony"),
      makeResource("lora", "lora-3", "Third LoRA", "Pony"),
      makeResource("lora", "lora-4", "Fourth LoRA", "Pony"),
    ];

    const result = validateTimelineResourceRecommendation({
      candidates: {
        checkpoints: [makeCandidate(checkpoint)],
        loras: loras.map(makeCandidate),
      },
      recommendation: {
        checkpoint: {
          resource: checkpoint,
          reason: "Local checkpoint.",
        },
        loras: loras.map((lora) => ({
          resource: lora,
          suggestedWeight: 0.7,
          reason: "Local LoRA.",
        })),
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
    });

    expect(result.loras.map((lora) => lora.resource.id)).toEqual([
      "lora-1",
      "lora-2",
      "lora-3",
    ]);
    expect(result.warnings).toEqual(["Only the first 3 LoRAs were kept."]);
  });

  it("uses resolved local resource metadata for final prompt and ComfyUI request fields", () => {
    const localCheckpoint = makeResource("model", "checkpoint-local", "Shared Checkpoint", "Illustrious", {
      modelFileName: "local-checkpoint.safetensors",
    });
    const recommendedCheckpoint = makeResource("model", "checkpoint-invented", "Shared Checkpoint", "Illustrious", {
      modelFileName: "invented-checkpoint.safetensors",
    });
    const localLora = makeResource("lora", "lora-local", "Shared LoRA", "Illustrious", {
      modelFileName: "local-lora.safetensors",
      trainedWords: ["local_trigger"],
    });
    const recommendedLora = makeResource("lora", "lora-invented", "Shared LoRA", "Illustrious", {
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
      modelBaseModel: "Illustrious",
      positivePrompt:
        "masterpiece, best quality, amazing quality, very aesthetic, newest, cinematic anime, local_trigger, courier, neon alley",
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
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Illustrious");
    const lora = makeResource("lora", "lora-local", "Local LoRA", "Illustrious", {
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
    })).toBe("masterpiece, best quality, amazing quality, very aesthetic, newest, cinematic anime, neon_style, courier, neon alley");
  });

  it("creates a ComfyUI request preview from the final formatted prompt", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Illustrious");
    const lora = makeResource("lora", "lora-local", "Local LoRA", "Illustrious");
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
    expect(result.finalPositivePrompt).toBe(
      "masterpiece, best quality, amazing quality, very aesthetic, newest, cinematic anime, neon_style, courier, neon alley",
    );
    expect(result.requestPreview).toMatchObject({
      checkpointName: "Local Checkpoint.safetensors",
      positivePrompt:
        "masterpiece, best quality, amazing quality, very aesthetic, newest, cinematic anime, neon_style, courier, neon alley",
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

  it("defaults img2img parameter recommendations to denoise 0.9 with source image metadata", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint");
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
        samplers: ["euler"],
        schedulers: ["normal"],
      },
      sourceImage: {
        dataUrl: "data:image/webp;base64,aGVsbG8=",
        filename: "source.webp",
        height: 770,
        mimeType: "image/webp",
        uploadedAt: "2026-06-07T00:00:00.000Z",
        width: 1025,
      },
    });

    expect(result.denoise).toBe(0.9);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.requestPreview).toMatchObject({
      batchSize: 1,
      denoise: 0.9,
      width: 1024,
      height: 768,
      imageWidth: 1025,
      imageHeight: 770,
    });
    expect(result.requestPreview).not.toHaveProperty("sourceImageDataUrl");
  });

  it("passes uploaded image dimensions to style advice and uses manual img2img denoise", async () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint");
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
    const scenePrompt = makeScenePrompt("illustrious");
    let workflow = createTimelineWorkflowState({
      promptProfile: "illustrious",
      sceneRequest: "A source-guided courier portrait",
      sourceDenoise: 0.35,
      sourceImage: {
        dataUrl: "data:image/png;base64,c291cmNl",
        filename: "reference.png",
        height: 1024,
        mimeType: "image/png",
        uploadedAt: "2026-06-07T00:00:00.000Z",
        width: 1536,
      },
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", scenePrompt, "ai");
    workflow = completeTimelineNode(workflow, "resource-recommendation", resourceResult, "ai");

    let styleAdviceRequest: TimelineStyleAdviceRequest | null = null;
    const adapters = createTimelineT7NodeAdapters({
      adviseStyle: (request) => {
        styleAdviceRequest = request;
        return {
          prompt: "style advice prompt should be ignored",
          parameterSuggestionReason: "AI Style Advice suggested a conflicting square resolution.",
          overallEffect: "Tuned style.",
          parseWarning: null,
          parameterSuggestions: {
            cfgScale: 5,
            loraWeights: [],
            negativePromptAdditions: "jpeg artifacts",
            resolution: "512x512",
            sampler: "euler",
            scheduler: "normal",
            steps: 28,
          },
        };
      },
      loadResourceCandidates: () => resourceResult.candidates,
      loadSamplerOptions: () => ({
        samplers: ["euler"],
        schedulers: ["normal"],
      }),
      recommendResources: () => ({
        checkpoint: resourceResult.checkpoint,
        loras: resourceResult.loras,
        recommendationReason: resourceResult.recommendationReason,
        overallEffect: resourceResult.overallEffect,
        warnings: resourceResult.warnings,
      }),
    });
    const adapter = adapters["parameter-recommendation"];

    expect(adapter).toBeDefined();
    const adapterResult = await adapter?.({
      dependencies: [
        workflow.nodes["scene-prompt"],
        workflow.nodes["resource-recommendation"],
      ],
      nodeId: "parameter-recommendation",
      workflow,
    });
    const result = (
      adapterResult && typeof adapterResult === "object" && "value" in adapterResult
        ? adapterResult.value
        : adapterResult
    ) as ParameterRecommendationTimelineResult;

    expect(styleAdviceRequest).toMatchObject({
      referenceResolution: {
        height: 1024,
        width: 1536,
      },
    });
    expect(result.denoise).toBe(0.35);
    expect(result.width).toBe(1536);
    expect(result.height).toBe(1024);
    expect(result.reason).toBe("AI Style Advice suggested a conflicting square resolution.");
    expect(result.requestPreview).toMatchObject({
      batchSize: 1,
      cfg: 5,
      denoise: 0.35,
      height: 1024,
      imageHeight: 1024,
      imageWidth: 1536,
      steps: 28,
      width: 1536,
    });
    expect(result.requestPreview).not.toHaveProperty("sourceImageDataUrl");
  });

  it("coerces old generic scene prompt results while continuing T7 parameter recommendations", async () => {
    const checkpoint = makeResource("model", "checkpoint-illustrious", "Illustrious Checkpoint", "Illustrious");
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
    let workflow = createTimelineWorkflowState({
      promptProfile: "illustrious",
      sceneRequest: "A restored old generic prompt profile scene",
    });
    workflow = completeTimelineNode(workflow, "scene-prompt", {
      ...makeScenePrompt("illustrious"),
      promptProfile: "generic" as never,
    }, "manual");
    workflow = completeTimelineNode(workflow, "resource-recommendation", resourceResult, "ai");

    const adapters = createTimelineT7NodeAdapters({
      loadSamplerOptions: () => ({
        samplers: ["euler"],
        schedulers: ["normal"],
      }),
      loadResourceCandidates: () => resourceResult.candidates,
      recommendResources: () => ({
        checkpoint: resourceResult.checkpoint,
        loras: resourceResult.loras,
        recommendationReason: resourceResult.recommendationReason,
        overallEffect: resourceResult.overallEffect,
        warnings: resourceResult.warnings,
      }),
    });
    const adapter = adapters["parameter-recommendation"];

    const adapterResult = await adapter?.({
      dependencies: [
        workflow.nodes["scene-prompt"],
        workflow.nodes["resource-recommendation"],
      ],
      nodeId: "parameter-recommendation",
      workflow,
    });
    const result = (
      adapterResult && typeof adapterResult === "object" && "value" in adapterResult
        ? adapterResult.value
        : adapterResult
    ) as ParameterRecommendationTimelineResult;

    expect(result.finalPositivePrompt).toContain("masterpiece");
    expect(result.requestPreview.workflowProfile).toBe("default");
  });

  it("succeeds when a selected LoRA has no trained words", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Illustrious");
    const lora = makeResource("lora", "lora-local", "Local LoRA", "Illustrious", {
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
      scenePrompt: makeScenePrompt("illustrious"),
      canvasBinding: null,
    });

    expect(result.requestPreview.positivePrompt).toContain("courier");
    expect(result.requestPreview.loras).toEqual([
      {
        loraName: "Local LoRA.safetensors",
        strengthModel: 0.72,
        strengthClip: 0.72,
      },
    ]);
  });

  it("formats Anima and Illustrious prompts by selected profile", () => {
    const animaCheckpoint = makeResource("model", "checkpoint-anima", "Anima Checkpoint", "Anima");
    const illustriousCheckpoint = makeResource("model", "checkpoint-illustrious", "Illustrious Checkpoint", "Illustrious");

    const makeResourceResult = (
      checkpoint: SelectedCivitaiResourcePreview,
    ): ResourceRecommendationTimelineResult => {
      return {
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
    };

    const anima = buildTimelineFinalPositivePrompt({
      resourceResult: makeResourceResult(animaCheckpoint),
      scenePrompt: makeScenePrompt("anima"),
    });
    const illustrious = buildTimelineFinalPositivePrompt({
      resourceResult: makeResourceResult(illustriousCheckpoint),
      scenePrompt: {
        ...makeScenePrompt("illustrious"),
        positivePrompt: "A courier runs through a neon alley in cinematic anime lighting.",
        illustriousSections: {
          subjectIdentity: ["solo courier"],
          backgroundEnvironmentObjects: ["neon alley"],
          lightingFocus: ["cinematic lighting"],
        },
      },
    });

    expect(anima).toContain("score_7");
    expect(illustrious).toContain("amazing quality");
    expect(illustrious).toContain("solo courier");
    expect(illustrious).not.toContain("A courier runs");
    expect(anima).not.toBe(illustrious);
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
      scenePrompt: makeScenePrompt("anima"),
      canvasBinding: null,
    });

    expect(result.requestPreview.workflowProfile).toBe("anima");
    expect(result.finalPositivePrompt).toBe(result.requestPreview.positivePrompt);
    expect(result.requestPreview.positivePrompt.match(/masterpiece/g)).toHaveLength(1);
    expect(result.requestPreview.positivePrompt.match(/score_9/g)).toHaveLength(1);
    expect(result.requestPreview.positivePrompt.match(/score_8/g)).toHaveLength(1);
    expect(result.requestPreview.positivePrompt.match(/score_7/g)).toHaveLength(1);
    expect(result.requestPreview.positivePrompt.match(/neon_style/g)).toHaveLength(1);
    expect(result.requestPreview.negativePrompt).toContain("worst quality");
    expect(result.requestPreview.negativePrompt).toContain("score_1");
    expect(result.requestPreview.negativePrompt).toContain("jpeg artifacts");
    expect(result.requestPreview.negativePrompt).toContain("bad_hands");
  });

  it("uses AI Style Advice parameter suggestions and rounds render dimensions to multiples of 8", () => {
    const checkpoint = makeResource("model", "checkpoint-local", "Local Checkpoint", "Illustrious");
    const lora = makeResource("lora", "lora-local", "Local LoRA", "Illustrious", {
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
      aiAdvice: {
        prompt: "style advice prompt should be ignored",
        parameterSuggestionReason: "AI Style Advice tuned the selected resources.",
        overallEffect: "Tuned style.",
        parseWarning: null,
        parameterSuggestions: {
          cfgScale: 5.5,
          loraWeights: [{ name: "Local LoRA", suggestedWeight: 0.64 }],
          negativePromptAdditions: "jpeg artifacts",
          resolution: "1219x801",
          sampler: "euler",
          scheduler: "normal",
          steps: 38,
        },
      },
      resourceResult,
      scenePrompt: makeScenePrompt("illustrious"),
      canvasBinding: null,
      samplerOptions: {
        samplers: ["euler", "dpmpp_2m"],
        schedulers: ["normal", "karras"],
      },
    });

    expect(result).toMatchObject({
      cfg: 5.5,
      height: 800,
      reason: "AI Style Advice tuned the selected resources.",
      samplerName: "euler",
      scheduler: "normal",
      steps: 38,
      width: 1216,
    });
    expect(result.finalPositivePrompt).not.toBe("style advice prompt should be ignored");
    expect(result.requestPreview.positivePrompt).toBe(result.finalPositivePrompt);
    expect(result.requestPreview.width).toBe(1216);
    expect(result.requestPreview.height).toBe(800);
    expect(result.requestPreview.negativePrompt).toContain("low quality");
    expect(result.requestPreview.negativePrompt).toContain("jpeg artifacts");
    expect(result.requestPreview.loras?.[0]).toMatchObject({
      strengthModel: 0.64,
      strengthClip: 0.64,
    });
  });

  it("passes Anima checkpoint filename aliases into the request preview", () => {
    const checkpoint = makeResource("model", "checkpoint-anima", "Anima Checkpoint", "Anima", {
      modelFileName: "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
      modelFileNameAliases: [
        "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
        "pencil-xl-diffusion.safetensors",
      ],
      modelStorageKind: "diffusion",
    });
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
      overallEffect: "Anima portrait.",
      warnings: [],
    };

    const result = createTimelineParameterRecommendation({
      resourceResult,
      scenePrompt: makeScenePrompt("anima"),
      canvasBinding: null,
    });

    expect(result.requestPreview).toMatchObject({
      checkpointName: "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
      checkpointNameAliases: [
        "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
        "pencil-xl-diffusion.safetensors",
      ],
      workflowProfile: "anima",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
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
