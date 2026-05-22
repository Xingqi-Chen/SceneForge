import type {
  CivitaiResourceRecommendation,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";

export type CivitaiAiPromptResult = {
  prompt: string;
  parameterSuggestions: unknown | null;
  parameterSuggestionReason: string;
  overallEffect: string;
  parseWarning: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinList(values: string[]) {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  return cleanValues.length > 0 ? cleanValues.join(", ") : "none";
}

function formatNullable(label: string, value: string | number | null) {
  if (value === null || value === "") {
    return null;
  }

  return `- ${label}: ${value}`;
}

function formatWeightRange(resource: SelectedCivitaiResourcePreview) {
  const weights = [
    resource.averageWeight !== null ? `average=${resource.averageWeight}` : null,
    resource.minWeight !== null ? `min=${resource.minWeight}` : null,
    resource.maxWeight !== null ? `max=${resource.maxWeight}` : null,
  ].filter(Boolean);

  return weights.length > 0 ? `- observedWeight: ${weights.join(", ")}` : null;
}

function formatRecommendation(recommendation: CivitaiResourceRecommendation) {
  const parts = [
    recommendation.condition ? `condition=${recommendation.condition}` : null,
    recommendation.baseModel ? `baseModel=${recommendation.baseModel}` : null,
    recommendation.checkpoint ? `checkpoint=${recommendation.checkpoint}` : null,
    recommendation.sampler ? `sampler=${recommendation.sampler}` : null,
    recommendation.loraWeight !== null ? `loraWeight=${recommendation.loraWeight}` : null,
    recommendation.loraWeightMin !== null ? `loraWeightMin=${recommendation.loraWeightMin}` : null,
    recommendation.loraWeightMax !== null ? `loraWeightMax=${recommendation.loraWeightMax}` : null,
    recommendation.hdRedrawRate !== null ? `hdRedrawRate=${recommendation.hdRedrawRate}` : null,
    recommendation.notes ? `notes=${recommendation.notes}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "no details";
}

function formatResourceForAi(resource: SelectedCivitaiResourcePreview, label: string) {
  return [
    `${label}:`,
    `- name: ${resource.name}`,
    formatNullable("versionName", resource.versionName),
    formatNullable("baseModel", resource.baseModel),
    formatNullable("creator", resource.creator),
    `- trainedWords: ${joinList(resource.trainedWords)}`,
    `- tags: ${joinList(resource.tags)}`,
    `- categories: ${joinList(resource.categories)}`,
    formatWeightRange(resource),
    resource.usageGuide ? `- usageGuide: ${resource.usageGuide}` : null,
    resource.descriptionSnippet ? `- description: ${resource.descriptionSnippet}` : null,
    resource.recommendations.length > 0
      ? `- parameterRecommendations: ${resource.recommendations.map(formatRecommendation).join(" | ")}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function selectedCivitaiResourceCards(resources: SelectedCivitaiResourcesPreview) {
  return [
    ...(resources.checkpoint ? [resources.checkpoint] : []),
    ...resources.loras,
  ];
}

export function hasSelectedCivitaiResources(resources: SelectedCivitaiResourcesPreview) {
  return selectedCivitaiResourceCards(resources).length > 0;
}

export function formatSelectedCivitaiResourcesForAi(resources: SelectedCivitaiResourcesPreview) {
  const sections = [
    resources.checkpoint ? formatResourceForAi(resources.checkpoint, "Checkpoint") : null,
    ...resources.loras.map((resource, index) => formatResourceForAi(resource, `LoRA ${index + 1}`)),
  ].filter((section): section is string => section !== null);

  return sections.length > 0 ? sections.join("\n\n") : null;
}

export function buildCivitaiAiJsonResponseInstructions() {
  return [
    "Return JSON only. Do not wrap it in markdown.",
    "Shape: { \"prompt\": string, \"parameterSuggestions\": { \"checkpoint\"?: string, \"sampler\"?: string, \"steps\"?: number|string, \"cfgScale\"?: number|string, \"resolution\"?: string, \"negativePromptAdditions\"?: string, \"loraWeights\": [{ \"name\": string, \"suggestedWeight\": number|string, \"reason\"?: string }] }|string|null, \"parameterSuggestionReason\": string, \"overallEffect\": string }.",
    "Use selected Civitai resources as model-specific context.",
    "overallEffect and parameterSuggestionReason must be written in Simplified Chinese.",
    "overallEffect must describe the visual style/effect expected from the selected checkpoint + LoRA combination: rendering style, texture, lighting tendency, detail level, color mood, realism/anime bias, and possible tradeoffs.",
    "overallEffect must not describe the current image subject, pose, action, composition, or scene contents.",
    "parameterSuggestionReason must be one or two user-facing Chinese sentences explaining why the suggested sampler, steps, CFG, resolution, and LoRA weights fit this checkpoint + LoRA combination.",
    "When any LoRA is selected, parameterSuggestions must include loraWeights with one item for every selected LoRA, preserving each LoRA's name and giving a suggestedWeight.",
    "For each LoRA suggestedWeight, prefer Civitai recommended or observed weights when available; otherwise choose a conservative value and explain it in the per-LoRA reason.",
    "You may include useful LoRA trigger words from trainedWords, but do not force every trigger word into the prompt.",
    "Do not invent trigger words that are not listed in the selected Civitai resources.",
    "Do not generate <lora:...> syntax unless it already appears in the prompt preview.",
  ].join("\n");
}

function parseJsonCandidate(rawContent: string) {
  const trimmed = rawContent.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Continue to fenced JSON fallback.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) {
    return null;
  }

  try {
    return JSON.parse(fenced[1].trim()) as unknown;
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeParameterSuggestions(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() ? value.trim() : null;
  }

  if (typeof value === "number" || typeof value === "boolean" || Array.isArray(value) || isRecord(value)) {
    return value;
  }

  return null;
}

export function parseCivitaiAiPromptResponse(rawContent: string): CivitaiAiPromptResult {
  const parsed = parseJsonCandidate(rawContent);

  if (!isRecord(parsed)) {
    return {
      prompt: rawContent.trim(),
      parameterSuggestions: null,
      parameterSuggestionReason: "",
      overallEffect: "",
      parseWarning: "未解析到参数建议，已将 AI 原文写入 Prompt。",
    };
  }

  const prompt = normalizeOptionalText(parsed.prompt);
  if (!prompt) {
    return {
      prompt: rawContent.trim(),
      parameterSuggestions: null,
      parameterSuggestionReason: "",
      overallEffect: "",
      parseWarning: "AI 返回的 JSON 缺少 prompt 字段，已将原文写入 Prompt。",
    };
  }

  return {
    prompt,
    parameterSuggestions: normalizeParameterSuggestions(parsed.parameterSuggestions),
    parameterSuggestionReason: normalizeOptionalText(parsed.parameterSuggestionReason),
    overallEffect: normalizeOptionalText(parsed.overallEffect),
    parseWarning: null,
  };
}
