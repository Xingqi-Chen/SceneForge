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
