import {
  commonWorkflowDefinitionVersion,
  type CommonWorkflowDefinition,
  type CommonWorkflowNodeMetadata,
} from "./workflow-definition";
import {
  executableTimelineNodeIds,
  reservedTimelineNodeIds,
  timelineNodeIds,
  type TimelineNodeId,
} from "./types";
import { mvpTimelineDependencyDag } from "./dag";

export const singleImageWorkflowMode = "single-image";

export type TimelineWorkflowMode = typeof singleImageWorkflowMode;

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

export const singleImageWorkflowDefinition = {
  mode: singleImageWorkflowMode,
  version: commonWorkflowDefinitionVersion,
  nodeIds: timelineNodeIds,
  executableNodeIds: executableTimelineNodeIds,
  reservedNodeIds: reservedTimelineNodeIds,
  dependencyDag: mvpTimelineDependencyDag,
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
} as const satisfies CommonWorkflowDefinition<TimelineNodeId>;
