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
    shellState: "Manual scene request",
    emptyState: "Scene request is waiting for input.",
    editLabel: "Edit request",
    aiLabel: "Rewrite",
  },
  "scene-prompt": {
    title: "Scene prompt",
    shellState: "Prompt draft shell",
    emptyState: "Ready for scene prompt inference.",
    editLabel: "Edit prompt",
    aiLabel: "Suggest prompt",
  },
  "character-tags": {
    title: "Character tags",
    shellState: "Character tag shell",
    emptyState: "Waiting for the scene prompt.",
    editLabel: "Edit tags",
    aiLabel: "Suggest tags",
  },
  "character-action": {
    title: "Character action",
    shellState: "Action and pose shell",
    emptyState: "Waiting for character tags.",
    editLabel: "Edit action",
    aiLabel: "Suggest action",
  },
  "canvas-binding": {
    title: "3D canvas binding",
    shellState: "Canvas binding shell",
    emptyState: "Waiting for prompt, tags, and action.",
    editLabel: "Edit binding",
    aiLabel: "Suggest binding",
  },
  "resource-recommendation": {
    title: "Checkpoint and LoRA",
    shellState: "Resource selection shell",
    emptyState: "Waiting for prompt, tags, action, and local resources.",
    editLabel: "Edit resources",
    aiLabel: "Suggest resources",
  },
  "parameter-recommendation": {
    title: "Generation parameters",
    shellState: "Parameter shell",
    emptyState: "Waiting for prompt, canvas, and resources.",
    editLabel: "Edit parameters",
    aiLabel: "Suggest parameters",
  },
  "generation-gate": {
    title: "Start image generation",
    shellState: "Explicit confirmation gate",
    emptyState: "Waiting for all upstream nodes before generation can be confirmed.",
    editLabel: "Edit request preview",
    aiLabel: "Suggest final check",
  },
  "comfyui-execution": {
    title: "ComfyUI execution",
    shellState: "Reserved future execution node",
    emptyState: "ComfyUI remains blocked until a future explicit confirmation flow starts generation.",
    editLabel: "Execution locked",
    aiLabel: "Diagnose",
    reserved: true,
  },
  "result-display": {
    title: "Result display",
    shellState: "Reserved future result node",
    emptyState: "Result display remains empty until confirmed ComfyUI execution returns an image.",
    editLabel: "Result locked",
    aiLabel: "Review result",
    reserved: true,
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
  }

  if (node.result !== undefined) {
    return tryStringify(node.result);
  }

  return "";
}
