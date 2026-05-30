import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { generatePrompt } from "@/features/prompt-engine";

import { buildAiSystemPrompt, buildAiUserText } from "./PromptPreviewPanel";

describe("PromptPreviewPanel AI prompt messages", () => {
  it("instructs AI prompt generation to use Danbooru-style tags instead of natural language", () => {
    const systemPrompt = buildAiSystemPrompt({
      layout: true,
      pose: true,
      visual: true,
    });

    expect(systemPrompt).toContain("Danbooru/booru-style");
    expect(systemPrompt).toContain("not natural language");
    expect(systemPrompt).toContain("comma-separated tokens and short tag phrases");
    expect(systemPrompt).toContain("no prose explanation");
    expect(systemPrompt).toContain("dynamic pose");
    expect(systemPrompt).toContain("low angle");
    expect(systemPrompt).toContain("Do not connect separate words with underscores");
    expect(systemPrompt).not.toContain("natural image-prompt language");
    expect(systemPrompt).not.toContain("natural, artistic language");
  });

  it("asks for a Danbooru-style positive tag prompt in the user message", () => {
    const project = createDefaultProject();
    const userText = buildAiUserText({
      constraints: {
        layout: false,
        pose: true,
        visual: false,
      },
      layoutConstraints: null,
      promptForAi: generatePrompt(project),
      project,
      structuredSummary: "character: standing pose",
    });

    expect(userText).toContain("Danbooru-style positive tag prompt");
    expect(userText).toContain("using pose/action tags, not coordinate prose");
  });
});
