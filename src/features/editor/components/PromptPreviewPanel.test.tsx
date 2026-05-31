import { describe, expect, it, vi } from "vitest";

import type {
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { createDefaultProject } from "@/features/editor/store/defaults";
import { generatePrompt } from "@/features/prompt-engine";

import {
  buildAiSystemPrompt,
  buildAiUserText,
  resolveSelectedCivitaiResourcesForAi,
} from "./PromptPreviewPanel";

function makeResource(
  resourceType: "lora" | "model",
  name: string,
  overrides: Partial<SelectedCivitaiResourcePreview> = {},
): SelectedCivitaiResourcePreview {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    resourceType,
    name,
    versionName: "v1",
    baseModel: "Illustrious",
    creator: "creator",
    trainedWords: [],
    tags: [],
    categories: [],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    modelFileName: `${name}.safetensors`,
    ...overrides,
  };
}

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
    expect(systemPrompt).not.toContain("Illustrious prompt ordering");
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
    expect(userText).toContain("your reply must be the positive prompt text only");
    expect(userText).not.toContain("Selected Civitai resources");
  });

  it("adds Illustrious section and selected Civitai context for Stable Diffusion", () => {
    const project = createDefaultProject();
    project.settings.modelFormat = "stable-diffusion";
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Illustrious Checkpoint", {
        trainedWords: ["checkpoint trigger"],
      }),
      loras: [
        makeResource("lora", "Style LoRA", {
          categories: ["style"],
          trainedWords: ["style trigger"],
        }),
      ],
    };
    const systemPrompt = buildAiSystemPrompt(
      {
        layout: false,
        pose: false,
        visual: false,
      },
      { modelFormat: "stable-diffusion" },
    );
    const userText = buildAiUserText({
      constraints: {
        layout: false,
        pose: false,
        visual: false,
      },
      layoutConstraints: null,
      modelFormat: "stable-diffusion",
      promptForAi: generatePrompt(project),
      project,
      selectedResources,
      structuredSummary: "character: standing pose",
    });

    expect(systemPrompt).toContain("Illustrious prompt ordering");
    expect(systemPrompt).toContain("Return JSON only");
    expect(systemPrompt).toContain("Do not add rating tags");
    expect(userText).toContain("your reply must be Illustrious JSON sections");
    expect(userText).not.toContain("positive prompt text only");
    expect(userText).toContain("Selected Civitai resources");
    expect(userText).toContain("Checkpoint:");
    expect(userText).toContain("- trainedWords: checkpoint trigger");
    expect(userText).toContain("LoRA 1:");
    expect(userText).toContain("- trainedWords: style trigger");
  });
});

describe("resolveSelectedCivitaiResourcesForAi", () => {
  it("does not fetch selected resources for generic prompt generation", async () => {
    const fetchSelectedResources = vi.fn<() => Promise<SelectedCivitaiResourcesPreview>>();

    await expect(
      resolveSelectedCivitaiResourcesForAi({
        fetchSelectedResources,
        modelFormat: "generic",
        selectedResources: {
          checkpoint: makeResource("model", "Cached Checkpoint"),
          loras: [],
        },
        selectedResourcesQuery: "checkpointId=checkpoint-a",
        selectedResourcesResultQuery: "",
        selectedResourceStatus: "loading",
        shouldLoadSelectedResources: true,
      }),
    ).resolves.toEqual({ checkpoint: null, loras: [] });
    expect(fetchSelectedResources).not.toHaveBeenCalled();
  });

  it("fetches current Stable Diffusion selected resources before AI generation when previews are not loaded", async () => {
    const fetchedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Fetched Checkpoint", {
        trainedWords: ["checkpoint trigger"],
      }),
      loras: [
        makeResource("lora", "Fetched LoRA", {
          trainedWords: ["lora trigger"],
        }),
      ],
    };
    const fetchSelectedResources = vi.fn<(query: string) => Promise<SelectedCivitaiResourcesPreview>>()
      .mockResolvedValue(fetchedResources);

    await expect(
      resolveSelectedCivitaiResourcesForAi({
        fetchSelectedResources,
        modelFormat: "stable-diffusion",
        selectedResources: { checkpoint: null, loras: [] },
        selectedResourcesQuery: "checkpointId=checkpoint-a&loraIds=lora-a",
        selectedResourcesResultQuery: "",
        selectedResourceStatus: "loading",
        shouldLoadSelectedResources: true,
      }),
    ).resolves.toBe(fetchedResources);
    expect(fetchSelectedResources).toHaveBeenCalledWith("checkpointId=checkpoint-a&loraIds=lora-a");
  });

  it("reuses successfully loaded current Stable Diffusion selected resources", async () => {
    const cachedResources: SelectedCivitaiResourcesPreview = {
      checkpoint: makeResource("model", "Cached Checkpoint", {
        trainedWords: ["cached trigger"],
      }),
      loras: [],
    };
    const fetchSelectedResources = vi.fn<(query: string) => Promise<SelectedCivitaiResourcesPreview>>();

    await expect(
      resolveSelectedCivitaiResourcesForAi({
        fetchSelectedResources,
        modelFormat: "stable-diffusion",
        selectedResources: cachedResources,
        selectedResourcesQuery: "checkpointId=checkpoint-a",
        selectedResourcesResultQuery: "checkpointId=checkpoint-a",
        selectedResourceStatus: "success",
        shouldLoadSelectedResources: true,
      }),
    ).resolves.toBe(cachedResources);
    expect(fetchSelectedResources).not.toHaveBeenCalled();
  });
});
