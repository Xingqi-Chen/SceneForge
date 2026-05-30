import { describe, expect, it } from "vitest";

import { mergeDraftWithPromptRefresh } from "./comfyui-generation-draft";

describe("ComfyUI generation draft prompt refresh", () => {
  it("uses fresh prompts when no current draft exists yet", () => {
    const nextDraft = mergeDraftWithPromptRefresh({
      currentDraft: null,
      nextDraft: {
        cfg: 8,
        negativePrompt: "preset negative",
        positivePrompt: "preset positive",
      },
      nextPromptRefreshKey: "portrait",
      previousPromptRefreshKey: null,
    });

    expect(nextDraft).toEqual({
      cfg: 8,
      negativePrompt: "preset negative",
      positivePrompt: "preset positive",
    });
  });

  it("keeps manual prompt edits when the refresh key is unchanged", () => {
    const nextDraft = mergeDraftWithPromptRefresh({
      currentDraft: {
        cfg: 7,
        negativePrompt: "manual negative",
        positivePrompt: "manual positive",
      },
      nextDraft: {
        cfg: 8,
        negativePrompt: "preset negative",
        positivePrompt: "preset positive",
      },
      nextPromptRefreshKey: "portrait",
      previousPromptRefreshKey: "portrait",
    });

    expect(nextDraft).toEqual({
      cfg: 8,
      negativePrompt: "manual negative",
      positivePrompt: "manual positive",
    });
  });

  it("uses fresh prompts when the refresh key changes", () => {
    const nextDraft = mergeDraftWithPromptRefresh({
      currentDraft: {
        cfg: 7,
        negativePrompt: "manual negative",
        positivePrompt: "manual positive",
      },
      nextDraft: {
        cfg: 8,
        negativePrompt: "outdoor negative",
        positivePrompt: "outdoor positive",
      },
      nextPromptRefreshKey: "outdoor",
      previousPromptRefreshKey: "portrait",
    });

    expect(nextDraft).toEqual({
      cfg: 8,
      negativePrompt: "outdoor negative",
      positivePrompt: "outdoor positive",
    });
  });
});
