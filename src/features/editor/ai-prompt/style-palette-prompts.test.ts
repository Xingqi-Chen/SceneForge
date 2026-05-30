import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview, SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";

import {
  STYLE_PALETTE_PROMPT_PRESETS,
  buildStylePaletteAdviceMessages,
  buildStylePaletteActivePrompt,
  buildStylePalettePositivePrompt,
  buildStylePaletteSubjectDanbooruMessages,
  normalizeStylePaletteSubjectPrompt,
} from "./style-palette-prompts";

function makeResource(
  resourceType: "model" | "lora",
  name: string,
  overrides: Partial<SelectedCivitaiResourcePreview> = {},
): SelectedCivitaiResourcePreview {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    resourceType,
    name,
    versionName: "v1",
    baseModel: "Pony",
    creator: "creator",
    trainedWords: resourceType === "lora" ? [`${name} trigger`] : [],
    tags: ["style"],
    categories: ["style"],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: resourceType === "lora" ? 0.7 : null,
    minWeight: resourceType === "lora" ? 0.5 : null,
    maxWeight: resourceType === "lora" ? 0.9 : null,
    recommendations: [],
    previewImage: null,
    modelFileName: `${name}.safetensors`,
    promptReferences: [],
    ...overrides,
  };
}

describe("style palette prompts", () => {
  it("defines six complete fixed presets", () => {
    expect(STYLE_PALETTE_PROMPT_PRESETS).toHaveLength(6);
    expect(STYLE_PALETTE_PROMPT_PRESETS.map((preset) => preset.id)).toEqual([
      "portrait",
      "full-body",
      "indoor",
      "outdoor",
      "action",
      "object",
    ]);
    expect(
      STYLE_PALETTE_PROMPT_PRESETS.every((preset) => preset.positive.trim() && preset.negative.trim()),
    ).toBe(true);
  });

  it("appends selected artist prompt parts and LoRA trigger words while deduping blanks", () => {
    const preset = STYLE_PALETTE_PROMPT_PRESETS[0];
    const resources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Checkpoint"),
      loras: [
        makeResource("lora", "Painter", { trainedWords: ["Painter trigger", ""] }),
        makeResource("lora", "Detail", { trainedWords: ["Painter trigger", "detail trigger"] }),
      ],
    };

    const prompt = buildStylePalettePositivePrompt({
      artistPrompts: ["artist:alpha, Painter trigger", " ", "by beta"],
      preset,
      resources,
    });

    expect(prompt).toContain("1girl");
    expect(prompt).toContain("artist:alpha");
    expect(prompt).toContain("by beta");
    expect(prompt.match(/Painter trigger/g)).toHaveLength(1);
    expect(prompt).toContain("detail trigger");
  });

  it("prepends subject input to the active style palette prompt while deduping tags", () => {
    const prompt = buildStylePaletteActivePrompt({
      subjectPrompt: "hatsune_miku, 1girl",
      stylePrompt: "1girl, solo, simple background",
    });

    expect(prompt).toBe("hatsune_miku, 1girl, solo, simple background");
  });

  it("builds and normalizes Danbooru subject conversion prompts", () => {
    const messages = buildStylePaletteSubjectDanbooruMessages({ subject: "Hatsune Miku" });

    expect(messages[0].content).toContain("Danbooru tag normalizer");
    expect(messages[0].content).toContain("Return only comma-separated tags");
    expect(messages[1].content).toContain("Hatsune Miku");
    expect(normalizeStylePaletteSubjectPrompt("Tags: hatsune_miku, 1girl, hatsune_miku")).toBe(
      "hatsune_miku, 1girl",
    );
  });

  it("builds JSON-only style advice messages without scene rewrite instructions", () => {
    const preset = STYLE_PALETTE_PROMPT_PRESETS[1];
    const resources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Checkpoint"),
      loras: [makeResource("lora", "Painter")],
    };
    const messages = buildStylePaletteAdviceMessages({
      artistPrompts: ["artist:alpha"],
      preset,
      resources,
    });

    expect(messages[0].content).toContain("Return JSON only");
    expect(messages[0].content).toContain("Do not invent image subjects");
    expect(messages[0].content).toContain("Do not rewrite the preset into a new scene");
    expect(messages[0].content).toContain("parameterSuggestions");
    expect(messages[0].content).toContain("sampler must be one ComfyUI KSampler sampler_name value");
    expect(messages[0].content).toContain("scheduler must be one ComfyUI KSampler scheduler value");
    expect(messages[0].content).toContain("Do not return combined A1111/Civitai strings");
    expect(messages[1].content).toContain('"artistPrompt": "artist:alpha"');
    expect(messages[1].content).toContain("Checkpoint");
    expect(messages[1].content).toContain(preset.positive);
  });
});
