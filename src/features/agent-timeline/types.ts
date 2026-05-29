import type {
  BodyPartId,
  PromptTagCategory,
  PromptTagSubcategory,
  SceneObject3DTransform,
} from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

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
] as const satisfies readonly TimelineNodeId[];

export type TimelineExecutableNodeId = (typeof executableTimelineNodeIds)[number];

export const reservedTimelineNodeIds = [
  "resource-recommendation",
  "parameter-recommendation",
  "comfyui-execution",
  "result-display",
] as const satisfies readonly TimelineNodeId[];

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
  nodes: TimelineNodeMap;
  createdAt: string;
  updatedAt: string;
  generationConfirmed: boolean;
};

export type SceneInputTimelineResult = {
  rawIntent: string;
  settingsSnapshot?: unknown;
};

export type TimelinePromptFragment = {
  label: string;
  prompt: string;
};

export type ScenePromptTimelineResult = {
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
};

export type CharacterPromptTag = {
  label: string;
  prompt: string;
  category: PromptTagCategory;
  subcategory?: PromptTagSubcategory;
  bodyPartId?: BodyPartId;
};

export type CharacterTagsTimelineResult = {
  primaryCharacter: {
    name: string;
    description: string;
  };
  tags: CharacterPromptTag[];
  extraPeopleContext: string[];
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

export type GenerationGateTimelineResult = {
  confirmationRequired: boolean;
  confirmed: boolean;
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
