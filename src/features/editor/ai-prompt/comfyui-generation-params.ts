import type {
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import {
  COMFYUI_FACE_DETAILER_DEFAULTS,
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_LATENT_IMAGE_NODE,
  normalizeComfyUiLatentImageNode,
  resolveComfyUiTextToImageWorkflowProfile,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
import type { SavedComfyUiGenerationParams } from "@/shared/types";

import type { CivitaiAiPromptResult } from "./civitai-ai-context";
import { normalizeComfyUiSamplerSettings } from "./comfyui-generation-options";
import {
  isAnimaPromptContext,
  mergeAnimaNegativePrompts,
  renderAnimaPromptForContext,
} from "./anima-prompt";

export type ComfyUiGenerationParameterSource = "ai" | "reference" | "diagnosis" | "saved";

export type ComfyUiGenerationLoraSetting = {
  enabled: boolean;
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
const SD3_LATENT_MODEL_PATTERN = /\b(?:sd\s*3(?:\.\d+)?|stable\s+diffusion\s+3(?:\.\d+)?|flux(?:\s*1)?|qwen(?:\s+image)?|z\s+image|lumina)\b/i;

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
  const samplerSettings = normalizeComfyUiSamplerSettings({
    samplerName: readString(parameterSuggestions, ["samplerName", "sampler"]),
    scheduler: readString(parameterSuggestions, ["scheduler"]),
  });

  return {
    width: readNumber(parameterSuggestions, ["width", "imageWidth"]) ?? resolution.width,
    height: readNumber(parameterSuggestions, ["height", "imageHeight"]) ?? resolution.height,
    seed: readNumber(parameterSuggestions, ["seed"]),
    steps: readNumber(parameterSuggestions, ["steps"]),
    cfg: readNumber(parameterSuggestions, ["cfg", "cfgScale", "cfg_scale"]),
    samplerName: samplerSettings.samplerName,
    scheduler: samplerSettings.scheduler,
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

function sanitizePositiveInteger(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.round(value);
}

function sanitizeFiniteNumber(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? undefined : value;
}

function sanitizeDenoise(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
    return undefined;
  }

  return value;
}

function sanitizeSeed(value: number | undefined) {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function savedLoraByName(savedParameters: SavedComfyUiGenerationParams | null | undefined) {
  return new Map((savedParameters?.loras ?? []).map((lora) => [normalizeWeightName(lora.loraName), lora]));
}

function getResourceModelFamilyText(resource: SelectedCivitaiResourcePreview | null) {
  if (!resource) {
    return "";
  }

  return [
    resource.baseModel,
    resource.name,
    resource.versionName,
    resource.modelFileName,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .replace(/[_-]+/g, " ");
}

function inferLatentImageNode(
  checkpoint: SelectedCivitaiResourcePreview | null,
  savedParameters: SavedComfyUiGenerationParams | null,
) {
  const savedLatentImageNode = normalizeComfyUiLatentImageNode(savedParameters?.latentImageNode);
  if (savedLatentImageNode) {
    return savedLatentImageNode;
  }

  return SD3_LATENT_MODEL_PATTERN.test(getResourceModelFamilyText(checkpoint))
    ? "EmptySD3LatentImage"
    : DEFAULT_COMFYUI_LATENT_IMAGE_NODE;
}

function resolveSavedPromptWrapper(savedParameters: SavedComfyUiGenerationParams | null) {
  return {
    positivePrefix: savedParameters?.promptWrapper?.positivePrefix ?? "",
    negativePrefix: savedParameters?.promptWrapper?.negativePrefix ?? "",
  };
}

function resolveSavedFaceDetailerOption<T extends string>(
  value: string | undefined,
  fallback: T,
  options: readonly { value: T }[],
): T {
  return options.find((option) => option.value === value)?.value ?? fallback;
}

function resolveSavedDetailer(
  savedDetailer: SavedComfyUiGenerationParams["faceDetailer"] | undefined,
  fallback: Pick<ComfyUiTextToImageRequest, "cfg" | "samplerName" | "scheduler" | "steps">,
  defaultDetectorModel: string,
) {
  const samplerSettings = normalizeComfyUiSamplerSettings({
    samplerName: savedDetailer?.samplerName,
    scheduler: savedDetailer?.scheduler,
  });

  return {
    bboxCropFactor: savedDetailer?.bboxCropFactor ?? COMFYUI_FACE_DETAILER_DEFAULTS.bboxCropFactor,
    bboxDilation: savedDetailer?.bboxDilation ?? COMFYUI_FACE_DETAILER_DEFAULTS.bboxDilation,
    bboxThreshold: savedDetailer?.bboxThreshold ?? COMFYUI_FACE_DETAILER_DEFAULTS.bboxThreshold,
    cfg: savedDetailer?.cfg ?? fallback.cfg ?? DEFAULT_CFG,
    cycle: savedDetailer?.cycle ?? COMFYUI_FACE_DETAILER_DEFAULTS.cycle,
    denoise: savedDetailer?.denoise ?? COMFYUI_FACE_DETAILER_DEFAULTS.denoise,
    enabled: savedDetailer?.enabled ?? false,
    detectorModelName: savedDetailer?.detectorModelName?.trim() || defaultDetectorModel,
    dropSize: savedDetailer?.dropSize ?? COMFYUI_FACE_DETAILER_DEFAULTS.dropSize,
    feather: savedDetailer?.feather ?? COMFYUI_FACE_DETAILER_DEFAULTS.feather,
    forceInpaint: savedDetailer?.forceInpaint ?? COMFYUI_FACE_DETAILER_DEFAULTS.forceInpaint,
    guideSize: savedDetailer?.guideSize ?? COMFYUI_FACE_DETAILER_DEFAULTS.guideSize,
    guideSizeFor: savedDetailer?.guideSizeFor ?? COMFYUI_FACE_DETAILER_DEFAULTS.guideSizeFor,
    maxSize: savedDetailer?.maxSize ?? COMFYUI_FACE_DETAILER_DEFAULTS.maxSize,
    noiseMask: savedDetailer?.noiseMask ?? COMFYUI_FACE_DETAILER_DEFAULTS.noiseMask,
    samBBoxExpansion: savedDetailer?.samBBoxExpansion ?? COMFYUI_FACE_DETAILER_DEFAULTS.samBBoxExpansion,
    samDetectionHint: resolveSavedFaceDetailerOption(
      savedDetailer?.samDetectionHint,
      COMFYUI_FACE_DETAILER_DEFAULTS.samDetectionHint,
      COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
    ),
    samDilation: savedDetailer?.samDilation ?? COMFYUI_FACE_DETAILER_DEFAULTS.samDilation,
    samMaskHintThreshold: savedDetailer?.samMaskHintThreshold ?? COMFYUI_FACE_DETAILER_DEFAULTS.samMaskHintThreshold,
    samMaskHintUseNegative: resolveSavedFaceDetailerOption(
      savedDetailer?.samMaskHintUseNegative,
      COMFYUI_FACE_DETAILER_DEFAULTS.samMaskHintUseNegative,
      COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
    ),
    samThreshold: savedDetailer?.samThreshold ?? COMFYUI_FACE_DETAILER_DEFAULTS.samThreshold,
    samplerName: samplerSettings.samplerName ?? fallback.samplerName ?? DEFAULT_SAMPLER,
    scheduler: samplerSettings.scheduler ?? fallback.scheduler ?? DEFAULT_SCHEDULER,
    steps: savedDetailer?.steps ?? fallback.steps ?? DEFAULT_STEPS,
    wildcard: savedDetailer?.wildcard ?? COMFYUI_FACE_DETAILER_DEFAULTS.wildcard,
  };
}

function resolveSavedFaceDetailer(
  savedParameters: SavedComfyUiGenerationParams | null,
  fallback: Pick<ComfyUiTextToImageRequest, "cfg" | "samplerName" | "scheduler" | "steps">,
) {
  return resolveSavedDetailer(
    savedParameters?.faceDetailer,
    fallback,
    DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  );
}

function resolveSavedHandDetailer(
  savedParameters: SavedComfyUiGenerationParams | null,
  fallback: Pick<ComfyUiTextToImageRequest, "cfg" | "samplerName" | "scheduler" | "steps">,
) {
  return resolveSavedDetailer(
    savedParameters?.handDetailer,
    fallback,
    DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
  );
}

function makeNegativePrompt(baseNegativePrompt: string, additions: string | undefined) {
  const parts = [baseNegativePrompt.trim(), additions?.trim()].filter(Boolean);
  return Array.from(new Set(parts)).join(", ");
}

export function resolveComfyUiGenerationSettings(input: {
  activePrompt: string;
  activePromptAlreadyFormatted?: boolean;
  baseNegativePrompt: string;
  selectedResources: SelectedCivitaiResourcesPreview;
  aiAdvice: CivitaiAiPromptResult | null;
  savedParameters?: SavedComfyUiGenerationParams | null;
  supportsNsfw?: boolean;
}): ComfyUiGenerationSettings {
  const parsedAi = parseComfyUiAiGenerationParameters(input.aiAdvice?.parameterSuggestions ?? null);
  const savedParameters = input.savedParameters ?? null;
  const savedSamplerSettings = normalizeComfyUiSamplerSettings({
    samplerName: savedParameters?.samplerName,
    scheduler: savedParameters?.scheduler,
  });
  const parameterSource: ComfyUiGenerationParameterSource = savedParameters ? "saved" : parsedAi ? "ai" : "reference";
  const checkpoint = input.selectedResources.checkpoint;
  const savedLoras = savedLoraByName(savedParameters);
  const loras = input.selectedResources.loras.map((resource) => {
    const aiWeight = parsedAi ? findAiLoraWeight(resource, parsedAi.loraWeights) : undefined;
    const savedLora = savedLoras.get(normalizeWeightName(resource.modelFileName));
    const strengthModel = clampWeight(savedLora?.strengthModel ?? aiWeight?.weight ?? getReferenceLoraWeight(resource));
    const strengthClip = clampWeight(savedLora?.strengthClip ?? strengthModel);

    return {
      enabled: savedLora?.enabled ?? true,
      resource,
      loraName: resource.modelFileName,
      strengthModel,
      strengthClip,
      source: savedLora ? "saved" as const : aiWeight ? "ai" as const : "reference" as const,
    };
  });
  const steps = sanitizePositiveInteger(savedParameters?.steps) ?? sanitizePositiveInteger(parsedAi?.steps) ?? DEFAULT_STEPS;
  const cfg = sanitizeFiniteNumber(savedParameters?.cfg) ?? sanitizeFiniteNumber(parsedAi?.cfg) ?? DEFAULT_CFG;
  const samplerName = savedSamplerSettings.samplerName ?? parsedAi?.samplerName ?? DEFAULT_SAMPLER;
  const scheduler = savedSamplerSettings.scheduler ?? parsedAi?.scheduler ?? DEFAULT_SCHEDULER;
  const request: ComfyUiTextToImageRequest = {
    checkpointName: checkpoint?.modelFileName ?? "",
    checkpointNameAliases: checkpoint?.modelFileNameAliases,
    modelBaseModel: checkpoint?.baseModel ?? undefined,
    modelStorageKind: checkpoint?.modelStorageKind,
    positivePrompt: input.activePrompt.trim(),
    negativePrompt: makeNegativePrompt(input.baseNegativePrompt, parsedAi?.negativePromptAdditions),
    loras: loras
      .filter((lora) => lora.enabled)
      .map((lora) => ({
        loraName: lora.loraName,
        strengthModel: lora.strengthModel,
        strengthClip: lora.strengthClip,
      })),
    width: sanitizeComfyUiDimension(savedParameters?.width) ?? sanitizeComfyUiDimension(parsedAi?.width) ?? DEFAULT_WIDTH,
    height: sanitizeComfyUiDimension(savedParameters?.height) ?? sanitizeComfyUiDimension(parsedAi?.height) ?? DEFAULT_HEIGHT,
    seed: sanitizeSeed(savedParameters?.seed) ?? sanitizeSeed(parsedAi?.seed),
    steps,
    cfg,
    samplerName,
    scheduler,
    denoise: sanitizeDenoise(savedParameters?.denoise) ?? sanitizeDenoise(parsedAi?.denoise) ?? DEFAULT_DENOISE,
    batchSize: sanitizePositiveInteger(savedParameters?.imageCount) ?? DEFAULT_BATCH_SIZE,
    latentImageNode: inferLatentImageNode(checkpoint, savedParameters),
    promptWrapper: resolveSavedPromptWrapper(savedParameters),
    outputPrefix: savedParameters?.outputPrefix?.trim() || DEFAULT_OUTPUT_PREFIX,
    faceDetailer: resolveSavedFaceDetailer(savedParameters, {
      cfg,
      samplerName,
      scheduler,
      steps,
    }),
    handDetailer: resolveSavedHandDetailer(savedParameters, {
      cfg,
      samplerName,
      scheduler,
      steps,
    }),
  };
  request.workflowProfile = resolveComfyUiTextToImageWorkflowProfile(request).id;
  if (isAnimaPromptContext({
    baseModel: request.modelBaseModel,
    resources: input.selectedResources,
    supportsNsfw: input.supportsNsfw,
    workflowProfile: request.workflowProfile,
  })) {
    if (!input.activePromptAlreadyFormatted) {
      request.positivePrompt = renderAnimaPromptForContext(request.positivePrompt, {
        baseModel: request.modelBaseModel,
        resources: input.selectedResources,
        supportsNsfw: input.supportsNsfw,
        workflowProfile: request.workflowProfile,
      });
    }
    request.negativePrompt = mergeAnimaNegativePrompts([request.negativePrompt]);
  }

  return {
    request,
    checkpoint,
    loras,
    parameterSource,
    negativePromptAdditions: parsedAi?.negativePromptAdditions ?? "",
  };
}
