import type { TimelineNodeId, TimelineNodeResult } from "@/features/agent-timeline";
import { singleImageWorkflowDefinition } from "@/features/agent-timeline/workflow-definitions";

export type TimelineNodeContent = {
  title: string;
  shellState: string;
  emptyState: string;
  editLabel: string;
  aiLabel: string;
  reserved?: boolean;
};

export const timelineNodeContent: Record<TimelineNodeId, TimelineNodeContent> = {
  "scene-input": {
    title: singleImageWorkflowDefinition.metadata["scene-input"].title,
    shellState: "Command composer",
    emptyState: "Scene request is waiting for input.",
    editLabel: singleImageWorkflowDefinition.metadata["scene-input"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["scene-input"].aiRetry.label,
  },
  "scene-prompt": {
    title: singleImageWorkflowDefinition.metadata["scene-prompt"].title,
    shellState: "Shared scene context",
    emptyState: "Ready for scene prompt inference.",
    editLabel: singleImageWorkflowDefinition.metadata["scene-prompt"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["scene-prompt"].aiRetry.label,
  },
  "character-tags": {
    title: singleImageWorkflowDefinition.metadata["character-tags"].title,
    shellState: "Parallel tag extraction",
    emptyState: "Waiting for the scene prompt.",
    editLabel: singleImageWorkflowDefinition.metadata["character-tags"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["character-tags"].aiRetry.label,
  },
  "character-action": {
    title: singleImageWorkflowDefinition.metadata["character-action"].title,
    shellState: "Parallel pose planning",
    emptyState: "Waiting for the scene prompt.",
    editLabel: singleImageWorkflowDefinition.metadata["character-action"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["character-action"].aiRetry.label,
  },
  "canvas-binding": {
    title: singleImageWorkflowDefinition.metadata["canvas-binding"].title,
    shellState: "3D scene binding",
    emptyState: "Waiting for prompt, tags, and action.",
    editLabel: singleImageWorkflowDefinition.metadata["canvas-binding"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["canvas-binding"].aiRetry.label,
  },
  "resource-recommendation": {
    title: singleImageWorkflowDefinition.metadata["resource-recommendation"].title,
    shellState: "Checkpoint and LoRA selection",
    emptyState: "Waiting for prompt, tags, action, and local resources.",
    editLabel: singleImageWorkflowDefinition.metadata["resource-recommendation"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["resource-recommendation"].aiRetry.label,
  },
  "parameter-recommendation": {
    title: singleImageWorkflowDefinition.metadata["parameter-recommendation"].title,
    shellState: "Prompt and parameter assembly",
    emptyState: "Waiting for prompt, canvas, and resources.",
    editLabel: singleImageWorkflowDefinition.metadata["parameter-recommendation"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["parameter-recommendation"].aiRetry.label,
  },
  "generation-gate": {
    title: singleImageWorkflowDefinition.metadata["generation-gate"].title,
    shellState: "Explicit confirmation gate",
    emptyState: "Waiting for all upstream nodes before generation can be confirmed.",
    editLabel: singleImageWorkflowDefinition.metadata["generation-gate"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["generation-gate"].aiRetry.label,
  },
  "preview-execution": {
    title: singleImageWorkflowDefinition.metadata["preview-execution"].title,
    shellState: "Low-cost preview generation",
    emptyState: "Waiting for explicit confirmation before generating preview candidates.",
    editLabel: singleImageWorkflowDefinition.metadata["preview-execution"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["preview-execution"].aiRetry.label,
  },
  "preview-scoring": {
    title: singleImageWorkflowDefinition.metadata["preview-scoring"].title,
    shellState: "Structured Vision ranking",
    emptyState: "Waiting for enough successful preview candidates.",
    editLabel: singleImageWorkflowDefinition.metadata["preview-scoring"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["preview-scoring"].aiRetry.label,
  },
  "comfyui-execution": {
    title: singleImageWorkflowDefinition.metadata["comfyui-execution"].title,
    shellState: "Confirmed ComfyUI execution",
    emptyState: "Waiting for explicit confirmation before queuing ComfyUI.",
    editLabel: singleImageWorkflowDefinition.metadata["comfyui-execution"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["comfyui-execution"].aiRetry.label,
  },
  "final-review": {
    title: singleImageWorkflowDefinition.metadata["final-review"].title,
    shellState: "Preview and Final comparison",
    emptyState: "Waiting for complete Preview/Final pairs.",
    editLabel: singleImageWorkflowDefinition.metadata["final-review"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["final-review"].aiRetry.label,
  },
  "result-display": {
    title: singleImageWorkflowDefinition.metadata["result-display"].title,
    shellState: "Standalone timeline images",
    emptyState: "Waiting for confirmed ComfyUI execution to return images.",
    editLabel: singleImageWorkflowDefinition.metadata["result-display"].manualEdit.label,
    aiLabel: singleImageWorkflowDefinition.metadata["result-display"].aiRetry.label,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getTimelineNodeOutputText(node: TimelineNodeResult) {
  if (node.error) {
    return node.error.message;
  }

  if (typeof node.result === "string") {
    return node.result;
  }

  if (isRecord(node.result)) {
    if (typeof node.result.rawIntent === "string") {
      return node.result.rawIntent;
    }

    if (typeof node.result.shellContent === "string") {
      return node.result.shellContent;
    }

    if (typeof node.result.confirmed === "boolean") {
      return node.result.confirmed ? "Generation confirmed." : "Generation confirmation is required.";
    }

    if (typeof node.result.promptId === "string" && typeof node.result.outputNodeId === "string") {
      return `Queued prompt ${node.result.promptId}.`;
    }

    if (Array.isArray(node.result.candidates) && typeof node.result.successfulCount === "number") {
      return `${node.result.successfulCount} preview candidates are ready.`;
    }

    if (Array.isArray(node.result.scores) && Array.isArray(node.result.selectedCandidateIds)) {
      return `${node.result.scores.length} previews scored; ${node.result.selectedCandidateIds.length} selected.`;
    }

    if (Array.isArray(node.result.finals) && typeof node.result.finalCount === "number") {
      return `${node.result.finals.filter((item) => isRecord(item) && item.status === "done").length}/${node.result.finalCount} final images completed.`;
    }

    if (node.result.reviewVersion === 1 && Array.isArray(node.result.pairs)) {
      return node.result.status === "reviewed"
        ? `${node.result.pairs.length} Preview/Final pairs reviewed.`
        : `Final review ${String(node.result.status)}; variants remain selectable.`;
    }

    if (
      typeof node.result.promptId === "string" &&
      isRecord(node.result.image) &&
      typeof node.result.image.url === "string"
    ) {
      return `Generated image results for prompt ${node.result.promptId}.`;
    }

    if (
      isRecord(node.result.checkpoint) &&
      isRecord(node.result.checkpoint.resource) &&
      typeof node.result.checkpoint.resource.name === "string" &&
      Array.isArray(node.result.loras)
    ) {
      const loraCount = node.result.loras.length;
      return `${node.result.checkpoint.resource.name} with ${loraCount} LoRA${loraCount === 1 ? "" : "s"}.`;
    }

    if (
      typeof node.result.width === "number" &&
      typeof node.result.height === "number" &&
      typeof node.result.steps === "number" &&
      typeof node.result.samplerName === "string"
    ) {
      return `${node.result.width}x${node.result.height}, ${node.result.steps} steps, ${node.result.samplerName}.`;
    }
  }

  if (node.result !== undefined) {
    return tryStringify(node.result);
  }

  return "";
}
