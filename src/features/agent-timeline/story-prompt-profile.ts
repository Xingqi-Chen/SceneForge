/**
 * Story rendering currently supports only the established tag/prose profiles.
 * Keep this boundary separate from Run so adding a direct-only Run profile
 * cannot silently enter Story's multi-shot/img2img execution path.
 */
export const storyPromptProfileIds = ["illustrious", "anima"] as const;

export type StoryPromptProfileId = typeof storyPromptProfileIds[number];

export function isStoryPromptProfileId(value: unknown): value is StoryPromptProfileId {
  return value === "illustrious" || value === "anima";
}

export function coerceStoryPromptProfileId(
  value: unknown,
  fallback: StoryPromptProfileId = "illustrious",
): StoryPromptProfileId {
  if (isStoryPromptProfileId(value)) {
    return value;
  }

  return isStoryPromptProfileId(fallback) ? fallback : "illustrious";
}
