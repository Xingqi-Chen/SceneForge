import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview, SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";

import { parseComfyUiAiGenerationParameters, resolveComfyUiGenerationSettings } from "./comfyui-generation-params";

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
      samplerName: "euler_a",
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
});
