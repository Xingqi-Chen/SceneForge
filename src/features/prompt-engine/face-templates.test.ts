import { describe, expect, it } from "vitest";

import {
  createDefaultSceneNegativePromptTags,
  defaultCharacter,
} from "@/features/editor/store/defaults";
import { BUILT_IN_PROMPT_LIBRARY_TAGS } from "@/features/prompt-engine/prompt-library/built-in-prompt-tags";

import {
  FACE_TEMPLATES,
  applyFaceTemplateTagsToHead,
  createFaceTemplatePromptTags,
  removeFaceTemplateApplicationFromHead,
  removeFaceTemplateTagsFromHead,
  upsertFaceTemplateTagsOnHead,
} from "./face-templates";

describe("face templates", () => {
  it("keeps only real portrait and anime-style face templates", () => {
    expect(FACE_TEMPLATES.map((template) => template.id)).toEqual([
      "real-human-face",
      "anime-handdrawn-face",
      "transparent-handdrawn-anime-face",
    ]);
    expect(FACE_TEMPLATES.map((template) => template.label).join(" ")).not.toMatch(/GPT/i);
    expect(FACE_TEMPLATES.map((template) => template.label)).toEqual([
      "真实人像脸部",
      "基础手绘二次元脸部",
      "通透手绘二次元脸部",
    ]);
  });

  it("exposes face template tags through the built-in prompt library", () => {
    const prompts = BUILT_IN_PROMPT_LIBRARY_TAGS.map((tag) => tag.prompt);

    expect(prompts).toContain("multi-tone living skin");
    expect(prompts).toContain("consistent anime eye shapes");
    expect(prompts).toContain("transparent watercolor-like skin shading");
    expect(prompts).toContain("detailed layered iris highlights");
    expect(prompts).toContain("fake pores texture");
    expect(prompts).toContain("AI-generated eye artifacts");
    expect(prompts).toContain("plastic anime face");
  });

  it("does not add face template negatives to the default scene negative prompt", () => {
    const defaultNegativePrompts = createDefaultSceneNegativePromptTags().map((tag) => tag.prompt);

    expect(defaultNegativePrompts).toContain("over-smoothed skin");
    expect(defaultNegativePrompts).not.toContain("fake pores texture");
    expect(defaultNegativePrompts).not.toContain("AI-generated eye artifacts");
    expect(defaultNegativePrompts).not.toContain("plastic anime face");
  });

  it("includes real portrait anti-AI cues", () => {
    const tags = createFaceTemplatePromptTags("real-human-face", 1);

    expect(tags.map((tag) => tag.prompt)).toEqual(
      expect.arrayContaining([
        "multi-tone living skin",
        "fine vellus facial hair",
        "realistic under-eye texture",
        "fake pores texture",
        "dead eyes",
      ]),
    );
    expect(tags.find((tag) => tag.prompt === "multi-tone living skin")?.weight).toEqual({
      enabled: true,
      value: 1.16,
    });
    expect(tags.find((tag) => tag.prompt === "dead eyes")?.negative).toBe(true);
  });

  it("includes anime hand-drawn anti-AI cues", () => {
    const tags = createFaceTemplatePromptTags("anime-handdrawn-face", 1);

    expect(tags.map((tag) => tag.prompt)).toEqual(
      expect.arrayContaining([
        "clean hand-drawn anime face lineart",
        "consistent anime eye shapes",
        "clear iris highlights",
        "broken eye details",
        "melted iris",
        "AI-generated eye artifacts",
      ]),
    );
    expect(tags.find((tag) => tag.prompt === "consistent anime eye shapes")?.weight).toEqual({
      enabled: true,
      value: 1.1,
    });
    expect(tags.find((tag) => tag.prompt === "melted iris")?.negative).toBe(true);
  });

  it("includes transparent hand-drawn anime anti-AI cues", () => {
    const tags = createFaceTemplatePromptTags("transparent-handdrawn-anime-face", 1);

    expect(tags.map((tag) => tag.prompt)).toEqual(
      expect.arrayContaining([
        "transparent watercolor-like skin shading",
        "warm soft facial lighting",
        "natural soft blush on cheeks",
        "large expressive anime eyes",
        "detailed layered iris highlights",
        "gentle hand-painted skin gradients",
        "plastic anime face",
        "flat dead eyes",
        "muddy facial lineart",
      ]),
    );
    expect(
      tags.find((tag) => tag.prompt === "detailed layered iris highlights")?.weight,
    ).toEqual({
      enabled: true,
      value: 1.12,
    });
    expect(tags.find((tag) => tag.prompt === "plastic anime face")?.negative).toBe(true);
  });

  it("scales enabled weights by intensity", () => {
    const tags = createFaceTemplatePromptTags("real-human-face", 1.2);
    const skinTone = tags.find((tag) => tag.prompt === "multi-tone living skin");
    const proportions = tags.find((tag) => tag.prompt === "natural facial proportions");

    expect(skinTone?.weight).toEqual({ enabled: true, value: 1.39 });
    expect(proportions?.weight).toEqual({ enabled: false, value: 1 });
  });

  it("upserts existing head prompt tags instead of duplicating them", () => {
    const bodyParts = structuredClone(defaultCharacter.bodyParts);
    const head = bodyParts.find((bodyPart) => bodyPart.id === "head");

    head?.promptTags.push({
      id: "custom-multi-tone-skin",
      label: "Custom skin",
      prompt: "multi-tone living skin",
      category: "body-part",
      subcategory: "body-part-face",
      weight: { enabled: true, value: 0.9 },
    });

    const next = upsertFaceTemplateTagsOnHead(bodyParts, "real-human-face", 1.1);
    const nextHead = next.find((bodyPart) => bodyPart.id === "head");
    const skinToneTags =
      nextHead?.promptTags.filter((tag) => tag.prompt === "multi-tone living skin") ?? [];

    expect(skinToneTags).toHaveLength(1);
    expect(skinToneTags[0]).toMatchObject({
      id: "custom-multi-tone-skin",
      label: "Custom skin",
      weight: { enabled: true, value: 1.28 },
    });
  });

  it("keeps user-authored head tags when applying a template", () => {
    const bodyParts = structuredClone(defaultCharacter.bodyParts);
    const head = bodyParts.find((bodyPart) => bodyPart.id === "head");

    head?.promptTags.push({
      id: "custom-blue-eyes",
      label: "Blue eyes",
      prompt: "blue eyes",
      category: "body-part",
      subcategory: "body-part-eyes",
      weight: { enabled: false, value: 1 },
    });

    const next = upsertFaceTemplateTagsOnHead(bodyParts, "real-human-face", 1);
    const nextHead = next.find((bodyPart) => bodyPart.id === "head");

    expect(nextHead?.promptTags.some((tag) => tag.prompt === "blue eyes")).toBe(true);
    expect(nextHead?.promptTags.some((tag) => tag.prompt === "multi-tone living skin")).toBe(true);
  });

  it("removes only the selected template tags from the head", () => {
    const bodyParts = structuredClone(defaultCharacter.bodyParts);
    const withReal = upsertFaceTemplateTagsOnHead(bodyParts, "real-human-face", 1);
    const withBoth = upsertFaceTemplateTagsOnHead(withReal, "anime-handdrawn-face", 1);

    const next = removeFaceTemplateTagsFromHead(withBoth, "real-human-face");
    const nextHead = next.find((bodyPart) => bodyPart.id === "head");

    expect(nextHead?.promptTags.some((tag) => tag.prompt === "multi-tone living skin")).toBe(false);
    expect(nextHead?.promptTags.some((tag) => tag.prompt === "consistent anime eye shapes")).toBe(
      true,
    );
  });

  it("does not remove user-authored tags that only match a template prompt", () => {
    const bodyParts = structuredClone(defaultCharacter.bodyParts);
    const head = bodyParts.find((bodyPart) => bodyPart.id === "head");

    head?.promptTags.push({
      id: "custom-multi-tone-skin",
      label: "Custom skin",
      prompt: "multi-tone living skin",
      category: "body-part",
      subcategory: "body-part-face",
      weight: { enabled: true, value: 1.2 },
    });

    const next = removeFaceTemplateTagsFromHead(bodyParts, "real-human-face");
    const nextHead = next.find((bodyPart) => bodyPart.id === "head");

    expect(nextHead?.promptTags).toHaveLength(1);
    expect(nextHead?.promptTags[0]?.id).toBe("custom-multi-tone-skin");
  });

  it("reports which tags were added by a template application", () => {
    const bodyParts = structuredClone(defaultCharacter.bodyParts);
    const head = bodyParts.find((bodyPart) => bodyPart.id === "head");

    head?.promptTags.push({
      id: "custom-multi-tone-skin",
      label: "Custom skin",
      prompt: "multi-tone living skin",
      category: "body-part",
      subcategory: "body-part-face",
      weight: { enabled: true, value: 1 },
    });

    const result = applyFaceTemplateTagsToHead(bodyParts, "real-human-face", 1);

    expect(result.addedTagIds).not.toContain(
      "face-template-real-human-face-multi-tone-living-skin",
    );
    expect(result.addedTagIds).toContain(
      "face-template-real-human-face-natural-skin-microtexture",
    );
  });

  it("removes only tags added by the recorded template application", () => {
    const bodyParts = structuredClone(defaultCharacter.bodyParts);
    const head = bodyParts.find((bodyPart) => bodyPart.id === "head");

    head?.promptTags.push({
      id: "custom-multi-tone-skin",
      label: "Custom skin",
      prompt: "multi-tone living skin",
      category: "body-part",
      subcategory: "body-part-face",
      weight: { enabled: true, value: 1 },
    });

    const applied = applyFaceTemplateTagsToHead(bodyParts, "real-human-face", 1);
    const next = removeFaceTemplateApplicationFromHead(applied.bodyParts, applied.addedTagIds);
    const nextHead = next.find((bodyPart) => bodyPart.id === "head");

    expect(nextHead?.promptTags.some((tag) => tag.id === "custom-multi-tone-skin")).toBe(true);
    expect(nextHead?.promptTags.some((tag) => tag.prompt === "natural skin microtexture")).toBe(
      false,
    );
  });
});
