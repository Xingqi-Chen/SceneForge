import { describe, expect, it, vi } from "vitest";

import type {
  ComfyUiGenerateImageResponse,
  ComfyUiTextToImageRequest,
} from "@/features/comfyui";

import {
  createStoryParameterPlan,
  createStoryResourcePlan,
} from "./story-planning";
import {
  createStoryReferenceComfyUiGenerationAdapter,
  StoryReferencePlateGenerationError,
  type StoryReferencePlateGenerationClient,
} from "./story-reference-comfyui";
import type { StoryReferenceAsset } from "./story-types";

const reference = {
  id: "character-face:hero",
  storyId: "story-reference",
  referenceType: "character-face",
  importance: "required",
  resolutionState: "missing",
  canonicalPrompt: "clean face reference plate, Hero, silver hair",
  rationale: "Main character face identity is required.",
  sourceEntity: {
    id: "hero",
    name: "Hero",
    type: "character",
  },
  sourceShotIds: ["shot-1"],
  candidateAssetReferences: [],
} satisfies StoryReferenceAsset;

const resourcePlan = createStoryResourcePlan({
  storyId: "story-reference",
  candidates: {
    checkpoints: [
      {
        resource: {
          id: "checkpoint-anima",
          name: "Anima Checkpoint",
          baseModel: "Anima",
          modelBaseModel: "Anima",
          modelFileName: "anima.safetensors",
        },
      },
    ],
    loras: [],
  },
  recommendation: {
    checkpoint: {
      resource: {
        id: "checkpoint-anima",
        name: "Anima Checkpoint",
        baseModel: "Anima",
        modelBaseModel: "Anima",
        modelFileName: "anima.safetensors",
      },
      reason: "Use Anima.",
    },
    loras: [],
    recommendationReason: "Use local Anima resources.",
    overallEffect: "Clean reference plate.",
    warnings: [],
  },
});

const parameterPlan = createStoryParameterPlan({
  storyId: "story-reference",
  defaults: {
    width: 832,
    height: 1216,
    steps: 28,
    cfg: 5.5,
    samplerName: "dpmpp_2m",
    scheduler: "karras",
    denoise: 1,
  },
});

function queuedResponse(request: ComfyUiTextToImageRequest): ComfyUiGenerateImageResponse {
  return {
    promptId: "prompt-reference",
    raw: {},
    workflow: {},
    nodeIds: {
      unetLoader: "1",
      clipLoader: "2",
      vaeLoader: "3",
      loraLoaders: [],
      positivePrompt: "4",
      negativePrompt: "5",
      latentImage: "6",
      sampler: "7",
      vaeDecode: "8",
      previewImage: "9",
    },
    outputNodeId: "9",
    request: {
      ...request,
      batchSize: request.batchSize ?? 1,
      cfg: request.cfg ?? 5.5,
      denoise: request.denoise ?? 1,
      height: request.height ?? 1216,
      loras: request.loras ?? [],
      negativePrompt: request.negativePrompt ?? "",
      samplerName: request.samplerName ?? "dpmpp_2m",
      scheduler: request.scheduler ?? "karras",
      seed: request.seed ?? 1,
      steps: request.steps ?? 28,
      width: request.width ?? 832,
      workflowProfile: request.workflowProfile ?? "anima",
      characterReferences: request.characterReferences ?? [],
      checkpointNameAliases: request.checkpointNameAliases ?? [],
      clipDevice: request.clipDevice ?? "default",
      clipName: request.clipName ?? "qwen_3_06b_base.safetensors",
      latentImageNode: request.latentImageNode ?? "EmptyLatentImage",
      modelBaseModel: request.modelBaseModel ?? "Anima",
      modelStorageKind: request.modelStorageKind ?? "diffusion",
      promptWrapper: request.promptWrapper ?? "none",
      unetWeightDtype: request.unetWeightDtype ?? "default",
      vaeName: request.vaeName ?? "qwen_image_vae.safetensors",
    },
  } as ComfyUiGenerateImageResponse;
}

describe("Story reference ComfyUI generation adapter", () => {
  it("queues one Anima reference plate and returns stored metadata only", async () => {
    const generateImage = vi.fn(async (request: ComfyUiTextToImageRequest) => queuedResponse(request));
    const client = {
      buildViewUrl: (image) => `http://127.0.0.1:8188/view?filename=${image.filename}&type=${image.type ?? "output"}`,
      generateImage,
      getHistory: vi.fn(async () => ({
        "prompt-reference": {
          outputs: {
            "7": {
              images: [
                {
                  filename: "reference.png",
                  type: "output",
                },
              ],
            },
          },
        },
      })),
      getObjectInfo: vi.fn(async () => ({})),
    } satisfies StoryReferencePlateGenerationClient;
    const adapter = createStoryReferenceComfyUiGenerationAdapter({
      client,
      fetchImage: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      })),
      storeImage: vi.fn(async () => ({
        byteLength: 3,
        contentType: "image/png",
        filename: "stored-reference.png",
        url: "/api/comfyui/generated-images/stored-reference.png",
      })),
      historyPollIntervalMs: 0,
      now: () => "2026-06-29T00:00:00.000Z",
      validateObjectInfo: (request) => ({
        errors: [],
        request,
        warnings: ["Using local Anima defaults."],
      }),
      validateRequest: (request) => ({
        ok: true,
        request: request as ComfyUiTextToImageRequest,
      }),
    });

    const result = await adapter({
      nsfwContext: {
        audienceRating: "safe",
        contentWarnings: [],
        enabled: false,
        rationale: "Safe.",
      },
      parameterPlan,
      reference,
      resourcePlan,
    });

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage.mock.calls[0]?.[0]).toMatchObject({
      batchSize: 1,
      checkpointName: "anima.safetensors",
      modelBaseModel: "Anima",
      positivePrompt: expect.stringContaining("single clean reference plate"),
    });
    expect(result).toMatchObject({
      byteLength: 3,
      contentType: "image/png",
      filename: "stored-reference.png",
      source: "generated",
      url: "/api/comfyui/generated-images/stored-reference.png",
      metadata: {
        checkpointResourceId: "checkpoint-anima",
        promptId: "prompt-reference",
        referenceId: "character-face:hero",
        warnings: ["Using local Anima defaults."],
        workflowProfile: "anima",
      },
    });
    expect(JSON.stringify(result)).not.toContain("AQID");
  });

  it("rejects non-Anima resources before queueing", async () => {
    const defaultResourcePlan = createStoryResourcePlan({
      storyId: "story-reference",
      candidates: {
        checkpoints: [
          {
            resource: {
              id: "checkpoint-default",
              name: "Default Checkpoint",
              baseModel: "Illustrious",
              modelFileName: "default.safetensors",
              modelStorageKind: "checkpoint",
            },
          },
        ],
        loras: [],
      },
      recommendation: {
        checkpoint: {
          resource: {
            id: "checkpoint-default",
            name: "Default Checkpoint",
            baseModel: "Illustrious",
            modelFileName: "default.safetensors",
            modelStorageKind: "checkpoint",
          },
          reason: "Use default.",
        },
        loras: [],
        recommendationReason: "Default.",
        overallEffect: "Default.",
        warnings: [],
      },
    });
    const generateImage = vi.fn();
    const adapter = createStoryReferenceComfyUiGenerationAdapter({
      client: {
        buildViewUrl: () => "",
        generateImage,
        getHistory: vi.fn(),
        getObjectInfo: vi.fn(),
      },
      validateRequest: (request) => ({
        ok: true,
        request: request as ComfyUiTextToImageRequest,
      }),
    });

    await expect(adapter({
      nsfwContext: {
        audienceRating: "safe",
        contentWarnings: [],
        enabled: false,
        rationale: "Safe.",
      },
      parameterPlan,
      reference,
      resourcePlan: defaultResourcePlan,
    })).rejects.toBeInstanceOf(StoryReferencePlateGenerationError);
    expect(generateImage).not.toHaveBeenCalled();
  });
});
