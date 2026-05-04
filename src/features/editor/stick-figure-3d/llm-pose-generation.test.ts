import { describe, expect, it } from "vitest";

import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";

import { buildStickFigurePoseImageGenerationMessages } from "./llm-pose-generation";

describe("llm pose generation", () => {
  it("builds image pose inference messages with the same stick-pose response contract", () => {
    const messages = buildStickFigurePoseImageGenerationMessages(
      "data:image/jpeg;base64,abc",
      createDefaultStickFigurePoseV1(),
      "young hero",
      "left arm is important",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Required JSON shape");
    expect(messages[1].content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("left arm is important"),
      }),
      {
        type: "image_url",
        image_url: {
          url: "data:image/jpeg;base64,abc",
          detail: "low",
        },
      },
    ]);
  });
});
