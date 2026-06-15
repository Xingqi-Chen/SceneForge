import { describe, expect, it } from "vitest";

import {
  assembleStoryRenderPlan,
  createStoryExecutionRequestBatch,
  createStoryParameterPlan,
  createStoryPreviewParameters,
  createStoryResourcePlan,
  StoryResourcePlanValidationError,
  type StoryGenerationParameters,
  type StoryLocalResource,
  type StoryPreviewExecutionOptions,
} from "./story-planning";
import type { StorySafetyPlan, StoryShot } from "./story-types";

const storyId = "story-1";

const shots = [
  {
    id: "shot-1",
    storyId,
    order: 1,
    title: "Arrival",
    description: "The lead enters the station.",
    characterIds: ["lead"],
    sourceShotIds: [],
    camera: "wide shot",
    promptIntent: "rainy station arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId,
    order: 2,
    title: "Signal",
    description: "The lead notices a red signal.",
    characterIds: ["lead"],
    sourceShotIds: ["shot-1"],
    camera: "low close-up",
    promptIntent: "red signal reflected in a puddle",
    continuityNotes: ["Keep the raincoat visible."],
  },
] satisfies StoryShot[];

const safetyPlan = {
  storyId,
  audienceRating: "explicit",
  contentWarnings: ["adult-only tone"],
  blockedContent: ["graphic harm"],
  perShotNotes: [
    {
      shotId: "shot-2",
      risks: ["Could become graphic."],
      mitigations: ["Keep the scene symbolic."],
    },
  ],
  nsfwContext: {
    enabled: true,
    rationale: "User enabled mature story execution context.",
  },
} satisfies StorySafetyPlan;

const defaults = {
  width: 1024,
  height: 768,
  steps: 28,
  cfg: 5.5,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  denoise: 1,
} satisfies StoryGenerationParameters;

function checkpointResource(): StoryLocalResource {
  return {
    id: "checkpoint-local",
    name: "Local Checkpoint",
    baseModel: "Illustrious",
    modelFileName: "local.safetensors",
    nsfw: true,
    nsfwLevel: 5,
    modelNsfw: true,
  };
}

function loraResource(): StoryLocalResource {
  return {
    id: "lora-local",
    name: "Local LoRA",
    baseModel: "Illustrious",
    modelFileName: "local-lora.safetensors",
    trainedWords: ["wet platform"],
    nsfw: true,
    aiNsfwLevel: "explicit",
  };
}

function createResourcePlan() {
  const checkpoint = checkpointResource();
  const lora = loraResource();

  return createStoryResourcePlan({
    storyId,
    candidates: {
      checkpoints: [{ resource: checkpoint }],
      loras: [{ resource: lora }],
    },
    recommendation: {
      checkpoint: {
        resource: {
          ...checkpoint,
          nsfw: false,
          nsfwLevel: 0,
          modelNsfw: false,
        },
        reason: "Local match.",
      },
      loras: [
        {
          resource: {
            ...lora,
            nsfw: false,
            aiNsfwLevel: "safe",
          },
          suggestedWeight: 0.6,
          reason: "Local LoRA match.",
        },
      ],
      recommendationReason: "Use local story resources.",
      overallEffect: "Rainy cinematic panels.",
      warnings: [],
    },
  });
}

function createAnimaResourcePlan() {
  const checkpoint: StoryLocalResource = {
    id: "checkpoint-anima",
    name: "Anima Checkpoint",
    baseModel: "Anima",
    modelBaseModel: "Anima",
    modelFileName: "anima.safetensors",
    modelFileNameAliases: ["pencil-xl-diffusion.safetensors"],
    modelStorageKind: "diffusion",
    workflowProfile: "anima",
    clipName: "qwen_3_06b_base.safetensors",
    clipDevice: "default",
    vaeName: "qwen_image_vae.safetensors",
    unetWeightDtype: "default",
  };
  const lora: StoryLocalResource = {
    id: "lora-anima",
    name: "Anima LoRA",
    baseModel: "Anima",
    modelFileName: "anima-lora.safetensors",
    trainedWords: ["anima_style"],
  };

  return createStoryResourcePlan({
    storyId,
    candidates: {
      checkpoints: [{ resource: checkpoint }],
      loras: [{ resource: lora }],
    },
    recommendation: {
      checkpoint: {
        resource: checkpoint,
        reason: "Local Anima checkpoint.",
      },
      loras: [
        {
          resource: lora,
          suggestedWeight: 0.62,
          reason: "Local Anima LoRA.",
        },
      ],
      recommendationReason: "Use local Anima resources.",
      overallEffect: "Anima storyboard panels.",
      warnings: [],
    },
  });
}

describe("story planning", () => {
  it("selects only validated local resources and strips model NSFW markers", () => {
    const resourcePlan = createResourcePlan();

    expect(resourcePlan.checkpoint.resource).toEqual({
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Illustrious",
      modelFileName: "local.safetensors",
    });
    expect(resourcePlan.loras[0]?.resource).toEqual({
      id: "lora-local",
      name: "Local LoRA",
      baseModel: "Illustrious",
      modelFileName: "local-lora.safetensors",
      trainedWords: ["wet platform"],
    });
    expect(JSON.stringify(resourcePlan)).not.toContain("nsfw");
    expect(JSON.stringify(resourcePlan)).not.toContain("Nsfw");
  });

  it("rejects recommended resources that are not validated local candidates", () => {
    const checkpoint = checkpointResource();
    const lora = loraResource();

    expect(() =>
      createStoryResourcePlan({
        storyId,
        candidates: {
          checkpoints: [{ resource: checkpoint }],
          loras: [{ resource: lora }],
        },
        recommendation: {
          checkpoint: {
            resource: {
              id: "remote-checkpoint",
              name: "Remote Checkpoint",
              modelFileName: "remote.safetensors",
              nsfw: true,
              nsfwLevel: 5,
            },
            reason: "Invented remote resource must not be accepted.",
          },
          loras: [],
          recommendationReason: "Do not use resources outside local candidates.",
          overallEffect: "Remote model should be rejected even with matching NSFW metadata.",
          warnings: [],
        },
      }),
    ).toThrow(StoryResourcePlanValidationError);
  });

  it("keeps preview execution parameters separate from the formal parameter plan", () => {
    const parameterPlan = createStoryParameterPlan({
      storyId,
      defaults,
      perShotOverrides: [
        {
          shotId: "shot-2",
          parameters: { cfg: 6 },
        },
      ],
    });
    const before = JSON.stringify(parameterPlan);
    const previewOptions = {
      enabled: true,
      shotIds: ["shot-2"],
      parameterOverrides: {
        width: 512,
        height: 384,
        steps: 10,
      },
    } satisfies StoryPreviewExecutionOptions;

    expect(createStoryPreviewParameters(parameterPlan, previewOptions, "shot-2")).toMatchObject({
      width: 512,
      height: 384,
      steps: 10,
      cfg: 6,
    });
    expect(JSON.stringify(parameterPlan)).toBe(before);
  });

  it("assembles render plans with NSFW context and preview references outside formal parameters", () => {
    const resourcePlan = createResourcePlan();
    const parameterPlan = createStoryParameterPlan({ storyId, defaults });
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan,
      previewOptions: {
        enabled: true,
        shotIds: ["shot-2"],
        parameterOverrides: { steps: 8 },
      },
      previewResultReferences: [
        {
          shotId: "shot-2",
          promptId: "preview-1",
          createdAt: "2026-06-14T00:00:00.000Z",
          parameters: { ...defaults, steps: 8 },
        },
      ],
      resourcePlan,
      safetyPlan,
      shots,
    });

    expect(renderPlan.nsfwContext).toEqual({
      audienceRating: "explicit",
      contentWarnings: ["adult-only tone"],
      enabled: true,
      rationale: "User enabled mature story execution context.",
    });
    expect(renderPlan.preview.resultReferences).toHaveLength(1);
    expect(renderPlan.shots[1]).toMatchObject({
      shotId: "shot-2",
      negativePrompt: "graphic harm, Keep the scene symbolic.",
      parameters: defaults,
    });
  });

  it("reuses the base-model-aware ComfyUI prompt resolver for Story render prompts", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan });
    const firstShot = renderPlan.shots[0];
    const firstRequest = finalBatch.requests[0]?.request;

    expect(firstShot.positivePrompt).toContain("masterpiece");
    expect(firstShot.positivePrompt).toContain("score_9");
    expect(firstShot.positivePrompt).toContain("score_8");
    expect(firstShot.positivePrompt).toContain("score_7");
    expect(firstShot.positivePrompt).toContain("anima_style");
    expect(firstShot.negativePrompt).toContain("worst quality");
    expect(firstShot.negativePrompt).toContain("score_1");
    expect(firstShot.negativePrompt).toContain("graphic harm");
    expect(firstRequest).toMatchObject({
      checkpointName: "anima.safetensors",
      checkpointNameAliases: ["pencil-xl-diffusion.safetensors"],
      workflowProfile: "anima",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      clipName: "qwen_3_06b_base.safetensors",
      clipDevice: "default",
      vaeName: "qwen_image_vae.safetensors",
      unetWeightDtype: "default",
      positivePrompt: firstShot.positivePrompt,
      negativePrompt: firstShot.negativePrompt,
      loras: [
        {
          loraName: "anima-lora.safetensors",
          strengthModel: 0.62,
          strengthClip: 0.62,
        },
      ],
    });
  });

  it("preserves manually edited Story render prompts when creating execution requests", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      resourcePlan: createAnimaResourcePlan(),
      safetyPlan,
      shots,
    });
    const editedRenderPlan = {
      ...renderPlan,
      shots: renderPlan.shots.map((shot, index) =>
        index === 0
          ? {
              ...shot,
              positivePrompt: "manual edited anima prompt, anima_style",
              negativePrompt: "manual edited negative",
            }
          : shot,
      ),
    };
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan: editedRenderPlan });
    const firstRequest = finalBatch.requests[0]?.request;

    expect(firstRequest?.positivePrompt).toBe("manual edited anima prompt, anima_style");
    expect(firstRequest?.negativePrompt).toContain("manual edited negative");
    expect(firstRequest?.negativePrompt).toContain("worst quality");
  });

  it("assembles final and preview execution requests without model NSFW resource filtering", () => {
    const renderPlan = assembleStoryRenderPlan({
      parameterPlan: createStoryParameterPlan({ storyId, defaults }),
      previewOptions: {
        enabled: true,
        shotIds: ["shot-2"],
        parameterOverrides: { width: 512, height: 384, steps: 8 },
      },
      resourcePlan: createResourcePlan(),
      safetyPlan,
      shots,
    });
    const finalBatch = createStoryExecutionRequestBatch({ mode: "final", renderPlan });
    const previewBatch = createStoryExecutionRequestBatch({ mode: "preview", renderPlan });

    expect(finalBatch.requests).toHaveLength(2);
    expect(previewBatch.requests).toHaveLength(1);
    expect(previewBatch.requests[0]).toMatchObject({
      shotId: "shot-2",
      nsfwContext: renderPlan.nsfwContext,
      request: {
        checkpointName: "local.safetensors",
        loras: [{ loraName: "local-lora.safetensors", strengthModel: 0.6 }],
        preview: true,
        width: 512,
        height: 384,
        steps: 8,
      },
    });
    expect(JSON.stringify(finalBatch)).not.toContain("modelNsfw");
    expect(JSON.stringify(previewBatch)).not.toContain("aiNsfwLevel");
  });
});
