import { describe, expect, it } from "vitest";

import {
  buildCharacterTextPromptTagMessages,
  parseCharacterImagePromptTagsContent,
} from "./character-image-prompt-tags";

describe("parseCharacterImagePromptTagsContent", () => {
  it("parses body-part-bound prompt tags from JSON", () => {
    const result = parseCharacterImagePromptTagsContent(
      JSON.stringify({
        items: [
          {
            bodyPartId: "head",
            label: "黑长发",
            prompt: "long black hair",
            category: "body-part",
            subcategory: "body-part-hair",
          },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      items: [
        {
          target: { kind: "bodyPart", bodyPartId: "head" },
          bodyPartId: "head",
          tag: {
            label: "黑长发",
            prompt: "long black hair",
            category: "body-part",
            subcategory: "body-part-hair",
            negative: false,
            weight: { enabled: false, value: 1 },
          },
        },
      ],
    });
  });

  it("accepts fenced JSON and skips invalid body parts or grouped prompts", () => {
    const result = parseCharacterImagePromptTagsContent(`\`\`\`json
{"items":[
  {"bodyPartId":"head","label":"眼睛","prompt":"blue eyes","category":"body-part","subcategory":"body-part-eyes"},
  {"bodyPartId":"wing","label":"翅膀","prompt":"white wings","category":"body-part"},
  {"bodyPartId":"torso","label":"组合","prompt":"dress, ribbon","category":"outfit"}
]}
\`\`\``);

    expect(result).toEqual({
      ok: true,
      items: [
        {
          target: { kind: "bodyPart", bodyPartId: "head" },
          bodyPartId: "head",
          tag: {
            label: "眼睛",
            prompt: "blue eyes",
            category: "body-part",
            subcategory: "body-part-eyes",
            negative: false,
            weight: { enabled: false, value: 1 },
          },
        },
      ],
    });
  });

  it("returns an error when no valid items are present", () => {
    const result = parseCharacterImagePromptTagsContent('{"items":[]}');

    expect(result.ok).toBe(false);
  });

  it("builds text reverse-engineering messages that allow creative expansion", () => {
    const messages = buildCharacterTextPromptTagMessages({
      bodyParts: [
        {
          id: "head",
          label: "Head",
          promptTags: [],
          promptCategoryBindings: ["body-part", "outfit"],
        },
      ],
      characterTarget: {
        label: "Character",
        promptCategoryBindings: ["character", "body-part", "outfit"],
      },
      userPrompt: "生成一个穿着长裙的漂亮女生",
    });

    expect(messages[0].content).toContain("freely expand");
    expect(messages[0].content).toContain("label MUST be a short Simplified Chinese");
    expect(messages[0].content).toContain('"label":"黑长发"');
    expect(messages[0].content).toContain("Never return style, lighting, quality, scene");
    expect(messages[0].content).toContain("Categories: character, body-part, outfit.");
    expect(messages[0].content).not.toContain("lighting-source");
    expect(messages[1].content).toContain("userCharacterPrompt");
    expect(messages[1].content).toContain("生成一个穿着长裙的漂亮女生");
    expect(messages[1].content).not.toContain("existingPromptLibraryExamples");

    const payload = JSON.parse(String(messages[1].content)) as {
      characterTarget: { allowedCategories: string[] };
      bodyParts: Array<{ allowedCategories: string[] }>;
    };
    expect(payload.characterTarget.allowedCategories).toEqual(["character"]);
    expect(payload.bodyParts[0].allowedCategories).toEqual(["body-part", "outfit"]);
  });
});
