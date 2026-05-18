import { describe, expect, it } from "vitest";

import {
  buildCivitaiResourceEnrichmentMessages,
  mergeCivitaiTriggerWords,
  parseCivitaiResourceEnrichmentContent,
} from "./enrichment";

describe("Civitai resource enrichment", () => {
  it("parses fenced JSON with categories, trigger words, ranges, and redraw rates", () => {
    const parsed = parseCivitaiResourceEnrichmentContent(
      `\`\`\`json
{
  "usageGuide": "适合想要绘画感和降低 AI 感的图像。",
  "categories": ["style", "lighting", "not-valid"],
  "triggerWords": ["XUER guangying,", " xuer guangying "],
  "aiNsfwLevel": "suggestive",
  "aiNsfwConfidence": "0.75",
  "aiNsfwReason": "Style focused, with possible mildly suggestive examples.",
  "recommendations": [
    {
      "condition": "通用",
      "sampler": "DPM++ 2M",
      "loraWeight": "0.8-0.9",
      "hdRedrawRate": "0.42",
      "notes": "厚涂质感更好"
    }
  ]
}
\`\`\``,
      ["other"],
    );

    expect(parsed.usageGuide).toContain("绘画感");
    expect(parsed.categories).toEqual(["style", "lighting"]);
    expect(parsed.triggerWords).toEqual(["XUER guangying"]);
    expect(parsed.aiNsfwLevel).toBe("suggestive");
    expect(parsed.aiNsfwConfidence).toBe(0.75);
    expect(parsed.aiNsfwReason).toContain("suggestive");
    expect(parsed.recommendations).toEqual([
      {
        condition: "通用",
        baseModel: null,
        checkpoint: null,
        sampler: "DPM++ 2M",
        loraWeightMin: 0.8,
        loraWeightMax: 0.9,
        loraWeight: null,
        hdRedrawRate: 0.42,
        notes: "厚涂质感更好",
      },
    ]);
  });

  it("falls back to provided categories when the LLM categories are invalid", () => {
    const parsed = parseCivitaiResourceEnrichmentContent(
      JSON.stringify({
        usageGuide: "",
        categories: ["invalid"],
        triggerWords: [],
        aiNsfwLevel: "invalid",
        aiNsfwConfidence: 2,
        aiNsfwReason: "",
        recommendations: [{ loraWeight: 0.7 }],
      }),
      ["style"],
    );

    expect(parsed.categories).toEqual(["style"]);
    expect(parsed.aiNsfwLevel).toBe("unknown");
    expect(parsed.aiNsfwConfidence).toBe(1);
    expect(parsed.aiNsfwReason).toBeNull();
    expect(parsed.recommendations[0]?.loraWeight).toBe(0.7);
  });

  it("normalizes percentage values from LLM output", () => {
    const parsed = parseCivitaiResourceEnrichmentContent(
      JSON.stringify({
        categories: ["style"],
        aiNsfwLevel: "suggestive",
        aiNsfwConfidence: "70%",
        recommendations: [{ loraWeight: "80%", hdRedrawRate: "42%" }],
      }),
      ["other"],
    );

    expect(parsed.aiNsfwConfidence).toBe(0.7);
    expect(parsed.recommendations[0]?.loraWeight).toBe(0.8);
    expect(parsed.recommendations[0]?.hdRedrawRate).toBe(0.42);
  });

  it("throws for invalid JSON and dedupes merged trigger words case-insensitively", () => {
    expect(() => parseCivitaiResourceEnrichmentContent("not json", ["other"])).toThrow();
    expect(mergeCivitaiTriggerWords(["Alpha", " beta ", "vr4_zk4r1,"], ["alpha", "Gamma", "vr4_zk4r1"])).toEqual([
      "Alpha",
      "beta",
      "vr4_zk4r1",
      "Gamma",
    ]);
  });

  it("does not send source image prompt or sampler as recommendation evidence", () => {
    const messages = buildCivitaiResourceEnrichmentMessages({
      resourceType: "lora",
      civitaiModelId: 1,
      civitaiModelVersionId: 2,
      name: "Example LoRA",
      versionName: "v1",
      hash: null,
      baseModel: "Illustrious",
      trainedWords: [],
      tags: [],
      description: "Trigger word: example",
      creator: null,
      downloadUrl: null,
      filesJson: null,
      officialImagesJson: null,
      category: null,
      categories: [],
      usageGuide: null,
      recommendations: [],
      enrichmentStatus: "fallback",
      enrichmentError: null,
      nsfw: null,
      aiNsfwLevel: "unknown",
      aiNsfwConfidence: null,
      aiNsfwReason: null,
      rawVersionJson: null,
    });

    expect(messages[1]?.content).not.toContain("sourceImage");
    expect(messages[1]?.content).toContain("civitaiNsfw");
    expect(messages[0]?.content).toContain("Do NOT infer recommendations from a source image prompt");
  });
});
