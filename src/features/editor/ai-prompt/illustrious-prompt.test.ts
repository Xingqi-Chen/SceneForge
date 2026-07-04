import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview } from "@/features/civitai-lora-library";

import {
  buildIllustriousComicSequencePrompt,
  classifyFlatPromptToIllustriousSections,
  mergeNegativePrompts,
  renderIllustriousPrompt,
  renderIllustriousPromptFromAiResponse,
} from "./illustrious-prompt";

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

describe("Illustrious prompt renderer", () => {
  it("renders default quality tags, Civitai triggers, and sections in Illustrious order", () => {
    const prompt = renderIllustriousPrompt({
      resources: {
        checkpoint: makeResource("model", "Animagine", {
          trainedWords: ["checkpoint token"],
        }),
        loras: [
          makeResource("lora", "Style LoRA", {
            categories: ["style"],
            trainedWords: ["style trigger"],
          }),
          makeResource("lora", "Character LoRA", {
            categories: ["character"],
            trainedWords: ["character trigger"],
          }),
          makeResource("lora", "Unknown LoRA", {
            trainedWords: ["unknown trigger"],
          }),
          makeResource("lora", "Lighting LoRA", {
            categories: ["lighting"],
            trainedWords: ["lighting trigger"],
          }),
        ],
      },
      sections: {
        artistStyle: ["soft anime style"],
        subjectIdentity: ["1girl", "solo"],
        appearancePhysicalTraits: ["blue eyes"],
        lightingFocus: ["rim light"],
      },
    });

    expect(prompt).toBe(
      [
        "masterpiece",
        "best quality",
        "amazing quality",
        "very aesthetic",
        "newest",
        "soft anime style",
        "style trigger",
        "checkpoint token",
        "1girl",
        "solo",
        "character trigger",
        "unknown trigger",
        "blue eyes",
        "rim light",
        "lighting trigger",
      ].join(", "),
    );
    expect(prompt).not.toContain("rating:");
    expect(prompt).not.toContain("<lora:");
  });

  it("routes LoRA trigger words by tags and strips generated LoRA loader syntax", () => {
    const prompt = renderIllustriousPrompt({
      resources: {
        checkpoint: makeResource("model", "Checkpoint", {
          trainedWords: ["ckpt trigger"],
        }),
        loras: [
          makeResource("lora", "Tagged Style", {
            tags: ["Anime Style"],
            trainedWords: ["<lora:tagged-style:0.8>", "tag style trigger"],
          }),
          makeResource("lora", "Tagged Scene", {
            tags: ["background"],
            trainedWords: ["tag scene trigger"],
          }),
        ],
      },
      sections: {
        subjectIdentity: ["1girl"],
        backgroundEnvironmentObjects: ["city street"],
      },
    });

    expect(prompt).toBe(
      [
        "masterpiece",
        "best quality",
        "amazing quality",
        "very aesthetic",
        "newest",
        "tag style trigger",
        "ckpt trigger",
        "1girl",
        "city street",
        "tag scene trigger",
      ].join(", "),
    );
    expect(prompt).not.toContain("<lora:");
  });

  it("uses only explicit resource trigger selections when provided", () => {
    const prompt = renderIllustriousPrompt({
      resourceTriggerSelections: [
        {
          resourceId: "style-lora",
          selectedTrainedWords: ["usnr", "invented trigger"],
        },
      ],
      resources: {
        checkpoint: makeResource("model", "Checkpoint", {
          trainedWords: ["general", "sensitive", "nsfw", "explicit"],
        }),
        loras: [
          makeResource("lora", "Style LoRA", {
            id: "style-lora",
            categories: ["style"],
            trainedWords: ["usnr", "unused style trigger"],
          }),
        ],
      },
      sections: {
        rating: ["safe"],
        subjectIdentity: ["1girl"],
      },
    });

    expect(prompt).toContain("safe, usnr, 1girl");
    expect(prompt).not.toContain("general");
    expect(prompt).not.toContain("sensitive");
    expect(prompt).not.toContain("nsfw");
    expect(prompt).not.toContain("explicit");
    expect(prompt).not.toContain("unused style trigger");
    expect(prompt).not.toContain("invented trigger");
  });

  it("keeps legacy automatic resource triggers when selections are omitted", () => {
    const prompt = renderIllustriousPrompt({
      resources: {
        checkpoint: makeResource("model", "Checkpoint", {
          trainedWords: ["checkpoint trigger"],
        }),
        loras: [
          makeResource("lora", "Style LoRA", {
            id: "style-lora",
            categories: ["style"],
            trainedWords: ["style trigger"],
          }),
        ],
      },
      sections: {
        subjectIdentity: ["1girl"],
      },
    });

    expect(prompt).toContain("style trigger, checkpoint trigger, 1girl");
  });

  it("parses JSON sections before rendering and falls back to flat prompt classification", () => {
    const jsonPrompt = renderIllustriousPromptFromAiResponse({
      rawContent: JSON.stringify({
        sections: {
          poseActionExpression: ["running"],
          subjectIdentity: ["1girl"],
          cameraFraming: ["low angle"],
        },
      }),
    });

    expect(jsonPrompt).toContain("newest, 1girl, running, low angle");

    const flatPrompt = renderIllustriousPromptFromAiResponse({
      rawContent: "low angle, red dress, 1girl, soft rim lighting",
    });

    expect(flatPrompt).toContain("newest, 1girl, red dress");
    expect(flatPrompt).toContain("low angle, soft rim lighting");
  });

  it("classifies common flat prompt tags into Illustrious section buckets", () => {
    const sections = classifyFlatPromptToIllustriousSections(
      "best quality, 1girl, long hair, school uniform, sitting, forest background, cowboy shot, soft focus, absurdres",
    );

    expect(sections.quality).toEqual(["best quality"]);
    expect(sections.subjectIdentity).toEqual(["1girl"]);
    expect(sections.appearancePhysicalTraits).toEqual(["long hair"]);
    expect(sections.clothingAccessories).toEqual(["school uniform"]);
    expect(sections.poseActionExpression).toEqual(["sitting"]);
    expect(sections.backgroundEnvironmentObjects).toEqual(["forest background"]);
    expect(sections.cameraFraming).toEqual(["cowboy shot"]);
    expect(sections.lightingFocus).toEqual(["soft focus"]);
    expect(sections.detailResolution).toEqual(["absurdres"]);
  });

  it("builds Comic Sequence prompts without name-colon reference text", () => {
    const prompt = buildIllustriousComicSequencePrompt({
      basePrompt: "soft anime style, 1girl, blue eyes, classroom background",
      reference: {
        characterName: "Mira",
        characterPrompt: "red dress, long hair",
      },
      resources: {
        checkpoint: makeResource("model", "Checkpoint", {
          trainedWords: ["checkpoint token"],
        }),
        loras: [
          makeResource("lora", "Pose", {
            categories: ["pose"],
            trainedWords: ["pose trigger"],
          }),
        ],
      },
      shotPrompt: "waving, close-up, warm lighting",
    });

    expect(prompt).toContain("soft anime style, checkpoint token, 1girl, Mira");
    expect(prompt).toContain("blue eyes, long hair, red dress");
    expect(prompt).toContain("waving, pose trigger");
    expect(prompt).toContain("close-up, warm lighting");
    expect(prompt).not.toContain("Mira:");
  });

  it("dedupes merged negative prompts", () => {
    expect(mergeNegativePrompts(["low quality, blurry", "blurry, bad hands"])).toBe(
      "low quality, blurry, bad hands",
    );
  });
});
