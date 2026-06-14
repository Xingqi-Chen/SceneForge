import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

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

export type StoryLocalResource = ResourcePlanLocalResource & {
  trainedWords?: string[];
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

function getPositivePrompt(shot: StoryShot, resourcePlan: StoryResourcePlan) {
  const trainedWords = resourcePlan.loras.flatMap((lora) => lora.resource.trainedWords ?? []);
  return [shot.promptIntent, shot.camera, ...trainedWords]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function getNegativePrompt(safetyPlan: StorySafetyPlan, shotId: StoryShotId) {
  const shotNotes = safetyPlan.perShotNotes.find((note) => note.shotId === shotId);
  return [...safetyPlan.blockedContent, ...(shotNotes?.mitigations ?? [])]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function createShotComfyUiRequest(shot: StoryRenderPlanShot): ComfyUiTextToImageRequest {
  const checkpoint = shot.resources.checkpoint.resource;
  return {
    cfg: shot.parameters.cfg,
    checkpointName: checkpoint.modelFileName ?? checkpoint.name,
    denoise: shot.parameters.denoise,
    height: shot.parameters.height,
    loras: shot.resources.loras.map((lora) => ({
      loraName: lora.resource.modelFileName ?? lora.resource.name,
      strengthModel: lora.suggestedWeight ?? 1,
    })),
    modelBaseModel: checkpoint.modelBaseModel,
    modelStorageKind: checkpoint.modelStorageKind,
    negativePrompt: shot.negativePrompt,
    positivePrompt: shot.positivePrompt,
    samplerName: shot.parameters.samplerName,
    scheduler: shot.parameters.scheduler,
    seed: shot.parameters.seed,
    steps: shot.parameters.steps,
    width: shot.parameters.width,
    workflowProfile: checkpoint.workflowProfile,
    clipName: checkpoint.clipName,
    clipDevice: checkpoint.clipDevice,
    vaeName: checkpoint.vaeName,
    unetWeightDtype: checkpoint.unetWeightDtype,
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
    shots: shots.map((shot) => ({
      shotId: shot.id,
      order: shot.order,
      title: shot.title,
      positivePrompt: getPositivePrompt(shot, resourcePlan),
      negativePrompt: getNegativePrompt(safetyPlan, shot.id),
      sourceShotIds: [...shot.sourceShotIds],
      parameters: applyParameterOverride(parameterPlan.defaults, getPerShotOverride(parameterPlan, shot.id)),
      resources: {
        checkpoint: resourcePlan.checkpoint,
        loras: resourcePlan.loras,
      },
    })),
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
          ...createShotComfyUiRequest(requestShot),
          preview: mode === "preview",
        },
        shotId: shot.shotId,
        sourceShotIds: [...shot.sourceShotIds],
      };
    }),
    storyId: renderPlan.storyId,
  };
}
