import type {
  CivitaiAiRecommendationResponse,
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import {
  isCivitaiBaseModelCompatibleWithPromptProfile,
  isSameCivitaiBaseModel,
} from "@/features/civitai-lora-library/base-model";
import {
  parseComfyUiAiGenerationParameters,
  resolveComfyUiGenerationSettings,
} from "@/features/editor/ai-prompt/comfyui-generation-params";
import type { CivitaiAiPromptResult } from "@/features/editor/ai-prompt/civitai-ai-context";
import {
  renderAnimaPrompt,
} from "@/features/editor/ai-prompt/anima-prompt";
import {
  classifyFlatPromptToIllustriousSections,
  mergePromptParts,
  renderIllustriousPrompt,
  splitPromptParts,
} from "@/features/editor/ai-prompt/illustrious-prompt";
import {
  formatPromptProfileLabel,
  normalizePromptProfileId,
  type PromptProfileId,
} from "@/shared/prompt-profile";

import {
  createTimelineNodeError,
  DEFAULT_TIMELINE_SOURCE_DENOISE,
  normalizeTimelineSourceDenoise,
} from "./state";
import {
  TimelineNodeExecutionError,
  type CanvasBindingTimelineResult,
  type CharacterActionTimelineResult,
  type CharacterTagsTimelineResult,
  type ParameterRecommendationTimelineResult,
  type ResourceRecommendationTimelineResult,
  type SceneInputTimelineResult,
  type ScenePromptTimelineResult,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
  type TimelineNodeResult,
  type TimelineSeedPolicy,
} from "./types";

export type TimelineSamplerOptions = {
  samplers: string[];
  schedulers: string[];
};

export type TimelineResourceRecommendationRequest = {
  desiredEffect: string;
  maxLoras: number;
  promptProfile: PromptProfileId;
};

export type TimelineResourceRecommendationProvider = (
  request: TimelineResourceRecommendationRequest,
  context: TimelineNodeExecutionContext,
) => Promise<CivitaiAiRecommendationResponse> | CivitaiAiRecommendationResponse;

export type TimelineResourceCandidateProvider = (
  desiredEffect: string,
  context: TimelineNodeExecutionContext,
) => Promise<ResourceRecommendationTimelineResult["candidates"]> | ResourceRecommendationTimelineResult["candidates"];

export type TimelineSamplerOptionsProvider = (
  context: TimelineNodeExecutionContext,
) => Promise<TimelineSamplerOptions> | TimelineSamplerOptions;

export type TimelineStyleAdviceRequest = {
  baseNegativePrompt: string;
  finalPositivePrompt: string;
  referenceResolution?: {
    height: number;
    width: number;
  };
  selectedResources: SelectedCivitaiResourcesPreview;
};

export type TimelineStyleAdviceProvider = (
  request: TimelineStyleAdviceRequest,
  context: TimelineNodeExecutionContext,
) => Promise<CivitaiAiPromptResult | null> | CivitaiAiPromptResult | null;

export type TimelineT7NodeAdapterOptions = {
  recommendResources: TimelineResourceRecommendationProvider;
  loadResourceCandidates: TimelineResourceCandidateProvider;
  loadSamplerOptions?: TimelineSamplerOptionsProvider;
  adviseStyle?: TimelineStyleAdviceProvider;
  supportsNsfw?: () => boolean;
};

const maxTimelineLoras = 3;
const defaultSamplerOptions: TimelineSamplerOptions = {
  samplers: ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde"],
  schedulers: ["normal", "karras"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: unknown, maxLength = 1200) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function invalidTimelineInput(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(createTimelineNodeError("timeline_node_failed", message, details));
}

function invalidResourceSelection(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(createTimelineNodeError("resource_selection_invalid", message, details));
}

function getManualTextResult(result: unknown) {
  if (typeof result === "string") {
    return compactText(result, 2000);
  }

  if (isRecord(result) && typeof result.shellContent === "string") {
    return compactText(result.shellContent, 2000);
  }

  return "";
}

function getTimelinePromptProfile(workflow: TimelineNodeExecutionContext["workflow"]) {
  const sceneInput = workflow.nodes["scene-input"].result;
  if (isRecord(sceneInput)) {
    return normalizePromptProfileId(sceneInput.promptProfile);
  }

  const scenePrompt = workflow.nodes["scene-prompt"].result;
  if (isRecord(scenePrompt)) {
    return normalizePromptProfileId(scenePrompt.promptProfile);
  }

  return normalizePromptProfileId(undefined);
}

function getSceneInputSourceImage(workflow: TimelineNodeExecutionContext["workflow"]) {
  const sceneInput = workflow.nodes["scene-input"].result;

  if (!isRecord(sceneInput)) {
    return undefined;
  }

  return (sceneInput as Partial<SceneInputTimelineResult>).sourceImage;
}

function getSceneInputSourceDenoise(workflow: TimelineNodeExecutionContext["workflow"]) {
  const sceneInput = workflow.nodes["scene-input"].result;

  if (!isRecord(sceneInput)) {
    return undefined;
  }

  return (sceneInput as Partial<SceneInputTimelineResult>).sourceDenoise;
}

function getScenePromptResult(workflow: TimelineNodeExecutionContext["workflow"]): ScenePromptTimelineResult {
  const result = workflow.nodes["scene-prompt"].result;
  const manualText = getManualTextResult(result);
  const promptProfile = getTimelinePromptProfile(workflow);

  if (manualText) {
    return {
      promptProfile,
      primaryCharacter: {
        name: "Primary character",
        identity: manualText,
        publicFacts: [],
      },
      sceneIntent: manualText,
      styleTone: "",
      setting: "",
      sharedFacts: [],
      positivePrompt: manualText,
      negativeSuggestions: [],
      style: [],
      camera: [],
      lighting: [],
    };
  }

  if (
    isRecord(result) &&
    isRecord(result.primaryCharacter) &&
    typeof result.positivePrompt === "string" &&
    Array.isArray(result.negativeSuggestions)
  ) {
    return {
      ...result,
      promptProfile: normalizePromptProfileId(result.promptProfile ?? promptProfile),
    } as ScenePromptTimelineResult;
  }

  invalidTimelineInput("Scene prompt dependency is not usable for recommendations.", { result });
}

function getCharacterTagsResult(workflow: TimelineNodeExecutionContext["workflow"]): CharacterTagsTimelineResult {
  const result = workflow.nodes["character-tags"].result;
  if (isRecord(result) && Array.isArray(result.items)) {
    return result as CharacterTagsTimelineResult;
  }

  return { items: [] };
}

function getCharacterActionResult(workflow: TimelineNodeExecutionContext["workflow"]): CharacterActionTimelineResult | null {
  const result = workflow.nodes["character-action"].result;
  if (isRecord(result) && typeof result.action === "string") {
    return result as CharacterActionTimelineResult;
  }

  return null;
}

function getCanvasBindingResult(workflow: TimelineNodeExecutionContext["workflow"]): CanvasBindingTimelineResult | null {
  const result = workflow.nodes["canvas-binding"].result;
  if (isRecord(result) && typeof result.spatialSummary === "string") {
    return result as CanvasBindingTimelineResult;
  }

  return null;
}

function getResourceRecommendationResult(
  node: TimelineNodeResult,
): ResourceRecommendationTimelineResult {
  const result = node.result;
  if (
    isRecord(result) &&
    isRecord(result.checkpoint) &&
    isRecord(result.checkpoint.resource) &&
    Array.isArray(result.loras) &&
    isRecord(result.candidates) &&
    Array.isArray(result.candidates.checkpoints) &&
    Array.isArray(result.candidates.loras)
  ) {
    return result as ResourceRecommendationTimelineResult;
  }

  invalidTimelineInput("Resource recommendation dependency is not usable for parameter recommendation.", { result });
}

function buildDesiredEffect(context: TimelineNodeExecutionContext) {
  const scenePrompt = getScenePromptResult(context.workflow);
  const characterTags = getCharacterTagsResult(context.workflow);
  const action = getCharacterActionResult(context.workflow);
  const tagPrompts = characterTags.items.map((item) => item.prompt).filter(Boolean).slice(0, 12);
  const promptProfile = getTimelinePromptProfile(context.workflow);

  return [
    `Prompt profile: ${formatPromptProfileLabel(promptProfile)} (${promptProfile})`,
    scenePrompt.sceneIntent,
    scenePrompt.positivePrompt,
    scenePrompt.styleTone,
    scenePrompt.setting,
    action?.action,
    tagPrompts.length > 0 ? `Character tags: ${tagPrompts.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getCandidateMap(candidates: CivitaiRecommendationCandidate[]) {
  return new Map(candidates.map((candidate) => [candidate.resource.id, candidate]));
}

function normalizeResourceMatchValue(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function getResourceMatchAliases(resource: SelectedCivitaiResourcePreview) {
  return [
    resource.id,
    resource.name,
    resource.modelFileName,
  ]
    .map(normalizeResourceMatchValue)
    .filter(Boolean);
}

function findUnambiguousLocalCandidate(
  recommended: SelectedCivitaiResourcePreview,
  candidates: CivitaiRecommendationCandidate[],
) {
  const byId = getCandidateMap(candidates).get(recommended.id);
  if (byId) {
    return byId;
  }

  const recommendedAliases = new Set(getResourceMatchAliases(recommended));
  const matches = candidates.filter((candidate) =>
    getResourceMatchAliases(candidate.resource).some((alias) => recommendedAliases.has(alias)),
  );

  return matches.length === 1 ? matches[0] : null;
}

function isCompatibleLora(
  lora: SelectedCivitaiResourcePreview,
  checkpoint: SelectedCivitaiResourcePreview,
) {
  return !checkpoint.baseModel || !lora.baseModel || isSameCivitaiBaseModel(lora.baseModel, checkpoint.baseModel);
}

function appendMappedResourceWarning(
  warnings: string[],
  resourceKind: "checkpoint" | "LoRA",
  recommended: SelectedCivitaiResourcePreview,
  selected: SelectedCivitaiResourcePreview,
) {
  if (recommended.id === selected.id) {
    return;
  }

  warnings.push(`Mapped recommended ${resourceKind} ${recommended.name} to local candidate ${selected.name}.`);
}

export function validateTimelineResourceRecommendation({
  candidates,
  recommendation,
}: {
  candidates: ResourceRecommendationTimelineResult["candidates"];
  recommendation: CivitaiAiRecommendationResponse;
}): ResourceRecommendationTimelineResult {
  const checkpointCandidate = findUnambiguousLocalCandidate(
    recommendation.checkpoint.resource,
    candidates.checkpoints,
  );

  if (!checkpointCandidate) {
    invalidResourceSelection("Recommended checkpoint is not in the local candidate set.", {
      checkpointId: recommendation.checkpoint.resource.id,
      checkpointName: recommendation.checkpoint.resource.name,
    });
  }

  const warnings = [...recommendation.warnings];
  appendMappedResourceWarning(
    warnings,
    "checkpoint",
    recommendation.checkpoint.resource,
    checkpointCandidate.resource,
  );
  const selectedLoras: ResourceRecommendationTimelineResult["loras"] = [];
  const seenLoras = new Set<string>();

  for (const lora of recommendation.loras) {
    const candidate = findUnambiguousLocalCandidate(lora.resource, candidates.loras);
    if (!candidate) {
      invalidResourceSelection("Recommended LoRA is not in the local candidate set.", {
        loraId: lora.resource.id,
        loraName: lora.resource.name,
      });
    }

    if (seenLoras.has(candidate.resource.id)) {
      warnings.push(`Ignored duplicate LoRA ${candidate.resource.name}.`);
      continue;
    }

    if (selectedLoras.length >= maxTimelineLoras) {
      warnings.push(`Only the first ${maxTimelineLoras} LoRAs were kept.`);
      break;
    }

    if (!isCompatibleLora(candidate.resource, checkpointCandidate.resource)) {
      warnings.push(`Ignored incompatible LoRA ${candidate.resource.name}.`);
      continue;
    }

    appendMappedResourceWarning(warnings, "LoRA", lora.resource, candidate.resource);
    seenLoras.add(candidate.resource.id);
    selectedLoras.push({
      resource: candidate.resource,
      suggestedWeight: lora.suggestedWeight,
      reason: lora.reason,
    });
  }

  return {
    checkpoint: {
      resource: checkpointCandidate.resource,
      reason: recommendation.checkpoint.reason,
    },
    loras: selectedLoras,
    candidates,
    recommendationReason: recommendation.recommendationReason,
    overallEffect: recommendation.overallEffect,
    warnings,
  };
}

function getSelectedResources(resourceResult: ResourceRecommendationTimelineResult): SelectedCivitaiResourcesPreview {
  return {
    checkpoint: resourceResult.checkpoint.resource,
    loras: resourceResult.loras.map((lora) => lora.resource),
  };
}

function normalizeBaseModel(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function getLoraTrainedWordPrompt(resources: SelectedCivitaiResourcesPreview) {
  return resources.loras.flatMap((lora) => lora.trainedWords.flatMap(splitPromptParts)).join(", ");
}

function isPonyBaseModel(value: string | null | undefined) {
  return normalizeBaseModel(value).includes("pony");
}

export function filterTimelineResourceCandidatesForPromptProfile(
  candidates: ResourceRecommendationTimelineResult["candidates"],
  promptProfile: PromptProfileId | undefined,
): ResourceRecommendationTimelineResult["candidates"] {
  const resolvedProfile = normalizePromptProfileId(promptProfile);

  return {
    checkpoints: candidates.checkpoints.filter((candidate) =>
      isCivitaiBaseModelCompatibleWithPromptProfile(candidate.resource.baseModel, resolvedProfile),
    ),
    loras: candidates.loras.filter((candidate) =>
      isCivitaiBaseModelCompatibleWithPromptProfile(candidate.resource.baseModel, resolvedProfile),
    ),
  };
}

function hasPromptSectionContent(sections: Record<string, string | string[] | undefined> | undefined) {
  return Object.values(sections ?? {}).some((value) =>
    Array.isArray(value)
      ? value.flatMap(splitPromptParts).length > 0
      : splitPromptParts(value ?? "").length > 0,
  );
}

export function buildTimelineFinalPositivePrompt({
  promptProfile,
  resourceResult,
  scenePrompt,
  supportsNsfw = false,
}: {
  promptProfile?: PromptProfileId;
  resourceResult: ResourceRecommendationTimelineResult;
  scenePrompt: ScenePromptTimelineResult;
  supportsNsfw?: boolean;
}) {
  const resources = getSelectedResources(resourceResult);
  const resolvedProfile = normalizePromptProfileId(promptProfile ?? scenePrompt.promptProfile);
  const sourcePrompt = scenePrompt.positivePrompt;

  if (resolvedProfile === "anima") {
    return renderAnimaPrompt({
      resources,
      ...(hasPromptSectionContent(scenePrompt.animaSections)
        ? { sections: scenePrompt.animaSections }
        : { sourcePrompt }),
      supportsNsfw,
    });
  }

  if (resolvedProfile === "illustrious") {
    return renderIllustriousPrompt({
      resources,
      sections: hasPromptSectionContent(scenePrompt.illustriousSections)
        ? scenePrompt.illustriousSections
        : classifyFlatPromptToIllustriousSections(sourcePrompt),
    });
  }

  const loraTrainedWords = getLoraTrainedWordPrompt(resources);
  if (isPonyBaseModel(resources.checkpoint?.baseModel)) {
    return mergePromptParts([
      "score_9, score_8_up, score_7_up",
      sourcePrompt,
      loraTrainedWords,
    ]);
  }

  return mergePromptParts([sourcePrompt, loraTrainedWords]);
}

function getReferenceSampler(resource: SelectedCivitaiResourcePreview) {
  return resource.recommendations.find((recommendation) => recommendation.sampler)?.sampler ?? undefined;
}

function inferResolution(scenePrompt: ScenePromptTimelineResult, canvasBinding: CanvasBindingTimelineResult | null) {
  const text = [
    scenePrompt.positivePrompt,
    scenePrompt.sceneIntent,
    scenePrompt.camera.map((fragment) => fragment.prompt).join(" "),
    canvasBinding?.spatialSummary ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(?:portrait|vertical|full body|standing|character sheet)\b/.test(text)) {
    return "832x1216";
  }

  if (/\b(?:wide|landscape|panorama|establishing|cinematic)\b/.test(text)) {
    return "1216x832";
  }

  return "1024x1024";
}

function inferSteps(resource: SelectedCivitaiResourcePreview) {
  const family = [resource.baseModel, resource.name, resource.versionName].filter(Boolean).join(" ").toLowerCase();
  if (family.includes("anima")) {
    return 30;
  }

  if (family.includes("flux") || family.includes("qwen")) {
    return 28;
  }

  return 30;
}

function inferCfg(resource: SelectedCivitaiResourcePreview) {
  const family = [resource.baseModel, resource.name, resource.versionName].filter(Boolean).join(" ").toLowerCase();
  if (family.includes("anima") || family.includes("flux") || family.includes("qwen")) {
    return 7;
  }

  return 7;
}

function normalizeOptions(options: TimelineSamplerOptions | undefined): TimelineSamplerOptions {
  const samplers = options?.samplers.filter(Boolean) ?? [];
  const schedulers = options?.schedulers.filter(Boolean) ?? [];

  return {
    samplers: samplers.length > 0 ? samplers : defaultSamplerOptions.samplers,
    schedulers: schedulers.length > 0 ? schedulers : defaultSamplerOptions.schedulers,
  };
}

function pickSupportedValue(value: string | undefined, options: string[], fallback: string) {
  if (!value) {
    return options.includes(fallback) ? fallback : options[0] ?? fallback;
  }

  if (options.includes(value)) {
    return value;
  }

  return options.includes(fallback) ? fallback : options[0] ?? fallback;
}

function normalizeRenderDimension(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(8, Math.round(parsed / 8) * 8);
}

function makeSeedPolicy(requestSeed: number | undefined): TimelineSeedPolicy {
  return typeof requestSeed === "number" && Number.isSafeInteger(requestSeed) && requestSeed >= 0
    ? { mode: "fixed", seed: requestSeed }
    : { mode: "random" };
}

function createAiAdvice(
  resourceResult: ResourceRecommendationTimelineResult,
  scenePrompt: ScenePromptTimelineResult,
  canvasBinding: CanvasBindingTimelineResult | null,
  samplerOptions: TimelineSamplerOptions,
  finalPositivePrompt: string,
  sourceImage?: SceneInputTimelineResult["sourceImage"],
): CivitaiAiPromptResult {
  const checkpoint = resourceResult.checkpoint.resource;
  const referenceSampler = getReferenceSampler(checkpoint)
    ?? resourceResult.loras.map((lora) => getReferenceSampler(lora.resource)).find(Boolean);
  const parsedSampler = parseComfyUiAiGenerationParameters({
    sampler: referenceSampler,
  });
  const samplerName = pickSupportedValue(parsedSampler?.samplerName, samplerOptions.samplers, "euler");
  const scheduler = pickSupportedValue(parsedSampler?.scheduler, samplerOptions.schedulers, "normal");

  const referenceResolution = sourceImage
    ? `${sourceImage.width}x${sourceImage.height}`
    : inferResolution(scenePrompt, canvasBinding);

  return {
    prompt: finalPositivePrompt,
    parameterSuggestionReason: sourceImage
      ? "SceneForge selected conservative img2img parameters from the uploaded source image and local resource metadata."
      : "SceneForge selected conservative text-to-image parameters from local resource metadata.",
    overallEffect: resourceResult.overallEffect,
    parseWarning: null,
    parameterSuggestions: {
      cfg: inferCfg(checkpoint),
      denoise: sourceImage ? DEFAULT_TIMELINE_SOURCE_DENOISE : 1,
      loraWeights: resourceResult.loras.map((lora) => ({
        name: lora.resource.name,
        suggestedWeight: lora.suggestedWeight,
      })),
      negativePromptAdditions: scenePrompt.negativeSuggestions.join(", "),
      resolution: referenceResolution,
      sampler: samplerName,
      scheduler,
      steps: inferSteps(checkpoint),
    },
  };
}

export function createTimelineParameterRecommendation({
  promptProfile,
  resourceResult,
  scenePrompt,
  canvasBinding,
  aiAdvice,
  samplerOptions: rawSamplerOptions,
  supportsNsfw = false,
  sourceDenoise,
  sourceImage,
}: {
  promptProfile?: PromptProfileId;
  resourceResult: ResourceRecommendationTimelineResult;
  scenePrompt: ScenePromptTimelineResult;
  canvasBinding: CanvasBindingTimelineResult | null;
  aiAdvice?: CivitaiAiPromptResult | null;
  samplerOptions?: TimelineSamplerOptions;
  supportsNsfw?: boolean;
  sourceDenoise?: number;
  sourceImage?: SceneInputTimelineResult["sourceImage"];
}): ParameterRecommendationTimelineResult {
  const samplerOptions = normalizeOptions(rawSamplerOptions);
  const selectedResources = getSelectedResources(resourceResult);
  const finalPositivePrompt = buildTimelineFinalPositivePrompt({
    promptProfile,
    resourceResult,
    scenePrompt,
    supportsNsfw,
  });
  const baseNegativePrompt = scenePrompt.negativeSuggestions.join(", ");
  const resolvedAiAdvice =
    aiAdvice ?? createAiAdvice(resourceResult, scenePrompt, canvasBinding, samplerOptions, finalPositivePrompt, sourceImage);
  const settings = resolveComfyUiGenerationSettings({
    activePrompt: finalPositivePrompt,
    activePromptAlreadyFormatted: true,
    aiAdvice: resolvedAiAdvice,
    baseNegativePrompt,
    selectedResources,
    supportsNsfw,
  });
  const request = settings.request;
  const samplerName = pickSupportedValue(request.samplerName, samplerOptions.samplers, "euler");
  const scheduler = pickSupportedValue(request.scheduler, samplerOptions.schedulers, "normal");
  const denoise = sourceImage ? normalizeTimelineSourceDenoise(sourceDenoise) : request.denoise ?? 1;
  const rawRequestPreview = {
    ...request,
    denoise,
    ...(sourceImage
      ? {
          width: sourceImage.width,
          height: sourceImage.height,
          sourceImageDataUrl: sourceImage.dataUrl,
          imageWidth: sourceImage.width,
          imageHeight: sourceImage.height,
          batchSize: 1,
        }
      : {}),
    samplerName,
    scheduler,
  };
  const width = normalizeRenderDimension(rawRequestPreview.width, 1024);
  const height = normalizeRenderDimension(rawRequestPreview.height, 1024);
  const requestPreview = {
    ...rawRequestPreview,
    width,
    height,
  };

  return {
    availableSamplers: samplerOptions.samplers,
    availableSchedulers: samplerOptions.schedulers,
    width,
    height,
    steps: requestPreview.steps ?? 30,
    cfg: requestPreview.cfg ?? 7,
    samplerName,
    scheduler,
    denoise,
    seedPolicy: makeSeedPolicy(requestPreview.seed),
    finalPositivePrompt: requestPreview.positivePrompt,
    negativeAdditions: scenePrompt.negativeSuggestions,
    negativePrompt: requestPreview.negativePrompt ?? "",
    requestPreview,
    reason: aiAdvice
      ? (aiAdvice.parameterSuggestionReason.trim() ||
        "Used AI Style Advice with local resource metadata to create a ComfyUI text-to-image request preview.")
      : settings.parameterSource === "ai"
        ? "Used local resource metadata and prompt context to create a ComfyUI text-to-image request preview."
      : "Used conservative ComfyUI defaults because no model-specific parameter metadata was available.",
    warnings: request.samplerName !== samplerName || request.scheduler !== scheduler
      ? ["Sampler or scheduler suggestion was normalized to an available option."]
      : [],
  };
}

export function createTimelineT7NodeAdapters({
  adviseStyle,
  loadResourceCandidates,
  loadSamplerOptions,
  recommendResources,
  supportsNsfw = () => false,
}: TimelineT7NodeAdapterOptions): TimelineNodeAdapters {
  return {
    "resource-recommendation": async (context) => {
      const desiredEffect = buildDesiredEffect(context);
      const promptProfile = getTimelinePromptProfile(context.workflow);
      const candidates = filterTimelineResourceCandidatesForPromptProfile(
        await loadResourceCandidates(desiredEffect, context),
        promptProfile,
      );
      if (candidates.checkpoints.length === 0) {
        invalidResourceSelection(
          `No local ${formatPromptProfileLabel(promptProfile)} checkpoint candidates are available. Import or configure matching Civitai checkpoints first.`,
        );
      }

      const recommendation = await recommendResources(
        {
          desiredEffect,
          maxLoras: maxTimelineLoras,
          promptProfile,
        },
        context,
      );

      return {
        value: validateTimelineResourceRecommendation({ candidates, recommendation }),
        source: "ai",
      };
    },
    "parameter-recommendation": async (context) => {
      const scenePrompt = getScenePromptResult(context.workflow);
      const promptProfile = getTimelinePromptProfile(context.workflow);
      const resourceResult = getResourceRecommendationResult(context.workflow.nodes["resource-recommendation"]);
      const samplerOptions = loadSamplerOptions ? await loadSamplerOptions(context) : defaultSamplerOptions;
      const selectedResources = getSelectedResources(resourceResult);
      const finalPositivePrompt = buildTimelineFinalPositivePrompt({
        promptProfile,
        resourceResult,
        scenePrompt,
        supportsNsfw: supportsNsfw(),
      });
      const baseNegativePrompt = scenePrompt.negativeSuggestions.join(", ");
      const sourceImage = getSceneInputSourceImage(context.workflow);
      const aiAdvice = adviseStyle
        ? await adviseStyle(
            {
              baseNegativePrompt,
              finalPositivePrompt,
              ...(sourceImage
                ? {
                    referenceResolution: {
                      height: sourceImage.height,
                      width: sourceImage.width,
                    },
                  }
                : {}),
              selectedResources,
            },
            context,
          )
        : null;

      return {
        value: createTimelineParameterRecommendation({
          aiAdvice,
          canvasBinding: getCanvasBindingResult(context.workflow),
          promptProfile,
          resourceResult,
          samplerOptions,
          scenePrompt,
          sourceDenoise: sourceImage ? getSceneInputSourceDenoise(context.workflow) : undefined,
          sourceImage,
          supportsNsfw: supportsNsfw(),
        }),
        source: "system",
      };
    },
  };
}
