import { describe, expect, it } from "vitest";

import {
  coerceStoryPromptProfileId,
  isStoryPromptProfileId,
  storyPromptProfileIds,
} from "./story-prompt-profile";

describe("Story prompt-profile boundary", () => {
  it("excludes Run-only Krea and safely falls legacy Story values back to Illustrious", () => {
    expect(storyPromptProfileIds).toEqual(["illustrious", "anima"]);
    expect(isStoryPromptProfileId("krea2")).toBe(false);
    expect(coerceStoryPromptProfileId("anima")).toBe("anima");
    expect(coerceStoryPromptProfileId("krea2")).toBe("illustrious");
    expect(coerceStoryPromptProfileId("generic", "anima")).toBe("anima");
  });
});
