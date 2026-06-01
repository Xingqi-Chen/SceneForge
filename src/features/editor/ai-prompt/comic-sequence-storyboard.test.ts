import { describe, expect, it } from "vitest";

import {
  buildComicSequenceStoryboardMessages,
  COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS,
  parseComicSequenceStoryboardResponse,
} from "./comic-sequence-storyboard";

describe("comic sequence storyboard AI helpers", () => {
  it("builds auto-count JSON-only storyboard instructions", () => {
    const messages = buildComicSequenceStoryboardMessages({
      existingShotCount: 2,
      globalPrompt: "anime action scene",
      negativePrompt: "low quality",
      story: "The hero draws a sword, leaps forward, and blocks a strike.",
    });

    expect(messages[0].content).toContain("Return JSON only");
    expect(messages[0].content).toContain("upper limit of 20");
    expect(messages[0].content).toContain("English booru-style local shot prompt");
    expect(messages[0].content).toContain("not natural-language sentences");
    expect(messages[0].content).toContain("dynamic pose");
    expect(messages[0].content).toContain("Do not connect separate words with underscores");
    expect(messages[0].content).toContain("preserve underscores only when they are part of a known canonical tag or exact source token");
    expect(messages[0].content).toContain("Include a short natural-language title for each shot when possible");
    expect(messages[0].content).toContain("The title is only for the UI");
    expect(messages[0].content).toContain("For shots with two or more active visible characters");
    expect(messages[0].content).toContain("Use character A and character B when two distinct people need disambiguation");
    expect(messages[0].content).toContain("Keep character labels consistent across shots");
    expect(messages[0].content).toContain("Clearly describe relative placement");
    expect(messages[0].content).toContain("Clearly describe interaction direction");
    expect(messages[0].content).toContain("Include the contact point or shared object");
    expect(messages[0].content).toContain("Include gaze relationship when relevant");
    expect(messages[0].content).toContain("Use many people or crowd for crowd shots instead of inventing an exact count");
    expect(messages[0].content).toContain("Do not invent character identities, extra characters, model resources, or off-screen events");
    expect(messages[0].content).not.toContain("Use underscores for multi-word");
    expect(messages[0].content).not.toContain("Create exactly");
    expect(messages[1].content).toContain("\"targetShotCount\": \"auto\"");
  });

  it("builds Anima storyboard instructions with natural-language visual phrases", () => {
    const messages = buildComicSequenceStoryboardMessages({
      promptProfile: "anima",
      story: "The hero draws a sword, leaps forward, and blocks a strike.",
      targetShotCount: 3,
    });

    expect(messages[0].content).toContain("English Anima local shot prompt");
    expect(messages[0].content).toContain("descriptive English anime-style visual phrases or short clauses");
    expect(messages[0].content).toContain("Prefer visible clauses over bare tags");
    expect(messages[0].content).toContain("immediate setting, lighting, atmosphere, camera, and composition");
    expect(messages[0].content).toContain("not full prose paragraphs");
    expect(messages[0].content).toContain("foreground/background relationship as descriptive visual clauses");
    expect(messages[0].content).toContain("distinct hairstyle and a distinct pose or action");
    expect(messages[0].content).toContain("character A with short black hair");
    expect(messages[0].content).toContain("low-angle action composition");
    expect(messages[0].content).not.toContain("English booru-style local shot prompt");
    expect(messages[0].content).not.toContain("not natural-language sentences");
    expect(messages[0].content).not.toContain("Rewrite them as tags like");
    expect(messages[1].content).toContain("\"targetShotCount\": 3");
  });

  it("builds target-count instructions when requested", () => {
    const messages = buildComicSequenceStoryboardMessages({
      story: "A chase across rooftops.",
      targetShotCount: 4,
    });

    expect(messages[0].content).toContain("Create exactly 4 shots.");
    expect(messages[0].content).not.toContain("Choose the natural number of shots");
    expect(messages[1].content).toContain("\"targetShotCount\": 4");
  });

  it("parses plain JSON storyboard responses", () => {
    const parsed = parseComicSequenceStoryboardResponse(
      JSON.stringify({
        shots: [
          { title: "Opening", prompt: "wide shot, hero entering the alley" },
          { prompt: "close-up, hand gripping the sword" },
        ],
      }),
      { existingShotCount: 3 },
    );

    expect(parsed.shots).toEqual([
      { title: "Opening", prompt: "wide shot, hero entering the alley" },
      { title: "Shot 5", prompt: "close-up, hand gripping the sword" },
    ]);
  });

  it("parses fenced JSON and drops empty prompts", () => {
    const parsed = parseComicSequenceStoryboardResponse(
      [
        "```json",
        JSON.stringify({
          shots: [
            { title: "Empty", prompt: "  " },
            { prompt: "low angle, impact pose, debris flying" },
          ],
        }),
        "```",
      ].join("\n"),
      { existingShotCount: 2 },
    );

    expect(parsed.shots).toEqual([
      { title: "Shot 3", prompt: "low angle, impact pose, debris flying" },
    ]);
  });

  it("limits generated shots", () => {
    const parsed = parseComicSequenceStoryboardResponse(
      JSON.stringify({
        shots: Array.from({ length: COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS + 5 }, (_, index) => ({
          prompt: `shot prompt ${index + 1}`,
        })),
      }),
    );

    expect(parsed.shots).toHaveLength(COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS);
  });
});
