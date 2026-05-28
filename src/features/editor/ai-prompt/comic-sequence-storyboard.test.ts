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
    expect(messages[0].content).not.toContain("Create exactly");
    expect(messages[1].content).toContain("\"targetShotCount\": \"auto\"");
  });

  it("builds target-count instructions when requested", () => {
    const messages = buildComicSequenceStoryboardMessages({
      story: "A chase across rooftops.",
      targetShotCount: 4,
    });

    expect(messages[0].content).toContain("Create exactly 4 shots.");
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
