import {
  areCommonWorkflowDependenciesSatisfied,
  canRunCommonWorkflowNode,
  getCommonWorkflowDownstreamClosure,
  refreshCommonWorkflowReadiness,
  setCommonWorkflowNodeManualResult,
} from "./workflow-definition";
import {
  getTimelineWorkflowDefinition,
  singleImageWorkflowMode,
} from "./workflow-definitions";
import {
  TimelineNodeExecutionError,
  type GenerationGateTimelineResult,
  type SceneInputTimelineResult,
  type TimelineErrorCode,
  type TimelineNodeError,
  type TimelineNodeId,
  type TimelineNodeMap,
  type TimelineNodeResult,
  type TimelineNodeSource,
  type TimelineWorkflowState,
} from "./types";
import { normalizePromptProfileId, type PromptProfileId } from "@/shared/prompt-profile";
import { sanitizeRunSceneInputSettingsSnapshot, type RunSceneInputSettingsSnapshot } from "./run-input-settings";

type TimelineClock = () => string;

type TimelineWorkflowOptions = {
  workflowId?: string;
  imageCount?: number;
  promptProfile?: PromptProfileId;
  sceneRequest?: string;
  sourceDenoise?: number;
  sourceImage?: SceneInputTimelineResult["sourceImage"];
  settingsSnapshot?: Partial<RunSceneInputSettingsSnapshot>;
  now?: TimelineClock;
};

type TimelineMutationOptions = {
  now?: TimelineClock;
};

export const MIN_TIMELINE_IMAGE_COUNT = 1;
export const MAX_TIMELINE_IMAGE_COUNT = 4;
export const DEFAULT_TIMELINE_IMAGE_COUNT = 1;
export const DEFAULT_TIMELINE_SOURCE_DENOISE = 0.9;

function defaultNow() {
  return new Date().toISOString();
}

function createWorkflowId() {
  return `timeline-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTimelineImageCount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMELINE_IMAGE_COUNT;
  }

  return Math.min(
    MAX_TIMELINE_IMAGE_COUNT,
    Math.max(MIN_TIMELINE_IMAGE_COUNT, Math.round(parsed)),
  );
}

export function normalizeTimelineSourceDenoise(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMELINE_SOURCE_DENOISE;
  }

  return Math.min(1, Math.max(0, Number(parsed.toFixed(2))));
}

function createNode(nodeId: TimelineNodeId, updatedAt: string): TimelineNodeResult {
  const definition = getTimelineWorkflowDefinition();

  return {
    nodeId,
    status: definition.dependencyDag[nodeId].length === 0 ? "ready" : "blocked",
    updatedAt,
    source: "system",
  };
}

function cloneNodeMap(nodes: TimelineNodeMap): TimelineNodeMap {
  const definition = getTimelineWorkflowDefinition();

  return Object.fromEntries(definition.nodeIds.map((nodeId) => [nodeId, { ...nodes[nodeId] }])) as TimelineNodeMap;
}

function withUpdatedWorkflow(
  workflow: TimelineWorkflowState,
  nodes: TimelineNodeMap,
  updatedAt: string,
  generationConfirmed = workflow.generationConfirmed,
): TimelineWorkflowState {
  return {
    ...workflow,
    nodes,
    generationConfirmed,
    updatedAt,
  };
}

export function createTimelineNodeError(
  code: TimelineErrorCode,
  message: string,
  details?: unknown,
): TimelineNodeError {
  return details === undefined ? { code, message } : { code, message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTimelineError(
  error: unknown,
  fallbackCode: TimelineErrorCode = "timeline_node_failed",
): TimelineNodeError {
  if (error instanceof TimelineNodeExecutionError) {
    return createTimelineNodeError(error.code, error.message, error.details);
  }

  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return createTimelineNodeError(error.code as TimelineErrorCode, error.message, error.details);
  }

  if (error instanceof Error) {
    return createTimelineNodeError(fallbackCode, error.message, {
      name: error.name,
    });
  }

  return createTimelineNodeError(fallbackCode, "Timeline node execution failed.", {
    error,
  });
}

export function areTimelineNodeDependenciesSatisfied(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
) {
  const definition = getTimelineWorkflowDefinition(workflow.workflowMode);

  return areCommonWorkflowDependenciesSatisfied(workflow.nodes, nodeId, definition.dependencyDag);
}

export function refreshTimelineReadiness(workflow: TimelineWorkflowState): TimelineWorkflowState {
  const definition = getTimelineWorkflowDefinition(workflow.workflowMode);
  const guardedNodes = cloneNodeMap(workflow.nodes);

  for (const nodeId of definition.nodeIds) {
    const node = guardedNodes[nodeId];
    if (node.status === "blocked" && node.error?.code === "confirmation_required" && !workflow.generationConfirmed) {
      guardedNodes[nodeId] = {
        ...node,
        status: "error",
      };
    }
  }

  const refreshedNodes = refreshCommonWorkflowReadiness({
    dag: definition.dependencyDag,
    executableNodeIds: definition.executableNodeIds,
    nodeIds: definition.nodeIds,
    nodes: guardedNodes,
    reservedNodeIds: definition.reservedNodeIds,
  }) as TimelineNodeMap;

  for (const nodeId of definition.nodeIds) {
    const node = workflow.nodes[nodeId];
    if (node.status === "blocked" && node.error?.code === "confirmation_required" && !workflow.generationConfirmed) {
      refreshedNodes[nodeId] = node;
    }
  }

  return refreshedNodes === workflow.nodes ? workflow : { ...workflow, nodes: refreshedNodes };
}

export function createTimelineWorkflowState(options: TimelineWorkflowOptions = {}): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const timestamp = now();
  const definition = getTimelineWorkflowDefinition();
  const nodes = Object.fromEntries(definition.nodeIds.map((nodeId) => [nodeId, createNode(nodeId, timestamp)])) as TimelineNodeMap;
  const workflow: TimelineWorkflowState = {
    workflowId: options.workflowId ?? createWorkflowId(),
    workflowMode: singleImageWorkflowMode,
    nodes,
    createdAt: timestamp,
    updatedAt: timestamp,
    generationConfirmed: false,
  };

  if (!options.sceneRequest) {
    return refreshTimelineReadiness(workflow);
  }

  nodes["scene-input"] = {
    nodeId: "scene-input",
    status: "manual",
    result: {
      rawIntent: options.sceneRequest,
      promptProfile: normalizePromptProfileId(options.promptProfile),
      imageCount: options.sourceImage ? 1 : normalizeTimelineImageCount(options.imageCount),
      ...(options.sourceImage ? { sourceDenoise: normalizeTimelineSourceDenoise(options.sourceDenoise) } : {}),
      ...(options.sourceImage ? { sourceImage: options.sourceImage } : {}),
      settingsSnapshot: sanitizeRunSceneInputSettingsSnapshot(options.settingsSnapshot),
    } satisfies SceneInputTimelineResult,
    source: "manual",
    updatedAt: timestamp,
  };

  return refreshTimelineReadiness(workflow);
}

export function isTimelineNodeRegenerationEligible(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
) {
  const definition = getTimelineWorkflowDefinition(workflow.workflowMode);

  return (
    definition.executableNodeIds.includes(nodeId) &&
    workflow.nodes[nodeId].status === "stale" &&
    areTimelineNodeDependenciesSatisfied(workflow, nodeId)
  );
}

export function canRunTimelineNode(workflow: TimelineWorkflowState, nodeId: TimelineNodeId) {
  const definition = getTimelineWorkflowDefinition(workflow.workflowMode);

  const node = workflow.nodes[nodeId];

  if (node.status === "blocked" && node.error?.code === "confirmation_required" && !workflow.generationConfirmed) {
    return false;
  }

  return canRunCommonWorkflowNode({
    dag: definition.dependencyDag,
    executableNodeIds: definition.executableNodeIds,
    nodeId,
    nodes: workflow.nodes,
    reservedNodeIds: definition.reservedNodeIds,
  });
}

export function getRunnableTimelineNodeIds(workflow: TimelineWorkflowState) {
  const refreshed = refreshTimelineReadiness(workflow);
  const definition = getTimelineWorkflowDefinition(refreshed.workflowMode);

  return definition.nodeIds.filter((nodeId) => canRunTimelineNode(refreshed, nodeId));
}

export function markTimelineNodeRunning(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const nodes = cloneNodeMap(workflow.nodes);
  nodes[nodeId] = {
    ...nodes[nodeId],
    status: "running",
    error: undefined,
    updatedAt,
  };

  return withUpdatedWorkflow(workflow, nodes, updatedAt);
}

export function completeTimelineNode<T>(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
  result: T,
  source: TimelineNodeSource = "ai",
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const nodes = cloneNodeMap(workflow.nodes);
  nodes[nodeId] = {
    nodeId,
    status: "done",
    result,
    source,
    updatedAt,
  };

  return refreshTimelineReadiness(withUpdatedWorkflow(workflow, nodes, updatedAt));
}

export function failTimelineNode(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
  error: unknown,
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const nodes = cloneNodeMap(workflow.nodes);
  nodes[nodeId] = {
    ...nodes[nodeId],
    status: "error",
    error: normalizeTimelineError(error),
    updatedAt,
  };

  return withUpdatedWorkflow(workflow, nodes, updatedAt);
}

export function blockTimelineNode(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
  error: TimelineNodeError,
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const nodes = cloneNodeMap(workflow.nodes);
  nodes[nodeId] = {
    ...nodes[nodeId],
    status: "blocked",
    error,
    source: "system",
    updatedAt,
  };

  return withUpdatedWorkflow(workflow, nodes, updatedAt);
}

export function setTimelineNodeManualResult<T>(
  workflow: TimelineWorkflowState,
  nodeId: TimelineNodeId,
  result: T,
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const definition = getTimelineWorkflowDefinition(workflow.workflowMode);
  const edit = setCommonWorkflowNodeManualResult({
    dag: definition.dependencyDag,
    nodeId,
    nodeIds: definition.nodeIds,
    nodes: cloneNodeMap(workflow.nodes),
    result,
    updatedAt,
    trackManualEdit: false,
  });
  const nodes = edit.nodes as TimelineNodeMap;

  const generationConfirmed =
    nodeId === "generation-gate" || edit.staleNodeIds.includes("generation-gate")
      ? false
      : workflow.generationConfirmed;

  return refreshTimelineReadiness(withUpdatedWorkflow(workflow, nodes, updatedAt, generationConfirmed));
}

export function updateTimelineSceneInputSettings(
  workflow: TimelineWorkflowState,
  settingsSnapshot: RunSceneInputSettingsSnapshot,
  staleFromNodeId: "resource-recommendation" | "parameter-recommendation",
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const sceneInput = workflow.nodes["scene-input"].result;
  if (!isRecord(sceneInput)) {
    throw new TimelineNodeExecutionError(
      createTimelineNodeError("timeline_request_invalid", "Scene input settings require a completed scene input."),
    );
  }

  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const definition = getTimelineWorkflowDefinition(workflow.workflowMode);
  const nodes = cloneNodeMap(workflow.nodes);
  const staleNodeIds = [
    staleFromNodeId,
    ...getCommonWorkflowDownstreamClosure(staleFromNodeId, definition.nodeIds, definition.dependencyDag),
  ];

  nodes["scene-input"] = {
    ...nodes["scene-input"],
    result: {
      ...sceneInput,
      settingsSnapshot: sanitizeRunSceneInputSettingsSnapshot(settingsSnapshot),
    } as SceneInputTimelineResult,
    updatedAt,
  };

  for (const nodeId of staleNodeIds) {
    nodes[nodeId] = {
      ...nodes[nodeId],
      status: "stale",
      error: undefined,
      updatedAt,
    };
  }

  return refreshTimelineReadiness(withUpdatedWorkflow(workflow, nodes, updatedAt, false));
}

export function confirmTimelineGeneration(
  workflow: TimelineWorkflowState,
  result: GenerationGateTimelineResult = {
    confirmationRequired: false,
    confirmed: true,
  },
  options: TimelineMutationOptions = {},
): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const nodes = cloneNodeMap(workflow.nodes);

  nodes["generation-gate"] = {
    nodeId: "generation-gate",
    status: "manual",
    result,
    source: "manual",
    updatedAt,
  };

  return refreshTimelineReadiness(withUpdatedWorkflow(workflow, nodes, updatedAt, true));
}
