import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview } from "@/features/civitai-lora-library";

import {
  buildCivitaiAiJsonResponseInstructions,
  formatSelectedCivitaiResourcesForAi,
  parseCivitaiAiPromptResponse,
} from "./civitai-ai-context";

function makeResource(overrides: Partial<SelectedCivitaiResourcePreview> = {}): SelectedCivitaiResourcePreview {
  return {
    id: "checkpoint",
    resourceType: "model",
    name: "Anima",
    versionName: "preview3-base",
    baseModel: "Anima",
    creator: null,
    trainedWords: [],
    tags: [],
    categories: ["other"],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    modelFileName: "anima.safetensors",
    ...overrides,
  };
}

describe("Civitai AI context", () => {
  it("includes example image dimensions in selected resource context", () => {
    expect(formatSelectedCivitaiResourcesForAi({
      checkpoint: makeResource({
        exampleImageDimensions: ["896x1152 (5 examples)", "1152x896"],
      }),
      loras: [],
    })).toContain("- exampleImageDimensions: 896x1152 (5 examples), 1152x896");
  });

  it("asks the LLM for JSON-only prompt and parameter suggestions", () => {
    const instructions = buildCivitaiAiJsonResponseInstructions();

    expect(instructions).toContain("Return JSON only");
    expect(instructions).toContain("\"prompt\": string");
    expect(instructions).toContain("\"parameterSuggestions\"");
    expect(instructions).toContain("overallEffect and parameterSuggestionReason must be written in Simplified Chinese");
    expect(instructions).toContain("return sampler and scheduler as separate parameterSuggestions fields");
    expect(instructions).toContain("one item for every selected LoRA");
    expect(instructions).toContain("Do not invent trigger words");
    expect(instructions).toContain("Do not generate <lora:...> syntax");
  });

  it("parses fenced JSON Civitai prompt responses", () => {
    const result = parseCivitaiAiPromptResponse(`Before text
\`\`\`json
{
  "prompt": "1girl, teal cardigan, library window",
  "parameterSuggestions": {
    "sampler": "euler",
    "scheduler": "simple",
    "steps": 28,
    "loraWeights": [
      { "name": "soft light", "suggestedWeight": 0.65, "reason": "matches metadata" }
    ]
  },
  "parameterSuggestionReason": "该组合适合柔和光照。",
  "overallEffect": "柔和的动漫插画质感。"
}
\`\`\``);

    expect(result).toEqual({
      prompt: "1girl, teal cardigan, library window",
      parameterSuggestions: {
        sampler: "euler",
        scheduler: "simple",
        steps: 28,
        loraWeights: [
          { name: "soft light", suggestedWeight: 0.65, reason: "matches metadata" },
        ],
      },
      parameterSuggestionReason: "该组合适合柔和光照。",
      overallEffect: "柔和的动漫插画质感。",
      parseWarning: null,
    });
  });

  it("falls back to raw text when Civitai prompt responses are not parseable JSON", () => {
    const result = parseCivitaiAiPromptResponse("plain prompt without JSON");

    expect(result).toMatchObject({
      prompt: "plain prompt without JSON",
      parameterSuggestions: null,
      parameterSuggestionReason: "",
      overallEffect: "",
    });
    expect(result.parseWarning).toContain("未解析到参数建议");
  });

  it("falls back to raw text when parsed Civitai JSON omits prompt", () => {
    const result = parseCivitaiAiPromptResponse(JSON.stringify({
      parameterSuggestions: {
        sampler: "euler",
      },
    }));

    expect(result).toMatchObject({
      prompt: '{"parameterSuggestions":{"sampler":"euler"}}',
      parameterSuggestions: null,
      parameterSuggestionReason: "",
      overallEffect: "",
    });
    expect(result.parseWarning).toContain("缺少 prompt 字段");
  });
});
