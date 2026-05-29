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
