import type { ComfyUiTextToImageRequest } from "@/features/comfyui";
import type {
  CivitaiPromptReference,
  CivitaiResourceRecommendation,
  CivitaiLoraCategory,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { resolveComfyUiGenerationSettings } from "@/features/editor/ai-prompt/comfyui-generation-params";
import type { CivitaiAiPromptResult } from "@/features/editor/ai-prompt/civitai-ai-context";
import {
  type PromptProfileId,
} from "@/shared/prompt-profile";

import {
  validateLocalResourcePlan,
  type ResourcePlanCandidates,
  type ResourcePlanLocalResource,
  type ResourcePlanRecommendation,
  type ResourcePlanResult,
} from "./resource-plan";
import type {
  StoryNsfwContext,
  StorySafetyPlan,
  StoryShot,
  StoryShotId,
} from "./story-types";
import {
  buildTimelineFinalPositivePrompt,
} from "./t7-node-adapters";
import type {
  ResourceRecommendationTimelineResult,
  ScenePromptTimelineResult,
} from "./types";

export type StoryLocalResource = ResourcePlanLocalResource & {
  versionName?: string | null;
  creator?: string | null;
  trainedWords?: string[];
  tags?: string[];
  categories?: CivitaiLoraCategory[];
  usageGuide?: string | null;
  descriptionSnippet?: string | null;
  averageWeight?: number | null;
  minWeight?: number | null;
  maxWeight?: number | null;
  recommendations?: CivitaiResourceRecommendation[];
  previewImage?: string | null;
  modelFileNameAliases?: string[];
  promptReferences?: CivitaiPromptReference[];
  workflowProfile?: ComfyUiTextToImageRequest["workflowProfile"];
  modelBaseModel?: string;
  modelStorageKind?: ComfyUiTextToImageRequest["modelStorageKind"];
  clipName?: string;
  clipDevice?: string;
  vaeName?: string;
  unetWeightDtype?: string;
  nsfw?: boolean | null;
  nsfwLevel?: number | null;
  aiNsfwLevel?: string | null;
  modelNsfw?: boolean | null;
};

export type StoryResourcePlan = ResourcePlanResult<StoryLocalResource> & {
  storyId: string;
};

export type StoryGenerationParameters = {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  seed?: number;
};

export type StoryParameterPlan = {
  storyId: string;
  defaults: StoryGenerationParameters;
  perShotOverrides: Array<{
    shotId: StoryShotId;
    parameters: Partial<StoryGenerationParameters>;
    reason?: string;
  }>;
  warnings: string[];
};

export type StoryPreviewExecutionOptions = {
  enabled: boolean;
  shotIds: StoryShotId[];
  parameterOverrides: Partial<StoryGenerationParameters>;
  requestedAt?: string;
  reason?: string;
};

export type StoryPreviewResultReference = {
  shotId: StoryShotId;
  promptId: string;
  imageUrl?: string;
  createdAt: string;
  parameters: StoryGenerationParameters;
};

export type StoryRenderPlanShot = {
  shotId: StoryShotId;
  order: number;
  title: string;
  positivePrompt: string;
  negativePrompt: string;
  sourceShotIds: StoryShotId[];
  parameters: StoryGenerationParameters;
  resources: {
    checkpoint: StoryResourcePlan["checkpoint"];
    loras: StoryResourcePlan["loras"];
  };
};

export type StoryRenderPlan = {
  storyId: string;
  nsfwContext: StoryNsfwContext;
  shots: StoryRenderPlanShot[];
  preview: {
    options: StoryPreviewExecutionOptions;
    resultReferences: StoryPreviewResultReference[];
  };
  warnings: string[];
};

export type StoryExecutionRequest = {
  shotId: StoryShotId;
  nsfwContext: StoryNsfwContext;
  request: ComfyUiTextToImageRequest;
  sourceShotIds: StoryShotId[];
};

export type StoryExecutionRequestBatch = {
  storyId: string;
  mode: "preview" | "final";
  nsfwContext: StoryNsfwContext;
  requests: StoryExecutionRequest[];
};

type StoryResourcePlanError = {
  message: string;
  details?: unknown;
};

export class StoryResourcePlanValidationError extends Error {
  readonly details?: unknown;

  constructor({ details, message }: StoryResourcePlanError) {
    super(message);
    this.name = "StoryResourcePlanValidationError";
    this.details = details;
  }
}

const defaultPreviewExecutionOptions: StoryPreviewExecutionOptions = {
  enabled: false,
  shotIds: [],
  parameterOverrides: {},
};

function failStoryResourcePlan(message: string, details?: unknown): never {
  throw new StoryResourcePlanValidationError({ message, details });
}

function isCompatibleStoryLora(lora: StoryLocalResource, checkpoint: StoryLocalResource) {
  return !checkpoint.baseModel || !lora.baseModel || checkpoint.baseModel === lora.baseModel;
}

function normalizeDimension(value: number) {
  return Math.max(8, Math.round(value / 8) * 8);
}

function normalizeParameters(parameters: StoryGenerationParameters): StoryGenerationParameters {
  return {
    ...parameters,
    width: normalizeDimension(parameters.width),
    height: normalizeDimension(parameters.height),
    steps: Math.max(1, Math.round(parameters.steps)),
    cfg: Number(parameters.cfg.toFixed(2)),
    denoise: Math.min(1, Math.max(0, Number(parameters.denoise.toFixed(2)))),
  };
}

function applyParameterOverride(
  defaults: StoryGenerationParameters,
  override: Partial<StoryGenerationParameters> | undefined,
): StoryGenerationParameters {
  return normalizeParameters({
    ...defaults,
    ...override,
  });
}

function getPerShotOverride(parameterPlan: StoryParameterPlan, shotId: StoryShotId) {
  return parameterPlan.perShotOverrides.find((override) => override.shotId === shotId)?.parameters;
}

function getNsfwContext(safetyPlan: StorySafetyPlan): StoryNsfwContext {
  return {
    audienceRating: safetyPlan.audienceRating,
    contentWarnings: [...safetyPlan.contentWarnings],
    enabled: safetyPlan.nsfwContext?.enabled ?? safetyPlan.audienceRating === "explicit",
    rationale: safetyPlan.nsfwContext?.rationale ?? "",
  };
}

function getBasePositivePrompt(shot: StoryShot) {
  return [shot.promptIntent, shot.camera]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function getBaseNegativePrompt(safetyPlan: StorySafetyPlan, shotId: StoryShotId) {
  const shotNotes = safetyPlan.perShotNotes.find((note) => note.shotId === shotId);
  return [...safetyPlan.blockedContent, ...(shotNotes?.mitigations ?? [])]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function inferPromptProfileFromCheckpoint(checkpoint: StoryLocalResource): PromptProfileId {
  const family = [
    checkpoint.modelBaseModel,
    checkpoint.baseModel,
    checkpoint.name,
    checkpoint.modelFileName,
  ].filter(Boolean).join(" ").toLocaleLowerCase();

  if (family.includes("anima")) {
    return "anima";
  }

  if (family.includes("illustrious")) {
    return "illustrious";
  }

  return "generic";
}

function toSelectedCivitaiResourcePreview(
  resource: StoryLocalResource,
  resourceType: "lora" | "model",
): SelectedCivitaiResourcePreview {
  return {
    id: resource.id,
    resourceType,
    name: resource.name,
    versionName: resource.versionName ?? null,
    baseModel: resource.modelBaseModel ?? resource.baseModel ?? null,
    creator: resource.creator ?? null,
    trainedWords: resource.trainedWords ?? [],
    tags: resource.tags ?? [],
    categories: resource.categories ?? [],
    usageGuide: resource.usageGuide ?? null,
    descriptionSnippet: resource.descriptionSnippet ?? null,
    averageWeight: resource.averageWeight ?? null,
    minWeight: resource.minWeight ?? null,
    maxWeight: resource.maxWeight ?? null,
    recommendations: resource.recommendations ?? [],
    previewImage: resource.previewImage ?? null,
    modelFileName: resource.modelFileName ?? resource.name,
    modelFileNameAliases: resource.modelFileNameAliases,
    modelStorageKind: resourceType === "model" ? resource.modelStorageKind : undefined,
    promptReferences: resource.promptReferences,
  };
}

function getSelectedResources(resourcePlan: StoryResourcePlan): SelectedCivitaiResourcesPreview {
  return {
    checkpoint: toSelectedCivitaiResourcePreview(resourcePlan.checkpoint.resource, "model"),
    loras: resourcePlan.loras.map((lora) => toSelectedCivitaiResourcePreview(lora.resource, "lora")),
  };
}

function getResourceRecommendationResult(resourcePlan: StoryResourcePlan): ResourceRecommendationTimelineResult {
  const checkpoint = toSelectedCivitaiResourcePreview(resourcePlan.checkpoint.resource, "model");
  const loras = resourcePlan.loras.map((lora) => ({
    resource: toSelectedCivitaiResourcePreview(lora.resource, "lora"),
    suggestedWeight: lora.suggestedWeight,
    reason: lora.reason,
  }));

  return {
    checkpoint: {
      resource: checkpoint,
      reason: resourcePlan.checkpoint.reason,
    },
    loras,
    candidates: {
      checkpoints: [
        {
          resource: checkpoint,
          importedImageCount: 1,
          commonCheckpoints: [],
          commonLoras: [],
          score: 1,
        },
      ],
      loras: loras.map((lora) => ({
        resource: lora.resource,
        importedImageCount: 1,
        commonCheckpoints: [],
        commonLoras: [],
        score: 1,
      })),
    },
    recommendationReason: resourcePlan.recommendationReason,
    overallEffect: resourcePlan.overallEffect,
    warnings: [...resourcePlan.warnings],
  };
}

function getScenePromptFromStoryShot({
  baseNegativePrompt,
  promptProfile,
  shot,
}: {
  baseNegativePrompt: string;
  promptProfile: PromptProfileId;
  shot: StoryShot;
}): ScenePromptTimelineResult {
  const positivePrompt = getBasePositivePrompt(shot);

  return {
    promptProfile,
    primaryCharacter: {
      name: shot.characterIds[0] ?? "Primary character",
      identity: positivePrompt,
      publicFacts: [...shot.continuityNotes],
    },
    sceneIntent: shot.description || shot.promptIntent,
    styleTone: "",
    setting: "",
    sharedFacts: [...shot.continuityNotes],
    positivePrompt,
    negativeSuggestions: baseNegativePrompt ? [baseNegativePrompt] : [],
    style: [],
    camera: shot.camera ? [{ label: "Camera", prompt: shot.camera }] : [],
    lighting: [],
  };
}

function createStoryAiAdvice({
  finalPositivePrompt,
  parameters,
  resourcePlan,
}: {
  finalPositivePrompt: string;
  parameters: StoryGenerationParameters;
  resourcePlan: StoryResourcePlan;
}): CivitaiAiPromptResult {
  return {
    prompt: finalPositivePrompt,
    parameterSuggestionReason: "SceneForge Story Graph reused the shared ComfyUI generation settings resolver.",
    overallEffect: resourcePlan.overallEffect,
    parseWarning: null,
    parameterSuggestions: {
      cfg: parameters.cfg,
      denoise: parameters.denoise,
      loraWeights: resourcePlan.loras.map((lora) => ({
        name: lora.resource.name,
        suggestedWeight: lora.suggestedWeight,
      })),
      negativePromptAdditions: "",
      resolution: `${parameters.width}x${parameters.height}`,
      sampler: parameters.samplerName,
      scheduler: parameters.scheduler,
      steps: parameters.steps,
      ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
    },
  };
}

function createStoryComfyUiSettings({
  baseNegativePrompt,
  formattedPositivePrompt,
  parameters,
  resourcePlan,
  supportsNsfw,
}: {
  baseNegativePrompt: string;
  formattedPositivePrompt: string;
  parameters: StoryGenerationParameters;
  resourcePlan: StoryResourcePlan;
  supportsNsfw: boolean;
}) {
  return resolveComfyUiGenerationSettings({
    activePrompt: formattedPositivePrompt,
    activePromptAlreadyFormatted: true,
    aiAdvice: createStoryAiAdvice({
      finalPositivePrompt: formattedPositivePrompt,
      parameters,
      resourcePlan,
    }),
    baseNegativePrompt,
    selectedResources: getSelectedResources(resourcePlan),
    supportsNsfw,
  });
}

function createFormattedStoryPositivePrompt({
  baseNegativePrompt,
  resourcePlan,
  shot,
  supportsNsfw,
}: {
  baseNegativePrompt: string;
  resourcePlan: StoryResourcePlan;
  shot: StoryShot;
  supportsNsfw: boolean;
}) {
  const promptProfile = inferPromptProfileFromCheckpoint(resourcePlan.checkpoint.resource);
  const resourceResult = getResourceRecommendationResult(resourcePlan);
  const scenePrompt = getScenePromptFromStoryShot({
    baseNegativePrompt,
    promptProfile,
    shot,
  });

  return buildTimelineFinalPositivePrompt({
    promptProfile,
    resourceResult,
    scenePrompt,
    supportsNsfw,
  });
}

function createShotComfyUiRequest(
  shot: StoryRenderPlanShot,
  storyId: string,
  nsfwContext: StoryNsfwContext,
): ComfyUiTextToImageRequest {
  const checkpoint = shot.resources.checkpoint.resource;
  const resourcePlan = {
    storyId,
    checkpoint: shot.resources.checkpoint,
    loras: shot.resources.loras,
    recommendationReason: "",
    overallEffect: "",
    warnings: [],
  };
  const settings = createStoryComfyUiSettings({
    baseNegativePrompt: shot.negativePrompt,
    formattedPositivePrompt: shot.positivePrompt,
    parameters: shot.parameters,
    resourcePlan,
    supportsNsfw: nsfwContext.enabled,
  });

  return {
    ...settings.request,
    cfg: shot.parameters.cfg,
    denoise: shot.parameters.denoise,
    height: shot.parameters.height,
    samplerName: shot.parameters.samplerName,
    scheduler: shot.parameters.scheduler,
    seed: shot.parameters.seed,
    steps: shot.parameters.steps,
    width: shot.parameters.width,
    workflowProfile: checkpoint.workflowProfile ?? settings.request.workflowProfile,
    clipName: checkpoint.clipName ?? settings.request.clipName,
    clipDevice: checkpoint.clipDevice ?? settings.request.clipDevice,
    vaeName: checkpoint.vaeName ?? settings.request.vaeName,
    unetWeightDtype: checkpoint.unetWeightDtype ?? settings.request.unetWeightDtype,
  };
}

export function createStoryResourcePlan({
  candidates,
  recommendation,
  storyId,
}: {
  candidates: ResourcePlanCandidates<StoryLocalResource>;
  recommendation: ResourcePlanRecommendation<StoryLocalResource>;
  storyId: string;
}): StoryResourcePlan {
  const result = validateLocalResourcePlan({
    candidates,
    recommendation,
    options: {
      areResourcesCompatible: isCompatibleStoryLora,
      onInvalidSelection: failStoryResourcePlan,
    },
  });

  return {
    ...result,
    storyId,
  };
}

export function createStoryParameterPlan({
  defaults,
  perShotOverrides = [],
  storyId,
  warnings = [],
}: {
  defaults: StoryGenerationParameters;
  perShotOverrides?: StoryParameterPlan["perShotOverrides"];
  storyId: string;
  warnings?: string[];
}): StoryParameterPlan {
  return {
    defaults: normalizeParameters(defaults),
    perShotOverrides: perShotOverrides.map((override) => ({
      ...override,
      parameters: { ...override.parameters },
    })),
    storyId,
    warnings: [...warnings],
  };
}

export function createStoryPreviewParameters(
  parameterPlan: StoryParameterPlan,
  options: StoryPreviewExecutionOptions,
  shotId: StoryShotId,
): StoryGenerationParameters {
  return applyParameterOverride(
    applyParameterOverride(parameterPlan.defaults, getPerShotOverride(parameterPlan, shotId)),
    options.parameterOverrides,
  );
}

export function assembleStoryRenderPlan({
  parameterPlan,
  previewOptions = defaultPreviewExecutionOptions,
  previewResultReferences = [],
  resourcePlan,
  safetyPlan,
  shots,
}: {
  parameterPlan: StoryParameterPlan;
  previewOptions?: StoryPreviewExecutionOptions;
  previewResultReferences?: StoryPreviewResultReference[];
  resourcePlan: StoryResourcePlan;
  safetyPlan: StorySafetyPlan;
  shots: readonly StoryShot[];
}): StoryRenderPlan {
  const nsfwContext = getNsfwContext(safetyPlan);

  return {
    storyId: resourcePlan.storyId,
    nsfwContext,
    preview: {
      options: {
        ...previewOptions,
        parameterOverrides: { ...previewOptions.parameterOverrides },
        shotIds: [...previewOptions.shotIds],
      },
      resultReferences: previewResultReferences.map((reference) => ({
        ...reference,
        parameters: { ...reference.parameters },
      })),
    },
    shots: shots.map((shot) => {
      const parameters = applyParameterOverride(parameterPlan.defaults, getPerShotOverride(parameterPlan, shot.id));
      const baseNegativePrompt = getBaseNegativePrompt(safetyPlan, shot.id);
      const positivePrompt = createFormattedStoryPositivePrompt({
        baseNegativePrompt,
        resourcePlan,
        shot,
        supportsNsfw: nsfwContext.enabled,
      });
      const settings = createStoryComfyUiSettings({
        baseNegativePrompt,
        formattedPositivePrompt: positivePrompt,
        parameters,
        resourcePlan,
        supportsNsfw: nsfwContext.enabled,
      });

      return {
        shotId: shot.id,
        order: shot.order,
        title: shot.title,
        positivePrompt: settings.request.positivePrompt,
        negativePrompt: settings.request.negativePrompt ?? "",
        sourceShotIds: [...shot.sourceShotIds],
        parameters,
        resources: {
          checkpoint: resourcePlan.checkpoint,
          loras: resourcePlan.loras,
        },
      };
    }),
    warnings: [...parameterPlan.warnings, ...resourcePlan.warnings],
  };
}

export function createStoryExecutionRequestBatch({
  mode,
  renderPlan,
}: {
  mode: "preview" | "final";
  renderPlan: StoryRenderPlan;
}): StoryExecutionRequestBatch {
  const selectedShotIds = mode === "preview"
    ? new Set(renderPlan.preview.options.enabled ? renderPlan.preview.options.shotIds : [])
    : null;
  const selectedShots = selectedShotIds
    ? renderPlan.shots.filter((shot) => selectedShotIds.has(shot.shotId))
    : renderPlan.shots;

  return {
    mode,
    nsfwContext: renderPlan.nsfwContext,
    requests: selectedShots.map((shot) => {
      const parameters = mode === "preview"
        ? createStoryPreviewParameters(
            {
              defaults: shot.parameters,
              perShotOverrides: [],
              storyId: renderPlan.storyId,
              warnings: [],
            },
            renderPlan.preview.options,
            shot.shotId,
          )
        : shot.parameters;
      const requestShot = {
        ...shot,
        parameters,
      };

      return {
        nsfwContext: renderPlan.nsfwContext,
        request: {
          ...createShotComfyUiRequest(requestShot, renderPlan.storyId, renderPlan.nsfwContext),
          preview: mode === "preview",
        },
        shotId: shot.shotId,
        sourceShotIds: [...shot.sourceShotIds],
      };
    }),
    storyId: renderPlan.storyId,
  };
}
