import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";

import { generatePrompt } from "./generate-prompt";

describe("generatePrompt", () => {
  it("builds a stable diffusion prompt from semantic scene data", () => {
    const project = createDefaultProject();

    const result = generatePrompt(project);

    expect(result.prompt).toContain("场景描述");
    expect(result.prompt).toContain("(cinematic composition:1.15)");
    expect(result.prompt).toContain("wooden table in the foreground");
    expect(result.prompt).toContain("(long flowing hair:1.2)");
    expect(result.negativePrompt).toBe("low quality, blurry, extra fingers");
  });

  it("uses Midjourney weight formatting when configured", () => {
    const project = {
      ...createDefaultProject(),
      settings: {
        ...createDefaultProject().settings,
        modelFormat: "midjourney" as const,
      },
    };

    const result = generatePrompt(project);

    expect(result.prompt).toContain("cinematic composition::1.15");
  });

  it("collects body-part negative tags", () => {
    const project = createDefaultProject();

    project.scene.characters[0].bodyParts[0].promptTags.push({
      id: "tag-bad-hands",
      label: "手部错误",
      prompt: "bad hands",
      category: "negative",
      weight: { enabled: false, value: 1 },
      negative: true,
    });

    const result = generatePrompt(project);

    expect(result.negativePrompt).toContain("bad hands");
  });
});
