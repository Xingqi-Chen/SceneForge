import { describe, expect, it } from "vitest";

import {
  buildPromptLibrarySubcategoryMessages,
  parseLlmPromptLibraryImportContent,
  parseLlmPromptLibrarySubcategoryContent,
} from "./parse-llm-prompt-library-import";

describe("parseLlmPromptLibraryImportContent", () => {
  it("parses valid items array", () => {
    const result = parseLlmPromptLibraryImportContent(
      JSON.stringify({
        items: [
          {
            label: "名作",
            prompt: "masterpiece",
            category: "quality",
            subcategory: "quality-finish",
          },
          {
            label: "LoRA",
            prompt: "<lora:Alpaca_Carlesi_Style:1>",
            category: "style",
            subcategory: "style-rendering",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0]?.category).toBe("quality");
      expect(result.tags[0]?.subcategory).toBe("quality-finish");
      expect(result.tags[0]?.negative).toBe(false);
      expect(result.tags[1]?.prompt).toBe("<lora:Alpaca_Carlesi_Style:1>");
    }
  });

  it("drops subcategories that do not belong to the selected category", () => {
    const result = parseLlmPromptLibraryImportContent(
      JSON.stringify({
        items: [
          {
            label: "蓝眼",
            prompt: "blue eyes",
            category: "body-part",
            subcategory: "scene-weather",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags[0]?.category).toBe("body-part");
      expect(result.tags[0]?.subcategory).toBeUndefined();
    }
  });

  it("splits comma-separated prompt chunks into atomic tags", () => {
    const result = parseLlmPromptLibraryImportContent(
      JSON.stringify({
        items: [
          {
            label: "僵尸少女角色",
            prompt:
              "alpacaxd, 1girl, solo, black hair, braid, qing guanmao, jiangshi, hat, twin braids, long hair, blue eyes, ofuda, chinese clothes",
            category: "character",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags.map((tag) => tag.prompt)).toEqual([
        "alpacaxd",
        "1girl",
        "solo",
        "black hair",
        "braid",
        "qing guanmao",
        "jiangshi",
        "hat",
        "twin braids",
        "long hair",
        "blue eyes",
        "ofuda",
        "chinese clothes",
      ]);
      expect(result.tags.map((tag) => tag.label)).toContain("blue eyes");
    }
  });

  it("splits quoted prompt chunks instead of preserving them as one tag", () => {
    const result = parseLlmPromptLibraryImportContent(
      JSON.stringify({
        items: [
          {
            prompt: '"alpacaxd, 1girl, noodles, colored skin"',
            category: "character",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags.map((tag) => tag.prompt)).toEqual([
        "alpacaxd",
        "1girl",
        "noodles",
        "colored skin",
      ]);
    }
  });

  it("cleans negative prefixes, wrappers, weights, and metadata", () => {
    const result = parseLlmPromptLibraryImportContent(
      JSON.stringify({
        items: [
          {
            prompt:
              "Negative prompt: worst_quality, {missing hands, extra hands}, (bad anatomy:1.5), Steps: 30, CFG scale: 7",
            category: "negative",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags.map((tag) => tag.prompt)).toEqual([
        "worst_quality",
        "missing hands",
        "extra hands",
        "bad anatomy",
      ]);
      expect(result.tags.at(-1)?.weight).toEqual({ enabled: true, value: 1.5 });
      expect(result.tags.every((tag) => tag.negative)).toBe(true);
    }
  });

  it("strips markdown fences when present", () => {
    const inner = JSON.stringify({
      items: [{ label: "A", prompt: "solo", category: "character" }],
    });
    const result = parseLlmPromptLibraryImportContent("```json\n" + inner + "\n```");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags).toHaveLength(1);
    }
  });

  it("marks negative category as negative", () => {
    const result = parseLlmPromptLibraryImportContent(
      JSON.stringify({
        items: [{ label: "坏", prompt: "low quality", category: "negative" }],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tags[0]?.negative).toBe(true);
    }
  });

  it("rejects invalid json", () => {
    const result = parseLlmPromptLibraryImportContent("not json");
    expect(result.ok).toBe(false);
  });

  it("rejects missing items", () => {
    const result = parseLlmPromptLibraryImportContent(JSON.stringify({ foo: [] }));
    expect(result.ok).toBe(false);
  });
});

describe("parseLlmPromptLibrarySubcategoryContent", () => {
  it("parses valid subcategory assignments", () => {
    const result = parseLlmPromptLibrarySubcategoryContent(
      JSON.stringify({
        items: [
          { id: "a", subcategory: "body-part-hair" },
          { id: "b", subcategory: "body-part-eyes" },
        ],
      }),
      "body-part",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignments).toEqual([
        { id: "a", subcategory: "body-part-hair" },
        { id: "b", subcategory: "body-part-eyes" },
      ]);
    }
  });

  it("drops assignments with subcategories outside the current category", () => {
    const result = parseLlmPromptLibrarySubcategoryContent(
      JSON.stringify({
        items: [
          { id: "a", subcategory: "scene-weather" },
          { id: "b", subcategory: "body-part-hands" },
        ],
      }),
      "body-part",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignments).toEqual([{ id: "b", subcategory: "body-part-hands" }]);
    }
  });

  it("builds subcategory classification messages with existing ids", () => {
    const messages = buildPromptLibrarySubcategoryMessages("scene", [
      { id: "tag-1", label: "雨天", prompt: "rainy day" },
    ]);

    expect(messages[0]?.content).toContain("scene-weather");
    expect(messages[1]?.content).toContain("tag-1");
  });
});
