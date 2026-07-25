import type { ParsedLoraWeight } from "./types";

const CIVITAI_IMAGE_PAGE_HOSTS = new Set([
  "civitai.com",
  "www.civitai.com",
  "civitai.red",
  "www.civitai.red",
]);

function parseCivitaiImageId(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const imageId = Number(value);
  return Number.isSafeInteger(imageId) && imageId > 0 ? imageId : null;
}

export function parseCivitaiImageIdFromUrl(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numericImageId = parseCivitaiImageId(trimmed);
  if (numericImageId !== null) {
    return numericImageId;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !CIVITAI_IMAGE_PAGE_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "images") {
    return null;
  }

  return parseCivitaiImageId(parts[1] ?? "");
}

export function parseLoraWeightsFromPrompt(prompt: string | null | undefined): ParsedLoraWeight[] {
  if (!prompt) {
    return [];
  }

  const results: ParsedLoraWeight[] = [];
  const pattern = /<\s*lora\s*:\s*([^:>]+?)\s*(?::\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prompt)) !== null) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }

    const parsedWeight = match[2] ? Number.parseFloat(match[2]) : Number.NaN;
    results.push({
      name,
      weight: Number.isFinite(parsedWeight) ? parsedWeight : null,
      raw: match[0],
    });
  }

  return results;
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function findPromptLoraWeight(
  promptWeights: ParsedLoraWeight[],
  resourceName: string | null,
): number | null {
  if (!resourceName) {
    return null;
  }

  const normalizedResourceName = normalizeName(resourceName);
  const match = promptWeights.find((entry) => normalizeName(entry.name) === normalizedResourceName);
  return match?.weight ?? null;
}

export function findTriggerWordsUsed(prompt: string | null, trainedWords: string[]): string[] {
  if (!prompt) {
    return [];
  }

  const normalizedPrompt = prompt.toLocaleLowerCase();
  const seen = new Set<string>();
  const used: string[] = [];

  for (const word of trainedWords) {
    const trimmed = word.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLocaleLowerCase();
    if (!seen.has(key) && normalizedPrompt.includes(key)) {
      seen.add(key);
      used.push(trimmed);
    }
  }

  return used;
}
