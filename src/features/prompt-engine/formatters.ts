import type { PromptModelFormat, PromptTag, PromptWeight } from "@/shared/types";

function normalizePrompt(prompt: string) {
  return prompt.trim().replace(/\s+/g, " ");
}

function formatWeightedPrompt(prompt: string, weight: PromptWeight, format: PromptModelFormat) {
  const normalizedPrompt = normalizePrompt(prompt);

  if (!weight.enabled || weight.value === 1) {
    return normalizedPrompt;
  }

  if (format === "stable-diffusion") {
    return `(${normalizedPrompt}:${weight.value})`;
  }

  if (format === "midjourney") {
    return `${normalizedPrompt}::${weight.value}`;
  }

  return `${normalizedPrompt} (${weight.value})`;
}

export function formatPromptTag(tag: PromptTag, format: PromptModelFormat) {
  return formatWeightedPrompt(tag.prompt, tag.weight, format);
}

export function formatPromptText(
  prompt: string,
  weight: PromptWeight,
  format: PromptModelFormat,
) {
  return formatWeightedPrompt(prompt, weight, format);
}
