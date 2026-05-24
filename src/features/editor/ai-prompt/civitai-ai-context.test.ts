import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview } from "@/features/civitai-lora-library";

import {
  buildCivitaiAiJsonResponseInstructions,
  formatSelectedCivitaiResourcesForAi,
  parseCivitaiAiPromptResponse,
} from "./civitai-ai-context";

function makeResource(
  overrides: Partial<SelectedCivitaiResourcePreview> = {},
): SelectedCivitaiResourcePreview {
  return {
    id: "resource-a",
    resourceType: "lora",
    name: "Cyber Outfit",
    versionName: "v1",
    baseModel: "SDXL 1.0",
    creator: "creator",
    trainedWords: ["cyber outfit", "neon trim"],
    tags: ["clothing", "cyberpunk"],
    categories: ["clothing"],
    usageGuide: "Use 0.7 for balanced details.",
    descriptionSnippet: "Techwear outfit with neon accents.",
    averageWeight: 0.7,
    minWeight: 0.5,
    maxWeight: 0.9,
    recommendations: [
      {
        condition: "default",
        baseModel: "SDXL 1.0",
        checkpoint: null,
        sampler: "DPM++ 2M",
        loraWeightMin: 0.5,
        loraWeightMax: 0.9,
        loraWeight: 0.7,
        hdRedrawRate: null,
        notes: "Good default.",
      },
    ],
    previewImage: null,
    modelFileName: "Cyber Outfit__v1.safetensors",
    ...overrides,
  };
}

describe("Civitai AI prompt context", () => {
  it("formats selected checkpoint and LoRAs for LLM context", () => {
    const checkpoint = makeResource({
      id: "checkpoint",
      resourceType: "model",
      name: "Realistic Checkpoint",
      trainedWords: [],
      tags: ["realistic"],
      categories: [],
      averageWeight: null,
      minWeight: null,
      maxWeight: null,
    });
    const lora = makeResource({ id: "lora" });

    const context = formatSelectedCivitaiResourcesForAi({
      checkpoint,
      loras: [lora],
    });

    expect(context).toContain("Checkpoint:");
    expect(context).toContain("- name: Realistic Checkpoint");
    expect(context).toContain("- trainedWords: none");
    expect(context).toContain("LoRA 1:");
    expect(context).toContain("- trainedWords: cyber outfit, neon trim");
    expect(context).toContain("- observedWeight: average=0.7, min=0.5, max=0.9");
    expect(context).toContain("sampler=DPM++ 2M");
  });

  it("omits Civitai context when no selected resources are available", () => {
    expect(formatSelectedCivitaiResourcesForAi({ checkpoint: null, loras: [] })).toBeNull();
  });

  it("documents the JSON response contract and trigger word policy", () => {
    const instructions = buildCivitaiAiJsonResponseInstructions();

    expect(instructions).toContain('"prompt"');
    expect(instructions).toContain('"parameterSuggestions"');
    expect(instructions).toContain('"scheduler"');
    expect(instructions).toContain('"loraWeights"');
    expect(instructions).toContain('"suggestedWeight"');
    expect(instructions).toContain('"parameterSuggestionReason"');
    expect(instructions).toContain("Simplified Chinese");
    expect(instructions).toContain("checkpoint + LoRA combination");
    expect(instructions).toContain("must not describe the current image subject");
    expect(instructions).toContain("user-facing Chinese sentences");
    expect(instructions).toContain("sampler and scheduler as separate");
    expect(instructions).toContain("one item for every selected LoRA");
    expect(instructions).toContain("do not force every trigger word");
    expect(instructions).toContain("Do not invent trigger words");
  });
});

describe("parseCivitaiAiPromptResponse", () => {
  it("parses plain JSON responses", () => {
    expect(
      parseCivitaiAiPromptResponse(
        JSON.stringify({
          prompt: "1girl, cyber outfit",
          parameterSuggestions: {
            steps: 30,
            cfgScale: 6,
            loraWeights: [{ name: "Cyber Outfit", suggestedWeight: 0.7, reason: "沿用 Civitai 推荐权重。" }],
          },
          parameterSuggestionReason: "这个组合偏写实细节，30 步和中等 CFG 能稳定材质表现。",
          overallEffect: "写实电影感更强，霓虹材质和服装细节会更突出。",
        }),
      ),
    ).toEqual({
      prompt: "1girl, cyber outfit",
      parameterSuggestions: {
        steps: 30,
        cfgScale: 6,
        loraWeights: [{ name: "Cyber Outfit", suggestedWeight: 0.7, reason: "沿用 Civitai 推荐权重。" }],
      },
      parameterSuggestionReason: "这个组合偏写实细节，30 步和中等 CFG 能稳定材质表现。",
      overallEffect: "写实电影感更强，霓虹材质和服装细节会更突出。",
      parseWarning: null,
    });
  });

  it("parses fenced JSON responses", () => {
    const result = parseCivitaiAiPromptResponse(
      "```json\n{\"prompt\":\"rainy neon alley\",\"parameterSuggestions\":\"steps 28\",\"parameterSuggestionReason\":\"该步数适合保留湿润反光和霓虹层次。\",\"overallEffect\":\"偏浓郁霓虹色彩与湿润反光质感。\"}\n```",
    );

    expect(result.prompt).toBe("rainy neon alley");
    expect(result.parameterSuggestions).toBe("steps 28");
    expect(result.parameterSuggestionReason).toBe("该步数适合保留湿润反光和霓虹层次。");
    expect(result.overallEffect).toBe("偏浓郁霓虹色彩与湿润反光质感。");
    expect(result.parseWarning).toBeNull();
  });

  it("normalizes missing suggestion fields", () => {
    const result = parseCivitaiAiPromptResponse("{\"prompt\":\"solo portrait\"}");

    expect(result.prompt).toBe("solo portrait");
    expect(result.parameterSuggestions).toBeNull();
    expect(result.parameterSuggestionReason).toBe("");
    expect(result.overallEffect).toBe("");
    expect(result.parseWarning).toBeNull();
  });

  it("falls back to raw text for non-JSON responses", () => {
    const result = parseCivitaiAiPromptResponse("plain prompt text");

    expect(result.prompt).toBe("plain prompt text");
    expect(result.parameterSuggestions).toBeNull();
    expect(result.parameterSuggestionReason).toBe("");
    expect(result.overallEffect).toBe("");
    expect(result.parseWarning).toContain("未解析到参数建议");
  });
});
