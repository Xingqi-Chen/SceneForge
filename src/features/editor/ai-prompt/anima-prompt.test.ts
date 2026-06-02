import { describe, expect, it } from "vitest";

import type { SelectedCivitaiResourcePreview } from "@/features/civitai-lora-library";
import type { GeneratedPrompt } from "@/features/prompt-engine";

import {
  buildAnimaAiResponseInstructions,
  buildAnimaComicSequencePrompt,
  classifyFlatPromptToAnimaSections,
  formatGeneratedPromptForAnimaContext,
  isAnimaPromptContext,
  mergeAnimaNegativePrompts,
  renderAnimaPrompt,
  renderAnimaPromptForContext,
  renderAnimaPromptFromAiResponse,
  resolveAnimaPromptContextFromResources,
} from "./anima-prompt";

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
    baseModel: "Anima",
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

describe("Anima prompt renderer", () => {
  it("instructs LLM responses to use descriptive natural visual clauses", () => {
    const instructions = buildAnimaAiResponseInstructions();

    expect(instructions).toContain("detailed English anime-style visual phrases or short descriptive clauses");
    expect(instructions).toContain("Keep output comma-separated and prompt-like");
    expect(instructions).toContain("Prefer visible descriptive clauses over bare tags");
    expect(instructions).toContain("action, expression, scene, lighting, atmosphere, camera, and composition");
    expect(instructions).toContain("Keep character identity early and clear");
    expect(instructions).toContain("visible pose/action and facial expression");
    expect(instructions).toContain("distinct hairstyle and a distinct pose or action");
    expect(instructions).toContain("foreground/background relationship");
    expect(instructions).toContain("Avoid abstract psychological narration");
    expect(instructions).toContain("standing beside a rain-streaked window in an unlit room");
    expect(instructions).toContain("Return JSON only");
    expect(instructions).not.toContain("booru-style tags or short tag phrases");
  });

  it("detects Anima contexts by workflow profile or base model", () => {
    expect(isAnimaPromptContext({ workflowProfile: "anima" })).toBe(true);
    expect(isAnimaPromptContext({ baseModel: "Anima" })).toBe(true);
    expect(isAnimaPromptContext({ baseModel: "Illustrious" })).toBe(false);
  });

  it("renders Anima sections in required order with safe default when NSFW is disabled", () => {
    const prompt = renderAnimaPrompt({
      resources: {
        checkpoint: makeResource("model", "Anima Checkpoint", {
          trainedWords: ["checkpoint trigger"],
        }),
        loras: [
          makeResource("lora", "Character LoRA", {
            categories: ["character"],
            trainedWords: ["character trigger"],
          }),
          makeResource("lora", "Style LoRA", {
            categories: ["style"],
            trainedWords: ["artist trigger"],
          }),
        ],
      },
      sections: {
        artist: ["artist:alpha beta"],
        character: ["blue eyes"],
        general: ["city street"],
        source: ["series:Example Story"],
        subjectCount: ["1girl", "solo"],
      },
      supportsNsfw: false,
    });

    expect(prompt).toBe(
      [
        "masterpiece",
        "best quality",
        "score_9",
        "score_8",
        "score_7",
        "safe",
        "1girl",
        "solo",
        "blue eyes",
        "character trigger",
        "series:Example Story",
        "@alpha beta",
        "artist trigger",
        "city street",
        "checkpoint trigger",
      ].join(", "),
    );
  });

  it("routes checkpoint trained words through Anima section classification", () => {
    const prompt = renderAnimaPrompt({
      resources: {
        checkpoint: makeResource("model", "Anima Checkpoint", {
          trainedWords: [
            "artist:Checkpoint Artist",
            "1girl",
            "series:Checkpoint Story",
            "explicit",
            "moonlit rooftop",
          ],
        }),
        loras: [],
      },
      supportsNsfw: true,
    });

    expect(prompt).toBe(
      [
        "masterpiece",
        "best quality",
        "score_9",
        "score_8",
        "score_7",
        "explicit",
        "1girl",
        "series:Checkpoint Story",
        "@Checkpoint Artist",
        "moonlit rooftop",
      ].join(", "),
    );
  });

  it("omits default safe when NSFW is enabled while preserving explicit safety tags", () => {
    expect(renderAnimaPrompt({ sourcePrompt: "1girl, city", supportsNsfw: true })).not.toContain("safe");
    expect(renderAnimaPrompt({ sourcePrompt: "explicit, 1girl, city", supportsNsfw: true })).toContain("explicit");
  });

  it("places explicit safety tags in the first section and dedupes case-insensitively after ordering", () => {
    const prompt = renderAnimaPrompt({
      sourcePrompt: "1girl, Safe, city, masterpiece, City, artist:Alpha",
      supportsNsfw: false,
    });

    expect(prompt).toBe("masterpiece, best quality, score_9, score_8, score_7, Safe, 1girl, @Alpha, city");
    expect(prompt.match(/\bcity\b/gi)).toHaveLength(1);
  });

  it("classifies prompt parts into Anima section buckets", () => {
    const sections = classifyFlatPromptToAnimaSections(
      "score_7, 2girls, long hair, series:Example, by sample artist, warm lighting",
    );

    expect(sections.qualityMetaSafety).toEqual(["score_7"]);
    expect(sections.subjectCount).toEqual(["2girls"]);
    expect(sections.character).toEqual(["long hair"]);
    expect(sections.source).toEqual(["series:Example"]);
    expect(sections.artist).toEqual(["@sample artist"]);
    expect(sections.general).toEqual(["warm lighting"]);
  });

  it("keeps non-Anima contexts unchanged and formats Anima generated prompts plus negatives", () => {
    const generated: GeneratedPrompt = {
      prompt: "city, 1girl, artist:Alpha",
      negativePrompt: "low quality, blurry",
      parts: ["city", "1girl", "artist:Alpha"],
    };

    expect(renderAnimaPromptForContext(generated.prompt, { workflowProfile: "default" })).toBe(generated.prompt);
    expect(formatGeneratedPromptForAnimaContext(generated, { workflowProfile: "default" })).toBe(generated);
    expect(formatGeneratedPromptForAnimaContext(generated, { workflowProfile: "anima" })).toMatchObject({
      prompt: "masterpiece, best quality, score_9, score_8, score_7, safe, 1girl, @Alpha, city",
      negativePrompt:
        "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands",
    });
  });

  it("derives editor Anima context from current resources without stale saved metadata", () => {
    const currentResources = {
      checkpoint: makeResource("model", "Illustrious Checkpoint", {
        baseModel: "Illustrious",
      }),
      loras: [],
    };
    const generated: GeneratedPrompt = {
      prompt: "city, 1girl, artist:Alpha",
      negativePrompt: "low quality",
      parts: ["city", "1girl", "artist:Alpha"],
    };
    const context = resolveAnimaPromptContextFromResources({
      resources: currentResources,
      supportsNsfw: false,
    });

    expect(isAnimaPromptContext(context)).toBe(false);
    expect(formatGeneratedPromptForAnimaContext(generated, context)).toBe(generated);
  });

  it("activates from selected checkpoint base model and stays idempotent across preview and payload formatting", () => {
    const generated: GeneratedPrompt = {
      prompt: "questionable, city, 1girl, artist:Alpha",
      negativePrompt: "low quality, blurry",
      parts: ["questionable", "city", "1girl", "artist:Alpha"],
    };
    const context = {
      resources: {
        checkpoint: makeResource("model", "Anima Checkpoint", {
          baseModel: "Anima",
        }),
        loras: [],
      },
      supportsNsfw: true,
    };

    const previewPrompt = formatGeneratedPromptForAnimaContext(generated, context);
    const payloadPrompt = formatGeneratedPromptForAnimaContext(previewPrompt, context);

    expect(previewPrompt).toMatchObject({
      prompt: "masterpiece, best quality, score_9, score_8, score_7, questionable, 1girl, @Alpha, city",
      negativePrompt:
        "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands",
    });
    expect(previewPrompt.prompt).not.toContain("safe");
    expect(payloadPrompt).toEqual(previewPrompt);
  });

  it("parses Anima AI JSON sections before rendering", () => {
    const prompt = renderAnimaPromptFromAiResponse({
      rawContent: JSON.stringify({
        sections: {
          general: ["night street"],
          artist: ["by Beta"],
          character: ["red dress"],
          subjectCount: ["solo"],
        },
      }),
      supportsNsfw: false,
    });

    expect(prompt).toContain("safe, solo, red dress");
    expect(prompt).toContain("@Beta, night street");
  });

  it("builds Comic Sequence prompts with reference character text in the character section", () => {
    const prompt = buildAnimaComicSequencePrompt({
      basePrompt: "city street, 1girl, artist:Alpha",
      hasReferenceImages: true,
      reference: {
        characterName: "Mira",
        characterPrompt: "blue hair, red dress",
      },
      resources: {
        checkpoint: null,
        loras: [
          makeResource("lora", "Pose", {
            categories: ["pose"],
            trainedWords: ["pose trigger"],
          }),
        ],
      },
      shotPrompt: "waving, series:Example",
    });

    expect(prompt).toContain("safe, 1girl, Mira, blue hair, red dress, waving");
    expect(prompt).toContain("series:Example, @Alpha, city street, pose trigger");
    expect(prompt).not.toContain("Mira:");
  });

  it("merges Anima negative defaults without duplicate prompt parts", () => {
    expect(mergeAnimaNegativePrompts(["low quality, blurry", "bad hands, blurry"])).toBe(
      "worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, watermark, artist name, nsfw, bad_hands, bad hands",
    );
  });
});
