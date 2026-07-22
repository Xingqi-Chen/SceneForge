import {
  timelineNodeIds,
  type TimelineExecutableNodeId,
  type TimelineNodeId,
  type TimelineReservedNodeId,
} from "./types";
import {
  getCommonWorkflowDependentNodeIds,
  getCommonWorkflowDownstreamClosure,
  getCommonWorkflowNodeDependencies,
  validateCommonWorkflowDependencyDag,
} from "./workflow-definition";
import { singleImageWorkflowDefinition } from "./workflow-definitions";

export type TimelineDependencyDag = Record<TimelineNodeId, readonly TimelineNodeId[]>;

export type TimelineDagValidationIssue = {
  nodeId?: TimelineNodeId;
  message: string;
};

export const mvpTimelineDependencyDag = singleImageWorkflowDefinition.dependencyDag as TimelineDependencyDag;

const allNodeIds = new Set<TimelineNodeId>(timelineNodeIds);
const executableNodeIds = new Set<TimelineNodeId>(singleImageWorkflowDefinition.executableNodeIds);
const reservedNodeIds = new Set<TimelineNodeId>(singleImageWorkflowDefinition.reservedNodeIds);

export function isTimelineNodeId(value: string): value is TimelineNodeId {
  return allNodeIds.has(value as TimelineNodeId);
}

export function isExecutableTimelineNodeId(value: TimelineNodeId): value is TimelineExecutableNodeId {
  return executableNodeIds.has(value);
}

export function isReservedTimelineNodeId(value: TimelineNodeId): value is TimelineReservedNodeId {
  return reservedNodeIds.has(value);
}

export function getTimelineNodeDependencies(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag = mvpTimelineDependencyDag,
) {
  return getCommonWorkflowNodeDependencies(nodeId, dag);
}

export function getTimelineDependentNodeIds(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag = mvpTimelineDependencyDag,
) {
  return getCommonWorkflowDependentNodeIds(nodeId, timelineNodeIds, dag);
}

export function getTimelineDownstreamClosure(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag = mvpTimelineDependencyDag,
) {
  return getCommonWorkflowDownstreamClosure(nodeId, timelineNodeIds, dag);
}

export function validateTimelineDependencyDag(dag: TimelineDependencyDag = mvpTimelineDependencyDag) {
  const issues: TimelineDagValidationIssue[] = validateCommonWorkflowDependencyDag(timelineNodeIds, dag).map(
    (issue) => ({
      ...issue,
      message: issue.message.replace("Workflow", "Timeline"),
    }),
  );

  if (!dag["preview-execution"].includes("generation-gate")) {
    issues.push({
      nodeId: "preview-execution",
      message: "Preview execution must remain downstream of the generation gate.",
    });
  }

  if (!dag["comfyui-execution"].includes("preview-scoring")) {
    issues.push({ nodeId: "comfyui-execution", message: "Final execution must remain downstream of preview scoring." });
  }

  if (!dag["final-review"].includes("comfyui-execution")) {
    issues.push({
      nodeId: "final-review",
      message: "Final review must remain downstream of ComfyUI execution.",
    });
  }

  if (!dag["result-display"].includes("final-review")) {
    issues.push({ nodeId: "result-display", message: "Result display must remain downstream of final review." });
  }

  return issues;
}

export function assertValidTimelineDependencyDag(dag: TimelineDependencyDag = mvpTimelineDependencyDag) {
  const issues = validateTimelineDependencyDag(dag);

  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join("\n"));
  }
}
