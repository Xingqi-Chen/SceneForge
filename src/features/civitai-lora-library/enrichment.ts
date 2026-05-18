import { createLiteLlmClient, type LlmChatMessage } from "@/features/llm";

import { classifyCivitaiLora } from "./classification";
import type {
  CivitaiAiNsfwLevel,
  CivitaiEnrichmentStatus,
  CivitaiLoraCategory,
  CivitaiResourceRecommendation,
  CivitaiResourceUpsertInput,
} from "./types";

const CIVITAI_LORA_CATEGORIES: CivitaiLoraCategory[] = [
  "character",
  "style",
  "clothing",
  "pose",
  "scene",
  "lighting",
  "detail",
  "other",
];

const CATEGORY_SET = new Set<CivitaiLoraCategory>(CIVITAI_LORA_CATEGORIES);
const AI_NSFW_LEVELS: CivitaiAiNsfwLevel[] = ["sfw", "suggestive", "mature", "explicit", "unknown"];
const AI_NSFW_LEVEL_SET = new Set<CivitaiAiNsfwLevel>(AI_NSFW_LEVELS);
const MAX_DESCRIPTION_CHARS = 6000;
const MAX_ERROR_CHARS = 240;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  if (fence?.[1]) {
    return fence[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const isPercent = trimmed.endsWith("%");
    const normalized = trimmed.replace(/%$/, "");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return isPercent ? parsed / 100 : parsed;
  }

  return null;
}

function clamp01(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeAiNsfwLevel(value: unknown): CivitaiAiNsfwLevel {
  const normalized = asTrimmedString(value)?.toLocaleLowerCase();
  return normalized && AI_NSFW_LEVEL_SET.has(normalized as CivitaiAiNsfwLevel)
    ? (normalized as CivitaiAiNsfwLevel)
    : "unknown";
}

function parseNumberRange(value: unknown): { min: number | null; max: number | null } {
  if (typeof value !== "string") {
    const number = asFiniteNumber(value);
    return { min: number, max: number };
  }

  const match = /(-?\d+(?:\.\d+)?)\s*(?:-|~|to|到|至)\s*(-?\d+(?:\.\d+)?)/i.exec(value);
  if (!match?.[1] || !match[2]) {
    const number = asFiniteNumber(value);
    return { min: number, max: number };
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return { min: null, max: null };
  }

  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}

function truncateForPrompt(value: string | null, max: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function normalizeCategories(value: unknown, fallbackCategories: CivitaiLoraCategory[]): CivitaiLoraCategory[] {
  const rawCategories = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<CivitaiLoraCategory>();
  const categories: CivitaiLoraCategory[] = [];

  for (const raw of rawCategories) {
    const normalized = asTrimmedString(raw)?.toLocaleLowerCase();
    if (!normalized || !CATEGORY_SET.has(normalized as CivitaiLoraCategory)) {
      continue;
    }

    const category = normalized as CivitaiLoraCategory;
    if (!seen.has(category)) {
      seen.add(category);
      categories.push(category);
    }
  }

  return categories.length > 0 ? categories : fallbackCategories;
}

export function mergeCivitaiTriggerWords(existing: string[], extracted: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const word of [...existing, ...extracted]) {
    const normalized = normalizeTriggerWordToken(word);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

function normalizeTriggerWordToken(value: string) {
  return value
    .trim()
    .replace(/^[,，;；\s]+/, "")
    .replace(/[,，;；\s]+$/, "")
    .trim();
}

function normalizeTriggerWords(value: unknown): string[] {
  const rawWords = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const words: string[] = [];

  for (const raw of rawWords) {
    const text = asTrimmedString(raw);
    if (!text) {
      continue;
    }

    const parts = text
      .split(/[,，\n;]/)
      .map((part) => part.trim())
      .filter(Boolean);
    words.push(...parts);
  }

  return mergeCivitaiTriggerWords([], words);
}

function normalizeRecommendation(value: unknown): CivitaiResourceRecommendation | null {
  if (!isRecord(value)) {
    return null;
  }

  const loraWeightRange = parseNumberRange(value.loraWeight);
  const explicitMin = asFiniteNumber(value.loraWeightMin);
  const explicitMax = asFiniteNumber(value.loraWeightMax);
  const loraWeightMin = explicitMin ?? (loraWeightRange.min !== loraWeightRange.max ? loraWeightRange.min : null);
  const loraWeightMax = explicitMax ?? (loraWeightRange.min !== loraWeightRange.max ? loraWeightRange.max : null);
  const loraWeight = asFiniteNumber(value.loraWeight) ?? (loraWeightMin === loraWeightMax ? loraWeightMin : null);
  const min = loraWeightMin !== null && loraWeightMax !== null ? Math.min(loraWeightMin, loraWeightMax) : loraWeightMin;
  const max = loraWeightMin !== null && loraWeightMax !== null ? Math.max(loraWeightMin, loraWeightMax) : loraWeightMax;

  const recommendation: CivitaiResourceRecommendation = {
    condition: asTrimmedString(value.condition),
    baseModel: asTrimmedString(value.baseModel),
    checkpoint: asTrimmedString(value.checkpoint),
    sampler: asTrimmedString(value.sampler),
    loraWeightMin: min,
    loraWeightMax: max,
    loraWeight,
    hdRedrawRate: asFiniteNumber(value.hdRedrawRate),
    notes: asTrimmedString(value.notes),
  };

  if (
    !recommendation.condition &&
    !recommendation.baseModel &&
    !recommendation.checkpoint &&
    !recommendation.sampler &&
    recommendation.loraWeightMin === null &&
    recommendation.loraWeightMax === null &&
    recommendation.loraWeight === null &&
    recommendation.hdRedrawRate === null &&
    !recommendation.notes
  ) {
    return null;
  }

  return recommendation;
}

function normalizeRecommendations(value: unknown): CivitaiResourceRecommendation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeRecommendation)
    .filter((item): item is CivitaiResourceRecommendation => Boolean(item));
}

function getFallbackCategories(input: Pick<CivitaiResourceUpsertInput, "resourceType" | "name" | "tags" | "description">): CivitaiLoraCategory[] {
  if (input.resourceType === "lora") {
    return [classifyCivitaiLora({ name: input.name, tags: input.tags, description: input.description })];
  }

  const haystack = [input.name, ...(input.tags ?? []), input.description ?? ""].join(" ").toLocaleLowerCase();
  if (haystack.includes("style") || haystack.includes("anime") || haystack.includes("realistic")) {
    return ["style"];
  }

  return ["other"];
}

export type ParsedCivitaiResourceEnrichment = {
  usageGuide: string | null;
  categories: CivitaiLoraCategory[];
  triggerWords: string[];
  recommendations: CivitaiResourceRecommendation[];
  aiNsfwLevel: CivitaiAiNsfwLevel;
  aiNsfwConfidence: number | null;
  aiNsfwReason: string | null;
};

export type CivitaiResourceEnrichmentResult = ParsedCivitaiResourceEnrichment & {
  status: CivitaiEnrichmentStatus;
  error: string | null;
};

export function parseCivitaiResourceEnrichmentContent(
  content: string,
  fallbackCategories: CivitaiLoraCategory[],
): ParsedCivitaiResourceEnrichment {
  const jsonText = extractJsonPayload(content);
  const parsed = JSON.parse(jsonText) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("LLM response JSON must be an object.");
  }

  return {
    usageGuide: asTrimmedString(parsed.usageGuide),
    categories: normalizeCategories(parsed.categories, fallbackCategories),
    triggerWords: normalizeTriggerWords(parsed.triggerWords),
    recommendations: normalizeRecommendations(parsed.recommendations),
    aiNsfwLevel: normalizeAiNsfwLevel(parsed.aiNsfwLevel),
    aiNsfwConfidence: clamp01(asFiniteNumber(parsed.aiNsfwConfidence)),
    aiNsfwReason: asTrimmedString(parsed.aiNsfwReason),
  };
}

export function buildCivitaiResourceEnrichmentMessages(
  input: CivitaiResourceUpsertInput,
): LlmChatMessage[] {
  const payload = {
    resourceType: input.resourceType,
    name: input.name,
    versionName: input.versionName,
    baseModel: input.baseModel,
    tags: input.tags,
    trainedWords: input.trainedWords,
    description: truncateForPrompt(input.description, MAX_DESCRIPTION_CHARS),
    creator: input.creator,
    civitaiModelId: input.civitaiModelId,
    civitaiModelVersionId: input.civitaiModelVersionId,
    civitaiNsfw: input.nsfw,
  };

  return [
    {
      role: "system",
      content: [
        "You enrich Civitai LoRA/checkpoint metadata for a local image-generation model library.",
        "Read the Civitai description carefully. It may include noisy prose, links, sampler-specific notes, trigger words, LORA weight ranges, HD redraw rates, and model/checkpoint combinations.",
        "Recommendations must come only from Civitai model/version metadata and description. Do NOT infer recommendations from a source image prompt, sampler, or one-off usage example.",
        "Extract only information supported by the input. Do not invent exact numbers.",
        "Return JSON ONLY. No markdown fences, no commentary.",
        "Use Chinese for usageGuide and notes unless a model/sampler/token name is being preserved.",
        `categories must be one or more of: ${CIVITAI_LORA_CATEGORIES.join(", ")}.`,
        `aiNsfwLevel must be one of: ${AI_NSFW_LEVELS.join(", ")}. Judge from the model/version description, tags, name, and Civitai nsfw flag. Use unknown when evidence is weak.`,
        "aiNsfwConfidence is a number from 0 to 1. aiNsfwReason must be a short Chinese explanation, or null if unknown.",
        "recommendations is an array. Create separate entries when the description gives different advice for different samplers, checkpoints, base models, or conditions.",
        "Use null for unknown fields. Use loraWeightMin/loraWeightMax for ranges like 0.8-0.9. Use loraWeight for a single value.",
        "Expected shape:",
        '{"usageGuide":"适合...","categories":["style"],"triggerWords":["token"],"aiNsfwLevel":"sfw","aiNsfwConfidence":0.8,"aiNsfwReason":"说明文字未出现成人内容。","recommendations":[{"condition":"...","baseModel":null,"checkpoint":null,"sampler":"DPM++ 2M","loraWeightMin":0.8,"loraWeightMax":0.9,"loraWeight":null,"hdRedrawRate":0.42,"notes":"..."}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(payload),
    },
  ];
}

function fallbackEnrichment(
  input: CivitaiResourceUpsertInput,
  status: CivitaiEnrichmentStatus,
  error: string | null,
): CivitaiResourceEnrichmentResult {
  return {
    usageGuide: null,
    categories: getFallbackCategories(input),
    triggerWords: [],
    recommendations: [],
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    status,
    error,
  };
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}...` : message;
}

export async function enrichCivitaiResource(
  input: CivitaiResourceUpsertInput,
): Promise<CivitaiResourceEnrichmentResult> {
  const fallbackCategories = getFallbackCategories(input);

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel: process.env.LITELLM_DEFAULT_MODEL,
    });
    const completion = await client.completeChat({
      purpose: "civitai-resource-enrichment",
      messages: buildCivitaiResourceEnrichmentMessages(input),
      temperature: 0,
      maxTokens: 900,
    });
    const enrichment = parseCivitaiResourceEnrichmentContent(completion.content, fallbackCategories);

    return {
      ...enrichment,
      status: "ai_enriched",
      error: null,
    };
  } catch (error) {
    return fallbackEnrichment(input, "ai_failed", summarizeError(error));
  }
}

export function applyCivitaiEnrichment(
  input: CivitaiResourceUpsertInput,
  enrichment: CivitaiResourceEnrichmentResult,
): CivitaiResourceUpsertInput {
  const trainedWords = mergeCivitaiTriggerWords(input.trainedWords, enrichment.triggerWords);
  const categories = enrichment.categories.length > 0 ? enrichment.categories : getFallbackCategories(input);

  return {
    ...input,
    trainedWords,
    category: categories[0] ?? "other",
    categories,
    usageGuide: enrichment.usageGuide,
    recommendations: enrichment.recommendations,
    enrichmentStatus: enrichment.status,
    enrichmentError: enrichment.error,
    aiNsfwLevel: enrichment.aiNsfwLevel,
    aiNsfwConfidence: enrichment.aiNsfwConfidence,
    aiNsfwReason: enrichment.aiNsfwReason,
  };
}
