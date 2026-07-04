export const promptProfileIds = ["illustrious", "anima"] as const;

export type PromptProfileId = (typeof promptProfileIds)[number];

export const defaultPromptProfileId: PromptProfileId = "illustrious";

const promptProfileIdSet = new Set<string>(promptProfileIds);

export function isPromptProfileId(value: unknown): value is PromptProfileId {
  return typeof value === "string" && promptProfileIdSet.has(value);
}

export function normalizePromptProfileId(value: unknown): PromptProfileId {
  if (value === undefined || value === null || value === "") {
    return defaultPromptProfileId;
  }

  if (isPromptProfileId(value)) {
    return value;
  }

  throw new Error(`Invalid promptProfile "${String(value)}".`);
}

export function coercePromptProfileId(
  value: unknown,
  fallback: PromptProfileId = defaultPromptProfileId,
): PromptProfileId {
  return isPromptProfileId(value) ? value : fallback;
}

export function formatPromptProfileLabel(profile: PromptProfileId) {
  if (profile === "illustrious") {
    return "Illustrious";
  }

  return "Anima";
}
