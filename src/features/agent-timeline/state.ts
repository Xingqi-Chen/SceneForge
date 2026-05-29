import {
  getTimelineDownstreamClosure,
  getTimelineNodeDependencies,
  isExecutableTimelineNodeId,
  isReservedTimelineNodeId,
} from "./dag";
import {
  timelineNodeIds,
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

type TimelineClock = () => string;

type TimelineWorkflowOptions = {
  workflowId?: string;
  sceneRequest?: string;
  settingsSnapshot?: unknown;
  now?: TimelineClock;
};

type TimelineMutationOptions = {
  now?: TimelineClock;
};

const dependencyCompleteStatuses = new Set(["done", "manual"]);
const runnableStatuses = new Set(["ready", "stale", "error"]);

function defaultNow() {
  return new Date().toISOString();
}

function createWorkflowId() {
  return `timeline-${Math.random().toString(36).slice(2, 10)}`;
}

function createNode(nodeId: TimelineNodeId, updatedAt: string): TimelineNodeResult {
  return {
    nodeId,
    status: getTimelineNodeDependencies(nodeId).length === 0 ? "ready" : "blocked",
    updatedAt,
    source: "system",
  };
}

function cloneNodeMap(nodes: TimelineNodeMap): TimelineNodeMap {
  return Object.fromEntries(timelineNodeIds.map((nodeId) => [nodeId, { ...nodes[nodeId] }])) as TimelineNodeMap;
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
  return getTimelineNodeDependencies(nodeId).every((dependencyId) =>
    dependencyCompleteStatuses.has(workflow.nodes[dependencyId].status),
  );
}

export function refreshTimelineReadiness(workflow: TimelineWorkflowState): TimelineWorkflowState {
  const nodes = cloneNodeMap(workflow.nodes);
  let changed = false;

  for (const nodeId of timelineNodeIds) {
    const node = nodes[nodeId];

    if (node.status === "done" || node.status === "manual" || node.status === "running" || node.status === "error") {
      continue;
    }

    if (node.status === "stale") {
      continue;
    }

    if (node.status === "blocked" && node.error?.code === "confirmation_required" && !workflow.generationConfirmed) {
      continue;
    }

    const nextStatus =
      areTimelineNodeDependenciesSatisfied({ ...workflow, nodes }, nodeId) &&
      isExecutableTimelineNodeId(nodeId) &&
      !isReservedTimelineNodeId(nodeId)
        ? "ready"
        : "blocked";

    if (node.status !== nextStatus) {
      nodes[nodeId] = {
        ...node,
        status: nextStatus,
        error: nextStatus === "ready" ? undefined : node.error,
      };
      changed = true;
    }
  }

  return changed ? { ...workflow, nodes } : workflow;
}

export function createTimelineWorkflowState(options: TimelineWorkflowOptions = {}): TimelineWorkflowState {
  const now = options.now ?? defaultNow;
  const timestamp = now();
  const nodes = Object.fromEntries(timelineNodeIds.map((nodeId) => [nodeId, createNode(nodeId, timestamp)])) as TimelineNodeMap;
  const workflow: TimelineWorkflowState = {
    workflowId: options.workflowId ?? createWorkflowId(),
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
      settingsSnapshot: options.settingsSnapshot,
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
  return (
    isExecutableTimelineNodeId(nodeId) &&
    workflow.nodes[nodeId].status === "stale" &&
    areTimelineNodeDependenciesSatisfied(workflow, nodeId)
  );
}

export function canRunTimelineNode(workflow: TimelineWorkflowState, nodeId: TimelineNodeId) {
  if (!isExecutableTimelineNodeId(nodeId) || isReservedTimelineNodeId(nodeId)) {
    return false;
  }

  if (!areTimelineNodeDependenciesSatisfied(workflow, nodeId)) {
    return false;
  }

  const node = workflow.nodes[nodeId];

  if (node.status === "blocked" && node.error?.code === "confirmation_required" && !workflow.generationConfirmed) {
    return false;
  }

  return runnableStatuses.has(node.status);
}

export function getRunnableTimelineNodeIds(workflow: TimelineWorkflowState) {
  const refreshed = refreshTimelineReadiness(workflow);

  return timelineNodeIds.filter((nodeId) => canRunTimelineNode(refreshed, nodeId));
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
  const nodes = cloneNodeMap(workflow.nodes);
  const downstreamNodeIds = getTimelineDownstreamClosure(nodeId);

  nodes[nodeId] = {
    nodeId,
    status: "manual",
    result,
    source: "manual",
    updatedAt,
  };

  for (const downstreamNodeId of downstreamNodeIds) {
    const downstreamNode = nodes[downstreamNodeId];
    nodes[downstreamNodeId] = {
      ...downstreamNode,
      status: "stale",
      error: undefined,
      updatedAt,
    };
  }

  const generationConfirmed =
    nodeId === "generation-gate" || downstreamNodeIds.includes("generation-gate")
      ? false
      : workflow.generationConfirmed;

  return refreshTimelineReadiness(withUpdatedWorkflow(workflow, nodes, updatedAt, generationConfirmed));
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
