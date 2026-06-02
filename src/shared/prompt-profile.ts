export const promptProfileIds = ["illustrious", "anima", "generic"] as const;

export type PromptProfileId = (typeof promptProfileIds)[number];

export const defaultPromptProfileId: PromptProfileId = "illustrious";

const promptProfileIdSet = new Set<string>(promptProfileIds);

export function isPromptProfileId(value: unknown): value is PromptProfileId {
  return typeof value === "string" && promptProfileIdSet.has(value);
}

export function normalizePromptProfileId(value: unknown): PromptProfileId {
  return isPromptProfileId(value) ? value : defaultPromptProfileId;
}

export function formatPromptProfileLabel(profile: PromptProfileId) {
  if (profile === "illustrious") {
    return "Illustrious";
  }

  if (profile === "anima") {
    return "Anima";
  }

  return "Generic";
}
