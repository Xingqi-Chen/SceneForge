import type { ParsedLoraWeight } from "./types";

export function parseCivitaiImageIdFromUrl(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!/(^|\.)civitai\.com$/i.test(url.hostname)) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const imagesIndex = parts.findIndex((part) => part.toLowerCase() === "images");
  const candidate = imagesIndex >= 0 ? parts[imagesIndex + 1] : null;
  if (!candidate || !/^\d+$/.test(candidate)) {
    return null;
  }

  return Number.parseInt(candidate, 10);
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
