import {
  refreshCommonWorkflowReadiness,
  setCommonWorkflowNodeManualResult,
  type CommonWorkflowArtifactScope,
  type CommonWorkflowManualEditState,
  type CommonWorkflowNodeMap,
  type CommonWorkflowNodeResult,
} from "./workflow-definition";
import { storyGraphWorkflowMode, storyWorkflowDefinition } from "./story-workflow";
import type {
  ShotDependencyGraph,
  StoryId,
  StoryShotId,
  StoryWorkflowNodeId,
} from "./story-types";

type StoryClock = () => string;

export type StoryManualEditScope =
  | {
      artifactType: string;
      kind: "story";
      storyId?: StoryId;
    }
  | {
      artifactType: string;
      kind: "shot";
      shotId: StoryShotId;
      storyId?: StoryId;
    };

export type StoryManualEditState = CommonWorkflowManualEditState & {
  scope: CommonWorkflowArtifactScope;
  staleShotIds: StoryShotId[];
};

export type StoryWorkflowNodeResult<T = unknown> = Omit<
  CommonWorkflowNodeResult<StoryWorkflowNodeId, T>,
  "manualEdit"
> & {
  manualEdit?: StoryManualEditState;
};

export type StoryWorkflowNodeMap = {
  [NodeId in StoryWorkflowNodeId]: StoryWorkflowNodeResult;
};

export type StoryWorkflowState = {
  createdAt: string;
  generationConfirmed: boolean;
  nodes: StoryWorkflowNodeMap;
  storyId: StoryId;
  updatedAt: string;
  workflowId: string;
  workflowMode: typeof storyGraphWorkflowMode;
};

type StoryWorkflowOptions = {
  now?: StoryClock;
  storyId?: StoryId;
  workflowId?: string;
};

type StoryManualEditOptions = {
  now?: StoryClock;
  scope: StoryManualEditScope;
};

function defaultNow() {
  return new Date().toISOString();
}

function createWorkflowId() {
  return `story-${Math.random().toString(36).slice(2, 10)}`;
}

function createStoryId() {
  return `story-${Math.random().toString(36).slice(2, 10)}`;
}

function toArtifactScope(scope: StoryManualEditScope): CommonWorkflowArtifactScope {
  return scope.kind === "shot"
    ? {
        kind: "shot",
        shotId: scope.shotId,
        storyId: scope.storyId,
      }
    : {
        kind: "story",
        storyId: scope.storyId,
      };
}

function getShotDependencyDownstreamShotIds(
  graph: ShotDependencyGraph,
  shotId: StoryShotId,
): StoryShotId[] {
  const visited = new Set<StoryShotId>();
  const queue = graph.edges
    .filter((edge) => edge.fromShotId === shotId)
    .map((edge) => edge.toShotId);

  for (let index = 0; index < queue.length; index += 1) {
    const currentShotId = queue[index];

    if (visited.has(currentShotId)) {
      continue;
    }

    visited.add(currentShotId);
    queue.push(
      ...graph.edges
        .filter((edge) => edge.fromShotId === currentShotId)
        .map((edge) => edge.toShotId),
    );
  }

  return graph.nodes
    .map((node) => node.shotId)
    .filter((candidateShotId) => visited.has(candidateShotId));
}

function getStaleShotIds({
  result,
  scope,
}: {
  result: unknown;
  scope: StoryManualEditScope;
}) {
  if (scope.kind !== "shot") {
    return [];
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "nodes" in result &&
    "edges" in result &&
    Array.isArray((result as ShotDependencyGraph).nodes) &&
    Array.isArray((result as ShotDependencyGraph).edges)
  ) {
    return getShotDependencyDownstreamShotIds(result as ShotDependencyGraph, scope.shotId);
  }

  return [];
}

function cloneStoryNodeMap(nodes: StoryWorkflowNodeMap): StoryWorkflowNodeMap {
  return Object.fromEntries(
    storyWorkflowDefinition.nodeIds.map((nodeId) => [nodeId, { ...nodes[nodeId] }]),
  ) as StoryWorkflowNodeMap;
}

export function createStoryWorkflowState(options: StoryWorkflowOptions = {}): StoryWorkflowState {
  const now = options.now ?? defaultNow;
  const timestamp = now();
  const nodes = Object.fromEntries(
    storyWorkflowDefinition.nodeIds.map((nodeId) => [
      nodeId,
      {
        nodeId,
        status: storyWorkflowDefinition.dependencyDag[nodeId].length === 0 ? "ready" : "blocked",
        source: "system",
        updatedAt: timestamp,
      },
    ]),
  ) as StoryWorkflowNodeMap;
  const workflow: StoryWorkflowState = {
    workflowId: options.workflowId ?? createWorkflowId(),
    workflowMode: storyGraphWorkflowMode,
    storyId: options.storyId ?? createStoryId(),
    nodes,
    createdAt: timestamp,
    updatedAt: timestamp,
    generationConfirmed: false,
  };

  return refreshStoryWorkflowReadiness(workflow);
}

export function refreshStoryWorkflowReadiness(workflow: StoryWorkflowState): StoryWorkflowState {
  const refreshedNodes = refreshCommonWorkflowReadiness({
    dag: storyWorkflowDefinition.dependencyDag,
    executableNodeIds: storyWorkflowDefinition.executableNodeIds,
    nodeIds: storyWorkflowDefinition.nodeIds,
    nodes: cloneStoryNodeMap(workflow.nodes) as CommonWorkflowNodeMap<StoryWorkflowNodeId>,
    reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
  }) as StoryWorkflowNodeMap;

  return refreshedNodes === workflow.nodes ? workflow : { ...workflow, nodes: refreshedNodes };
}

export function setStoryNodeManualResult<T>(
  workflow: StoryWorkflowState,
  nodeId: StoryWorkflowNodeId,
  result: T,
  options: StoryManualEditOptions,
): StoryWorkflowState {
  const now = options.now ?? defaultNow;
  const updatedAt = now();
  const edit = setCommonWorkflowNodeManualResult({
    dag: storyWorkflowDefinition.dependencyDag,
    nodeId,
    nodeIds: storyWorkflowDefinition.nodeIds,
    nodes: cloneStoryNodeMap(workflow.nodes) as CommonWorkflowNodeMap<StoryWorkflowNodeId>,
    result,
    updatedAt,
  });
  const nodes = edit.nodes as StoryWorkflowNodeMap;
  const staleShotIds = getStaleShotIds({ result, scope: options.scope });

  nodes[nodeId] = {
    ...nodes[nodeId],
    manualEdit: {
      editedAt: updatedAt,
      scope: toArtifactScope(options.scope),
      staleNodeIds: edit.staleNodeIds,
      staleShotIds,
    },
  };

  const generationConfirmed =
    nodeId === "generation-gate" || edit.staleNodeIds.includes("generation-gate")
      ? false
      : workflow.generationConfirmed;

  return refreshStoryWorkflowReadiness({
    ...workflow,
    generationConfirmed,
    nodes,
    updatedAt,
  });
}
