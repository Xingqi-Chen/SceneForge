import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview, SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import type { GeneratedPrompt } from "@/features/prompt-engine";

import { parseComfyUiAiGenerationParameters, resolveComfyUiGenerationSettings } from "./comfyui-generation-params";
import {
  formatGeneratedPromptForAnimaContext,
  resolveAnimaPromptContextFromResources,
} from "./anima-prompt";

function makeResource(
  resourceType: "model" | "lora",
  name: string,
  overrides: Partial<SelectedCivitaiResourcePreview> = {},
): SelectedCivitaiResourcePreview {
  return {
    id: name,
    resourceType,
    name,
    versionName: "v1",
    baseModel: "Pony",
    creator: "creator",
    trainedWords: [],
    tags: [],
    categories: [],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    modelFileName: `${name}.safetensors`,
    ...overrides,
  };
}

describe("ComfyUI generation parameters", () => {
  it("parses AI parameter suggestion objects", () => {
    expect(
      parseComfyUiAiGenerationParameters({
        steps: "32 steps",
        cfgScale: "6.5",
        sampler: "dpmpp_2m",
        scheduler: "karras",
        resolution: "832x1216",
        negativePromptAdditions: "bad hands",
        loraWeights: [{ name: "Neon LoRA", suggestedWeight: "0.82" }],
      }),
    ).toEqual({
      width: 832,
      height: 1216,
      seed: undefined,
      steps: 32,
      cfg: 6.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      denoise: undefined,
      negativePromptAdditions: "bad hands",
      loraWeights: [{ name: "Neon LoRA", weight: 0.82 }],
    });
  });

  it("splits combined Civitai sampler and scheduler strings before applying them", () => {
    expect(
      parseComfyUiAiGenerationParameters({
        sampler: "DPM++ 2M Karras",
        steps: 30,
      }),
    ).toMatchObject({
      samplerName: "dpmpp_2m",
      scheduler: "karras",
    });

    expect(
      parseComfyUiAiGenerationParameters({
        sampler: "DPM++ 2M SDE Karras",
      }),
    ).toMatchObject({
      samplerName: "dpmpp_2m_sde",
      scheduler: "karras",
    });
  });

  it("uses AI values when available", () => {
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Cyber Checkpoint"),
      loras: [makeResource("lora", "Neon LoRA")],
    };
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "rainy alley",
      baseNegativePrompt: "low quality",
      selectedResources,
      aiAdvice: {
        prompt: "rainy alley",
        parameterSuggestionReason: "",
        overallEffect: "",
        parseWarning: null,
        parameterSuggestions: {
          steps: 28,
          cfgScale: 6,
          sampler: "euler_a",
          scheduler: "normal",
          resolution: "768x1024",
          negativePromptAdditions: "bad anatomy",
          loraWeights: [{ name: "Neon LoRA", suggestedWeight: 0.76 }],
        },
      },
    });

    expect(settings.parameterSource).toBe("ai");
    expect(settings.request).toMatchObject({
      checkpointName: "Cyber Checkpoint.safetensors",
      positivePrompt: "rainy alley",
      negativePrompt: "low quality, bad anatomy",
      width: 768,
      height: 1024,
      steps: 28,
      cfg: 6,
      samplerName: "euler_ancestral",
      scheduler: "normal",
      latentImageNode: "EmptyLatentImage",
    });
    expect(settings.request.loras).toEqual([
      {
        loraName: "Neon LoRA.safetensors",
        strengthModel: 0.76,
        strengthClip: 0.76,
      },
    ]);
    expect(settings.loras[0].source).toBe("ai");
  });

  it("preserves selected checkpoint metadata for workflow profile routing", () => {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "city street, 1girl, artist:Alpha",
      baseNegativePrompt: "",
      selectedResources: {
        checkpoint: makeResource("model", "Pencil XL", {
          baseModel: "Anima",
          modelFileName: "pencil-xl-diffusion.safetensors",
          modelStorageKind: "diffusion",
        }),
        loras: [],
      },
      aiAdvice: null,
      savedParameters: null,
    });

    expect(settings.request).toMatchObject({
      checkpointName: "pencil-xl-diffusion.safetensors",
      workflowProfile: "anima",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      positivePrompt: "masterpiece, best quality, score_7, safe, 1girl, @Alpha, city street",
      negativePrompt: "low quality, worst quality, bad anatomy, bad hands",
    });
  });

  it("preserves selected checkpoint filename aliases for Anima object_info resolution", () => {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "city street, 1girl",
      baseNegativePrompt: "",
      selectedResources: {
        checkpoint: makeResource("model", "Pencil XL", {
          baseModel: "Anima",
          modelFileName: "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
          modelFileNameAliases: [
            "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
            "pencil-xl-diffusion.safetensors",
          ],
          modelStorageKind: "diffusion",
        }),
        loras: [],
      },
      aiAdvice: null,
      savedParameters: null,
    });

    expect(settings.request).toMatchObject({
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

  it("does not let stale saved Anima metadata force Anima formatting for a selected non-Anima checkpoint", () => {
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Illustrious Checkpoint", {
        baseModel: "Illustrious",
        modelFileName: "illustrious.safetensors",
        modelStorageKind: "checkpoint",
      }),
      loras: [],
    };
    const generated: GeneratedPrompt = {
      prompt: "city street, 1girl, artist:Alpha",
      negativePrompt: "low quality",
      parts: ["city street", "1girl", "artist:Alpha"],
    };
    const previewPrompt = formatGeneratedPromptForAnimaContext(
      generated,
      resolveAnimaPromptContextFromResources({
        resources: selectedResources,
        supportsNsfw: false,
      }),
    );
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: previewPrompt.prompt,
      baseNegativePrompt: previewPrompt.negativePrompt,
      selectedResources,
      aiAdvice: null,
      savedParameters: {
        cfg: 7,
        denoise: 1,
        height: 1024,
        imageCount: 1,
        loras: [],
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        outputPrefix: "SceneForge",
        samplerName: "euler",
        savedAt: "2026-05-23T00:00:00.000Z",
        scheduler: "normal",
        seed: 123,
        seedMode: "fixed",
        steps: 30,
        width: 1024,
        workflowProfile: "anima",
      },
    });

    expect(previewPrompt).toEqual(generated);
    expect(settings.request).toMatchObject({
      checkpointName: "illustrious.safetensors",
      workflowProfile: "default",
      modelBaseModel: "Illustrious",
      modelStorageKind: "checkpoint",
      positivePrompt: generated.prompt,
      negativePrompt: generated.negativePrompt,
    });
  });

  it("omits Anima default safe when the project supports NSFW", () => {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "1girl, city street",
      baseNegativePrompt: "",
      selectedResources: {
        checkpoint: makeResource("model", "Pencil XL", {
          baseModel: "Anima",
          modelFileName: "pencil-xl-diffusion.safetensors",
          modelStorageKind: "diffusion",
        }),
        loras: [],
      },
      aiAdvice: null,
      savedParameters: null,
      supportsNsfw: true,
    });

    expect(settings.request.positivePrompt).toBe("masterpiece, best quality, score_7, 1girl, city street");
    expect(settings.request.positivePrompt).not.toContain("safe");
  });

  it("ignores legacy saved Anima CLIP and VAE overrides because the profile uses fixed settings", () => {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "portrait",
      baseNegativePrompt: "",
      selectedResources: {
        checkpoint: makeResource("model", "Pencil XL", {
          baseModel: "Anima",
          modelFileName: "pencil-xl-diffusion.safetensors",
          modelStorageKind: "diffusion",
        }),
        loras: [],
      },
      aiAdvice: null,
      savedParameters: {
        cfg: 7,
        clipDevice: "cuda",
        clipName: "custom-clip.safetensors",
        denoise: 1,
        height: 1024,
        imageCount: 1,
        loras: [],
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        outputPrefix: "SceneForge",
        samplerName: "euler",
        savedAt: "2026-05-23T00:00:00.000Z",
        scheduler: "normal",
        seed: 123,
        seedMode: "fixed",
        steps: 30,
        unetWeightDtype: "fp8_e4m3fn",
        vaeName: "custom-vae.safetensors",
        width: 1024,
        workflowProfile: "anima",
      },
    });

    expect(settings.request).toMatchObject({
      checkpointName: "pencil-xl-diffusion.safetensors",
      workflowProfile: "anima",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
    });
    expect(settings.request.clipName).toBeUndefined();
    expect(settings.request.clipDevice).toBeUndefined();
    expect(settings.request.vaeName).toBeUndefined();
    expect(settings.request.unetWeightDtype).toBeUndefined();
  });

  it("falls back to reference values when AI suggestions are missing or invalid", () => {
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Base Model"),
      loras: [
        makeResource("lora", "Reference LoRA", {
          averageWeight: 0.64,
        }),
        makeResource("lora", "Recommended LoRA", {
          recommendations: [
            {
              condition: "default",
              baseModel: null,
              checkpoint: null,
              sampler: null,
              loraWeightMin: null,
              loraWeightMax: null,
              loraWeight: 0.81,
              hdRedrawRate: null,
              notes: null,
            },
          ],
        }),
      ],
    };
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "portrait",
      baseNegativePrompt: "",
      selectedResources,
      aiAdvice: {
        prompt: "portrait",
        parameterSuggestionReason: "",
        overallEffect: "",
        parseWarning: null,
        parameterSuggestions: "steps 28",
      },
    });

    expect(settings.parameterSource).toBe("reference");
    expect(settings.request).toMatchObject({
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 1,
    });
    expect(settings.request.loras).toEqual([
      {
        loraName: "Reference LoRA.safetensors",
        strengthModel: 0.64,
        strengthClip: 0.64,
      },
      {
        loraName: "Recommended LoRA.safetensors",
        strengthModel: 0.81,
        strengthClip: 0.81,
      },
    ]);
  });

  it("normalizes AI dimensions to ComfyUI-compatible multiples of 8", () => {
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Base Model"),
      loras: [],
    };
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "portrait",
      baseNegativePrompt: "",
      selectedResources,
      aiAdvice: {
        prompt: "portrait",
        parameterSuggestionReason: "",
        overallEffect: "",
        parseWarning: null,
        parameterSuggestions: {
          resolution: "1025x777",
        },
      },
    });

    expect(settings.request).toMatchObject({
      width: 1024,
      height: 776,
    });
  });

  it("infers SD3-compatible latent nodes from the selected checkpoint family", () => {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "portrait",
      baseNegativePrompt: "",
      selectedResources: {
        checkpoint: makeResource("model", "Red Lily", {
          baseModel: "SD 3.5",
          modelFileName: "red-lily.safetensors",
        }),
        loras: [],
      },
      aiAdvice: null,
    });

    expect(settings.request.latentImageNode).toBe("EmptySD3LatentImage");
  });

  it("uses the saved latent node when present", () => {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "portrait",
      baseNegativePrompt: "",
      selectedResources: {
        checkpoint: makeResource("model", "Base Model"),
        loras: [],
      },
      aiAdvice: null,
      savedParameters: {
        cfg: 7,
        denoise: 1,
        height: 1024,
        imageCount: 1,
        latentImageNode: "EmptySD3LatentImage",
        loras: [],
        outputPrefix: "SceneForge",
        promptWrapper: {
          negativePrefix: "Negative prefix: ",
          positivePrefix: "Positive prefix: ",
        },
        samplerName: "euler",
        savedAt: "2026-05-23T00:00:00.000Z",
        scheduler: "normal",
        seed: 123,
        seedMode: "fixed",
        steps: 30,
        width: 1024,
      },
    });

    expect(settings.request.latentImageNode).toBe("EmptySD3LatentImage");
    expect(settings.request.promptWrapper).toEqual({
      negativePrefix: "Negative prefix: ",
      positivePrefix: "Positive prefix: ",
    });
  });

  it("prioritizes saved parameters without replacing the active prompt", () => {
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Base Model"),
      loras: [
        makeResource("lora", "Saved LoRA"),
        makeResource("lora", "Fresh LoRA", {
          averageWeight: 0.55,
        }),
      ],
    };
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: "current canvas prompt",
      baseNegativePrompt: "low quality",
      selectedResources,
      aiAdvice: {
        prompt: "style prompt",
        parameterSuggestionReason: "",
        overallEffect: "",
        parseWarning: null,
        parameterSuggestions: {
          steps: 28,
          cfgScale: 6,
          resolution: "768x1024",
          loraWeights: [{ name: "Saved LoRA", suggestedWeight: 0.25 }],
        },
      },
      savedParameters: {
        cfg: 8.5,
        denoise: 0.9,
        height: 1536,
        imageCount: 3,
        loras: [
          {
            enabled: false,
            loraName: "Saved LoRA.safetensors",
            strengthClip: 0.42,
            strengthModel: 0.38,
          },
        ],
        outputPrefix: "SavedPrefix",
        faceDetailer: {
          enabled: true,
          samplerName: "DPM++ 2M SDE Karras",
          scheduler: "normal",
        },
        handDetailer: {
          enabled: true,
          detectorModelName: "bbox/hand_yolov8s.pt",
          samplerName: "DPM++ 2M Karras",
          scheduler: "normal",
        },
        samplerName: "DPM++ 2M Karras",
        savedAt: "2026-05-23T00:00:00.000Z",
        scheduler: "normal",
        seed: 12345,
        seedMode: "fixed",
        steps: 36,
        width: 1024,
      },
    });

    expect(settings.parameterSource).toBe("saved");
    expect(settings.request).toMatchObject({
      positivePrompt: "current canvas prompt",
      negativePrompt: "low quality",
      width: 1024,
      height: 1536,
      steps: 36,
      cfg: 8.5,
      batchSize: 3,
      outputPrefix: "SavedPrefix",
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      faceDetailer: {
        enabled: true,
        samplerName: "dpmpp_2m_sde",
        scheduler: "karras",
      },
      handDetailer: {
        enabled: true,
        detectorModelName: "bbox/hand_yolov8s.pt",
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
    });
    expect(settings.loras).toMatchObject([
      {
        enabled: false,
        loraName: "Saved LoRA.safetensors",
        source: "saved",
        strengthClip: 0.42,
        strengthModel: 0.38,
      },
      {
        enabled: true,
        loraName: "Fresh LoRA.safetensors",
        source: "reference",
        strengthClip: 0.55,
        strengthModel: 0.55,
      },
    ]);
    expect(settings.request.loras).toEqual([
      {
        loraName: "Fresh LoRA.safetensors",
        strengthClip: 0.55,
        strengthModel: 0.55,
      },
    ]);
  });
});
