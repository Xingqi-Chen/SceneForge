import type { PromptProfileId } from "@/shared/prompt-profile";

export function normalizeCivitaiBaseModel(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function isSameCivitaiBaseModel(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeCivitaiBaseModel(left);
  const normalizedRight = normalizeCivitaiBaseModel(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isAnimaCivitaiBaseModel(value: string | null | undefined) {
  return normalizeCivitaiBaseModel(value) === "anima";
}

export function isCivitaiBaseModelCompatibleWithPromptProfile(
  baseModel: string | null | undefined,
  promptProfile: PromptProfileId,
) {
  const normalized = normalizeCivitaiBaseModel(baseModel);

  if (promptProfile === "illustrious") {
    return normalized.includes("illustrious");
  }

  if (promptProfile === "anima") {
    return normalized === "anima";
  }

  return !normalized || (!normalized.includes("illustrious") && normalized !== "anima");
}
