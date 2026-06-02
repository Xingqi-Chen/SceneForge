import type {
  CivitaiAiRecommendationResponse,
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { isSameCivitaiBaseModel } from "@/features/civitai-lora-library/base-model";
import {
  parseComfyUiAiGenerationParameters,
  resolveComfyUiGenerationSettings,
} from "@/features/editor/ai-prompt/comfyui-generation-params";
import type { CivitaiAiPromptResult } from "@/features/editor/ai-prompt/civitai-ai-context";

import { createTimelineNodeError } from "./state";
import {
  TimelineNodeExecutionError,
  type CanvasBindingTimelineResult,
  type CharacterActionTimelineResult,
  type CharacterTagsTimelineResult,
  type ParameterRecommendationTimelineResult,
  type ResourceRecommendationTimelineResult,
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

export type TimelineT7NodeAdapterOptions = {
  recommendResources: TimelineResourceRecommendationProvider;
  loadResourceCandidates: TimelineResourceCandidateProvider;
  loadSamplerOptions?: TimelineSamplerOptionsProvider;
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

function getScenePromptResult(workflow: TimelineNodeExecutionContext["workflow"]): ScenePromptTimelineResult {
  const result = workflow.nodes["scene-prompt"].result;
  const manualText = getManualTextResult(result);

  if (manualText) {
    return {
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
    return result as ScenePromptTimelineResult;
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

  return [
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

function isCompatibleLora(
  lora: SelectedCivitaiResourcePreview,
  checkpoint: SelectedCivitaiResourcePreview,
) {
  return !checkpoint.baseModel || !lora.baseModel || isSameCivitaiBaseModel(lora.baseModel, checkpoint.baseModel);
}

export function validateTimelineResourceRecommendation({
  candidates,
  recommendation,
}: {
  candidates: ResourceRecommendationTimelineResult["candidates"];
  recommendation: CivitaiAiRecommendationResponse;
}): ResourceRecommendationTimelineResult {
  const checkpointMap = getCandidateMap(candidates.checkpoints);
  const loraMap = getCandidateMap(candidates.loras);
  const checkpointCandidate = checkpointMap.get(recommendation.checkpoint.resource.id);

  if (!checkpointCandidate) {
    invalidResourceSelection("Recommended checkpoint is not in the local candidate set.", {
      checkpointId: recommendation.checkpoint.resource.id,
    });
  }

  const warnings = [...recommendation.warnings];
  const selectedLoras: ResourceRecommendationTimelineResult["loras"] = [];
  const seenLoras = new Set<string>();

  for (const lora of recommendation.loras) {
    const candidate = loraMap.get(lora.resource.id);
    if (!candidate) {
      warnings.push(`Ignored unavailable LoRA ${lora.resource.name}.`);
      continue;
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
): CivitaiAiPromptResult {
  const checkpoint = resourceResult.checkpoint.resource;
  const referenceSampler = getReferenceSampler(checkpoint)
    ?? resourceResult.loras.map((lora) => getReferenceSampler(lora.resource)).find(Boolean);
  const parsedSampler = parseComfyUiAiGenerationParameters({
    sampler: referenceSampler,
  });
  const samplerName = pickSupportedValue(parsedSampler?.samplerName, samplerOptions.samplers, "euler");
  const scheduler = pickSupportedValue(parsedSampler?.scheduler, samplerOptions.schedulers, "normal");

  return {
    prompt: scenePrompt.positivePrompt,
    parameterSuggestionReason: "SceneForge selected conservative text-to-image parameters from local resource metadata.",
    overallEffect: resourceResult.overallEffect,
    parseWarning: null,
    parameterSuggestions: {
      cfg: inferCfg(checkpoint),
      denoise: 1,
      loraWeights: resourceResult.loras.map((lora) => ({
        name: lora.resource.name,
        suggestedWeight: lora.suggestedWeight,
      })),
      negativePromptAdditions: scenePrompt.negativeSuggestions.join(", "),
      resolution: inferResolution(scenePrompt, canvasBinding),
      sampler: samplerName,
      scheduler,
      steps: inferSteps(checkpoint),
    },
  };
}

export function createTimelineParameterRecommendation({
  resourceResult,
  scenePrompt,
  canvasBinding,
  samplerOptions: rawSamplerOptions,
  supportsNsfw = false,
}: {
  resourceResult: ResourceRecommendationTimelineResult;
  scenePrompt: ScenePromptTimelineResult;
  canvasBinding: CanvasBindingTimelineResult | null;
  samplerOptions?: TimelineSamplerOptions;
  supportsNsfw?: boolean;
}): ParameterRecommendationTimelineResult {
  const samplerOptions = normalizeOptions(rawSamplerOptions);
  const selectedResources: SelectedCivitaiResourcesPreview = {
    checkpoint: resourceResult.checkpoint.resource,
    loras: resourceResult.loras.map((lora) => lora.resource),
  };
  const baseNegativePrompt = scenePrompt.negativeSuggestions.join(", ");
  const settings = resolveComfyUiGenerationSettings({
    activePrompt: scenePrompt.positivePrompt,
    aiAdvice: createAiAdvice(resourceResult, scenePrompt, canvasBinding, samplerOptions),
    baseNegativePrompt,
    selectedResources,
    supportsNsfw,
  });
  const request = settings.request;
  const samplerName = pickSupportedValue(request.samplerName, samplerOptions.samplers, "euler");
  const scheduler = pickSupportedValue(request.scheduler, samplerOptions.schedulers, "normal");
  const requestPreview = {
    ...request,
    samplerName,
    scheduler,
  };

  return {
    availableSamplers: samplerOptions.samplers,
    availableSchedulers: samplerOptions.schedulers,
    width: requestPreview.width ?? 1024,
    height: requestPreview.height ?? 1024,
    steps: requestPreview.steps ?? 30,
    cfg: requestPreview.cfg ?? 7,
    samplerName,
    scheduler,
    denoise: requestPreview.denoise ?? 1,
    seedPolicy: makeSeedPolicy(requestPreview.seed),
    negativeAdditions: scenePrompt.negativeSuggestions,
    negativePrompt: requestPreview.negativePrompt ?? "",
    requestPreview,
    reason: settings.parameterSource === "ai"
      ? "Used local resource metadata and prompt context to create a ComfyUI text-to-image request preview."
      : "Used conservative ComfyUI defaults because no model-specific parameter metadata was available.",
    warnings: request.samplerName !== samplerName || request.scheduler !== scheduler
      ? ["Sampler or scheduler suggestion was normalized to an available option."]
      : [],
  };
}

export function createTimelineT7NodeAdapters({
  loadResourceCandidates,
  loadSamplerOptions,
  recommendResources,
  supportsNsfw = () => false,
}: TimelineT7NodeAdapterOptions): TimelineNodeAdapters {
  return {
    "resource-recommendation": async (context) => {
      const desiredEffect = buildDesiredEffect(context);
      const candidates = await loadResourceCandidates(desiredEffect, context);
      if (candidates.checkpoints.length === 0) {
        invalidResourceSelection("No local checkpoint candidates are available. Import or configure Civitai checkpoints first.");
      }

      const recommendation = await recommendResources(
        {
          desiredEffect,
          maxLoras: maxTimelineLoras,
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
      const resourceResult = getResourceRecommendationResult(context.workflow.nodes["resource-recommendation"]);
      const samplerOptions = loadSamplerOptions ? await loadSamplerOptions(context) : defaultSamplerOptions;

      return {
        value: createTimelineParameterRecommendation({
          canvasBinding: getCanvasBindingResult(context.workflow),
          resourceResult,
          samplerOptions,
          scenePrompt,
          supportsNsfw: supportsNsfw(),
        }),
        source: "system",
      };
    },
  };
}
