import type { ComfyUiTextToImageRequest } from "@/features/comfyui";
import type {
  CivitaiPromptReference,
  CivitaiResourceRecommendation,
  CivitaiLoraCategory,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import {
  parseComfyUiAiGenerationParameters,
  resolveComfyUiGenerationSettings,
} from "@/features/editor/ai-prompt/comfyui-generation-params";
import {
  splitPromptParts,
} from "@/features/editor/ai-prompt/illustrious-prompt";
import type { CivitaiAiPromptResult } from "@/features/editor/ai-prompt/civitai-ai-context";
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
  StoryInput,
  StorySourceImageEdgeSummary,
  StoryReferenceAsset,
} from "./story-types";
import {
  createStorySourceImageEdgeSummaries,
} from "./story-source-image-risk";
import {
  normalizeTimelineSamplerOptions,
  pickSupportedValue,
  type TimelineSamplerOptions,
} from "./timeline-sampler-options";

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
  exampleImageDimensions?: string[];
  importedImageCount?: number;
  commonCheckpoints?: Array<{ resourceId: string; name: string; count: number }>;
  commonLoras?: Array<{ resourceId: string; name: string; count: number }>;
  recommendationScore?: number;
  recommendationRank?: number;
  storyInputStrengthModel?: number;
  storyInputStrengthClip?: number;
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

type StoryGenerationParameterInput = Partial<Record<keyof StoryGenerationParameters, unknown>>;

type StoryParameterOverrideInput = {
  shotId: StoryShotId;
  parameters: StoryGenerationParameterInput;
  reason?: string;
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

export type StoryRenderPlanResourceRefs = {
  sourceNodeId: "resource-plan";
  checkpoint: {
    modelFileName?: string;
    name: string;
    resourceId: string;
  };
  loras: Array<{
    name: string;
    resourceId: string;
    suggestedWeight: number | null;
  }>;
};

export type StoryGenerationRequestPreview = {
  animaPromptParts: StoryAnimaPromptParts;
  negativePromptLength: number;
  negativePromptPreview: string;
  parameters: StoryGenerationParameters;
  positivePromptLength: number;
  positivePromptPreview: string;
  sourceImageEdges: StorySourceImageEdgeSummary[];
  shotId: StoryShotId;
  sourceMode: "none" | "source-image";
  sourceShotIds: StoryShotId[];
  title: string;
};

export type StoryAnimaPromptParts = {
  subjectTags: string[];
  characterTags: string[];
  seriesTags: string[];
  artistTags: string[];
  outfitTags: string[];
  propTags: string[];
  actionTags: string[];
  settingTags: string[];
  cameraTags: string[];
  lightingTags: string[];
  styleTags: string[];
  singleFrameCaption: string;
  negativeAdditions: string[];
};

export type StoryRenderPromptDraftShot = {
  shotId: StoryShotId;
  animaPromptParts: StoryAnimaPromptParts;
  rationale?: string;
  warnings?: string[];
};

export type StoryRenderPromptPlan = {
  storyId: string;
  shots: StoryRenderPromptDraftShot[];
  warnings: string[];
};

export type StoryRenderPlanShot = {
  shotId: StoryShotId;
  order: number;
  title: string;
  animaPromptParts: StoryAnimaPromptParts;
  positivePrompt: string;
  negativePrompt: string;
  outputAnchors: StoryOutputAnchors;
  sourceImageEdges: StorySourceImageEdgeSummary[];
  sourceShotIds: StoryShotId[];
  parameters: StoryGenerationParameters;
  resourceRefs: {
    checkpointResourceId: string;
    loraResourceIds: string[];
  };
  resources?: {
    checkpoint: StoryResourcePlan["checkpoint"];
    loras: StoryResourcePlan["loras"];
  };
  promptRationale?: string;
  promptWarnings?: string[];
};

export type StoryRenderPlan = {
  storyId: string;
  img2imgDenoise: number;
  nsfwContext: StoryNsfwContext;
  resourceRefs: StoryRenderPlanResourceRefs;
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

export type StoryOutputAnchors = Record<StoryPromptBucket, string[]> & {
  negative: string[];
  source: {
    mode: "none" | "source-image";
    risks: StorySourceImageEdgeSummary[];
    sourceShotIds: StoryShotId[];
    reason: string;
  };
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
const defaultStoryGenerationParameters = {
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 5.5,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  denoise: 1,
} satisfies StoryGenerationParameters;
export const DEFAULT_STORY_IMG2IMG_DENOISE = 0.9;
const storyAnimaPromptPrefix = [
  "masterpiece",
  "best quality",
  "score_7",
  "safe",
] as const;
const storySafeMinorNegativeTags = [
  "nsfw",
  "sexualized minor",
  "revealing clothes",
  "fetishized",
  "voyeurism",
  "gore",
  "severe injury",
];

function failStoryResourcePlan(message: string, details?: unknown): never {
  throw new StoryResourcePlanValidationError({ message, details });
}

function isCompatibleStoryLora(lora: StoryLocalResource, checkpoint: StoryLocalResource) {
  return !checkpoint.baseModel || !lora.baseModel || checkpoint.baseModel === lora.baseModel;
}

function normalizeDimension(value: number) {
  return Math.max(8, Math.round(value / 8) * 8);
}

function readExplicitDimensions(text: string) {
  const match = text.match(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/i);
  if (!match) {
    return null;
  }

  return {
    width: normalizeDimension(Number(match[1])),
    height: normalizeDimension(Number(match[2])),
  };
}

function getStoryDimensionText({
  input,
  shots,
}: {
  input?: StoryInput;
  shots?: readonly StoryShot[];
}) {
  return [
    input?.rawIntent,
    input?.storyContext,
    ...(input?.storySegments?.flatMap((segment) => [segment.title, segment.sourceText]) ?? []),
    ...(shots?.flatMap((shot) => [
      shot.title,
      shot.description,
      shot.promptIntent,
      shot.camera,
      ...shot.continuityNotes,
    ]) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function getStoryRecommendationDimensionText(recommendation: CivitaiResourceRecommendation) {
  return [
    recommendation.condition,
    recommendation.baseModel,
    recommendation.checkpoint,
    recommendation.sampler,
    recommendation.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

function getStoryResourceDimensionText(resourcePlan?: StoryResourcePlan) {
  if (!resourcePlan) {
    return "";
  }

  const resources = [
    resourcePlan.checkpoint.resource,
    ...resourcePlan.loras.map((lora) => lora.resource),
  ];

  return resources.flatMap((resource) => [
    resource.name,
    resource.versionName,
    resource.baseModel,
    resource.modelBaseModel,
    resource.modelFileName,
    ...(resource.modelFileNameAliases ?? []),
    ...(resource.tags ?? []),
    ...(resource.categories ?? []),
    resource.usageGuide,
    resource.descriptionSnippet,
    ...(resource.recommendations ?? []).map(getStoryRecommendationDimensionText),
  ])
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function inferStoryGenerationDimensions({
  input,
  resourcePlan,
}: {
  input?: StoryInput;
  resourcePlan?: StoryResourcePlan;
  shots?: readonly StoryShot[];
}) {
  const inputText = getStoryDimensionText({ input });
  const resourceText = getStoryResourceDimensionText(resourcePlan);
  const explicitDimensions =
    readExplicitDimensions(inputText)
    ?? readExplicitDimensions(resourceText);

  if (explicitDimensions) {
    return explicitDimensions;
  }

  return {
    width: defaultStoryGenerationParameters.width,
    height: defaultStoryGenerationParameters.height,
  };
}

function readFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readSeed(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizeStoryImg2ImgDenoise(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_STORY_IMG2IMG_DENOISE;
  }

  return Math.min(1, Math.max(0, Number(parsed.toFixed(2))));
}

export function getStoryInputImg2ImgDenoise(input?: StoryInput) {
  const settingsSnapshot = input?.settingsSnapshot;
  if (settingsSnapshot && typeof settingsSnapshot === "object" && !Array.isArray(settingsSnapshot)) {
    return normalizeStoryImg2ImgDenoise((settingsSnapshot as { img2imgDenoise?: unknown }).img2imgDenoise);
  }

  return DEFAULT_STORY_IMG2IMG_DENOISE;
}

function getReferenceSampler(resource: StoryLocalResource) {
  return resource.recommendations?.find((recommendation) => recommendation.sampler)?.sampler ?? undefined;
}

function getStoryModelFamilyText(resourcePlan: StoryResourcePlan) {
  return [
    resourcePlan.checkpoint.resource.modelBaseModel,
    resourcePlan.checkpoint.resource.baseModel,
    resourcePlan.checkpoint.resource.name,
    resourcePlan.checkpoint.resource.versionName,
    resourcePlan.checkpoint.resource.modelFileName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function getModelFamilySamplerDefaults(resourcePlan: StoryResourcePlan) {
  const family = getStoryModelFamilyText(resourcePlan);

  if (/\banima\b/.test(family)) {
    return {
      steps: 36,
      cfg: 4.5,
      samplerName: "er_sde",
      scheduler: "simple",
    };
  }

  if (/\b(?:anime|flux|qwen|z\s*image|lumina)\b/.test(family)) {
    return {
      steps: defaultStoryGenerationParameters.steps,
      cfg: defaultStoryGenerationParameters.cfg,
      samplerName: "euler",
      scheduler: "normal",
    };
  }

  return {
    steps: defaultStoryGenerationParameters.steps,
    cfg: defaultStoryGenerationParameters.cfg,
    samplerName: defaultStoryGenerationParameters.samplerName,
    scheduler: defaultStoryGenerationParameters.scheduler,
  };
}

export function createStoryDefaultGenerationParameters({
  input,
  resourcePlan,
  samplerOptions,
  shots,
}: {
  input?: StoryInput;
  resourcePlan: StoryResourcePlan;
  samplerOptions?: TimelineSamplerOptions;
  shots?: readonly StoryShot[];
}): StoryGenerationParameters {
  const referenceSampler = getReferenceSampler(resourcePlan.checkpoint.resource)
    ?? resourcePlan.loras.map((lora) => getReferenceSampler(lora.resource)).find(Boolean);
  const parsedSampler = parseComfyUiAiGenerationParameters({
    sampler: referenceSampler,
  });
  const familyDefaults = getModelFamilySamplerDefaults(resourcePlan);
  const dimensionDefaults = inferStoryGenerationDimensions({ input, resourcePlan, shots });

  return normalizeParameters({
    ...defaultStoryGenerationParameters,
    width: dimensionDefaults.width,
    height: dimensionDefaults.height,
    steps: familyDefaults.steps,
    cfg: familyDefaults.cfg,
    samplerName: parsedSampler?.samplerName ?? familyDefaults.samplerName,
    scheduler: parsedSampler?.scheduler ?? familyDefaults.scheduler,
  }, samplerOptions);
}

function normalizeParameters(
  parameters: StoryGenerationParameterInput,
  samplerOptions?: TimelineSamplerOptions,
  fallback: StoryGenerationParameters = defaultStoryGenerationParameters,
): StoryGenerationParameters {
  const normalizedSamplerOptions = samplerOptions ? normalizeTimelineSamplerOptions(samplerOptions) : null;
  const samplerName = readString(parameters.samplerName, fallback.samplerName);
  const scheduler = readString(parameters.scheduler, fallback.scheduler);
  const seed = readSeed(parameters.seed);

  return {
    width: normalizeDimension(readFiniteNumber(parameters.width, fallback.width)),
    height: normalizeDimension(readFiniteNumber(parameters.height, fallback.height)),
    steps: Math.max(1, Math.round(readFiniteNumber(parameters.steps, fallback.steps))),
    cfg: Number(readFiniteNumber(parameters.cfg, fallback.cfg).toFixed(2)),
    samplerName: normalizedSamplerOptions
      ? pickSupportedValue(samplerName, normalizedSamplerOptions.samplers, "euler")
      : samplerName,
    scheduler: normalizedSamplerOptions
      ? pickSupportedValue(scheduler, normalizedSamplerOptions.schedulers, "normal")
      : scheduler,
    denoise: Math.min(1, Math.max(0, Number(readFiniteNumber(parameters.denoise, fallback.denoise).toFixed(2)))),
    ...(seed !== undefined ? { seed } : {}),
  };
}

function hasOverrideValue(parameters: StoryGenerationParameterInput, key: keyof StoryGenerationParameters) {
  return Object.prototype.hasOwnProperty.call(parameters, key);
}

function normalizeParameterOverride(
  parameters: StoryGenerationParameterInput,
  defaults: StoryGenerationParameters,
  samplerOptions?: TimelineSamplerOptions,
): Partial<StoryGenerationParameters> {
  const normalized = normalizeParameters({
    ...defaults,
    ...parameters,
  }, samplerOptions, defaults);
  const override: Partial<StoryGenerationParameters> = {};

  if (hasOverrideValue(parameters, "steps")) {
    override.steps = normalized.steps;
  }

  if (hasOverrideValue(parameters, "cfg")) {
    override.cfg = normalized.cfg;
  }

  if (hasOverrideValue(parameters, "samplerName")) {
    override.samplerName = normalized.samplerName;
  }

  if (hasOverrideValue(parameters, "scheduler")) {
    override.scheduler = normalized.scheduler;
  }

  if (hasOverrideValue(parameters, "denoise")) {
    override.denoise = normalized.denoise;
  }

  if (hasOverrideValue(parameters, "seed") && normalized.seed !== undefined) {
    override.seed = normalized.seed;
  }

  return override;
}

function enforceStoryResolution(
  parameters: StoryGenerationParameters,
  resolution: Pick<StoryGenerationParameters, "width" | "height">,
): StoryGenerationParameters {
  return parameters.width === resolution.width && parameters.height === resolution.height
    ? parameters
    : {
        ...parameters,
        width: resolution.width,
        height: resolution.height,
      };
}

function applyParameterOverride(
  defaults: StoryGenerationParameters,
  override: Partial<StoryGenerationParameters> | undefined,
  samplerOptions?: TimelineSamplerOptions,
): StoryGenerationParameters {
  return normalizeParameters({
    ...defaults,
    ...override,
  }, samplerOptions);
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

const storyAnimaPromptPartArrayKeys = [
  "subjectTags",
  "characterTags",
  "seriesTags",
  "artistTags",
  "outfitTags",
  "propTags",
  "actionTags",
  "settingTags",
  "cameraTags",
  "lightingTags",
  "styleTags",
  "negativeAdditions",
] as const satisfies readonly (keyof StoryAnimaPromptParts)[];

const storyAnimaPromptPositivePartKeys = [
  "subjectTags",
  "characterTags",
  "seriesTags",
  "artistTags",
  "outfitTags",
  "propTags",
  "actionTags",
  "settingTags",
  "cameraTags",
  "lightingTags",
  "styleTags",
] as const satisfies readonly (keyof StoryAnimaPromptParts)[];

const storyAnimaPromptPartAliases = {
  actionTags: "action_tags",
  artistTags: "artist_tags",
  cameraTags: "camera_tags",
  characterTags: "character_tags",
  lightingTags: "lighting_tags",
  negativeAdditions: "negative_additions",
  outfitTags: "outfit_tags",
  propTags: "prop_tags",
  seriesTags: "series_tags",
  settingTags: "setting_tags",
  singleFrameCaption: "single_frame_caption",
  styleTags: "style_tags",
  subjectTags: "subject_tags",
} as const satisfies Record<keyof StoryAnimaPromptParts, string>;

function createEmptyStoryAnimaPromptParts(): StoryAnimaPromptParts {
  return {
    subjectTags: [],
    characterTags: [],
    seriesTags: [],
    artistTags: [],
    outfitTags: [],
    propTags: [],
    actionTags: [],
    settingTags: [],
    cameraTags: [],
    lightingTags: [],
    styleTags: [],
    singleFrameCaption: "",
    negativeAdditions: [],
  };
}

function dedupeExactPromptParts(parts: string[]) {
  const seen = new Set<string>();

  return parts.filter((part) => {
    if (!part || seen.has(part)) {
      return false;
    }

    seen.add(part);
    return true;
  });
}

function normalizeStoryAnimaPromptPart(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getStoryAnimaPromptPartSourceValue(
  source: Record<string, unknown>,
  key: keyof StoryAnimaPromptParts,
) {
  return source[key] ?? source[storyAnimaPromptPartAliases[key]];
}

export function normalizeStoryAnimaPromptParts(raw: unknown): StoryAnimaPromptParts {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const parts = createEmptyStoryAnimaPromptParts();

  for (const key of storyAnimaPromptPartArrayKeys) {
    const value = getStoryAnimaPromptPartSourceValue(source, key);
    parts[key] = Array.isArray(value)
      ? dedupeExactPromptParts(value.map(normalizeStoryAnimaPromptPart).filter(Boolean))
      : [];
  }

  parts.singleFrameCaption = normalizeStoryAnimaPromptPart(
    getStoryAnimaPromptPartSourceValue(source, "singleFrameCaption"),
  );

  return parts;
}

export function compileStoryAnimaPrompt(parts: StoryAnimaPromptParts): string {
  const normalized = normalizeStoryAnimaPromptParts(parts);

  return [
    ...storyAnimaPromptPrefix,
    ...storyAnimaPromptPositivePartKeys.flatMap((key) => normalized[key]),
    normalized.singleFrameCaption,
  ].filter(Boolean).join(", ");
}

function dedupeStoryPromptParts(parts: string[]) {
  const seen = new Set<string>();

  return parts.filter((part) => {
    const key = part.toLocaleLowerCase();
    if (!part || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getStoryRenderPromptDraft(shotId: StoryShotId, renderPromptPlan?: StoryRenderPromptPlan) {
  const draft = renderPromptPlan?.shots.find((candidate) => candidate.shotId === shotId);
  if (!draft) {
    return undefined;
  }

  return {
    ...draft,
    animaPromptParts: normalizeStoryAnimaPromptParts(draft.animaPromptParts),
    warnings: draft.warnings ? [...draft.warnings] : undefined,
  };
}

function normalizeStoryNegativePromptPart(value: string) {
  return value
    .replace(/<lora:[^>]+>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[.;:]+$/g, "")
    .trim();
}

function mergeStoryNegativePrompts(...values: string[]) {
  return dedupeStoryPromptParts(
    values
      .flatMap((value) => splitPromptParts(value))
      .map(normalizeStoryNegativePromptPart)
      .filter(Boolean),
  ).join(", ");
}

function getStoryRenderPromptDraftNegativeParts(renderPromptDraft?: StoryRenderPromptDraftShot) {
  return renderPromptDraft?.animaPromptParts.negativeAdditions ?? [];
}

function createFallbackStoryAnimaPromptParts(shot: StoryShot): StoryAnimaPromptParts {
  return normalizeStoryAnimaPromptParts({
    subjectTags: inferStoryAnimaSubjectCount(shot),
    characterTags: shot.characterIds,
    actionTags: [shot.promptIntent],
    settingTags: shot.continuityNotes,
    cameraTags: [shot.camera],
    singleFrameCaption: shot.description,
    negativeAdditions: [],
  });
}

function getStoryAnimaPromptPartsForShot(
  shot: StoryShot,
  renderPromptDraft?: StoryRenderPromptDraftShot,
): StoryAnimaPromptParts {
  return renderPromptDraft
    ? normalizeStoryAnimaPromptParts(renderPromptDraft.animaPromptParts)
    : createFallbackStoryAnimaPromptParts(shot);
}

function getBasePositivePrompt(parts: StoryAnimaPromptParts) {
  return compileStoryAnimaPrompt(parts);
}

function getShotSafetyText(shot: StoryShot) {
  return [
    shot.description,
    shot.promptIntent,
    ...shot.continuityNotes,
    ...shot.characterIds,
  ].join(" ");
}

function hasMinorSubject(shot: StoryShot, safetyPlan: StorySafetyPlan) {
  return /\b(?:minor|under\s*18|underage|teen|teenage|child|children|kid|little\s+girl|little\s+boy|schoolgirl|schoolboy)\b/i
    .test([
      getShotSafetyText(shot),
      ...safetyPlan.contentWarnings,
    ].join(" "));
}

function hasSexualViolenceStoryRisk(shot: StoryShot, safetyPlan: StorySafetyPlan) {
  const shotNotes = safetyPlan.perShotNotes
    .filter((note) => note.shotId === shot.id)
    .flatMap((note) => [...note.risks, ...note.mitigations]);
  return /\b(?:non-consensual|nonconsensual|sexual violence|coercion|forced sexual|assault)\b/i
    .test([
      getShotSafetyText(shot),
      ...safetyPlan.contentWarnings,
      ...shotNotes,
    ].join(" "));
}

function allowsAdultIntimateContent(safetyPlan: StorySafetyPlan) {
  const nsfwEnabled = safetyPlan.nsfwContext?.enabled ?? safetyPlan.audienceRating === "explicit";
  return nsfwEnabled && /\b(?:nudity|nude|sexualized self-touch|intimate adult|adult intimacy|explicit adult)\b/i
    .test([
      safetyPlan.audienceRating,
      ...safetyPlan.contentWarnings,
      safetyPlan.nsfwContext?.rationale ?? "",
    ].join(" "));
}

function getBaseNegativePrompt(safetyPlan: StorySafetyPlan, shot: StoryShot) {
  const nsfwEnabled = safetyPlan.nsfwContext?.enabled ?? safetyPlan.audienceRating === "explicit";
  const minorSubject = hasMinorSubject(shot, safetyPlan);
  const safeMinor = !nsfwEnabled && minorSubject;
  const adultNsfwSubject = nsfwEnabled && !minorSubject;
  const sexualViolenceRisk = hasSexualViolenceStoryRisk(shot, safetyPlan);
  const adultIntimacyAllowed = allowsAdultIntimateContent(safetyPlan);
  const normalized = [
    ...(safeMinor ? storySafeMinorNegativeTags : []),
    ...safetyPlan.blockedContent.flatMap(normalizeStorySafetyNegativePart),
  ]
    .flatMap(normalizeStorySafetyNegativePart)
    .filter((part, index, parts) => parts.findIndex((candidate) => candidate.toLocaleLowerCase() === part.toLocaleLowerCase()) === index)
    .filter((part) => !safeMinor || part !== "childlike face")
    .filter((part) => sexualViolenceRisk || !["non-consensual", "sexual violence", "coercion"].includes(part))
    .filter((part) => !(adultNsfwSubject && adultIntimacyAllowed && part === "explicit depiction of genitals or nipples"))
    .slice(0, 14);
  const order = [
    "nsfw",
    "sexualized minor",
    "age-gap romantic framing",
    "revealing clothes",
    "nude",
    "fetishized",
    "voyeurism",
    "non-consensual",
    "sexual violence",
    "coercion",
    "gore",
    "severe injury",
    "childlike face",
  ];

  return [
    ...order.filter((tag) => normalized.includes(tag)),
    ...normalized.filter((tag) => !order.includes(tag)),
  ]
    .join(", ");
}

function normalizeStorySafetyNegativePart(value: string) {
  const text = value.trim();
  const key = text.toLocaleLowerCase();
  const tags: string[] = [];

  if (!key) {
    return [];
  }

  if (/\b(?:sexualized|sexualization)\b/.test(key) && /\b(?:minors?|teen|teenage|teen-coded|child|children|girl|boy|under\s*16|underage)\b/.test(key)) {
    tags.push("sexualized minor", "childlike face");
  }

  if (/\b(?:romantic|sexual)\b/.test(key) && /\b(?:teen|teenage|child|children|minor|underage)\b/.test(key)) {
    tags.push("age-gap romantic framing");
  }

  if (/\bunder\s*16\b|\bunderage\b/.test(key)) {
    tags.push("sexualized minor", "childlike face");
  }

  if (/\bnudity\b|\bnude\b/.test(key)) {
    tags.push("nude");
  }

  if (/\bfetish\b|\bvoyeur/.test(key)) {
    tags.push("fetishized", "voyeurism");
  }

  if (/\bnon-consensual\b|\bnonconsensual\b/.test(key)) {
    tags.push("non-consensual");
  }

  if (/\bsexual violence\b|\bcoercion\b/.test(key)) {
    tags.push("sexual violence", "coercion");
  }

  if (/\bage-ambiguous\b|\bappear younger\b|\byounger than intended\b|\bchildlike\b/.test(key)) {
    tags.push("childlike face");
  }

  if (/\bgraphic\b|\bgore\b|\bsevere accident\b|\bbodily injury\b/.test(key)) {
    tags.push("gore", "severe injury");
  }

  if (/\bcriminal misconduct\b|\bcrime\b|\bcriminal\b/.test(key)) {
    tags.push("crime");
  }

  if (/\bdemeaning\b|\bstereotyped\b|\bstereotype\b/.test(key)) {
    tags.push("stereotype");
  }

  if (/\baging up\b|\baged up\b|\bportraying\b.*\badult\b.*\bbypass\b|\badult\b.*\bbypass\b/.test(key)) {
    tags.push("aged-up minor");
  }

  return tags.length > 0
    ? tags.filter((tag, index, allTags) => allTags.indexOf(tag) === index)
    : splitPromptParts(text).map(normalizeStoryAnchorPhrase).filter(Boolean);
}

type StoryPromptBucket =
  | "subject"
  | "appearance"
  | "clothing"
  | "action"
  | "environment"
  | "composition"
  | "camera"
  | "lighting"
  | "detail";

function createEmptyStoryPromptBuckets(): Record<StoryPromptBucket, string[]> {
  return {
    action: [],
    appearance: [],
    camera: [],
    clothing: [],
    composition: [],
    detail: [],
    environment: [],
    lighting: [],
    subject: [],
  };
}

function getStoryPromptBucket(value: string): StoryPromptBucket {
  const key = value.toLocaleLowerCase();

  if (/\bforced calm expression\b/.test(key)) {
    return "action";
  }

  if (/\b(?:eye level|street-level|low angle|high angle|medium(?:-| )?full|medium(?:-| )?close|close-up|wide|shot|angle|camera|handheld|desk height)\b/.test(key)) {
    return "camera";
  }

  if (/\b(?:rainy evening\b.*\bwarm interior contrast|warm low-key room lighting|soft warm amber lighting|light|lighting|daylight|fluorescent|sodium|overcast|reflections?|shadow|neutral)\b/.test(key)) {
    return "lighting";
  }

  if (/\b(?:starts? slipping|slipping|sliding off|loosened|lowered|remove|removing|undress|undressing|unveiling|revealing shoulders|more exposed|touching|hand-to-chest|brings one hand|seated|sitting|legs crossed|kneel|kneeling|ride|riding|run|running|sprint|sprinting|catch|catching|falling|snapped|jammed|locking?|sliding|return slot|abandoning?|boards?|steps?|slides?|grips?|clutch|holds?|holding|carries?|carry|carrying|tucked|lift|lifting|checks?|launches?|struggles?|trying|smooth|smoothing|knock|knocking|expression|hands?)\b/.test(key)) {
    return "action";
  }

  if (/\b(?:rupa|teen|messenger|courier|protagonist|character|person|man|woman|boy|girl|father|mother|child|recipient|lead)\b/.test(key)) {
    return "subject";
  }

  if (/\b(?:hair|freckles|face|eyes?|glasses|expression|drenched|soaked|wettest|disheveled|silhouette|bare shoulders|soft features)\b/.test(key)) {
    return "appearance";
  }

  if (/\b(?:raincoat|jacket|cardigan|sweater|shirt|jeans|sneakers|shoes|boots?|coat|uniform|clothing|outfit|wearing|hat|wardrobe|costume|same outfit|same clothes)\b/.test(key)) {
    return "clothing";
  }

  if (/\bgrease\b/.test(key)) {
    return "detail";
  }

  if (/\b(?:foreground|background|center|compose|composition|framing|depth|three-quarter|lower center|sharp focal point)\b/.test(key)) {
    return "composition";
  }

  if (/\b(?:cinematic|illustrated|realism|texture|textures|material|materials|grit|grime|damp|wet asphalt)\b/.test(key)) {
    return "detail";
  }

  if (/\b(?:market|street|sidewalk|crosswalk|bus|depot|courthouse|lobby|desk|city|alley|station|plaza|hallway|library|stairwell|apartment|doorway|bakery|umbrellas?|stalls?|puddles?|traffic|architecture|interior|exterior|background|environment|bridge route|barricades?)\b/.test(key)) {
    return "environment";
  }

  return "detail";
}

function normalizeStoryAnchorPhrase(value: string) {
  let normalized = value
    .replace(/\b(?:around\s+)?1[0-7]\s*(?:to|-)\s*1[0-7]\s*(?:year\s*old)?\b/gi, "teenage")
    .replace(/\b(?:age\s*)?16\s*(?:to|-)\s*18\b/gi, "older teen")
    .replace(/\bmale-presenting teen\b/gi, "older teen male")
    .replace(/\bteen-coded\b/gi, "older teen")
    .replace(/\s+/g, " ")
    .replace(/[.;:]+$/g, "")
    .trim();
  const key = normalized.toLocaleLowerCase();

  if (!normalized || key === "safe") {
    return "";
  }

  if (
    /^(?:show only|this shot marks|despite crowded setting|visible human subjects?|visible human subject)\b/i.test(normalized) ||
    /\bshould (?:look|feel|show|remain)\b/i.test(normalized) ||
    /\b(?:must clearly signal|may still show|as only clear visible subject)\b/i.test(normalized)
  ) {
    return "";
  }

  if (/^extra\s+.+\s+description$/i.test(normalized)) {
    return "";
  }

  if (/^(?:maya|hair|compose|include|show|use|place her beside glass|her visible)$/i.test(normalized)) {
    return "";
  }

  if (/^(?:around\s+)?(?:\d{1,2}\s*(?:to|-)\s*\d{1,2}|older teen|teenage)$/i.test(normalized)) {
    return "";
  }

  if (/\bbicycl|bike\b/.test(key) && /\bnarrow alley\b/.test(key) && /\b(?:lift|lifting|carry|carrying|grip|gripping|squeez|squeeze)\b/.test(key)) {
    return "lifting bicycle through narrow alley";
  }

  if (/\bpolice barricades?\b/.test(key) && /\bbridge route\b/.test(key)) {
    return "distant police barricades near bridge route";
  }

  if (/\bcatch/.test(key) && /\bfalling bakery box\b/.test(key)) {
    return "catching falling bakery box";
  }

  if (/\bsnapped backpack strap\b/.test(key)) {
    return "snapped backpack strap";
  }

  if (/\babandon/.test(key) && /\bbicycl|bike\b/.test(key)) {
    return "abandoning bicycle";
  }

  if (/\bbox\b/.test(key) && /\btucked\b/.test(key) && /\brain jacket\b/.test(key)) {
    return "box tucked under rain jacket";
  }

  if (/\bbright yellow rain jacket\b/.test(key)) {
    return "bright yellow rain jacket";
  }

  if (/\brunning\b/.test(key) && /\bblocked crosswalk\b/.test(key)) {
    return "running through blocked crosswalk";
  }

  if (/\bsmoothing\b/.test(key) && /\bcrushed box corner\b/.test(key)) {
    return "smoothing crushed box corner";
  }

  if (/\bknocking\b/.test(key) && /\bapartment door\b/.test(key)) {
    return "knocking at apartment door";
  }

  if (/\briding\b/.test(key) && /\bshaky bicycl/.test(key)) {
    return "riding shaky bicycle";
  }

  if (/\bwheel\b/.test(key) && /\bjammed\b/.test(key)) {
    return "wheel jammed";
  }

  if (/\blocks?\b|\blocking\b/.test(key) && /\bbicycl|bike\b/.test(key) && /\bsprint/.test(key)) {
    return "locking bicycle then sprinting";
  }

  if (/\bslide|sliding\b/.test(key) && /\bbook\b/.test(key) && /\breturn slot\b/.test(key)) {
    return "sliding book through return slot";
  }

  if (/\brainy evening\b/.test(key) && /\bwarm interior contrast\b/.test(key)) {
    return "rainy evening with warm interior contrast";
  }

  if (/\bwarm low-key room lighting\b/.test(key)) {
    return "warm low-key room lighting";
  }

  if (/\bsoft warm amber lighting\b/.test(key)) {
    return "soft warm amber lighting";
  }

  if (/\brides?\b/.test(key) && /\bshaky bicycl/.test(key)) {
    return "riding shaky bicycle";
  }

  if (/\b(?:touch(?:es|ing)?|hand-to-chest)\b/.test(key) && /\b(?:chest|hand-to-chest)\b/.test(key)) {
    return "hand-to-chest gesture";
  }

  if (/\bsliding off\b/.test(key) && /\breveal(?:ing)? (?:her )?shoulders?\b/.test(key)) {
    return "loosened clothing sliding off shoulders";
  }

  if (/\bstarts? slipping\b/.test(key) && /\breveal(?:ing)? (?:her )?shoulders?\b/.test(key)) {
    return "slipping clothing down to reveal shoulders";
  }

  if (/\blowered further\b/.test(key) && /\bupper body more exposed\b/.test(key)) {
    return "lowered clothing exposing upper body";
  }

  if (/\bseated\b/.test(key) && /\bsame chair\b/.test(key) && /\blegs crossed\b/.test(key)) {
    return "seated on same chair with legs crossed";
  }

  normalized = normalized
    .replace(/^(?:and|then|while)\s+/i, "")
    .replace(/^(?:he|she|they)\s+should\s+(?:be\s+|look\s+|remain\s+|show\s+)?/i, "")
    .replace(/^(?:maintain|preserve)\s+(?:the\s+)?(?:same\s+|clear\s+)?/i, "")
    .replace(/^(?:use|show)\s+/i, "")
    .replace(/^keep\s+(?:the\s+)?(?:same\s+)?/i, "")
    .replace(/^any\s+/i, "")
    .replace(/^the\s+lead\s+notices\s+(?:a\s+|the\s+)?/i, "lead noticing ")
    .replace(/\b(?:must\s+)?remain(?:s)?\s+(?:clearly\s+)?(?:visible|readable)\b/gi, "visible")
    .replace(/\bvisible\s+in\s+(?:every|each|the)\s+(?:frame|shot|scene)\b/gi, "visible")
    .replace(/\b(?:must clearly signal|may still show|as only clear visible subject)\b/gi, "")
    .replace(/\b(?:every|each)\s+(?:frame|shot|scene)\b/gi, "")
    .replace(/\bwardrobe\s+continuity\b/gi, "consistent wardrobe")
    .replace(/\bsame\s+bright\s+yellow\s+rain\s+jacket\b/gi, "bright yellow rain jacket")
    .replace(/\bthe\s+same\s+bright\s+yellow\s+rain\s+jacket\b/gi, "bright yellow rain jacket")
    .replace(/\bthe\s+/gi, "")
    .replace(/\ba\s+/gi, "")
    .replace(/\ban\s+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:]+$/g, "")
    .trim();

  if (
    /\b(?:with|and|or|as|such as|mixed|more|bright|blocked|compose|include|show|use|distant|far|from|to|subtly|toward|towards)$/i.test(normalized) ||
    /\b(?:brings one hand|key new action(?: in this final shot)?)$/i.test(normalized) ||
    /^(?:traffic lights to show urgency|grease on hands)$/i.test(normalized)
  ) {
    return "";
  }

  return /\b(?:with|and|or|as|such as|mixed|more|bright|blocked|compose|include|show|use|distant|far|from|to|subtly|toward|towards)$/i.test(normalized)
    ? ""
    : normalized;
}

function getStoryPositiveAnchorBuckets(positivePrompt: string): Record<StoryPromptBucket, string[]> {
  const buckets = createEmptyStoryPromptBuckets();

  for (const part of splitPromptParts(positivePrompt)) {
    const bucket = getStoryPromptBucket(part);
    buckets[bucket].push(part);
  }

  return buckets;
}

function getShotSubjectText(shot: StoryShot) {
  return [
    ...shot.characterIds,
    shot.description,
    shot.promptIntent,
    ...shot.continuityNotes,
  ].join(" ").toLocaleLowerCase();
}

function countSubjectMatches(text: string, pattern: RegExp) {
  const matches = text.match(pattern) ?? [];
  return matches.length;
}

function hasAdultSubjectContext(text: string) {
  return /\b(?:adult|college|college-age|university|woman|women|man|men|mother|father)\b/.test(text);
}

function inferStoryAnimaSubjectCount(shot: StoryShot) {
  const subjectCount = Math.max(1, shot.characterIds.length);
  const text = getShotSubjectText(shot);
  const femaleCount = Math.min(
    subjectCount,
    countSubjectMatches(text, /\b(?:girl|woman|female|mother|daughter|sister|heroine|maya)\b/g),
  );
  const maleCount = Math.min(
    subjectCount - femaleCount,
    countSubjectMatches(text, /\b(?:man|male|father|boy|son|brother|he|his)\b/g),
  );

  if (subjectCount === 1) {
    if (femaleCount > 0) {
      return ["1girl", "solo"];
    }

    if (maleCount > 0) {
      return [/\b(?:man|father)\b/.test(text) ? "1man" : "1boy", "solo"];
    }

    return ["solo"];
  }

  if (hasAdultSubjectContext(text)) {
    return [`${subjectCount}people`];
  }

  if (femaleCount + maleCount === subjectCount) {
    const maleTag = /\b(?:man|father)\b/.test(text)
      ? `${maleCount}${maleCount === 1 ? "man" : "men"}`
      : `${maleCount}boy${maleCount === 1 ? "" : "s"}`;

    return [
      ...(femaleCount > 0 ? [`${femaleCount}girl${femaleCount === 1 ? "" : "s"}`] : []),
      ...(maleCount > 0 ? [maleTag] : []),
    ];
  }

  return [`${subjectCount}people`];
}

function createStoryOutputAnchors({
  baseNegativePrompt,
  basePositivePrompt,
  sourceImageEdges,
  sourceShotIds,
}: {
  baseNegativePrompt: string;
  basePositivePrompt: string;
  sourceImageEdges: StorySourceImageEdgeSummary[];
  sourceShotIds: StoryShotId[];
}): StoryOutputAnchors {
  return {
    ...getStoryPositiveAnchorBuckets(basePositivePrompt),
    negative: splitPromptParts(baseNegativePrompt),
    source: {
      mode: sourceShotIds.length > 0 ? "source-image" : "none",
      risks: sourceImageEdges.map((edge) => ({
        ...edge,
        riskFactors: [...edge.riskFactors],
        sourceChain: [...edge.sourceChain],
      })),
      sourceShotIds: [...sourceShotIds],
      reason: sourceShotIds.length > 0
        ? "This shot will receive previous generated image inputs from the listed source shots."
        : "No previous generated image is injected; continuity is prompt-only for this shot.",
    },
  };
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
    exampleImageDimensions: resource.exampleImageDimensions,
  };
}

function getSelectedResources(resourcePlan: StoryResourcePlan): SelectedCivitaiResourcesPreview {
  return {
    checkpoint: toSelectedCivitaiResourcePreview(resourcePlan.checkpoint.resource, "model"),
    loras: resourcePlan.loras.map((lora) => toSelectedCivitaiResourcePreview(lora.resource, "lora")),
  };
}

export function getSelectedStoryResourcesForPrompting(resourcePlan: StoryResourcePlan): SelectedCivitaiResourcesPreview {
  return getSelectedResources(resourcePlan);
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
  const settings = resolveComfyUiGenerationSettings({
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
  const storyInputLoraWeights = new Map(
    resourcePlan.loras
      .filter((lora) =>
        lora.resource.storyInputStrengthModel !== undefined ||
        lora.resource.storyInputStrengthClip !== undefined,
      )
      .map((lora) => [lora.resource.modelFileName ?? lora.resource.name, lora.resource]),
  );

  if (storyInputLoraWeights.size === 0) {
    return settings;
  }

  return {
    ...settings,
    request: {
      ...settings.request,
      loras: (settings.request.loras ?? []).map((lora) => {
        const weights = storyInputLoraWeights.get(lora.loraName);

        return weights
          ? {
              ...lora,
              strengthModel: weights.storyInputStrengthModel ?? lora.strengthModel,
              strengthClip: weights.storyInputStrengthClip ?? lora.strengthClip,
            }
          : lora;
      }),
    },
  };
}

export function createStoryReferencePlateComfyUiRequest({
  nsfwContext,
  parameterPlan,
  reference,
  resourcePlan,
  samplerOptions,
}: {
  nsfwContext: StoryNsfwContext;
  parameterPlan: StoryParameterPlan;
  reference: StoryReferenceAsset;
  resourcePlan: StoryResourcePlan;
  samplerOptions?: TimelineSamplerOptions;
}): ComfyUiTextToImageRequest {
  const checkpoint = resourcePlan.checkpoint.resource;
  const parameters = normalizeParameters(parameterPlan.defaults, samplerOptions);
  const formattedPositivePrompt = [
    reference.canonicalPrompt,
    "single clean reference plate",
    "neutral background",
    "clear readable design",
    "front-facing visual reference",
  ].filter(Boolean).join(", ");
  const settings = createStoryComfyUiSettings({
    baseNegativePrompt: [
      "text",
      "watermark",
      "logo",
      "multi-panel layout",
      "multiple unrelated characters",
      "cropped subject",
      "low quality",
    ].join(", "),
    formattedPositivePrompt,
    parameters,
    resourcePlan,
    supportsNsfw: nsfwContext.enabled,
  });

  return {
    ...settings.request,
    batchSize: 1,
    cfg: parameters.cfg,
    denoise: parameters.denoise,
    height: parameters.height,
    outputPrefix: `sceneforge-story-reference-${reference.referenceType}`,
    samplerName: parameters.samplerName,
    scheduler: parameters.scheduler,
    seed: parameters.seed,
    steps: parameters.steps,
    width: parameters.width,
    workflowProfile: checkpoint.workflowProfile ?? settings.request.workflowProfile,
    clipName: checkpoint.clipName ?? settings.request.clipName,
    clipDevice: checkpoint.clipDevice ?? settings.request.clipDevice,
    vaeName: checkpoint.vaeName ?? settings.request.vaeName,
    unetWeightDtype: checkpoint.unetWeightDtype ?? settings.request.unetWeightDtype,
  };
}

function createFormattedStoryPositivePrompt({
  animaPromptParts,
}: {
  animaPromptParts: StoryAnimaPromptParts;
}) {
  return compileStoryAnimaPrompt(animaPromptParts);
}

function createStoryRenderPlanResourceRefs(resourcePlan: StoryResourcePlan): StoryRenderPlanResourceRefs {
  return {
    sourceNodeId: "resource-plan",
    checkpoint: {
      resourceId: resourcePlan.checkpoint.resource.id,
      name: resourcePlan.checkpoint.resource.name,
      modelFileName: resourcePlan.checkpoint.resource.modelFileName ?? undefined,
    },
    loras: resourcePlan.loras.map((lora) => ({
      resourceId: lora.resource.id,
      name: lora.resource.name,
      suggestedWeight: lora.suggestedWeight,
    })),
  };
}

function compactRequestPromptPreview(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function createStoryGenerationRequestPreview(
  shot: StoryRenderPlanShot,
  img2imgDenoise = DEFAULT_STORY_IMG2IMG_DENOISE,
): StoryGenerationRequestPreview {
  const normalizedImg2ImgDenoise = normalizeStoryImg2ImgDenoise(img2imgDenoise);

  return {
    animaPromptParts: {
      ...shot.animaPromptParts,
      actionTags: [...shot.animaPromptParts.actionTags],
      artistTags: [...shot.animaPromptParts.artistTags],
      cameraTags: [...shot.animaPromptParts.cameraTags],
      characterTags: [...shot.animaPromptParts.characterTags],
      lightingTags: [...shot.animaPromptParts.lightingTags],
      negativeAdditions: [...shot.animaPromptParts.negativeAdditions],
      outfitTags: [...shot.animaPromptParts.outfitTags],
      propTags: [...shot.animaPromptParts.propTags],
      settingTags: [...shot.animaPromptParts.settingTags],
      styleTags: [...shot.animaPromptParts.styleTags],
      subjectTags: [...shot.animaPromptParts.subjectTags],
      seriesTags: [...shot.animaPromptParts.seriesTags],
    },
    negativePromptLength: shot.negativePrompt.length,
    negativePromptPreview: compactRequestPromptPreview(shot.negativePrompt),
    parameters: {
      ...shot.parameters,
      ...(shot.sourceShotIds.length > 0 ? { denoise: normalizedImg2ImgDenoise } : {}),
    },
    positivePromptLength: shot.positivePrompt.length,
    positivePromptPreview: compactRequestPromptPreview(shot.positivePrompt),
    sourceImageEdges: (shot.sourceImageEdges ?? []).map((edge) => ({
      ...edge,
      riskFactors: [...edge.riskFactors],
      sourceChain: [...edge.sourceChain],
    })),
    shotId: shot.shotId,
    sourceMode: shot.sourceShotIds.length > 0 ? "source-image" : "none",
    sourceShotIds: [...shot.sourceShotIds],
    title: shot.title,
  };
}

function getLegacyResourcePlanFromShot(
  shot: StoryRenderPlanShot,
  storyId: string,
): StoryResourcePlan | null {
  if (!shot.resources) {
    return null;
  }

  return {
    storyId,
    checkpoint: shot.resources.checkpoint,
    loras: shot.resources.loras,
    recommendationReason: "",
    overallEffect: "",
    warnings: [],
  };
}

function createShotComfyUiRequest(
  shot: StoryRenderPlanShot,
  storyId: string,
  nsfwContext: StoryNsfwContext,
  resourcePlan: StoryResourcePlan,
  samplerOptions?: TimelineSamplerOptions,
): ComfyUiTextToImageRequest {
  const checkpoint = resourcePlan.checkpoint.resource;
  const parameters = normalizeParameters(shot.parameters, samplerOptions);
  const settings = createStoryComfyUiSettings({
    baseNegativePrompt: shot.negativePrompt,
    formattedPositivePrompt: shot.positivePrompt,
    parameters,
    resourcePlan,
    supportsNsfw: nsfwContext.enabled,
  });

  return {
    ...settings.request,
    cfg: parameters.cfg,
    denoise: parameters.denoise,
    height: parameters.height,
    samplerName: parameters.samplerName,
    scheduler: parameters.scheduler,
    seed: parameters.seed,
    steps: parameters.steps,
    width: parameters.width,
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
  samplerOptions,
  storyId,
  warnings = [],
}: {
  defaults: StoryGenerationParameters;
  perShotOverrides?: StoryParameterOverrideInput[];
  samplerOptions?: TimelineSamplerOptions;
  storyId: string;
  warnings?: string[];
}): StoryParameterPlan {
  const normalizedDefaults = normalizeParameters(defaults, samplerOptions);

  return {
    defaults: normalizedDefaults,
    perShotOverrides: perShotOverrides.map((override) => ({
      ...override,
      parameters: normalizeParameterOverride(override.parameters, normalizedDefaults, samplerOptions),
    })),
    storyId,
    warnings: [...warnings],
  };
}

export function createStoryPreviewParameters(
  parameterPlan: StoryParameterPlan,
  options: StoryPreviewExecutionOptions,
  shotId: StoryShotId,
  samplerOptions?: TimelineSamplerOptions,
): StoryGenerationParameters {
  const defaults = normalizeParameters(parameterPlan.defaults, samplerOptions);
  const shotParameters = enforceStoryResolution(
    applyParameterOverride(defaults, getPerShotOverride(parameterPlan, shotId), samplerOptions),
    defaults,
  );

  return applyParameterOverride(
    shotParameters,
    options.parameterOverrides,
    samplerOptions,
  );
}

export function assembleStoryRenderPlan({
  img2imgDenoise = DEFAULT_STORY_IMG2IMG_DENOISE,
  parameterPlan,
  previewOptions = defaultPreviewExecutionOptions,
  previewResultReferences = [],
  resourcePlan,
  renderPromptPlan,
  samplerOptions,
  safetyPlan,
  shots,
}: {
  img2imgDenoise?: number;
  parameterPlan: StoryParameterPlan;
  previewOptions?: StoryPreviewExecutionOptions;
  previewResultReferences?: StoryPreviewResultReference[];
  resourcePlan: StoryResourcePlan;
  renderPromptPlan?: StoryRenderPromptPlan;
  samplerOptions?: TimelineSamplerOptions;
  safetyPlan: StorySafetyPlan;
  shots: readonly StoryShot[];
}): StoryRenderPlan {
  const nsfwContext = getNsfwContext(safetyPlan);
  const defaultParameters = normalizeParameters(parameterPlan.defaults, samplerOptions);
  const normalizedImg2ImgDenoise = normalizeStoryImg2ImgDenoise(img2imgDenoise);
  const renderWarnings: string[] = [];
  const sourceImageEdges = createStorySourceImageEdgeSummaries(shots);
  renderWarnings.push(
    ...sourceImageEdges
      .filter((edge) => edge.riskLevel === "high")
      .map((edge) =>
        `Shot "${edge.targetShotId}" uses high-risk source image "${edge.sourceShotId}": ${edge.riskReason}`,
      ),
  );
  const renderShots = shots.map((shot) => {
    const shotSourceImageEdges = sourceImageEdges.filter((edge) => edge.targetShotId === shot.id);
    const parameters = enforceStoryResolution(
      applyParameterOverride(
        defaultParameters,
        getPerShotOverride(parameterPlan, shot.id),
        samplerOptions,
      ),
      defaultParameters,
    );
    const renderPromptDraft = getStoryRenderPromptDraft(shot.id, renderPromptPlan);
    if (renderPromptPlan && !renderPromptDraft) {
      renderWarnings.push(`Shot "${shot.id}" did not receive LLM Anima prompt parts; using local prompt fallback.`);
    }
    const animaPromptParts = getStoryAnimaPromptPartsForShot(shot, renderPromptDraft);
    const basePositivePrompt = getBasePositivePrompt(animaPromptParts);
    const baseNegativePrompt = mergeStoryNegativePrompts(
      getBaseNegativePrompt(safetyPlan, shot),
      getStoryRenderPromptDraftNegativeParts(renderPromptDraft).join(", "),
    );
    const formattedPositivePrompt = createFormattedStoryPositivePrompt({
      animaPromptParts,
    });
    const settings = createStoryComfyUiSettings({
      baseNegativePrompt,
      formattedPositivePrompt,
      parameters,
      resourcePlan,
      supportsNsfw: nsfwContext.enabled,
    });

    const promptWarnings = renderPromptDraft?.warnings ?? [];

    return {
      shotId: shot.id,
      order: shot.order,
      title: shot.title,
      animaPromptParts,
      positivePrompt: settings.request.positivePrompt,
      negativePrompt: settings.request.negativePrompt ?? "",
      outputAnchors: createStoryOutputAnchors({
        baseNegativePrompt,
        basePositivePrompt,
        sourceImageEdges: shotSourceImageEdges,
        sourceShotIds: shot.sourceShotIds,
      }),
      sourceImageEdges: shotSourceImageEdges.map((edge) => ({
        ...edge,
        riskFactors: [...edge.riskFactors],
        sourceChain: [...edge.sourceChain],
      })),
      sourceShotIds: [...shot.sourceShotIds],
      parameters,
      resourceRefs: {
        checkpointResourceId: resourcePlan.checkpoint.resource.id,
        loraResourceIds: resourcePlan.loras.map((lora) => lora.resource.id),
      },
      ...(renderPromptDraft
        ? {
            promptRationale: renderPromptDraft.rationale,
            ...(promptWarnings.length > 0 ? { promptWarnings } : {}),
          }
        : {}),
    };
  });

  return {
    storyId: resourcePlan.storyId,
    img2imgDenoise: normalizedImg2ImgDenoise,
    nsfwContext,
    resourceRefs: createStoryRenderPlanResourceRefs(resourcePlan),
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
    shots: renderShots,
    warnings: [
      ...parameterPlan.warnings,
      ...resourcePlan.warnings,
      ...(renderPromptPlan?.warnings ?? []),
      ...renderWarnings,
    ],
  };
}

export function createStoryExecutionRequestBatch({
  mode,
  renderPlan,
  resourcePlan,
  samplerOptions,
}: {
  mode: "preview" | "final";
  renderPlan: StoryRenderPlan;
  resourcePlan?: StoryResourcePlan;
  samplerOptions?: TimelineSamplerOptions;
}): StoryExecutionRequestBatch {
  const selectedShotIds = mode === "preview"
    ? new Set(renderPlan.preview.options.enabled ? renderPlan.preview.options.shotIds : [])
    : null;
  const selectedShots = selectedShotIds
    ? renderPlan.shots.filter((shot) => selectedShotIds.has(shot.shotId))
    : renderPlan.shots;
  const storyResolution = mode === "final" && renderPlan.shots[0]
    ? normalizeParameters(renderPlan.shots[0].parameters, samplerOptions)
    : null;

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
            samplerOptions,
          )
        : normalizeParameters(shot.parameters, samplerOptions);
      const requestParameters = storyResolution
        ? enforceStoryResolution(parameters, storyResolution)
        : parameters;
      const requestShot = {
        ...shot,
        parameters: requestParameters,
      };
      const requestResourcePlan = resourcePlan ?? getLegacyResourcePlanFromShot(shot, renderPlan.storyId);

      if (!requestResourcePlan) {
        throw new StoryResourcePlanValidationError({
          message: "Story execution requires the resource-plan result to assemble ComfyUI requests.",
          details: {
            shotId: shot.shotId,
            renderPlanResourceRefs: renderPlan.resourceRefs,
          },
        });
      }

      return {
        nsfwContext: renderPlan.nsfwContext,
        request: {
          ...createShotComfyUiRequest(
            requestShot,
            renderPlan.storyId,
            renderPlan.nsfwContext,
            requestResourcePlan,
            samplerOptions,
          ),
          denoise: shot.sourceShotIds.length > 0 ? renderPlan.img2imgDenoise : requestParameters.denoise,
          preview: mode === "preview",
        },
        shotId: shot.shotId,
        sourceShotIds: [...shot.sourceShotIds],
      };
    }),
    storyId: renderPlan.storyId,
  };
}
