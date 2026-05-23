import type {
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

import type { CivitaiAiPromptResult } from "./civitai-ai-context";

export type ComfyUiGenerationParameterSource = "ai" | "reference" | "diagnosis";

export type ComfyUiGenerationLoraSetting = {
  resource: SelectedCivitaiResourcePreview;
  loraName: string;
  strengthModel: number;
  strengthClip: number;
  source: ComfyUiGenerationParameterSource;
};

export type ComfyUiGenerationSettings = {
  request: ComfyUiTextToImageRequest;
  checkpoint: SelectedCivitaiResourcePreview | null;
  loras: ComfyUiGenerationLoraSetting[];
  parameterSource: ComfyUiGenerationParameterSource;
  negativePromptAdditions: string;
};

type ParsedLoraWeight = {
  name: string;
  weight: number;
};

type ParsedAiGenerationParameters = {
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
  negativePromptAdditions?: string;
  loraWeights: ParsedLoraWeight[];
};

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const DEFAULT_STEPS = 30;
const DEFAULT_CFG = 7;
const DEFAULT_SAMPLER = "euler";
const DEFAULT_SCHEDULER = "normal";
const DEFAULT_DENOISE = 1;
const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_OUTPUT_PREFIX = "SceneForge";
const DEFAULT_LORA_WEIGHT = 0.7;
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 16384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function parseNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parsed = parseNumericValue(record[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function parseResolution(value: unknown): Pick<ParsedAiGenerationParameters, "width" | "height"> {
  if (typeof value === "string") {
    const match = value.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
    if (match) {
      return {
        width: Number(match[1]),
        height: Number(match[2]),
      };
    }
  }

  if (isRecord(value)) {
    return {
      width: readNumber(value, ["width", "w"]),
      height: readNumber(value, ["height", "h"]),
    };
  }

  return {};
}

function normalizeWeightName(value: string) {
  return value.trim().toLowerCase();
}

function parseLoraWeights(value: unknown): ParsedLoraWeight[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const name = readString(entry, ["name", "loraName", "resourceName"]);
    const weight = readNumber(entry, ["suggestedWeight", "weight", "strengthModel", "strength"]);
    if (!name || weight === undefined) {
      return [];
    }

    return [{ name, weight }];
  });
}

export function parseComfyUiAiGenerationParameters(
  parameterSuggestions: unknown,
): ParsedAiGenerationParameters | null {
  if (!isRecord(parameterSuggestions)) {
    return null;
  }

  const resolution = parseResolution(parameterSuggestions.resolution);
  return {
    width: readNumber(parameterSuggestions, ["width", "imageWidth"]) ?? resolution.width,
    height: readNumber(parameterSuggestions, ["height", "imageHeight"]) ?? resolution.height,
    seed: readNumber(parameterSuggestions, ["seed"]),
    steps: readNumber(parameterSuggestions, ["steps"]),
    cfg: readNumber(parameterSuggestions, ["cfg", "cfgScale", "cfg_scale"]),
    samplerName: readString(parameterSuggestions, ["samplerName", "sampler"]),
    scheduler: readString(parameterSuggestions, ["scheduler"]),
    denoise: readNumber(parameterSuggestions, ["denoise"]),
    negativePromptAdditions: readString(parameterSuggestions, ["negativePromptAdditions", "negativePrompt"]),
    loraWeights: parseLoraWeights(parameterSuggestions.loraWeights),
  };
}

function findAiLoraWeight(resource: SelectedCivitaiResourcePreview, weights: ParsedLoraWeight[]) {
  const resourceNames = [
    resource.name,
    resource.versionName,
    resource.modelFileName,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeWeightName);

  return weights.find((weight) => {
    const weightName = normalizeWeightName(weight.name);
    return resourceNames.some(
      (resourceName) => resourceName === weightName || resourceName.includes(weightName) || weightName.includes(resourceName),
    );
  });
}

function getReferenceLoraWeight(resource: SelectedCivitaiResourcePreview) {
  const recommended = resource.recommendations.find((recommendation) => recommendation.loraWeight !== null);
  if (recommended?.loraWeight !== null && recommended?.loraWeight !== undefined) {
    return recommended.loraWeight;
  }

  if (resource.averageWeight !== null) {
    return resource.averageWeight;
  }

  const ranged = resource.recommendations.find(
    (recommendation) => recommendation.loraWeightMin !== null && recommendation.loraWeightMax !== null,
  );
  if (ranged?.loraWeightMin !== null && ranged?.loraWeightMax !== null && ranged) {
    return Number(((ranged.loraWeightMin + ranged.loraWeightMax) / 2).toFixed(2));
  }

  return DEFAULT_LORA_WEIGHT;
}

function clampWeight(value: number) {
  return Math.min(2, Math.max(-2, Number(value.toFixed(2))));
}

function sanitizeComfyUiDimension(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value / 8) * 8));
}

function makeNegativePrompt(baseNegativePrompt: string, additions: string | undefined) {
  const parts = [baseNegativePrompt.trim(), additions?.trim()].filter(Boolean);
  return Array.from(new Set(parts)).join(", ");
}

export function resolveComfyUiGenerationSettings(input: {
  activePrompt: string;
  baseNegativePrompt: string;
  selectedResources: SelectedCivitaiResourcesPreview;
  aiAdvice: CivitaiAiPromptResult | null;
}): ComfyUiGenerationSettings {
  const parsedAi = parseComfyUiAiGenerationParameters(input.aiAdvice?.parameterSuggestions ?? null);
  const parameterSource: ComfyUiGenerationParameterSource = parsedAi ? "ai" : "reference";
  const checkpoint = input.selectedResources.checkpoint;
  const loras = input.selectedResources.loras.map((resource) => {
    const aiWeight = parsedAi ? findAiLoraWeight(resource, parsedAi.loraWeights) : undefined;
    const strengthModel = clampWeight(aiWeight?.weight ?? getReferenceLoraWeight(resource));

    return {
      resource,
      loraName: resource.modelFileName,
      strengthModel,
      strengthClip: strengthModel,
      source: aiWeight ? "ai" as const : "reference" as const,
    };
  });
  const request: ComfyUiTextToImageRequest = {
    checkpointName: checkpoint?.modelFileName ?? "",
    positivePrompt: input.activePrompt.trim(),
    negativePrompt: makeNegativePrompt(input.baseNegativePrompt, parsedAi?.negativePromptAdditions),
    loras: loras.map((lora) => ({
      loraName: lora.loraName,
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip,
    })),
    width: sanitizeComfyUiDimension(parsedAi?.width) ?? DEFAULT_WIDTH,
    height: sanitizeComfyUiDimension(parsedAi?.height) ?? DEFAULT_HEIGHT,
    seed: parsedAi?.seed !== undefined && Number.isSafeInteger(parsedAi.seed) && parsedAi.seed >= 0 ? parsedAi.seed : undefined,
    steps: parsedAi?.steps && Number.isInteger(parsedAi.steps) && parsedAi.steps > 0 ? parsedAi.steps : DEFAULT_STEPS,
    cfg: parsedAi?.cfg ?? DEFAULT_CFG,
    samplerName: parsedAi?.samplerName ?? DEFAULT_SAMPLER,
    scheduler: parsedAi?.scheduler ?? DEFAULT_SCHEDULER,
    denoise: parsedAi?.denoise !== undefined && parsedAi.denoise >= 0 && parsedAi.denoise <= 1 ? parsedAi.denoise : DEFAULT_DENOISE,
    batchSize: DEFAULT_BATCH_SIZE,
    outputPrefix: DEFAULT_OUTPUT_PREFIX,
  };

  return {
    request,
    checkpoint,
    loras,
    parameterSource,
    negativePromptAdditions: parsedAi?.negativePromptAdditions ?? "",
  };
}
