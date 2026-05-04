import { describe, expect, it } from "vitest";

import { parseCharacterImagePromptTagsContent } from "./character-image-prompt-tags";

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
});
