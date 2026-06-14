import {
  buildCommonWorkflowDependencyDag,
  commonWorkflowDefinitionVersion,
  type CommonWorkflowDagEdge,
  type CommonWorkflowDefinition,
  type CommonWorkflowNodeMetadata,
} from "./workflow-definition";
import {
  executableTimelineNodeIds,
  reservedTimelineNodeIds,
  timelineNodeIds,
  type TimelineNodeAdapters,
  type TimelineNodeId,
} from "./types";

export const singleImageWorkflowMode = "single-image";

export type TimelineWorkflowMode = typeof singleImageWorkflowMode;

export type TimelineWorkflowAdapterFactory = (adapters: TimelineNodeAdapters) => TimelineNodeAdapters;

export type TimelineWorkflowDefinition = CommonWorkflowDefinition<TimelineNodeId> & {
  mode: TimelineWorkflowMode;
  adapterFactory: TimelineWorkflowAdapterFactory;
};

type TimelineWorkspaceKey =
  | "scene-input"
  | "scene-prompt"
  | "character-tags"
  | "character-action"
  | "canvas-binding"
  | "resource-recommendation"
  | "parameter-recommendation"
  | "generation-gate"
  | "comfyui-execution"
  | "result-display";

function createTimelineNodeMetadata({
  aiLabel,
  editLabel,
  inputKind,
  nodeId,
  title,
  workspaceKey,
}: {
  aiLabel: string;
  editLabel: string;
  inputKind: CommonWorkflowNodeMetadata<TimelineNodeId>["manualEdit"]["inputKind"];
  nodeId: TimelineNodeId;
  title: string;
  workspaceKey: TimelineWorkspaceKey;
}): CommonWorkflowNodeMetadata<TimelineNodeId> {
  return {
    nodeId,
    title,
    workspace: {
      key: workspaceKey,
      scope: "workflow",
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

export const singleImageWorkflowEdges = [
  { from: "scene-input", to: "scene-prompt" },
  { from: "scene-prompt", to: "character-tags" },
  { from: "scene-prompt", to: "character-action" },
  { from: "scene-prompt", to: "canvas-binding" },
  { from: "character-tags", to: "canvas-binding" },
  { from: "character-action", to: "canvas-binding" },
  { from: "scene-prompt", to: "resource-recommendation" },
  { from: "character-tags", to: "resource-recommendation" },
  { from: "character-action", to: "resource-recommendation" },
  { from: "scene-prompt", to: "parameter-recommendation" },
  { from: "canvas-binding", to: "parameter-recommendation" },
  { from: "resource-recommendation", to: "parameter-recommendation" },
  { from: "scene-prompt", to: "generation-gate" },
  { from: "character-tags", to: "generation-gate" },
  { from: "character-action", to: "generation-gate" },
  { from: "canvas-binding", to: "generation-gate" },
  { from: "resource-recommendation", to: "generation-gate" },
  { from: "parameter-recommendation", to: "generation-gate" },
  { from: "generation-gate", to: "comfyui-execution" },
  { from: "comfyui-execution", to: "result-display" },
] as const satisfies readonly CommonWorkflowDagEdge<TimelineNodeId>[];

export const singleImageWorkflowDependencyDag = buildCommonWorkflowDependencyDag(
  timelineNodeIds,
  singleImageWorkflowEdges,
);

export const singleImageWorkflowDefinition = {
  mode: singleImageWorkflowMode,
  version: commonWorkflowDefinitionVersion,
  nodeIds: timelineNodeIds,
  executableNodeIds: executableTimelineNodeIds,
  reservedNodeIds: reservedTimelineNodeIds,
  dependencyDag: singleImageWorkflowDependencyDag,
  adapterFactory: (adapters: TimelineNodeAdapters) => adapters,
  metadata: {
    "scene-input": createTimelineNodeMetadata({
      aiLabel: "Rewrite",
      editLabel: "Edit request",
      inputKind: "text",
      nodeId: "scene-input",
      title: "Scene input",
      workspaceKey: "scene-input",
    }),
    "scene-prompt": createTimelineNodeMetadata({
      aiLabel: "Suggest prompt",
      editLabel: "Edit JSON",
      inputKind: "json",
      nodeId: "scene-prompt",
      title: "Prompt generation",
      workspaceKey: "scene-prompt",
    }),
    "character-tags": createTimelineNodeMetadata({
      aiLabel: "Suggest tags",
      editLabel: "Tags locked",
      inputKind: "json",
      nodeId: "character-tags",
      title: "Character tags",
      workspaceKey: "character-tags",
    }),
    "character-action": createTimelineNodeMetadata({
      aiLabel: "Suggest action",
      editLabel: "Action locked",
      inputKind: "json",
      nodeId: "character-action",
      title: "Action planning",
      workspaceKey: "character-action",
    }),
    "canvas-binding": createTimelineNodeMetadata({
      aiLabel: "Suggest binding",
      editLabel: "Visual edits only",
      inputKind: "visual",
      nodeId: "canvas-binding",
      title: "Layout planning",
      workspaceKey: "canvas-binding",
    }),
    "resource-recommendation": createTimelineNodeMetadata({
      aiLabel: "Suggest resources",
      editLabel: "Edit resources",
      inputKind: "visual",
      nodeId: "resource-recommendation",
      title: "Model resources",
      workspaceKey: "resource-recommendation",
    }),
    "parameter-recommendation": createTimelineNodeMetadata({
      aiLabel: "Suggest parameters",
      editLabel: "Edit parameters",
      inputKind: "visual",
      nodeId: "parameter-recommendation",
      title: "Render prompt",
      workspaceKey: "parameter-recommendation",
    }),
    "generation-gate": createTimelineNodeMetadata({
      aiLabel: "Suggest final check",
      editLabel: "Edit request preview",
      inputKind: "json",
      nodeId: "generation-gate",
      title: "Review / export",
      workspaceKey: "generation-gate",
    }),
    "comfyui-execution": createTimelineNodeMetadata({
      aiLabel: "Diagnose",
      editLabel: "Execution locked",
      inputKind: "json",
      nodeId: "comfyui-execution",
      title: "Render execution",
      workspaceKey: "comfyui-execution",
    }),
    "result-display": createTimelineNodeMetadata({
      aiLabel: "Review result",
      editLabel: "Result locked",
      inputKind: "json",
      nodeId: "result-display",
      title: "Artifact result",
      workspaceKey: "result-display",
    }),
  },
} as const satisfies TimelineWorkflowDefinition;

export function getTimelineWorkflowDefinition(
  mode: TimelineWorkflowMode = singleImageWorkflowMode,
): TimelineWorkflowDefinition {
  switch (mode) {
    case singleImageWorkflowMode:
      return singleImageWorkflowDefinition;
  }
}

export {
  storyGraphWorkflowMode,
  storyWorkflowDefinition,
  storyWorkflowDependencyDag,
  storyWorkflowEdges,
  validateShotDependencyGraph,
  validateStoryWorkflowDefinition,
  type StoryGraphWorkflowMode,
  type StoryWorkflowDefinition,
  type StoryWorkflowValidationIssue,
} from "./story-workflow";
