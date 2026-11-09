import type { PromptProfileId } from "@/shared/prompt-profile";

export function normalizeCivitaiBaseModel(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase() ?? "";
  return isKrea2CivitaiBaseModel(normalized) ? "krea2" : normalized;
}

export function isSameCivitaiBaseModel(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeCivitaiBaseModel(left);
  const normalizedRight = normalizeCivitaiBaseModel(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isAnimaCivitaiBaseModel(value: string | null | undefined) {
  return normalizeCivitaiBaseModel(value) === "anima";
}

export function isKrea2CivitaiBaseModel(value: string | null | undefined) {
  // Compatibility aliases only; unknown future suffixes or generations stay separate.
  return /^krea[\s_-]*2(?:[\s_-]*turbo)?$/i.test((value ?? "").trim());
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

  if (promptProfile === "krea2") {
    return isKrea2CivitaiBaseModel(baseModel);
  }

  return false;
}
