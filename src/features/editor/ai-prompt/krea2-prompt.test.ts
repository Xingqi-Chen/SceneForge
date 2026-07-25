import { describe, expect, it } from "vitest";

import { renderKrea2Prompt } from "./krea2-prompt";

describe("Krea 2 prompt renderer", () => {
  it("renders supplied author sections in the fixed order without inventing details", () => {
    const prompt = renderKrea2Prompt({
      sections: {
        subjectMood: "A calm courier",
        subjectAttributesAndActions: "wearing a yellow jacket and holding a blue parcel",
        visualStyleAndMedium: "watercolor illustration",
        lightingColorAndTexture: "soft amber sunrise light",
        spatialCompositionAndFraming: "the courier stands in the foreground of a quiet station",
      },
    });

    expect(prompt).toBe(
      "A calm courier, wearing a yellow jacket and holding a blue parcel, watercolor illustration, " +
      "soft amber sunrise light, the courier stands in the foreground of a quiet station",
    );
    expect(prompt).not.toContain("dog");
    expect(prompt).not.toContain("leather");
  });

  it("preserves quoted visible text and requested medium while appending each LoRA trigger once", () => {
    const prompt = renderKrea2Prompt({
      resources: {
        checkpoint: null,
        loras: [
          {
            id: "style-lora",
            resourceType: "lora",
            name: "Style LoRA",
            versionName: "v1",
            baseModel: "Krea 2",
            creator: "creator",
            trainedWords: ["neon_station", "NEON_STATION", "soft ink"],
            tags: [],
            categories: [],
            usageGuide: null,
            descriptionSnippet: null,
            averageWeight: 0.7,
            minWeight: null,
            maxWeight: null,
            recommendations: [],
            previewImage: null,
            modelFileName: "style-lora.safetensors",
          },
        ],
      },
      sections: {
        subjectMood: 'A sign reads "OPEN ALL NIGHT"',
        visualStyleAndMedium: "35mm film photography",
        selectedLoraTriggerWords: ["neon_station", "soft ink"],
      },
    });

    expect(prompt).toBe(
      'A sign reads "OPEN ALL NIGHT", 35mm film photography, neon_station, soft ink',
    );
    expect(prompt.match(/neon_station/gi)).toHaveLength(1);
    expect(prompt.match(/soft ink/gi)).toHaveLength(1);
  });

  it("uses a flat manual prompt as the subject clause without reordering quoted text", () => {
    expect(renderKrea2Prompt({
      sourcePrompt: 'A poster says "KREA" in oil pastel',
      sections: { lightingColorAndTexture: "cool window light" },
    })).toBe('A poster says "KREA" in oil pastel, cool window light');
  });

  it("deduplicates exact one-word, multi-word, and quoted trigger matches without treating substrings as matches", () => {
    const prompt = renderKrea2Prompt({
      resources: {
        checkpoint: null,
        loras: [{
          id: "exact-trigger-lora",
          resourceType: "lora",
          name: "Exact Trigger LoRA",
          versionName: "v1",
          baseModel: "Krea 2",
          creator: "creator",
          trainedWords: ["art", "portrait", "soft ink", "soft inking"],
          tags: [],
          categories: [],
          usageGuide: null,
          descriptionSnippet: null,
          averageWeight: 0.7,
          minWeight: null,
          maxWeight: null,
          recommendations: [],
          previewImage: null,
          modelFileName: "exact-trigger-lora.safetensors",
        }],
      },
      sections: {
        subjectMood: 'A portrait displays the quoted text "soft ink"',
        visualStyleAndMedium: "illustration",
      },
    });

    expect(prompt).toBe(
      'A portrait displays the quoted text "soft ink", illustration, art, soft inking',
    );
    expect(prompt.match(/soft ink/gi)).toHaveLength(2);
    expect(prompt).not.toContain(", portrait");
  });
});
