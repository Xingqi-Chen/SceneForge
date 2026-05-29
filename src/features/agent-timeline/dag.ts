import {
  executableTimelineNodeIds,
  reservedTimelineNodeIds,
  timelineNodeIds,
  type TimelineExecutableNodeId,
  type TimelineNodeId,
  type TimelineReservedNodeId,
} from "./types";

export type TimelineDependencyDag = Record<TimelineNodeId, readonly TimelineNodeId[]>;

export type TimelineDagValidationIssue = {
  nodeId?: TimelineNodeId;
  message: string;
};

export const mvpTimelineDependencyDag = {
  "scene-input": [],
  "scene-prompt": ["scene-input"],
  "character-tags": ["scene-prompt"],
  "character-action": ["scene-prompt"],
  "canvas-binding": ["scene-prompt", "character-tags", "character-action"],
  "resource-recommendation": ["scene-prompt", "character-tags", "character-action"],
  "parameter-recommendation": ["scene-prompt", "canvas-binding", "resource-recommendation"],
  "generation-gate": [
    "scene-prompt",
    "character-tags",
    "character-action",
    "canvas-binding",
    "resource-recommendation",
    "parameter-recommendation",
  ],
  "comfyui-execution": ["generation-gate"],
  "result-display": ["comfyui-execution"],
} as const satisfies TimelineDependencyDag;

const allNodeIds = new Set<TimelineNodeId>(timelineNodeIds);
const executableNodeIds = new Set<TimelineExecutableNodeId>(executableTimelineNodeIds);
const reservedNodeIds = new Set<TimelineReservedNodeId>(reservedTimelineNodeIds);

export function isTimelineNodeId(value: string): value is TimelineNodeId {
  return allNodeIds.has(value as TimelineNodeId);
}

export function isExecutableTimelineNodeId(value: TimelineNodeId): value is TimelineExecutableNodeId {
  return executableNodeIds.has(value as TimelineExecutableNodeId);
}

export function isReservedTimelineNodeId(value: TimelineNodeId): value is TimelineReservedNodeId {
  return reservedNodeIds.has(value as TimelineReservedNodeId);
}

export function getTimelineNodeDependencies(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag = mvpTimelineDependencyDag,
) {
  return dag[nodeId];
}

export function getTimelineDependentNodeIds(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag = mvpTimelineDependencyDag,
) {
  return timelineNodeIds.filter((candidateId) => dag[candidateId].includes(nodeId));
}

export function getTimelineDownstreamClosure(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag = mvpTimelineDependencyDag,
) {
  const visited = new Set<TimelineNodeId>();
  const queue = [...getTimelineDependentNodeIds(nodeId, dag)];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    queue.push(...getTimelineDependentNodeIds(current, dag));
  }

  return timelineNodeIds.filter((candidateId) => visited.has(candidateId));
}

function visitForCycles(
  nodeId: TimelineNodeId,
  dag: TimelineDependencyDag,
  visiting: Set<TimelineNodeId>,
  visited: Set<TimelineNodeId>,
  issues: TimelineDagValidationIssue[],
) {
  if (visited.has(nodeId)) {
    return;
  }

  if (visiting.has(nodeId)) {
    issues.push({ nodeId, message: "Timeline dependency DAG contains a cycle." });
    return;
  }

  visiting.add(nodeId);

  for (const dependencyId of dag[nodeId]) {
    visitForCycles(dependencyId, dag, visiting, visited, issues);
  }

  visiting.delete(nodeId);
  visited.add(nodeId);
}

export function validateTimelineDependencyDag(dag: TimelineDependencyDag = mvpTimelineDependencyDag) {
  const issues: TimelineDagValidationIssue[] = [];
  const dagNodeIds = Object.keys(dag);

  for (const nodeId of timelineNodeIds) {
    if (!dagNodeIds.includes(nodeId)) {
      issues.push({ nodeId, message: "Timeline dependency DAG is missing a node." });
    }
  }

  for (const nodeId of dagNodeIds) {
    if (!isTimelineNodeId(nodeId)) {
      issues.push({ message: `Timeline dependency DAG contains unknown node "${nodeId}".` });
      continue;
    }

    for (const dependencyId of dag[nodeId]) {
      if (!allNodeIds.has(dependencyId)) {
        issues.push({ nodeId, message: `Timeline dependency DAG contains unknown dependency "${dependencyId}".` });
      }

      if (dependencyId === nodeId) {
        issues.push({ nodeId, message: "Timeline dependency DAG contains a self-dependency." });
      }
    }
  }

  const visiting = new Set<TimelineNodeId>();
  const visited = new Set<TimelineNodeId>();

  for (const nodeId of timelineNodeIds) {
    visitForCycles(nodeId, dag, visiting, visited, issues);
  }

  if (!dag["comfyui-execution"].includes("generation-gate")) {
    issues.push({
      nodeId: "comfyui-execution",
      message: "ComfyUI execution must remain downstream of the generation gate.",
    });
  }

  if (!dag["result-display"].includes("comfyui-execution")) {
    issues.push({
      nodeId: "result-display",
      message: "Result display must remain downstream of ComfyUI execution.",
    });
  }

  return issues;
}

export function assertValidTimelineDependencyDag(dag: TimelineDependencyDag = mvpTimelineDependencyDag) {
  const issues = validateTimelineDependencyDag(dag);

  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join("\n"));
  }
}
