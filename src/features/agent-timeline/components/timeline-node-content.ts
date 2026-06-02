import type { TimelineNodeId, TimelineNodeResult } from "@/features/agent-timeline";

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
    title: "Scene input",
    shellState: "Command composer",
    emptyState: "Scene request is waiting for input.",
    editLabel: "Edit request",
    aiLabel: "Rewrite",
  },
  "scene-prompt": {
    title: "Prompt generation",
    shellState: "Shared scene context",
    emptyState: "Ready for scene prompt inference.",
    editLabel: "Edit JSON",
    aiLabel: "Suggest prompt",
  },
  "character-tags": {
    title: "Character tags",
    shellState: "Parallel tag extraction",
    emptyState: "Waiting for the scene prompt.",
    editLabel: "Tags locked",
    aiLabel: "Suggest tags",
  },
  "character-action": {
    title: "Action planning",
    shellState: "Parallel pose planning",
    emptyState: "Waiting for the scene prompt.",
    editLabel: "Action locked",
    aiLabel: "Suggest action",
  },
  "canvas-binding": {
    title: "Layout planning",
    shellState: "3D scene binding",
    emptyState: "Waiting for prompt, tags, and action.",
    editLabel: "Visual edits only",
    aiLabel: "Suggest binding",
  },
  "resource-recommendation": {
    title: "Model resources",
    shellState: "Checkpoint and LoRA selection",
    emptyState: "Waiting for prompt, tags, action, and local resources.",
    editLabel: "Edit resources",
    aiLabel: "Suggest resources",
  },
  "parameter-recommendation": {
    title: "Render prompt",
    shellState: "Prompt and parameter assembly",
    emptyState: "Waiting for prompt, canvas, and resources.",
    editLabel: "Edit parameters",
    aiLabel: "Suggest parameters",
  },
  "generation-gate": {
    title: "Review / export",
    shellState: "Explicit confirmation gate",
    emptyState: "Waiting for all upstream nodes before generation can be confirmed.",
    editLabel: "Edit request preview",
    aiLabel: "Suggest final check",
  },
  "comfyui-execution": {
    title: "Render execution",
    shellState: "Confirmed ComfyUI execution",
    emptyState: "Waiting for explicit confirmation before queuing ComfyUI.",
    editLabel: "Execution locked",
    aiLabel: "Diagnose",
  },
  "result-display": {
    title: "Artifact result",
    shellState: "Standalone timeline image",
    emptyState: "Waiting for confirmed ComfyUI execution to return an image.",
    editLabel: "Result locked",
    aiLabel: "Review result",
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

    if (
      typeof node.result.promptId === "string" &&
      isRecord(node.result.image) &&
      typeof node.result.image.url === "string"
    ) {
      return `Generated image for prompt ${node.result.promptId}.`;
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
