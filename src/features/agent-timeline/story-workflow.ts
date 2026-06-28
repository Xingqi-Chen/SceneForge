import {
  buildCommonWorkflowDependencyDag,
  commonWorkflowDefinitionVersion,
  getCommonWorkflowNodeDependencies,
  validateCommonWorkflowDependencyDag,
  type CommonWorkflowDagEdge,
  type CommonWorkflowDefinition,
  type CommonWorkflowNodeMetadata,
} from "./workflow-definition";
import {
  executableStoryWorkflowNodeIds,
  reservedStoryWorkflowNodeIds,
  storyWorkflowNodeIds,
  type ShotDependencyGraph,
  type StoryShot,
  type StoryShotId,
  type StoryWorkflowNodeId,
} from "./story-types";

export const storyGraphWorkflowMode = "story-graph";

export type StoryGraphWorkflowMode = typeof storyGraphWorkflowMode;

export type StoryWorkflowDefinition = CommonWorkflowDefinition<StoryWorkflowNodeId> & {
  mode: StoryGraphWorkflowMode;
};

export type StoryWorkflowValidationIssue = {
  nodeId?: StoryWorkflowNodeId;
  shotId?: StoryShotId;
  message: string;
};

type StoryWorkspaceKey = StoryWorkflowNodeId;

function createStoryNodeMetadata({
  aiLabel,
  editLabel,
  inputKind,
  nodeId,
  title,
  workspaceKey = nodeId,
}: {
  aiLabel: string;
  editLabel: string;
  inputKind: CommonWorkflowNodeMetadata<StoryWorkflowNodeId>["manualEdit"]["inputKind"];
  nodeId: StoryWorkflowNodeId;
  title: string;
  workspaceKey?: StoryWorkspaceKey;
}): CommonWorkflowNodeMetadata<StoryWorkflowNodeId> {
  return {
    nodeId,
    title,
    workspace: {
      key: workspaceKey,
      scope: "story",
    },
    rawJson: {
      enabled: true,
      label: "Raw JSON",
    },
    aiRetry: {
      enabled: true,
      label: aiLabel,
      retryableStatuses: ["ready", "stale", "error", "manual", "done"],
    },
    manualEdit: {
      enabled: true,
      label: editLabel,
      inputKind,
      marksDownstreamStale: true,
    },
  };
}

export const storyWorkflowEdges = [
  { from: "story-input", to: "story-bible" },
  { from: "story-bible", to: "story-outline" },
  { from: "story-outline", to: "storyboard-shots" },
  { from: "story-bible", to: "story-safety-plan" },
  { from: "storyboard-shots", to: "story-safety-plan" },
  { from: "storyboard-shots", to: "shot-dependency-graph" },
  { from: "story-bible", to: "plot-state-graph" },
  { from: "story-outline", to: "plot-state-graph" },
  { from: "storyboard-shots", to: "plot-state-graph" },
  { from: "story-bible", to: "character-continuity-graph" },
  { from: "storyboard-shots", to: "character-continuity-graph" },
  { from: "story-safety-plan", to: "resource-plan" },
  { from: "storyboard-shots", to: "resource-plan" },
  { from: "resource-plan", to: "parameter-plan" },
  { from: "storyboard-shots", to: "parameter-plan" },
  { from: "character-continuity-graph", to: "story-render-plan" },
  { from: "shot-dependency-graph", to: "story-render-plan" },
  { from: "resource-plan", to: "story-render-plan" },
  { from: "parameter-plan", to: "story-render-plan" },
  { from: "plot-state-graph", to: "story-consistency-check" },
  { from: "character-continuity-graph", to: "story-consistency-check" },
  { from: "shot-dependency-graph", to: "story-consistency-check" },
  { from: "story-render-plan", to: "story-consistency-check" },
  { from: "story-safety-plan", to: "story-consistency-check" },
  { from: "story-consistency-check", to: "generation-gate" },
  { from: "story-render-plan", to: "generation-gate" },
  { from: "generation-gate", to: "shot-graph-execution" },
  { from: "shot-graph-execution", to: "story-result-display" },
] as const satisfies readonly CommonWorkflowDagEdge<StoryWorkflowNodeId>[];

export const storyWorkflowDependencyDag = buildCommonWorkflowDependencyDag(
  storyWorkflowNodeIds,
  storyWorkflowEdges,
);

export const storyWorkflowDefinition = {
  mode: storyGraphWorkflowMode,
  version: commonWorkflowDefinitionVersion,
  nodeIds: storyWorkflowNodeIds,
  executableNodeIds: executableStoryWorkflowNodeIds,
  reservedNodeIds: reservedStoryWorkflowNodeIds,
  dependencyDag: storyWorkflowDependencyDag,
  metadata: {
    "story-input": createStoryNodeMetadata({
      aiLabel: "Rewrite",
      editLabel: "Edit story request",
      inputKind: "text",
      nodeId: "story-input",
      title: "Story input",
    }),
    "story-bible": createStoryNodeMetadata({
      aiLabel: "Suggest bible",
      editLabel: "Edit story bible",
      inputKind: "json",
      nodeId: "story-bible",
      title: "Story bible",
    }),
    "story-outline": createStoryNodeMetadata({
      aiLabel: "Suggest outline",
      editLabel: "Edit outline",
      inputKind: "json",
      nodeId: "story-outline",
      title: "Story outline",
    }),
    "storyboard-shots": createStoryNodeMetadata({
      aiLabel: "Suggest shots",
      editLabel: "Edit shots",
      inputKind: "json",
      nodeId: "storyboard-shots",
      title: "Storyboard shots",
    }),
    "story-safety-plan": createStoryNodeMetadata({
      aiLabel: "Suggest safety plan",
      editLabel: "Edit safety plan",
      inputKind: "json",
      nodeId: "story-safety-plan",
      title: "Story safety",
    }),
    "shot-dependency-graph": createStoryNodeMetadata({
      aiLabel: "Suggest dependencies",
      editLabel: "Edit dependencies",
      inputKind: "json",
      nodeId: "shot-dependency-graph",
      title: "Shot dependencies",
    }),
    "plot-state-graph": createStoryNodeMetadata({
      aiLabel: "Suggest plot states",
      editLabel: "Edit plot states",
      inputKind: "json",
      nodeId: "plot-state-graph",
      title: "Plot states",
    }),
    "character-continuity-graph": createStoryNodeMetadata({
      aiLabel: "Suggest continuity",
      editLabel: "Edit continuity",
      inputKind: "json",
      nodeId: "character-continuity-graph",
      title: "Character continuity",
    }),
    "resource-plan": createStoryNodeMetadata({
      aiLabel: "Suggest resources",
      editLabel: "Edit resources",
      inputKind: "json",
      nodeId: "resource-plan",
      title: "Resource plan",
    }),
    "parameter-plan": createStoryNodeMetadata({
      aiLabel: "Suggest parameters",
      editLabel: "Edit parameters",
      inputKind: "json",
      nodeId: "parameter-plan",
      title: "Parameter plan",
    }),
    "story-render-plan": createStoryNodeMetadata({
      aiLabel: "Suggest render plan",
      editLabel: "Edit render plan",
      inputKind: "json",
      nodeId: "story-render-plan",
      title: "Story render plan",
    }),
    "story-consistency-check": createStoryNodeMetadata({
      aiLabel: "Recheck story",
      editLabel: "Edit check result",
      inputKind: "json",
      nodeId: "story-consistency-check",
      title: "Consistency check",
    }),
    "generation-gate": createStoryNodeMetadata({
      aiLabel: "Suggest final check",
      editLabel: "Edit request preview",
      inputKind: "json",
      nodeId: "generation-gate",
      title: "Generation gate",
    }),
    "shot-graph-execution": createStoryNodeMetadata({
      aiLabel: "Diagnose",
      editLabel: "Execution locked",
      inputKind: "json",
      nodeId: "shot-graph-execution",
      title: "Shot graph execution",
    }),
    "story-result-display": createStoryNodeMetadata({
      aiLabel: "Review result",
      editLabel: "Result locked",
      inputKind: "json",
      nodeId: "story-result-display",
      title: "Story result",
    }),
  },
} as const satisfies StoryWorkflowDefinition;

function visitShotDependencyGraph(
  shotId: StoryShotId,
  dependencies: Map<StoryShotId, StoryShotId[]>,
  visiting: Set<StoryShotId>,
  visited: Set<StoryShotId>,
  issues: StoryWorkflowValidationIssue[],
) {
  if (visited.has(shotId)) {
    return;
  }

  if (visiting.has(shotId)) {
    issues.push({
      shotId,
      message: "Shot dependency graph contains a cycle.",
    });
    return;
  }

  visiting.add(shotId);

  for (const dependencyShotId of dependencies.get(shotId) ?? []) {
    visitShotDependencyGraph(dependencyShotId, dependencies, visiting, visited, issues);
  }

  visiting.delete(shotId);
  visited.add(shotId);
}

export function validateShotDependencyGraph(
  graph: ShotDependencyGraph,
  shots: readonly StoryShot[],
): StoryWorkflowValidationIssue[] {
  const issues: StoryWorkflowValidationIssue[] = [];
  const shotIds = new Set(shots.map((shot) => shot.id));
  const graphShotIds = new Set(graph.nodes.map((node) => node.shotId));
  const dependencies = new Map<StoryShotId, StoryShotId[]>();

  for (const shot of shots) {
    if (!graphShotIds.has(shot.id)) {
      issues.push({
        shotId: shot.id,
        message: `Shot dependency graph is missing shot "${shot.id}".`,
      });
    }

    for (const sourceShotId of shot.sourceShotIds) {
      if (!shotIds.has(sourceShotId)) {
        issues.push({
          shotId: shot.id,
          message: `Shot "${shot.id}" references unknown source shot "${sourceShotId}".`,
        });
      }
    }
  }

  for (const node of graph.nodes) {
    if (!shotIds.has(node.shotId)) {
      issues.push({
        shotId: node.shotId,
        message: `Shot dependency graph contains unknown shot "${node.shotId}".`,
      });
    }
  }

  for (const edge of graph.edges) {
    if (!shotIds.has(edge.fromShotId)) {
      issues.push({
        shotId: edge.fromShotId,
        message: `Shot dependency graph contains unknown source shot "${edge.fromShotId}".`,
      });
    }

    if (!shotIds.has(edge.toShotId)) {
      issues.push({
        shotId: edge.toShotId,
        message: `Shot dependency graph contains unknown target shot "${edge.toShotId}".`,
      });
    }

    if (edge.fromShotId === edge.toShotId) {
      issues.push({
        shotId: edge.toShotId,
        message: `Shot "${edge.toShotId}" cannot depend on itself.`,
      });
    }

    const targetDependencies = dependencies.get(edge.toShotId) ?? [];
    targetDependencies.push(edge.fromShotId);
    dependencies.set(edge.toShotId, targetDependencies);
  }

  const visiting = new Set<StoryShotId>();
  const visited = new Set<StoryShotId>();

  for (const shot of shots) {
    visitShotDependencyGraph(shot.id, dependencies, visiting, visited, issues);
  }

  return issues;
}

export function validateStoryWorkflowDefinition(
  definition: StoryWorkflowDefinition = storyWorkflowDefinition,
): StoryWorkflowValidationIssue[] {
  const issues = validateCommonWorkflowDependencyDag(definition.nodeIds, definition.dependencyDag).map((issue) => ({
    ...issue,
    message: issue.message.replace("Workflow", "Story workflow"),
  }));

  const requiredPredecessors: Array<[StoryWorkflowNodeId, StoryWorkflowNodeId]> = [
    ["story-bible", "story-input"],
    ["story-outline", "story-bible"],
    ["storyboard-shots", "story-outline"],
    ["shot-dependency-graph", "storyboard-shots"],
    ["generation-gate", "story-consistency-check"],
    ["shot-graph-execution", "generation-gate"],
    ["story-result-display", "shot-graph-execution"],
  ];

  for (const [nodeId, predecessorId] of requiredPredecessors) {
    if (!getCommonWorkflowNodeDependencies(nodeId, definition.dependencyDag).includes(predecessorId)) {
      issues.push({
        nodeId,
        message: `Story workflow node "${nodeId}" must depend on "${predecessorId}".`,
      });
    }
  }

  return issues;
}

