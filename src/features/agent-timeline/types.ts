import type {
  CivitaiRecommendationCandidate,
  SelectedCivitaiResourcePreview,
} from "@/features/civitai-lora-library";
import type { ComfyUiTextToImageRequest } from "@/features/comfyui";
import type {
  BodyPartId,
  PromptTag,
  SceneObject3DTransform,
} from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";
import type { PromptProfileId } from "@/shared/prompt-profile";
import type { AnimaPromptSections } from "@/features/editor/ai-prompt/anima-prompt";
import type { IllustriousPromptSections } from "@/features/editor/ai-prompt/illustrious-prompt";
import type { TimelineWorkflowMode } from "./workflow-definitions";
import type { RunSceneInputSettingsSnapshot } from "./run-input-settings";
import type { StyleReferenceSnapshot } from "./style-reference";

export type AnimaPromptProfileOptions = {
  qualityMetaTags?: string[];
};

export const timelineNodeStatuses = [
  "blocked",
  "ready",
  "running",
  "done",
  "stale",
  "error",
  "manual",
] as const;

export type TimelineNodeStatus = (typeof timelineNodeStatuses)[number];

export const timelineNodeIds = [
  "scene-input",
  "scene-prompt",
  "character-tags",
  "character-action",
  "canvas-binding",
  "resource-recommendation",
  "parameter-recommendation",
  "generation-gate",
  "preview-execution",
  "preview-scoring",
  "comfyui-execution",
  "result-display",
] as const;

export type TimelineNodeId = (typeof timelineNodeIds)[number];

export const executableTimelineNodeIds = [
  "scene-input",
  "scene-prompt",
  "character-tags",
  "character-action",
  "canvas-binding",
  "resource-recommendation",
  "parameter-recommendation",
  "generation-gate",
  "preview-execution",
  "preview-scoring",
  "comfyui-execution",
  "result-display",
] as const satisfies readonly TimelineNodeId[];

export type TimelineExecutableNodeId = (typeof executableTimelineNodeIds)[number];

export const reservedTimelineNodeIds = [] as const satisfies readonly TimelineNodeId[];

export type TimelineReservedNodeId = (typeof reservedTimelineNodeIds)[number];

export type TimelineNodeSource = "ai" | "manual" | "system";

export type TimelineErrorCode =
  | "timeline_request_invalid"
  | "timeline_node_blocked"
  | "timeline_node_stale"
  | "timeline_node_failed"
  | "llm_config"
  | "llm_upstream"
  | "llm_malformed_response"
  | "resource_selection_invalid"
  | "confirmation_required"
  | "comfyui_request_invalid"
  | "comfyui_object_info_mismatch"
  | "comfyui_workflow_build_failed"
  | "comfyui_upstream"
  | "comfyui_execution_failed"
  | "image_storage_invalid"
  | "image_storage_failed"
  | "timeline_unexpected";

export type TimelineNodeError = {
  code: TimelineErrorCode;
  message: string;
  details?: unknown;
};

export type TimelineNodeResult<T = unknown> = {
  nodeId: TimelineNodeId;
  status: TimelineNodeStatus;
  result?: T;
  error?: TimelineNodeError;
  updatedAt: string;
  source: TimelineNodeSource;
};

export type TimelineNodeMap = {
  [NodeId in TimelineNodeId]: TimelineNodeResult;
};

export type TimelineWorkflowState = {
  workflowId: string;
  workflowMode: TimelineWorkflowMode;
  nodes: TimelineNodeMap;
  createdAt: string;
  updatedAt: string;
  generationConfirmed: boolean;
};

export type SceneInputTimelineResult = {
  rawIntent: string;
  promptProfile: PromptProfileId;
  imageCount: number;
  nsfw?: boolean;
  sourceDenoise?: number;
  sourceImage?: {
    dataUrl: string;
    filename: string;
    height: number;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    uploadedAt: string;
    width: number;
  };
  settingsSnapshot?: RunSceneInputSettingsSnapshot;
};

export type TimelinePromptFragment = {
  label: string;
  prompt: string;
};

export type ScenePromptTimelineResult = {
  promptProfile: PromptProfileId;
  primaryCharacter: {
    name: string;
    identity: string;
    publicFacts: string[];
  };
  sceneIntent: string;
  styleTone: string;
  setting: string;
  sharedFacts: string[];
  positivePrompt: string;
  negativeSuggestions: string[];
  style: TimelinePromptFragment[];
  camera: TimelinePromptFragment[];
  lighting: TimelinePromptFragment[];
  illustriousSections?: IllustriousPromptSections;
  animaSections?: AnimaPromptSections;
  animaPromptOptions?: AnimaPromptProfileOptions;
};

type CharacterPromptTagBase = Omit<PromptTag, "id">;

export type CharacterPromptTag =
  | (CharacterPromptTagBase & {
      targetKind: "character";
      bodyPartId?: never;
    })
  | (CharacterPromptTagBase & {
      targetKind: "bodyPart";
      bodyPartId: BodyPartId;
    });

export type CharacterTagsTimelineResult = {
  items: CharacterPromptTag[];
};

export type CharacterActionTimelineResult = {
  action: string;
  pose: StickFigurePoseV1;
  poseSummary: string;
};

export type CanvasBindingTimelineResult = {
  primaryCharacter: {
    id: string;
    name: string;
    description: string;
  };
  characterTags: CharacterPromptTag[];
  action: string;
  transform: SceneObject3DTransform;
  pose: StickFigurePoseV1;
  spatialSummary: string;
};

export type ResourceRecommendationTimelineResult = {
  checkpoint: {
    resource: SelectedCivitaiResourcePreview;
    reason: string;
  };
  loras: Array<{
    resource: SelectedCivitaiResourcePreview;
    suggestedWeight: number | null;
    strengthModel?: number;
    strengthClip?: number;
    reason: string;
  }>;
  candidates: {
    checkpoints: CivitaiRecommendationCandidate[];
    loras: CivitaiRecommendationCandidate[];
  };
  recommendationReason: string;
  overallEffect: string;
  warnings: string[];
};

export type TimelineSeedPolicy =
  | {
      mode: "random";
      seed?: never;
    }
  | {
      mode: "fixed";
      seed: number;
    };

export type ParameterRecommendationTimelineResult = {
  availableSamplers: string[];
  availableSchedulers: string[];
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  seedPolicy: TimelineSeedPolicy;
  finalPositivePrompt?: string;
  negativeAdditions: string[];
  negativePrompt: string;
  requestPreview: ComfyUiTextToImageRequest;
  styleReference?: StyleReferenceSnapshot;
  reason: string;
  warnings: string[];
};

export type GenerationGateTimelineResult = {
  confirmationRequired: boolean;
  confirmed: boolean;
  confirmationFingerprint?: string;
  finalPolicyVersion?: number;
};

export const previewScoringRubric = {
  adherence: 0.3,
  composition: 0.25,
  anatomy: 0.2,
  style: 0.15,
  technical: 0.1,
} as const;

export type TimelinePreviewScore = {
  adherence: number;
  composition: number;
  anatomy: number;
  style: number;
  technical: number;
  total: number;
  rationale?: string;
};

export const timelinePreviewCriticalDefectCategories = [
  "spatial_physical_contradiction",
  "gaze_or_action_mismatch",
  "subject_scale_or_framing",
  "severe_exposure",
  "anatomy_or_structure",
] as const;

export type TimelinePreviewCriticalDefectCategory =
  (typeof timelinePreviewCriticalDefectCategories)[number];

export const timelinePreviewBlockingDefectCategories = [
  "spatial_physical_contradiction",
  "severe_exposure",
  "anatomy_or_structure",
] as const satisfies readonly TimelinePreviewCriticalDefectCategory[];

export type TimelinePreviewCriticalDefect = {
  category: TimelinePreviewCriticalDefectCategory;
  description: string;
};

export type TimelinePreviewEligibleScore = TimelinePreviewScore & {
  criticalDefects: TimelinePreviewCriticalDefect[];
  eligible: boolean;
};

export type TimelinePreviewCandidate = {
  candidateId: string;
  index: number;
  seed: number;
  status: "done" | "error";
  promptId?: string;
  sourceImage?: {
    filename: string;
    nodeId: string;
    subfolder?: string;
    type?: string;
  };
  storedImage?: TimelineStoredGeneratedImage;
  error?: TimelineNodeError;
};

export type PreviewExecutionTimelineResult = {
  baseSeed: number;
  candidateCount: number;
  finalCount: number;
  previewHeight: number;
  previewWidth: number;
  previewSteps: number;
  candidates: TimelinePreviewCandidate[];
  successfulCount: number;
  warnings: string[];
};

type PreviewScoringTimelineResultBase = {
  selectedCandidateIds: string[];
  selectionSource: "ai" | "manual";
};

export type TimelinePreviewSelectionFallbackMetadata = {
  eligibleCount: number;
  fallbackCandidateIds: string[];
  selectionWarning?: string;
};

export function createTimelinePreviewSelectionFallbackMetadata(
  scores: ReadonlyArray<{ candidateId: string; eligible: boolean }>,
  selectedCandidateIds: readonly string[],
): TimelinePreviewSelectionFallbackMetadata {
  const eligibleCount = scores.filter((score) => score.eligible).length;
  const eligibilityById = new Map(scores.map((score) => [score.candidateId, score.eligible]));
  const fallbackCandidateIds = selectedCandidateIds.filter(
    (candidateId) => eligibilityById.get(candidateId) === false,
  );
  return {
    eligibleCount,
    fallbackCandidateIds,
    ...(fallbackCandidateIds.length > 0 ? {
      selectionWarning:
        `Only ${eligibleCount} preview candidate${eligibleCount === 1 ? "" : "s"} passed blocking-defect checks; ` +
        `${fallbackCandidateIds.length} annotated fallback candidate${fallbackCandidateIds.length === 1 ? " was" : "s were"} selected. ` +
        "Review the preserved defect annotations before final use.",
    } : {}),
  };
}

export type PreviewScoringTimelineResultV1 = PreviewScoringTimelineResultBase & {
  rubricVersion: 1;
  scores: Array<TimelinePreviewScore & { candidateId: string; rank: number }>;
};

export type PreviewScoringTimelineResultV2 = PreviewScoringTimelineResultBase & {
  rubricVersion: 2;
  scores: Array<TimelinePreviewEligibleScore & { candidateId: string; rank: number }>;
} & Partial<TimelinePreviewSelectionFallbackMetadata>;

export type PreviewScoringTimelineResult = PreviewScoringTimelineResultV1 | PreviewScoringTimelineResultV2;

export type TimelineFinalExecutionRecord = {
  candidateId: string;
  seed: number;
  rank: number;
  status: "done" | "error";
  promptId?: string;
  sourceImage?: {
    filename: string;
    nodeId: string;
    subfolder?: string;
    type?: string;
  };
  storedImage?: TimelineStoredGeneratedImage;
  previewUpscale?: TimelinePreviewUpscaleArtifact;
  error?: TimelineNodeError;
};

export type TimelinePreviewUpscaleArtifact = {
  policyVersion: number;
  resizeMode: "lanczos3-exact";
  width: number;
  height: number;
  sourcePreview: TimelineStoredGeneratedImage;
  storedImage: TimelineStoredGeneratedImage;
};

export type ComfyUiExecutionTimelineResult = {
  completed: boolean;
  finalCount: number;
  finals: TimelineFinalExecutionRecord[];
  finalPolicy?: {
    version: number;
    resizeMode: "lanczos3-exact";
  };
  nodeErrors?: unknown;
  nodeIds?: unknown;
  number?: number;
  outputNodeId?: string;
  promptId?: string;
  request: ComfyUiTextToImageRequest;
  warnings: string[];
};

export type TimelineStoredGeneratedImage = {
  byteLength: number;
  contentType: string;
  filename: string;
  url: string;
};

export type ResultDisplayTimelineResult = {
  completed: boolean;
  image: {
    filename: string;
    nodeId: string;
    subfolder?: string;
    type?: string;
    url: string;
  };
  images?: Array<{
    filename: string;
    nodeId: string;
    subfolder?: string;
    type?: string;
    url: string;
  }>;
  promptId: string;
  sourceImage: {
    filename: string;
    nodeId: string;
    subfolder?: string;
    type?: string;
  };
  sourceImages?: Array<{
    filename: string;
    nodeId: string;
    subfolder?: string;
    type?: string;
  }>;
  storedImage: TimelineStoredGeneratedImage;
  storedImages?: TimelineStoredGeneratedImage[];
  fallbacks?: Array<{
    candidateId: string;
    rank: number;
    seed: number;
    storedImage: TimelineStoredGeneratedImage;
  }>;
  warnings: string[];
  finalLinks?: Array<{
    candidateId: string;
    promptId: string;
    rank: number;
    seed: number;
  }>;
};

export type TimelineNodeExecutionContext = {
  nodeId: TimelineExecutableNodeId;
  workflow: TimelineWorkflowState;
  dependencies: TimelineNodeResult[];
};

export type TimelineNodeAdapterResult<T = unknown> = {
  value: T;
  source?: TimelineNodeSource;
};

export type TimelineNodeAdapter<T = unknown> = (
  context: TimelineNodeExecutionContext,
) => Promise<TimelineNodeAdapterResult<T> | T> | TimelineNodeAdapterResult<T> | T;

export type TimelineNodeAdapters = Partial<Record<TimelineExecutableNodeId, TimelineNodeAdapter>>;

export class TimelineNodeExecutionError extends Error {
  readonly code: TimelineErrorCode;
  readonly details?: unknown;

  constructor(error: TimelineNodeError) {
    super(error.message);
    this.name = "TimelineNodeExecutionError";
    this.code = error.code;
    this.details = error.details;
  }
}
