"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  CircleDot,
  Database,
  GitBranch,
  ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Paintbrush,
  PencilLine,
  Play,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Tags,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getTimelineNodeDependencies } from "@/features/agent-timeline/dag";
import { executeTimelineGraph, type TimelineWorkflowUpdate } from "@/features/agent-timeline/graph";
import {
  createTimelineWorkflowState,
  DEFAULT_TIMELINE_IMAGE_COUNT,
  DEFAULT_TIMELINE_SOURCE_DENOISE,
  markTimelineNodeRunning,
  normalizeTimelineImageCount,
  normalizeTimelineSourceDenoise,
  setTimelineNodeManualResult,
} from "@/features/agent-timeline/state";
import {
  createTimelineT5NodeAdapters,
  normalizeCharacterTagsTimelineResult,
  normalizeScenePromptTimelineResult,
  type TimelineCanvasBindingInput,
} from "@/features/agent-timeline/t5-node-adapters";
import { createTimelineT7NodeAdapters } from "@/features/agent-timeline/t7-node-adapters";
import {
  TimelineNodeExecutionError,
  type CanvasBindingTimelineResult,
  type CharacterActionTimelineResult,
  type ComfyUiExecutionTimelineResult,
  type ParameterRecommendationTimelineResult,
  type ResultDisplayTimelineResult,
  type ResourceRecommendationTimelineResult,
  type ScenePromptTimelineResult,
  type SceneInputTimelineResult,
  type TimelineNodeId,
  type TimelineNodeStatus,
  type TimelineWorkflowState,
} from "@/features/agent-timeline/types";
import { singleImageWorkflowDefinition } from "@/features/agent-timeline/workflow-definitions";
import type {
  CivitaiAiRecommendationResponse,
  CivitaiResourceListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library/types";
import { extractCivitaiExampleImageDimensions } from "@/features/civitai-lora-library/image-dimensions";
import {
  getCivitaiModelStorageKind,
  makeCivitaiResourceFileNameAliases,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library/resource-files";
import { parseCivitaiAiPromptResponse } from "@/features/editor/ai-prompt/civitai-ai-context";
import type { ComfyUiGenerationLoraSetting } from "@/features/editor/ai-prompt/comfyui-generation-params";
import {
  buildStylePaletteAdviceMessages,
  type StylePalettePromptPreset,
} from "@/features/editor/ai-prompt/style-palette-prompts";
import {
  bindPrimaryTimelineCharacterToEditorStore,
  createTimelinePromptTagSuggestions,
  getTimelineCharacterTagsToBind,
  getPrimaryTimelineCharacterPoseFromEditorStore,
} from "@/features/agent-timeline/editor-canvas-binding";
import {
  getAvailablePromptLibraryTags,
  PromptTagImportReviewDialog,
  splitPromptTagSuggestionsByLibrary,
  type NewPromptTagApplyMode,
  type PendingPromptTagImportReview,
} from "@/features/editor/components/PromptTagImportReviewDialog";
import {
  InpaintMaskDialog,
  toDraft,
  toInpaintRequestPayload,
  type GeneratedImageItem,
  type GenerationDraft,
  type InpaintSubmitInput,
} from "@/features/editor/components/ImageGenerationPanel";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  ComfyUiGeneratedImage,
  ComfyUiPromptHistoryResponse,
} from "@/features/comfyui";
import {
  getLlmProxyErrorMessage,
  isLlmChatResponse,
  LiteLlmError,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@/features/llm";
import { savePromptLibrary } from "@/features/persistence";
import {
  deleteActiveTimelineWorkflowRecord,
  loadActiveTimelineWorkflowRecord,
  saveActiveTimelineWorkflowRecord,
} from "@/features/agent-timeline/timeline-workflow-storage";
import type {
  TimelineOutputDisplayMode,
  TimelineOutputDisplayModeMap,
  TimelineWorkflowRecord,
  TimelineWorkflowRecordInput,
} from "@/features/agent-timeline/timeline-workflow-persistence";
import { isSingleImageTimelineWorkflowRecord } from "@/features/agent-timeline/timeline-workflow-persistence";
import type { CharacterPromptTagTarget } from "@/features/prompt-engine/prompt-library/character-image-prompt-tags";
import {
  defaultSceneForgeUserSettings,
  type CharacterTagNewTermDefaultOption,
  type CentralSettingsPayload,
  type SceneForgeWorkflowSettings,
  type WorkflowDisplayMode,
  workflowDisplayModeOptions,
} from "@/features/settings/types";
import { cn } from "@/shared/utils/cn";
import {
  defaultPromptProfileId,
  formatPromptProfileLabel,
  normalizePromptProfileId,
  promptProfileIds,
  type PromptProfileId,
} from "@/shared/prompt-profile";

import { TimelineNodeStatus as TimelineStatusChip } from "./TimelineNodeStatus";
import {
  isTimelineEditorWorkspaceNode,
  TimelineEditorWorkspace,
} from "./TimelineEditorWorkspace";
import { TimelineParameterRecommendationWorkspace } from "./TimelineParameterRecommendationWorkspace";
import { TimelineResourceRecommendationWorkspace } from "./TimelineResourceRecommendationWorkspace";
import { TimelineScenePromptWorkspace } from "./TimelineScenePromptWorkspace";
import { TimelineWorkflowProjectMenu } from "./TimelineWorkflowProjectMenu";
import { getTimelineNodeOutputText, timelineNodeContent } from "./timeline-node-content";

type DraftMap = Partial<Record<TimelineNodeId, string>>;
type NoticeMap = Partial<Record<TimelineNodeId, string>>;
type OutputDisplayMode = TimelineOutputDisplayMode;
type OutputDisplayModeMap = TimelineOutputDisplayModeMap;
type SceneInputAiAction = "rewrite" | "suggest";
type TimelineAutosaveStatus = "idle" | "loading" | "saved" | "error";
type TimelineSourceImage = NonNullable<SceneInputTimelineResult["sourceImage"]>;

type PendingTimelinePromptTagReview = {
  input: TimelineCanvasBindingInput;
  reject: (error: Error) => void;
  resolve: (mode: NewPromptTagApplyMode) => void;
  review: PendingPromptTagImportReview;
};

type StepDisplay = {
  agent: string;
  artifact: string;
  icon: LucideIcon;
  transform: string;
};

const stepDisplay: Record<TimelineNodeId, StepDisplay> = {
  "scene-input": {
    agent: "Intake agent",
    artifact: "Scene intent",
    icon: Terminal,
    transform: "Capture natural-language intent",
  },
  "scene-prompt": {
    agent: "Prompt agent",
    artifact: "Shared scene context table",
    icon: Bot,
    transform: "Expand scene intent into canonical shared context",
  },
  "character-tags": {
    agent: "Tag agent",
    artifact: "Character and body-part tags",
    icon: Tags,
    transform: "Extract entities, clothing, expression, and body details from prompt context",
  },
  "character-action": {
    agent: "Pose agent",
    artifact: "Action and pose plan",
    icon: Zap,
    transform: "Infer action, motion, and pose targets from prompt context",
  },
  "canvas-binding": {
    agent: "Layout agent",
    artifact: "3D layout binding",
    icon: LayoutDashboard,
    transform: "Map prompt entities into editable scene structure",
  },
  "resource-recommendation": {
    agent: "Resource agent",
    artifact: "Checkpoint and LoRA plan",
    icon: Database,
    transform: "Select available local resources",
  },
  "parameter-recommendation": {
    agent: "Render agent",
    artifact: "Render prompt and parameters",
    icon: SlidersHorizontal,
    transform: "Assemble render-ready request details",
  },
  "generation-gate": {
    agent: "Review agent",
    artifact: "Generation approval packet",
    icon: CheckCircle2,
    transform: "Hold final request for explicit user confirmation",
  },
  "comfyui-execution": {
    agent: "ComfyUI agent",
    artifact: "Queue metadata",
    icon: Braces,
    transform: "Validate and queue the confirmed ComfyUI render request",
  },
  "result-display": {
    agent: "Artifact agent",
    artifact: "Generated image results",
    icon: ImageIcon,
    transform: "Store returned images as standalone timeline state",
  },
};

const timelineHeaderClassName =
  "grid min-h-14 shrink-0 grid-cols-1 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4";
const timelineHeaderPrimaryClassName = "flex min-w-0 items-center gap-3";
const timelineHeaderIdentityClassName =
  "flex min-w-0 max-w-[min(38rem,50vw)] items-center gap-3";
const timelineHeaderProjectClassName = "flex min-w-0 justify-center";
const timelineHeaderContextClassName =
  "hidden h-9 min-w-0 max-w-[28rem] grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 xl:grid";
const timelineHeaderActionsClassName =
  "flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end sm:flex-nowrap";
const timelineHeaderNavClassName =
  "flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1";
const timelineHeaderNavCurrentClassName =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-semibold text-slate-950 shadow-sm";
const timelineHeaderNavLinkClassName =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-950";
const rawEditableNodeIds = new Set<TimelineNodeId>(["scene-input", "scene-prompt"]);
const timelineImageCountOptions = [1, 2, 3, 4] as const;
const visualOutputNodeIds = new Set<TimelineNodeId>([
  "scene-prompt",
  "canvas-binding",
  "resource-recommendation",
  "parameter-recommendation",
  "result-display",
]);
const nonEditableAiNodeIds = new Set<TimelineNodeId>(["character-tags", "character-action"]);
const parallelNodeIds = new Set<TimelineNodeId>(["character-tags", "character-action"]);
const workflowNodeIds = singleImageWorkflowDefinition.nodeIds;

async function completeTimelineChatViaApi(
  request: LlmChatRequest,
  options: { applyProjectNsfw?: boolean } = {},
): Promise<LlmChatResponse> {
  const supportsNsfw = useEditorStore.getState().project.settings.supportsNsfw === true;
  const requestBody: LlmChatRequest = {
    ...request,
    ...(options.applyProjectNsfw === false
      ? {}
      : { nsfw: supportsNsfw || request.nsfw === true }),
  };
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new LiteLlmError(getLlmProxyErrorMessage(payload), {
      statusCode: response.status,
      details: payload,
    });
  }

  if (!isLlmChatResponse(payload)) {
    throw new LiteLlmError("LLM response did not include usable chat content.", {
      statusCode: 502,
      details: payload,
    });
  }

  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function collectApiErrorDetailMessages(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  const ownErrors = isStringArray(value.errors) ? value.errors : [];

  return [
    ...ownErrors,
    ...collectApiErrorDetailMessages(value.details),
    ...collectApiErrorDetailMessages(value.error),
  ];
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : fallback;
  const details = Array.from(new Set(collectApiErrorDetailMessages(payload)))
    .filter((detail) => !message.includes(detail));

  return details.length > 0 ? [message, ...details].join(" ") : message;
}

function getTimelineNodeRawJsonText(node: TimelineWorkflowState["nodes"][TimelineNodeId]) {
  if (node.result !== undefined) {
    return JSON.stringify(node.result, null, 2);
  }

  if (node.error) {
    return JSON.stringify({ error: node.error }, null, 2);
  }

  return "";
}

function sanitizeDescriptionSnippet(value: string | null) {
  return value
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function toSelectedCivitaiResourcePreview(resource: CivitaiResourceListItem): SelectedCivitaiResourcePreview {
  const modelFileName = makeCivitaiResourceTargetFileName(resource);

  return {
    id: resource.id,
    resourceType: resource.resourceType === "model" ? "model" : "lora",
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    creator: resource.creator,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    descriptionSnippet: sanitizeDescriptionSnippet(resource.description),
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    recommendations: resource.recommendations,
    previewImage: resource.previewImage,
    modelFileName,
    modelFileNameAliases: makeCivitaiResourceFileNameAliases(resource),
    exampleImageDimensions: extractCivitaiExampleImageDimensions(resource.officialImagesJson),
    ...(resource.resourceType === "model" ? { modelStorageKind: getCivitaiModelStorageKind(resource) } : {}),
  };
}

function toTimelineResourceCandidate(resource: CivitaiResourceListItem) {
  const preview = toSelectedCivitaiResourcePreview(resource);

  return {
    resource: preview,
    importedImageCount: resource.importedImageCount,
    commonCheckpoints: [],
    commonLoras: [],
    score: resource.importedImageCount,
  };
}

function getTimelineWorkflowPromptProfile(workflow: TimelineWorkflowState) {
  const sceneInput = workflow.nodes["scene-input"].result;

  return isRecord(sceneInput) ? normalizePromptProfileId(sceneInput.promptProfile) : defaultPromptProfileId;
}

async function loadCivitaiResourceItems(
  resourceType: "lora" | "model",
  promptProfile: PromptProfileId,
) {
  const response = await fetch(
    `/api/civitai-lora-library/resources?resourceType=${resourceType}&category=all&downloaded=ready&promptProfile=${promptProfile}`,
  );
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to load local Civitai resources."));
  }

  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("Civitai resource response did not include an item list.");
  }

  return payload.items as CivitaiResourceListItem[];
}

async function loadTimelineResourceCandidatesViaApi(promptProfile: PromptProfileId) {
  const [checkpoints, loras] = await Promise.all([
    loadCivitaiResourceItems("model", promptProfile),
    loadCivitaiResourceItems("lora", promptProfile),
  ]);

  return {
    checkpoints: checkpoints.map(toTimelineResourceCandidate),
    loras: loras.map(toTimelineResourceCandidate),
  };
}

async function recommendTimelineResourcesViaApi({
  desiredEffect,
  promptProfile,
}: {
  desiredEffect: string;
  promptProfile: PromptProfileId;
}) {
  const response = await fetch("/api/civitai-lora-library/ai-recommendation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      desiredEffect,
      maxLoras: 3,
      promptProfile,
    }),
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to recommend local Civitai resources."));
  }

  return payload as CivitaiAiRecommendationResponse;
}

async function loadTimelineStyleAdviceViaApi({
  baseNegativePrompt,
  finalPositivePrompt,
  referenceResolution,
  selectedResources,
}: {
  baseNegativePrompt: string;
  finalPositivePrompt: string;
  referenceResolution?: {
    height: number;
    width: number;
  };
  selectedResources: SelectedCivitaiResourcesPreview;
}) {
  if (!selectedResources.checkpoint) {
    return null;
  }

  const preset: StylePalettePromptPreset = {
    id: "portrait",
    label: "Timeline render prompt",
    description: referenceResolution
      ? `Timeline prompt used for img2img model parameter advice. Use the uploaded source image dimensions ${referenceResolution.width}x${referenceResolution.height} as the reference resolution.`
      : "Timeline prompt used for model parameter advice.",
    positive: finalPositivePrompt,
    negative: baseNegativePrompt,
  };
  const response = await completeTimelineChatViaApi(
    {
      purpose: "stable-diffusion-prompt-generation",
      messages: buildStylePaletteAdviceMessages({
        artistPrompts: [],
        preset,
        resources: selectedResources,
      }),
      temperature: 0.25,
      maxTokens: 900,
    },
    { applyProjectNsfw: false },
  );

  const parsed = parseCivitaiAiPromptResponse(response.content);

  return parsed.parameterSuggestions ? parsed : null;
}

async function loadTimelineSamplerOptionsViaApi() {
  try {
    const response = await fetch("/api/comfyui/sampler-options");
    const payload: unknown = await response.json();

    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.samplers) || !Array.isArray(payload.schedulers)) {
      return { samplers: [], schedulers: [] };
    }

    return {
      samplers: payload.samplers.filter((value): value is string => typeof value === "string"),
      schedulers: payload.schedulers.filter((value): value is string => typeof value === "string"),
    };
  } catch {
    return { samplers: [], schedulers: [] };
  }
}

function parseManualJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseSceneInputAiJson(value: string) {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;

      if (isRecord(parsed) && typeof parsed.sceneRequest === "string") {
        return parsed.sceneRequest;
      }
    } catch {
      // Try the next likely JSON span.
    }
  }

  return trimmed;
}

function normalizeSceneInputAiText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function getSceneInputRawIntent(workflow: TimelineWorkflowState | null) {
  const result = workflow?.nodes["scene-input"].result;

  return isRecord(result) && typeof result.rawIntent === "string" ? result.rawIntent : "";
}

function getSceneInputImageCount(workflow: TimelineWorkflowState | null) {
  const result = workflow?.nodes["scene-input"].result;

  return isRecord(result)
    ? (result.sourceImage ? 1 : normalizeTimelineImageCount(result.imageCount))
    : DEFAULT_TIMELINE_IMAGE_COUNT;
}

function getSceneInputSourceImage(workflow: TimelineWorkflowState | null): TimelineSourceImage | null {
  const result = workflow?.nodes["scene-input"].result;

  return isRecord(result) && isRecord(result.sourceImage)
    ? result.sourceImage as TimelineSourceImage
    : null;
}

function getSceneInputSourceDenoise(workflow: TimelineWorkflowState | null) {
  const result = workflow?.nodes["scene-input"].result;

  return isRecord(result) && typeof result.sourceDenoise === "number"
    ? normalizeTimelineSourceDenoise(result.sourceDenoise)
    : DEFAULT_TIMELINE_SOURCE_DENOISE;
}

function parseSceneInputAiResponse(response: LlmChatResponse) {
  return normalizeSceneInputAiText(parseSceneInputAiJson(response.content));
}

function buildSceneInputAiRequest({
  action,
  promptProfile,
  sceneRequest,
}: {
  action: SceneInputAiAction;
  promptProfile: PromptProfileId;
  sceneRequest: string;
}): LlmChatRequest {
  const actionInstruction = action === "rewrite"
    ? [
        "Rewrite the provided scene request into a clearer, more generation-ready command.",
        "Preserve the user's subject, setting, mood, camera intent, and constraints.",
        "Do not add a second main character unless the user already requested one.",
      ]
    : [
        sceneRequest
          ? "Suggest one stronger alternate scene request inspired by the current draft, with the main character as the clear focus."
          : "Suggest one concise, visually rich single-image scene request centered on one clearly described main character.",
        "Use Japanese illustration / anime-inspired style only as the rendering style: clean character design, expressive eyes, readable silhouette, polished linework, and painterly color accents.",
        "Do not add Japanese cultural content unless the user asks for it; avoid inventing shrine, kimono, school uniform, samurai, archer, yokai, torii, katana, or other Japan-themed setting, clothing, action, or props just because of the style.",
        "Prioritize character details over environment: identity or role, visible appearance, clothing, expression, pose/action, and how the character relates to the scene.",
        "Keep the setting brief and supportive; avoid long background, atmosphere, prop, or lighting lists that can dilute character detail.",
        "Make it specific enough to start the SceneForge timeline while preserving the character as the dominant subject.",
        "Avoid file paths, model names, checkpoint names, LoRA names, render parameters, and implementation details.",
      ];

  return {
    purpose: "stable-diffusion-prompt-generation",
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's scene input agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "All natural-language fields must be English.",
          "Keep the result as a single-image scene request for an editable visual prompt workflow.",
          `Selected prompt profile: ${formatPromptProfileLabel(promptProfile)} (${promptProfile}).`,
          ...actionInstruction,
          'Required shape: {"sceneRequest":"..."}',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            action,
            currentSceneRequest: sceneRequest,
            promptProfile,
          },
          null,
          2,
        ),
      },
    ],
    temperature: action === "rewrite" ? 0.25 : 0.55,
    maxTokens: 300,
  };
}

function createManualResult(
  nodeId: TimelineNodeId,
  value: string,
  promptProfile: PromptProfileId,
  imageCount = DEFAULT_TIMELINE_IMAGE_COUNT,
  sourceImage?: TimelineSourceImage | null,
  sourceDenoise = DEFAULT_TIMELINE_SOURCE_DENOISE,
) {
  if (nodeId === "scene-input") {
    return {
      rawIntent: value,
      promptProfile,
      imageCount: sourceImage ? 1 : normalizeTimelineImageCount(imageCount),
      ...(sourceImage ? { sourceDenoise: normalizeTimelineSourceDenoise(sourceDenoise) } : {}),
      ...(sourceImage ? { sourceImage } : {}),
    } satisfies SceneInputTimelineResult;
  }

  const parsed = parseManualJson(value);

  if (parsed !== null) {
    try {
      if (nodeId === "scene-prompt") {
        return normalizeScenePromptTimelineResult(parsed);
      }

      if (nodeId === "character-tags") {
        return normalizeCharacterTagsTimelineResult(parsed);
      }

      if (
        nodeId === "character-action" &&
        typeof parsed === "object" &&
        parsed !== null &&
        "action" in parsed &&
        "pose" in parsed &&
        "poseSummary" in parsed
      ) {
        return parsed as CharacterActionTimelineResult;
      }

      if (
        nodeId === "canvas-binding" &&
        typeof parsed === "object" &&
        parsed !== null &&
        "primaryCharacter" in parsed &&
        "pose" in parsed &&
        "spatialSummary" in parsed
      ) {
        return parsed as CanvasBindingTimelineResult;
      }
    } catch (error) {
      if (!(error instanceof TimelineNodeExecutionError)) {
        throw error;
      }
    }
  }

  return {
    shellContent: value,
  };
}

function getCompactStatusLabel(status: TimelineNodeStatus) {
  if (status === "done" || status === "manual") {
    return "Done";
  }

  if (status === "ready") {
    return "Ready";
  }

  if (status === "running") {
    return "Running";
  }

  if (status === "blocked" || status === "error") {
    return "Blocked";
  }

  return "Pending";
}

function getStepTone(status: TimelineNodeStatus) {
  if (status === "done" || status === "manual") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "ready") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (status === "running") {
    return "border-indigo-200 bg-indigo-50 text-indigo-700";
  }

  if (status === "stale") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (status === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-white text-slate-500";
}

function normalizeWorkflowDisplayMode(value: unknown): WorkflowDisplayMode {
  return typeof value === "string" && workflowDisplayModeOptions.includes(value as WorkflowDisplayMode)
    ? (value as WorkflowDisplayMode)
    : defaultSceneForgeUserSettings.workflow.displayMode;
}

function normalizeTimelineWorkflowSettings(value: unknown): SceneForgeWorkflowSettings {
  const record = isRecord(value) ? value : {};
  const defaultWorkflowSettings = defaultSceneForgeUserSettings.workflow;

  return {
    characterTagNewTermDefaultOption:
      typeof record.characterTagNewTermDefaultOption === "string"
        ? (record.characterTagNewTermDefaultOption as CharacterTagNewTermDefaultOption)
        : defaultWorkflowSettings.characterTagNewTermDefaultOption,
    autoReview: typeof record.autoReview === "boolean" ? record.autoReview : defaultWorkflowSettings.autoReview,
    displayMode: normalizeWorkflowDisplayMode(record.displayMode),
  };
}

function getSimpleTimelineProgress(workflow: TimelineWorkflowState | null) {
  if (!workflow) {
    return {
      currentTask: "Waiting for a scene command.",
      percent: 0,
    };
  }

  const completedCount = workflowNodeIds.filter((nodeId) => {
    const status = workflow.nodes[nodeId].status;

    return status === "done" || status === "manual";
  }).length;
  const runningNodeId = workflowNodeIds.find((nodeId) => workflow.nodes[nodeId].status === "running");
  const errorNodeId = workflowNodeIds.find((nodeId) => workflow.nodes[nodeId].status === "error");
  const confirmationNode = workflow.nodes["generation-gate"];
  const confirmationRequired =
    confirmationNode.status === "blocked" && confirmationNode.error?.code === "confirmation_required";
  const nextNodeId = runningNodeId ??
    errorNodeId ??
    (confirmationRequired ? "generation-gate" : undefined) ??
    workflowNodeIds.find((nodeId) => {
      const status = workflow.nodes[nodeId].status;

      return status !== "done" && status !== "manual";
    }) ??
    "result-display";
  const nextNode = workflow.nodes[nextNodeId];
  const content = timelineNodeContent[nextNodeId];
  const progress = Math.round((completedCount / workflowNodeIds.length) * 100);

  if (workflow.nodes["result-display"].status === "done") {
    return {
      currentTask: "Generated result ready.",
      percent: 100,
    };
  }

  if (runningNodeId) {
    return {
      currentTask: `${content.title} is running.`,
      percent: Math.min(98, Math.round(((completedCount + 0.5) / workflowNodeIds.length) * 100)),
    };
  }

  if (confirmationRequired) {
    return {
      currentTask: "Review the render request before ComfyUI execution.",
      percent: progress,
    };
  }

  if (errorNodeId) {
    return {
      currentTask: nextNode.error?.message ?? `${content.title} needs attention.`,
      percent: progress,
    };
  }

  return {
    currentTask: `${content.title} is ${getCompactStatusLabel(nextNode.status).toLowerCase()}.`,
    percent: progress,
  };
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildDependencyText(nodeId: TimelineNodeId) {
  const dependencies = getTimelineNodeDependencies(nodeId);

  if (dependencies.length === 0) {
    return "User command";
  }

  return dependencies.map((dependencyId) => timelineNodeContent[dependencyId].title).join(", ");
}

function hasVisualOutputMode(nodeId: TimelineNodeId) {
  return visualOutputNodeIds.has(nodeId);
}

function canRawEditNode(nodeId: TimelineNodeId, workflow: TimelineWorkflowState | null) {
  return Boolean(workflow) && rawEditableNodeIds.has(nodeId);
}

function areGateDependenciesDone(workflow: TimelineWorkflowState) {
  return getTimelineNodeDependencies("generation-gate").every((nodeId) => {
    const status = workflow.nodes[nodeId].status;

    return status === "done" || status === "manual";
  });
}

function canConfirmTimelineWorkflow(workflow: TimelineWorkflowState | null) {
  if (!workflow || workflow.generationConfirmed || !areGateDependenciesDone(workflow)) {
    return false;
  }

  const gate = workflow.nodes["generation-gate"];

  return gate.status === "ready" ||
    gate.status === "blocked" && gate.error?.code === "confirmation_required";
}

function mergeTimelineWorkflowUpdate(
  workflow: TimelineWorkflowState,
  update: TimelineWorkflowUpdate,
): TimelineWorkflowState {
  return {
    ...workflow,
    ...update,
    nodes: {
      ...workflow.nodes,
      ...update.nodes,
    },
  };
}

async function confirmTimelineGenerationViaApi(workflow: TimelineWorkflowState) {
  const response = await fetch("/api/agent-timeline/confirm-generation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ workflow }),
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to confirm and run timeline generation."));
  }

  if (!isRecord(payload) || !isRecord(payload.workflow)) {
    throw new Error("Timeline generation response did not include workflow state.");
  }

  return payload.workflow as TimelineWorkflowState;
}

async function loadTimelineSettingsViaApi(): Promise<CentralSettingsPayload> {
  const response = await fetch("/api/settings");
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to load timeline settings."));
  }

  return payload as CentralSettingsPayload;
}

function getNewPromptTagApplyMode(
  option: CharacterTagNewTermDefaultOption,
): NewPromptTagApplyMode | null {
  if (option === "existing-only") {
    return "skip";
  }

  if (option === "temporary") {
    return "temporary";
  }

  if (option === "import") {
    return "import";
  }

  return null;
}

function isResultDisplayTimelineResult(value: unknown): value is ResultDisplayTimelineResult {
  return (
    isRecord(value) &&
    isRecord(value.image) &&
    typeof value.image.url === "string" &&
    typeof value.promptId === "string" &&
    isRecord(value.storedImage)
  );
}

function getTimelineResultImages(result: ResultDisplayTimelineResult) {
  return result.images?.length ? result.images : [result.image];
}

function getTimelineResultStoredImages(result: ResultDisplayTimelineResult) {
  return result.storedImages?.length ? result.storedImages : [result.storedImage];
}

function createTimelineResultImageItem({
  image,
  index,
  promptId,
  seed,
  storedImage,
}: {
  image: ResultDisplayTimelineResult["image"];
  index: number;
  promptId: string;
  seed: number;
  storedImage: ResultDisplayTimelineResult["storedImage"];
}): GeneratedImageItem {
  return {
    favorited: false,
    id: `timeline-${promptId}-${index}-${image.filename}`,
    image,
    localFilename: storedImage.filename,
    persisted: true,
    promptId,
    resultSource: "text-to-image",
    sessionGenerated: true,
    sourceReference: {
      filename: image.filename,
      ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
      ...(image.type !== undefined ? { type: image.type } : {}),
    },
    storage: "sceneforge",
    seed,
  };
}

function createTimelineInpaintImageItem({
  image,
  index,
  parentImageId,
  promptId,
  seed,
  storedImage,
}: {
  image: ComfyUiGeneratedImage;
  index: number;
  parentImageId: string;
  promptId: string;
  seed: number;
  storedImage: ResultDisplayTimelineResult["storedImage"];
}): GeneratedImageItem {
  return {
    favorited: false,
    id: `timeline-inpaint-${promptId}-${index}-${image.filename}`,
    localFilename: storedImage.filename,
    persisted: true,
    promptId,
    resultSource: "inpaint",
    sessionGenerated: true,
    sourceReference: {
      filename: image.filename,
      ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
      ...(image.type !== undefined ? { type: image.type } : {}),
    },
    storage: "sceneforge",
    seed,
    historyId: parentImageId,
    image,
  };
}

function getTimelineExecutionDraft(workflow: TimelineWorkflowState): GenerationDraft | null {
  const execution = workflow.nodes["comfyui-execution"].result;

  if (!isRecord(execution) || !isRecord(execution.request)) {
    return null;
  }

  return toDraft(execution.request as ComfyUiExecutionTimelineResult["request"]);
}

function getTimelineSelectedResources(workflow: TimelineWorkflowState): SelectedCivitaiResourcesPreview {
  const resourceResult = workflow.nodes["resource-recommendation"].result;

  if (!isRecord(resourceResult) || !isRecord(resourceResult.checkpoint) || !Array.isArray(resourceResult.loras)) {
    return {
      checkpoint: null,
      loras: [],
    };
  }

  const checkpoint = isRecord(resourceResult.checkpoint.resource)
    ? resourceResult.checkpoint.resource as SelectedCivitaiResourcePreview
    : null;
  const loras = resourceResult.loras
    .map((entry) => isRecord(entry) && isRecord(entry.resource)
      ? entry.resource as SelectedCivitaiResourcePreview
      : null)
    .filter((entry): entry is SelectedCivitaiResourcePreview => entry !== null);

  return {
    checkpoint,
    loras,
  };
}

async function waitForTimelineInpaintImages(
  promptId: string,
  expectedImageCount = 1,
  onPoll?: (history: ComfyUiPromptHistoryResponse) => void,
) {
  const deadline = Date.now() + 60 * 60 * 1000;

  while (Date.now() < deadline) {
    const response = await fetch(`/api/comfyui/history/${encodeURIComponent(promptId)}`, {
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(payload, "Unable to read ComfyUI inpaint history."));
    }

    const history = payload as ComfyUiPromptHistoryResponse;
    onPoll?.(history);

    if (history.images.length >= expectedImageCount) {
      return history;
    }

    if (history.completed) {
      throw new Error("ComfyUI completed the inpaint job without returning an image.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for ComfyUI inpaint output.");
}

async function saveTimelineInpaintImage(image: ComfyUiGeneratedImage) {
  const response = await fetch("/api/comfyui/generated-images", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      image: {
        filename: image.filename,
        ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
        ...(image.type !== undefined ? { type: image.type } : {}),
      },
    }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to store timeline inpaint image."));
  }

  return payload as ResultDisplayTimelineResult["storedImage"];
}

function TimelineResultDisplayWorkspace({
  emptyState,
  node,
  workflow,
}: {
  emptyState: string;
  node: TimelineWorkflowState["nodes"][TimelineNodeId];
  workflow: TimelineWorkflowState;
}) {
  const result = isResultDisplayTimelineResult(node.result) ? node.result : null;
  const draft = useMemo(() => getTimelineExecutionDraft(workflow), [workflow]);
  const selectedResources = useMemo(() => getTimelineSelectedResources(workflow), [workflow]);
  const [inpaintImageItem, setInpaintImageItem] = useState<GeneratedImageItem | null>(null);
  const [inpaintItems, setInpaintItems] = useState<GeneratedImageItem[]>([]);
  const [inpaintStatus, setInpaintStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [inpaintMessage, setInpaintMessage] = useState("");

  if (!result) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        {node.error?.message ?? emptyState}
      </div>
    );
  }

  const resultImages = getTimelineResultImages(result);
  const storedImages = getTimelineResultStoredImages(result);
  const totalBytes = storedImages.reduce((total, image) => total + image.byteLength, 0);
  const parentSeed = draft?.seed ?? 0;
  const parentItems = resultImages.map((image, index) => createTimelineResultImageItem({
    image,
    index,
    promptId: result.promptId,
    seed: parentSeed,
    storedImage: storedImages[index] ?? result.storedImage,
  }));
  const loraSettings: ComfyUiGenerationLoraSetting[] = selectedResources.loras
    .map((resource, index) => {
      const draftLora = draft?.loras.find((lora) => lora.loraName === resource.modelFileName) ?? draft?.loras[index];

      if (!draftLora) {
        return null;
      }

      return {
        enabled: draftLora.enabled,
        loraName: draftLora.loraName,
        resource,
        source: "ai",
        strengthClip: draftLora.strengthClip,
        strengthModel: draftLora.strengthModel,
      };
    })
    .filter((entry): entry is ComfyUiGenerationLoraSetting => entry !== null);

  async function submitTimelineInpaint(input: InpaintSubmitInput) {
    if (!draft || !inpaintImageItem) {
      throw new Error("Timeline inpaint settings are not ready.");
    }

    setInpaintStatus("loading");
    setInpaintMessage("Submitting inpaint job to ComfyUI...");

    try {
      const clientId = `timeline-inpaint-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
      const requestPayload = toInpaintRequestPayload(draft, input);
      const response = await fetch("/api/comfyui/inpaint-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestPayload, clientId }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "ComfyUI inpaint request failed."));
      }

      if (!isRecord(payload) || typeof payload.promptId !== "string") {
        throw new Error("ComfyUI inpaint response did not include a prompt id.");
      }

      setInpaintMessage(`Inpaint job submitted to ComfyUI, seed ${input.seed}.`);
      const history = await waitForTimelineInpaintImages(payload.promptId, 1, (historyUpdate) => {
        if (historyUpdate.images.length > 0) {
          setInpaintMessage(`Received ${historyUpdate.images.length}/1 inpaint image, seed ${input.seed}.`);
        }
      });
      const image = history.images[0];

      if (!image) {
        throw new Error("ComfyUI inpaint completed without an image.");
      }

      const storedImage = await saveTimelineInpaintImage(image);
      const inpaintItem = createTimelineInpaintImageItem({
        image: {
          ...image,
          url: storedImage.url,
        },
        index: inpaintItems.length,
        parentImageId: inpaintImageItem.id,
        promptId: payload.promptId,
        seed: input.seed,
        storedImage,
      });

      setInpaintItems((current) => [...current, inpaintItem]);
      setInpaintStatus("success");
      setInpaintMessage("Inpaint image generated and stored.");
      setInpaintImageItem(null);
    } catch (error) {
      setInpaintStatus("error");
      setInpaintMessage(error instanceof Error ? error.message : "Timeline inpaint failed.");
      throw error;
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="timeline-result-workspace">
      <div className={cn(
        "grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3",
        resultImages.length > 1 ? "md:grid-cols-2" : "grid-cols-1",
      )}>
        {parentItems.map((item, index) => (
          <figure className="overflow-hidden rounded-md border border-slate-200 bg-white" key={`${item.image.nodeId}:${item.image.filename}:${index}`}>
            <Image
              alt={`Timeline generated ComfyUI result ${index + 1}`}
              className="max-h-[42rem] w-full object-contain"
              height={1024}
              src={item.image.url}
              unoptimized
              width={1024}
            />
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
              <figcaption className="text-[11px] font-semibold text-slate-500">
                {resultImages.length > 1 ? `Image ${index + 1} of ${resultImages.length}` : "Generated image"}
              </figcaption>
              <Button
                className="h-8 gap-1.5 rounded-md bg-sky-600 px-2.5 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
                disabled={!draft || inpaintStatus === "loading"}
                onClick={() => setInpaintImageItem(item)}
                type="button"
              >
                <Paintbrush className="size-3.5" />
                Inpaint
              </Button>
            </div>
          </figure>
        ))}
      </div>
      {inpaintItems.length > 0 ? (
        <div className={cn(
          "grid gap-3 rounded-md border border-sky-200 bg-sky-50 p-3",
          inpaintItems.length > 1 ? "md:grid-cols-2" : "grid-cols-1",
        )}>
          {inpaintItems.map((item, index) => (
            <figure className="overflow-hidden rounded-md border border-sky-200 bg-white" key={item.id}>
              <Image
                alt={`Timeline inpaint result ${index + 1}`}
                className="max-h-[42rem] w-full object-contain"
                height={1024}
                src={item.image.url}
                unoptimized
                width={1024}
              />
              <figcaption className="border-t border-sky-100 px-3 py-2 text-[11px] font-semibold text-sky-700">
                Inpaint result {index + 1}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {inpaintStatus !== "idle" && inpaintMessage ? (
        <div className={cn(
          "rounded-md border p-3 text-xs leading-relaxed",
          inpaintStatus === "error"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-sky-200 bg-sky-50 text-sky-700",
        )}>
          {inpaintStatus === "loading" ? <LoaderCircle className="mr-1.5 inline size-3.5 animate-spin" /> : null}
          {inpaintMessage}
        </div>
      ) : null}
      {draft && inpaintImageItem ? (
        <InpaintMaskDialog
          busy={inpaintStatus === "loading"}
          draft={draft}
          imageItem={inpaintImageItem}
          loraSettings={loraSettings}
          onClose={() => setInpaintImageItem(null)}
          onSubmit={submitTimelineInpaint}
          open
          selectedResources={selectedResources}
        />
      ) : null}
      <dl className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs md:grid-cols-2">
        <div>
          <dt className="font-semibold uppercase text-slate-500">Prompt ID</dt>
          <dd className="mt-1 break-all text-slate-800">{result.promptId}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase text-slate-500">Stored images</dt>
          <dd className="mt-1 break-all text-slate-800">
            {storedImages.length === 1 ? result.storedImage.filename : `${storedImages.length} images`}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase text-slate-500">Content type</dt>
          <dd className="mt-1 text-slate-800">{result.storedImage.contentType}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase text-slate-500">Total bytes</dt>
          <dd className="mt-1 text-slate-800">{totalBytes.toLocaleString()}</dd>
        </div>
      </dl>
      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          {result.warnings.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

export function TimelineShell() {
  const [sceneRequest, setSceneRequest] = useState("");
  const [selectedPromptProfile, setSelectedPromptProfile] =
    useState<PromptProfileId>(defaultPromptProfileId);
  const [selectedImageCount, setSelectedImageCount] = useState(DEFAULT_TIMELINE_IMAGE_COUNT);
  const [selectedSourceDenoise, setSelectedSourceDenoise] = useState(DEFAULT_TIMELINE_SOURCE_DENOISE);
  const [selectedSourceImage, setSelectedSourceImage] = useState<TimelineSourceImage | null>(null);
  const [workflow, setWorkflow] = useState<TimelineWorkflowState | null>(null);
  const [workflowProjectId, setWorkflowProjectId] = useState<string | null>(null);
  const [workflowProjectName, setWorkflowProjectName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<TimelineNodeId>("scene-input");
  const [editingNodeId, setEditingNodeId] = useState<TimelineNodeId | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [outputDisplayModes, setOutputDisplayModes] = useState<OutputDisplayModeMap>({});
  const [notices, setNotices] = useState<NoticeMap>({});
  const [isRunning, setIsRunning] = useState(false);
  const activeRunIdRef = useRef(0);
  const sourceImageInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingPromptTagReview, setPendingPromptTagReview] =
    useState<PendingTimelinePromptTagReview | null>(null);
  const [isSavingPromptTagReview, setIsSavingPromptTagReview] = useState(false);
  const [timelineSettings, setTimelineSettings] = useState<SceneForgeWorkflowSettings>(
    defaultSceneForgeUserSettings.workflow,
  );
  const pendingPromptTagReviewRef = useRef<PendingTimelinePromptTagReview | null>(null);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const autosaveVersionRef = useRef(0);
  const latestAutosaveInputRef = useRef<TimelineWorkflowRecordInput | null>(null);
  const restoreVersionRef = useRef(0);
  const shouldClearActiveWorkflowRef = useRef(false);
  const isMountedRef = useRef(true);
  const [, setAutosaveStatus] = useState<TimelineAutosaveStatus>("idle");
  const [, setAutosaveMessage] = useState("");

  const previewWorkflow = useMemo(() => createTimelineWorkflowState({ workflowId: "draft-workflow" }), []);
  const activeWorkflow = workflow ?? previewWorkflow;
  const selectedNode = activeWorkflow.nodes[selectedNodeId];
  const selectedContent = timelineNodeContent[selectedNodeId];
  const selectedWorkspaceKey = singleImageWorkflowDefinition.metadata[selectedNodeId].workspace.key;
  const selectedDisplay = stepDisplay[selectedNodeId];
  const SelectedIcon = selectedDisplay.icon;
  const selectedOutput = getTimelineNodeOutputText(selectedNode);
  const selectedRawJsonOutput = getTimelineNodeRawJsonText(selectedNode);
  const selectedHasVisualOutput = hasVisualOutputMode(selectedNodeId);
  const selectedIsVisualOnlyEditable = selectedNodeId === "canvas-binding";
  const selectedOutputDisplayMode: OutputDisplayMode = selectedHasVisualOutput
    ? selectedIsVisualOnlyEditable
      ? "visual"
      : outputDisplayModes[selectedNodeId] ?? "visual"
    : "json";
  const selectedRawEditable = canRawEditNode(selectedNodeId, workflow);
  const selectedIsNonEditableAiNode = nonEditableAiNodeIds.has(selectedNodeId);
  const sceneRequestIsUsable = sceneRequest.trim().length > 0;
  const selectedNodeAiDisabled =
    isRunning ||
    selectedContent.reserved ||
    selectedNode.status === "blocked" ||
    selectedNode.status === "running";
  const generationCanBeConfirmed = canConfirmTimelineWorkflow(workflow);
  const workflowTitle = workflow ? workflowProjectName.trim() || sceneRequest || "Unnamed workflow" : "Untitled workflow";
  const workflowMode = workflow ? "Run shell" : "Draft setup";
  const sceneInputAiSource = sceneRequest.trim() || getSceneInputRawIntent(workflow).trim();
  function clearPendingPromptTagReview() {
    pendingPromptTagReviewRef.current = null;
    setPendingPromptTagReview(null);
    setIsSavingPromptTagReview(false);
  }

  function cancelPendingPromptTagReview(message: string) {
    const pending = pendingPromptTagReviewRef.current;
    if (!pending) {
      return;
    }

    pending.reject(new Error(message));
    clearPendingPromptTagReview();
  }

  function getCurrentTimelineWorkflowRecordInput(
    overrides: Partial<Omit<TimelineWorkflowRecordInput, "workflow">> = {},
  ): TimelineWorkflowRecordInput | null {
    if (!workflow) {
      return null;
    }

    const nextProjectId = "projectId" in overrides ? overrides.projectId : workflowProjectId;
    const nextProjectName = "name" in overrides ? overrides.name : workflowProjectName;

    return {
      ...(nextProjectId ? { projectId: nextProjectId } : {}),
      ...(nextProjectName ? { name: nextProjectName } : {}),
      workflow,
      sceneRequest: overrides.sceneRequest ?? sceneRequest,
      selectedPromptProfile: overrides.selectedPromptProfile ?? selectedPromptProfile,
      selectedImageCount: overrides.selectedImageCount ?? selectedImageCount,
      selectedNodeId: overrides.selectedNodeId ?? selectedNodeId,
      outputDisplayModes: overrides.outputDisplayModes ?? outputDisplayModes,
    };
  }

  function applyTimelineWorkflowRecord(record: TimelineWorkflowRecord, message: string, options: { saveActive?: boolean } = {}) {
    if (!isSingleImageTimelineWorkflowRecord(record)) {
      setAutosaveStatus("idle");
      setAutosaveMessage("Story Graph workflow records open from the Story page.");
      return;
    }

    const restoredImageCount = normalizeTimelineImageCount(record.selectedImageCount);
    const projectId = record.projectId ?? null;
    const projectName = record.name ?? "";
    const autosaveInput: TimelineWorkflowRecordInput = {
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { name: projectName } : {}),
      workflow: record.workflow,
      sceneRequest: record.sceneRequest,
      selectedPromptProfile: record.selectedPromptProfile,
      selectedImageCount: restoredImageCount,
      selectedNodeId: record.selectedNodeId,
      outputDisplayModes: record.outputDisplayModes,
    };

    latestAutosaveInputRef.current = autosaveInput;
    shouldClearActiveWorkflowRef.current = false;
    setWorkflow(record.workflow);
    setWorkflowProjectId(projectId);
    setWorkflowProjectName(projectName);
    setSceneRequest(record.sceneRequest);
    setSelectedPromptProfile(record.selectedPromptProfile);
    setSelectedImageCount(restoredImageCount);
    setSelectedSourceDenoise(getSceneInputSourceDenoise(record.workflow));
    setSelectedSourceImage(getSceneInputSourceImage(record.workflow));
    setSelectedNodeId(record.selectedNodeId);
    setEditingNodeId(null);
    setDrafts({});
    setOutputDisplayModes(record.outputDisplayModes);
    setNotices((current) => ({
      ...current,
      [record.selectedNodeId]: message,
    }));
    setAutosaveStatus("saved");
    setAutosaveMessage(projectName ? `Restored ${projectName}.` : `Restored ${record.workflow.workflowId}.`);

    if (options.saveActive) {
      void saveActiveTimelineWorkflowRecord(autosaveInput).catch((error) => {
        console.error("[SceneForge] [timeline] failed to update active workflow after opening named workflow", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to save the active timeline workflow.");
      });
    }
  }

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      activeRunIdRef.current += 1;
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
      flushLatestTimelineAutosave();
      const pending = pendingPromptTagReviewRef.current;
      if (pending) {
        pending.reject(new Error("Timeline run was superseded."));
        pendingPromptTagReviewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const restoreVersion = restoreVersionRef.current;

    void loadActiveTimelineWorkflowRecord()
      .then((record) => {
        if (canceled || restoreVersionRef.current !== restoreVersion || !record) {
          return;
        }

        applyTimelineWorkflowRecord(record, "Restored the autosaved timeline workflow.");
      })
      .catch((error) => {
        if (canceled || restoreVersionRef.current !== restoreVersion) {
          return;
        }

        console.error("[SceneForge] [timeline] failed to restore active workflow", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to restore the autosaved workflow.");
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    void loadTimelineSettingsViaApi()
      .then((payload) => {
        if (canceled) {
          return;
        }

        setTimelineSettings(normalizeTimelineWorkflowSettings(payload.workflow));
        useEditorStore.getState().updateProjectSettings({
          supportsNsfw: payload.general.nsfw.supportsNsfw,
        });
      })
      .catch((error) => {
        console.error("[SceneForge] [timeline] failed to load settings", { error });
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!workflow) {
      return;
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    const autosaveInput: TimelineWorkflowRecordInput = {
      ...(workflowProjectId ? { projectId: workflowProjectId } : {}),
      ...(workflowProjectName ? { name: workflowProjectName } : {}),
      workflow,
      sceneRequest,
      selectedPromptProfile,
      selectedImageCount,
      selectedNodeId,
      outputDisplayModes,
    };
    const autosaveVersion = autosaveVersionRef.current + 1;
    autosaveVersionRef.current = autosaveVersion;
    latestAutosaveInputRef.current = autosaveInput;

    autosaveTimeoutRef.current = window.setTimeout(() => {
      setAutosaveStatus("loading");
      setAutosaveMessage("Saving timeline workflow...");

      void saveActiveTimelineWorkflowRecord(autosaveInput)
        .then((record) => {
          if (autosaveVersionRef.current !== autosaveVersion) {
            const latestInput = latestAutosaveInputRef.current;

            void (latestInput
              ? saveActiveTimelineWorkflowRecord(latestInput)
              : deleteActiveTimelineWorkflowRecord()
            ).catch((error) => {
              console.error("[SceneForge] [timeline] failed to reconcile stale autosave", { error });
            });
            return;
          }

          if (!isMountedRef.current) {
            return;
          }

          setAutosaveStatus("saved");
          setAutosaveMessage(`Autosaved ${record.workflow.workflowId}.`);
        })
        .catch((error) => {
          if (autosaveVersionRef.current !== autosaveVersion) {
            return;
          }

          if (!isMountedRef.current) {
            return;
          }

          console.error("[SceneForge] [timeline] autosave failed", { error });
          setAutosaveStatus("error");
          setAutosaveMessage(error instanceof Error ? error.message : "Unable to autosave the timeline workflow.");
          setNotices((current) => ({
            ...current,
            [selectedNodeId]: error instanceof Error ? error.message : "Unable to autosave the timeline workflow.",
          }));
        });
    }, 250);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [
    workflow,
    sceneRequest,
    selectedPromptProfile,
    selectedImageCount,
    selectedNodeId,
    outputDisplayModes,
    workflowProjectId,
    workflowProjectName,
  ]);

  function isCurrentRun(runId: number) {
    return activeRunIdRef.current === runId;
  }

  function invalidateTimelineRun() {
    activeRunIdRef.current += 1;
    cancelPendingPromptTagReview("Timeline run was superseded.");
  }

  function flushLatestTimelineAutosave() {
    const latestInput = latestAutosaveInputRef.current;

    if (latestInput) {
      void saveActiveTimelineWorkflowRecord(latestInput).catch((error) => {
        console.error("[SceneForge] [timeline] failed to flush active workflow autosave", { error });
      });
      return;
    }

    if (!shouldClearActiveWorkflowRef.current) {
      return;
    }

    void deleteActiveTimelineWorkflowRecord().catch((error) => {
      console.error("[SceneForge] [timeline] failed to flush active workflow autosave", { error });
    });
  }

  function cancelPendingTimelineAutosave() {
    autosaveVersionRef.current += 1;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }

  function rememberLatestTimelineAutosaveInput(
    nextWorkflow: TimelineWorkflowState,
    overrides: Partial<Omit<TimelineWorkflowRecordInput, "workflow">> = {},
  ) {
    const nextProjectId = "projectId" in overrides ? overrides.projectId : workflowProjectId;
    const nextProjectName = "name" in overrides ? overrides.name : workflowProjectName;

    latestAutosaveInputRef.current = {
      ...(nextProjectId ? { projectId: nextProjectId } : {}),
      ...(nextProjectName ? { name: nextProjectName } : {}),
      workflow: nextWorkflow,
      sceneRequest: overrides.sceneRequest ?? sceneRequest,
      selectedPromptProfile: overrides.selectedPromptProfile ?? selectedPromptProfile,
      selectedImageCount: overrides.selectedImageCount ?? selectedImageCount,
      selectedNodeId: overrides.selectedNodeId ?? selectedNodeId,
      outputDisplayModes: overrides.outputDisplayModes ?? outputDisplayModes,
    };
    shouldClearActiveWorkflowRef.current = false;
  }

  function commitWorkflow(
    nextWorkflow: TimelineWorkflowState,
    overrides: Partial<Omit<TimelineWorkflowRecordInput, "workflow">> = {},
  ) {
    rememberLatestTimelineAutosaveInput(nextWorkflow, overrides);
    setWorkflow(nextWorkflow);
  }

  function getCurrentPromptLibraryTags() {
    return getAvailablePromptLibraryTags(useEditorStore.getState().project.settings);
  }

  function requestTimelinePromptTagReview(
    input: TimelineCanvasBindingInput,
    review: PendingPromptTagImportReview,
  ) {
    const defaultMode = getNewPromptTagApplyMode(
      timelineSettings.characterTagNewTermDefaultOption,
    );
    if (defaultMode) {
      return Promise.resolve(defaultMode);
    }

    const existingPending = pendingPromptTagReviewRef.current;
    if (existingPending) {
      existingPending.reject(new Error("Timeline prompt tag review was superseded."));
    }

    return new Promise<NewPromptTagApplyMode>((resolve, reject) => {
      const pending = {
        input,
        reject,
        resolve,
        review,
      };

      pendingPromptTagReviewRef.current = pending;
      setPendingPromptTagReview(pending);
      setIsSavingPromptTagReview(false);
      setSelectedNodeId("canvas-binding");
      setOutputDisplayModes((current) => ({
        ...current,
        "canvas-binding": "visual",
      }));
      setNotices((current) => ({
        ...current,
        "canvas-binding": `Review ${review.newSuggestions.length} new prompt tags before applying layout planning.`,
      }));
    });
  }

  async function bindCanvasWithPromptLibraryReview(
    input: TimelineCanvasBindingInput,
    runId: number,
  ) {
    const suggestions = createTimelinePromptTagSuggestions(input.characterTags);
    const review = splitPromptTagSuggestionsByLibrary(suggestions, getCurrentPromptLibraryTags());

    if (review.newSuggestions.length === 0) {
      return bindPrimaryTimelineCharacterToEditorStore(input, {
        characterTags: getTimelineCharacterTagsToBind(review, "skip"),
      });
    }

    try {
      const newTagMode = await requestTimelinePromptTagReview(input, review);

      if (!isCurrentRun(runId)) {
        throw new Error("Timeline run was superseded.");
      }

      if (newTagMode === "import") {
        useEditorStore
          .getState()
          .importPromptLibraryTags(review.newSuggestions.map((suggestion) => suggestion.tag));
        const nextProject = useEditorStore.getState().project;
        await savePromptLibrary({
          promptLibraryTags: nextProject.settings.promptLibraryTags ?? [],
          deletedBuiltInPromptLibraryTagIds:
            nextProject.settings.deletedBuiltInPromptLibraryTagIds ?? [],
        });

        const importedReview = splitPromptTagSuggestionsByLibrary(
          suggestions,
          getCurrentPromptLibraryTags(),
        );

        return bindPrimaryTimelineCharacterToEditorStore(input, {
          characterTags: getTimelineCharacterTagsToBind(importedReview, "temporary"),
        });
      }

      return bindPrimaryTimelineCharacterToEditorStore(input, {
        characterTags: getTimelineCharacterTagsToBind(review, newTagMode),
      });
    } finally {
      clearPendingPromptTagReview();
    }
  }

  function handleApplyPromptTagReview(mode: NewPromptTagApplyMode) {
    const pending = pendingPromptTagReviewRef.current;
    if (!pending) {
      return;
    }

    setIsSavingPromptTagReview(true);
    pending.resolve(mode);
  }

  function handleCancelPromptTagReview() {
    const message =
      "Layout planning prompt tag review was canceled. Rerun layout planning to try again.";

    setNotices((current) => ({
      ...current,
      "canvas-binding": message,
    }));
    cancelPendingPromptTagReview(message);
  }

  function getTimelinePromptTagTargetLabel(target: CharacterPromptTagTarget) {
    if (target.kind === "character") {
      return pendingPromptTagReview?.input.primaryCharacter.name ?? "人物";
    }

    if (target.kind === "bodyPart") {
      return target.bodyPartId;
    }

    return "场景";
  }

  async function runTimelineGraph(nextWorkflow: TimelineWorkflowState) {
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;

    setIsRunning(true);
    setNotices({});

    const handleWorkflowUpdate = (update: TimelineWorkflowUpdate) => {
      if (!isCurrentRun(runId)) {
        return;
      }

      setWorkflow((currentWorkflow) => {
        if (!currentWorkflow || currentWorkflow.workflowId !== nextWorkflow.workflowId) {
          return currentWorkflow;
        }

        const mergedWorkflow = mergeTimelineWorkflowUpdate(currentWorkflow, update);
        rememberLatestTimelineAutosaveInput(mergedWorkflow);
        return mergedWorkflow;
      });
    };

    try {
      const result = await executeTimelineGraph(
        nextWorkflow,
        {
          ...createTimelineT5NodeAdapters({
            completeChat: async (request) => {
              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              const response = await completeTimelineChatViaApi(request);

              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              return response;
            },
            bindCanvas: async (input) => {
              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              return bindCanvasWithPromptLibraryReview(input, runId);
            },
            getCurrentPose: getPrimaryTimelineCharacterPoseFromEditorStore,
          }),
          ...createTimelineT7NodeAdapters({
            adviseStyle: async (request) => {
              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              const response = await loadTimelineStyleAdviceViaApi(request);

              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              return response;
            },
            loadResourceCandidates: async (_desiredEffect, context) => {
              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              return loadTimelineResourceCandidatesViaApi(getTimelineWorkflowPromptProfile(context.workflow));
            },
            loadSamplerOptions: async () => {
              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              return loadTimelineSamplerOptionsViaApi();
            },
            recommendResources: async (request) => {
              if (!isCurrentRun(runId)) {
                throw new Error("Timeline run was superseded.");
              }

              return recommendTimelineResourcesViaApi({
                desiredEffect: request.desiredEffect,
                promptProfile: request.promptProfile,
              });
            },
            supportsNsfw: () => useEditorStore.getState().project.settings.supportsNsfw,
          }),
        },
        {
          onWorkflowUpdate: handleWorkflowUpdate,
        },
      );

      if (!isCurrentRun(runId)) {
        return;
      }

      const canvasBindingError = result.nodes["canvas-binding"].error;
      if (canvasBindingError) {
        setNotices((current) => ({
          ...current,
          "canvas-binding": canvasBindingError.message,
        }));
        if (canvasBindingError.message.includes("prompt tag review")) {
          setSelectedNodeId("canvas-binding");
        }
      } else {
        setNotices((current) => {
          if (!current["canvas-binding"]) {
            return current;
          }

          const next = { ...current };
          delete next["canvas-binding"];
          return next;
        });
      }

      commitWorkflow(result);
      if (timelineSettings.autoReview && canConfirmTimelineWorkflow(result)) {
        void runConfirmGeneration(result, { allowWhileRunning: true });
      }
    } catch (error) {
      if (!isCurrentRun(runId)) {
        return;
      }

      console.error("[SceneForge] [timeline] graph execution failed", { error });
      setNotices((current) => ({
        ...current,
        [selectedNodeId]: error instanceof Error ? error.message : "Timeline graph execution failed.",
      }));
    } finally {
      if (isCurrentRun(runId)) {
        setIsRunning(false);
      }
    }
  }

  async function runConfirmGeneration(
    targetWorkflow: TimelineWorkflowState | null,
    options: { allowWhileRunning?: boolean } = {},
  ) {
    if (!targetWorkflow || !canConfirmTimelineWorkflow(targetWorkflow) || (!options.allowWhileRunning && isRunning)) {
      return;
    }

    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;
    setIsRunning(true);
    setSelectedNodeId("comfyui-execution");
    setWorkflow((currentWorkflow) => {
      if (!currentWorkflow || currentWorkflow.workflowId !== targetWorkflow.workflowId) {
        return currentWorkflow;
      }

      const runningWorkflow = markTimelineNodeRunning(currentWorkflow, "comfyui-execution");
      rememberLatestTimelineAutosaveInput(runningWorkflow, {
        selectedNodeId: "comfyui-execution",
      });
      return runningWorkflow;
    });
    setNotices((current) => ({
      ...current,
      "comfyui-execution": "Confirmed request is being validated and queued in ComfyUI.",
    }));

    try {
      const result = await confirmTimelineGenerationViaApi(targetWorkflow);

      if (!isCurrentRun(runId)) {
        return;
      }

      commitWorkflow(result, {
        selectedNodeId: result.nodes["result-display"].status === "done" ? "result-display" : "comfyui-execution",
        outputDisplayModes: {
          ...outputDisplayModes,
          "result-display": "visual",
        },
      });
      const executionNode = result.nodes["comfyui-execution"];
      const executionErrorMessage = executionNode.status === "error" ? executionNode.error?.message : null;
      setSelectedNodeId(result.nodes["result-display"].status === "done" ? "result-display" : "comfyui-execution");
      setOutputDisplayModes((current) => ({
        ...current,
        "result-display": "visual",
      }));
      setNotices((current) => ({
        ...current,
        "comfyui-execution": executionErrorMessage ?? "Confirmed ComfyUI request finished graph execution.",
      }));
    } catch (error) {
      if (!isCurrentRun(runId)) {
        return;
      }

      console.error("[SceneForge] [timeline] confirmed generation failed", { error });
      setSelectedNodeId("generation-gate");
      setNotices((current) => ({
        ...current,
        "generation-gate": error instanceof Error ? error.message : "Timeline generation failed.",
      }));
    } finally {
      if (isCurrentRun(runId)) {
        setIsRunning(false);
      }
    }
  }

  function startWorkflow() {
    const trimmedSceneRequest = sceneRequest.trim();

    if (!trimmedSceneRequest || isRunning) {
      return;
    }

    restoreVersionRef.current += 1;
    setWorkflowProjectId(null);
    setWorkflowProjectName("");
    const nextWorkflow = createTimelineWorkflowState({
      imageCount: selectedSourceImage ? 1 : selectedImageCount,
      promptProfile: selectedPromptProfile,
      sceneRequest: trimmedSceneRequest,
      sourceDenoise: selectedSourceDenoise,
      sourceImage: selectedSourceImage ?? undefined,
    });
    const initialAutosaveInput: TimelineWorkflowRecordInput = {
      workflow: nextWorkflow,
      sceneRequest: trimmedSceneRequest,
      selectedPromptProfile,
      selectedImageCount: selectedSourceImage ? 1 : selectedImageCount,
      selectedNodeId: "scene-input",
      outputDisplayModes: {},
    };

    latestAutosaveInputRef.current = initialAutosaveInput;
    shouldClearActiveWorkflowRef.current = false;
    void saveActiveTimelineWorkflowRecord(initialAutosaveInput)
      .then((record) => {
        if (!isMountedRef.current) {
          return;
        }

        setAutosaveStatus("saved");
        setAutosaveMessage(`Autosaved ${record.workflow.workflowId}.`);
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }

        console.error("[SceneForge] [timeline] initial autosave failed", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to autosave the timeline workflow.");
      });
    commitWorkflow(nextWorkflow, initialAutosaveInput);
    setSceneRequest(trimmedSceneRequest);
    if (selectedSourceImage) {
      setSelectedImageCount(1);
    }
    setSelectedNodeId("scene-input");
    setEditingNodeId(null);
    setDrafts({});
    setOutputDisplayModes({});
    setNotices({});
    void runTimelineGraph(nextWorkflow);
  }

  function handlePromptProfileChange(value: string) {
    const promptProfile = normalizePromptProfileId(value);

    setSelectedPromptProfile(promptProfile);

    if (!workflow || isRunning) {
      return;
    }

    const rawIntent = sceneRequest.trim() ||
      (isRecord(workflow.nodes["scene-input"].result) &&
      typeof workflow.nodes["scene-input"].result.rawIntent === "string"
        ? workflow.nodes["scene-input"].result.rawIntent
        : "");

    if (!rawIntent) {
      return;
    }

    invalidateTimelineRun();
    commitWorkflow(setTimelineNodeManualResult(workflow, "scene-input", {
      rawIntent,
      imageCount: selectedSourceImage ? 1 : selectedImageCount,
      promptProfile,
      ...(selectedSourceImage ? { sourceDenoise: selectedSourceDenoise } : {}),
      ...(selectedSourceImage ? { sourceImage: selectedSourceImage } : {}),
    } satisfies SceneInputTimelineResult), {
      sceneRequest: rawIntent,
      selectedPromptProfile: promptProfile,
      selectedImageCount: selectedSourceImage ? 1 : selectedImageCount,
    });
  }

  function handleImageCountChange(value: string) {
    if (selectedSourceImage) {
      setSelectedImageCount(1);
      return;
    }

    const imageCount = normalizeTimelineImageCount(value);
    setSelectedImageCount(imageCount);

    if (!workflow || isRunning) {
      return;
    }

    const rawIntent = sceneRequest.trim() || getSceneInputRawIntent(workflow).trim();
    if (!rawIntent) {
      return;
    }

    invalidateTimelineRun();
    commitWorkflow(setTimelineNodeManualResult(workflow, "scene-input", {
      rawIntent,
      imageCount,
      promptProfile: selectedPromptProfile,
    } satisfies SceneInputTimelineResult), {
      sceneRequest: rawIntent,
      selectedImageCount: imageCount,
    });
    setNotices((current) => ({
      ...current,
      "scene-input": "Image count updated. Downstream nodes are pending regeneration.",
    }));
  }

  function commitSceneInputSourceImage(sourceImage: TimelineSourceImage | null) {
    const sourceDenoise = normalizeTimelineSourceDenoise(selectedSourceDenoise);
    setSelectedSourceImage(sourceImage);
    if (sourceImage) {
      setSelectedImageCount(1);
      setSelectedSourceDenoise(sourceDenoise);
    }

    if (!workflow || isRunning) {
      return;
    }

    const rawIntent = sceneRequest.trim() || getSceneInputRawIntent(workflow).trim();
    if (!rawIntent) {
      return;
    }

    invalidateTimelineRun();
    const imageCount = sourceImage ? 1 : selectedImageCount;
    commitWorkflow(setTimelineNodeManualResult(workflow, "scene-input", {
      rawIntent,
      imageCount,
      promptProfile: selectedPromptProfile,
      ...(sourceImage ? { sourceDenoise } : {}),
      ...(sourceImage ? { sourceImage } : {}),
    } satisfies SceneInputTimelineResult), {
      sceneRequest: rawIntent,
      selectedImageCount: imageCount,
    });
    setNotices((current) => ({
      ...current,
      "scene-input": sourceImage
        ? "Source image attached. Downstream generation will use img2img with one output."
        : "Source image removed. Downstream generation will return to text-to-image.",
    }));
  }

  function commitSourceDenoise(value: unknown = selectedSourceDenoise) {
    const denoise = normalizeTimelineSourceDenoise(value);
    setSelectedSourceDenoise(denoise);

    if (!workflow || isRunning || !selectedSourceImage) {
      return;
    }

    const rawIntent = sceneRequest.trim() || getSceneInputRawIntent(workflow).trim();
    if (!rawIntent) {
      return;
    }

    invalidateTimelineRun();
    commitWorkflow(setTimelineNodeManualResult(workflow, "scene-input", {
      rawIntent,
      imageCount: 1,
      promptProfile: selectedPromptProfile,
      sourceDenoise: denoise,
      sourceImage: selectedSourceImage,
    } satisfies SceneInputTimelineResult), {
      sceneRequest: rawIntent,
      selectedImageCount: 1,
    });
    setNotices((current) => ({
      ...current,
      "scene-input": `Img2img denoise set to ${denoise.toFixed(2)}. Downstream parameters are pending regeneration.`,
    }));
  }

  function handleSourceDenoiseChange(value: string) {
    setSelectedSourceDenoise(normalizeTimelineSourceDenoise(value));
  }

  function handleSourceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setNotices((current) => ({
        ...current,
        "scene-input": "Source image must be a PNG, JPEG, or WEBP file.",
      }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        return;
      }

      const image = new window.Image();
      image.onload = () => {
        commitSceneInputSourceImage({
          dataUrl,
          filename: file.name,
          height: image.naturalHeight,
          mimeType: file.type as TimelineSourceImage["mimeType"],
          uploadedAt: new Date().toISOString(),
          width: image.naturalWidth,
        });
      };
      image.onerror = () => {
        setNotices((current) => ({
          ...current,
          "scene-input": "Unable to read source image dimensions.",
        }));
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startWorkflow();
  }

  function handleStartEdit(nodeId: TimelineNodeId) {
    if (!workflow || !canRawEditNode(nodeId, workflow)) {
      return;
    }

    setSelectedNodeId(nodeId);
    setOutputDisplayModes((current) => ({
      ...current,
      [nodeId]: "json",
    }));
    setEditingNodeId(nodeId);
    setDrafts((current) => ({
      ...current,
      [nodeId]: current[nodeId] ?? getTimelineNodeOutputText(workflow.nodes[nodeId]),
    }));
  }

  function handleCancelEdit() {
    if (workflow && editingNodeId) {
      setDrafts((current) => ({
        ...current,
        [editingNodeId]: getTimelineNodeOutputText(workflow.nodes[editingNodeId]),
      }));
    }

    setEditingNodeId(null);
  }

  function handleDraftChange(nodeId: TimelineNodeId, value: string) {
    setDrafts((current) => ({
      ...current,
      [nodeId]: value,
    }));
  }

  function handleSaveEdit(nodeId: TimelineNodeId) {
    if (!workflow || !canRawEditNode(nodeId, workflow)) {
      return;
    }

    const draft = drafts[nodeId]?.trim() ?? "";

    if (!draft) {
      return;
    }

    invalidateTimelineRun();
    setIsRunning(false);
    commitWorkflow(setTimelineNodeManualResult(
      workflow,
      nodeId,
      createManualResult(
        nodeId,
        draft,
        selectedPromptProfile,
        selectedImageCount,
        selectedSourceImage,
        selectedSourceDenoise,
      ),
    ), {
      sceneRequest: nodeId === "scene-input" ? draft : sceneRequest,
    });
    setEditingNodeId(null);
    setDrafts((current) => ({
      ...current,
      [nodeId]: draft,
    }));

    if (nodeId === "scene-input") {
      setSceneRequest(draft);
    }
  }

  function handleSaveScenePromptVisual(result: ScenePromptTimelineResult) {
    if (!workflow) {
      return;
    }

    invalidateTimelineRun();
    setIsRunning(false);
    const nextWorkflow = setTimelineNodeManualResult(workflow, "scene-prompt", result);
    const nextDraft = JSON.stringify(result, null, 2);

    commitWorkflow(nextWorkflow);
    setDrafts((current) => ({
      ...current,
      "scene-prompt": nextDraft,
    }));
    setOutputDisplayModes((current) => ({
      ...current,
      "scene-prompt": "visual",
    }));
    setEditingNodeId(null);
  }

  function handleSaveResourceRecommendationVisual(result: ResourceRecommendationTimelineResult) {
    if (!workflow) {
      return;
    }

    invalidateTimelineRun();
    setIsRunning(false);
    const nextWorkflow = setTimelineNodeManualResult(workflow, "resource-recommendation", result);

    commitWorkflow(nextWorkflow);
    setDrafts((current) => ({
      ...current,
      "resource-recommendation": JSON.stringify(result, null, 2),
    }));
    setOutputDisplayModes((current) => ({
      ...current,
      "resource-recommendation": "visual",
    }));
    setEditingNodeId(null);
  }

  function handleSaveParameterRecommendationVisual(result: ParameterRecommendationTimelineResult) {
    if (!workflow) {
      return;
    }

    invalidateTimelineRun();
    setIsRunning(false);
    const nextWorkflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", result);

    commitWorkflow(nextWorkflow);
    setDrafts((current) => ({
      ...current,
      "parameter-recommendation": JSON.stringify(result, null, 2),
    }));
    setOutputDisplayModes((current) => ({
      ...current,
      "parameter-recommendation": "visual",
    }));
    setEditingNodeId(null);
  }

  async function handleSceneInputAi(action: SceneInputAiAction) {
    setSelectedNodeId("scene-input");

    if (isRunning) {
      return;
    }

    const currentSceneRequest = sceneRequest.trim() || getSceneInputRawIntent(workflow).trim();

    if (action === "rewrite" && !currentSceneRequest) {
      setNotices((current) => ({
        ...current,
        "scene-input": "Add a scene request before asking AI to rewrite it.",
      }));
      return;
    }

    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;
    setIsRunning(true);
    setEditingNodeId(null);
    if (workflow) {
      commitWorkflow(markTimelineNodeRunning(workflow, "scene-input"));
    }
    setNotices((current) => ({
      ...current,
      "scene-input": action === "rewrite" ? "Rewriting the scene request." : "Suggesting a scene request.",
    }));

    try {
      const response = await completeTimelineChatViaApi(
        buildSceneInputAiRequest({
          action,
          promptProfile: selectedPromptProfile,
          sceneRequest: currentSceneRequest,
        }),
      );

      if (!isCurrentRun(runId)) {
        return;
      }

      const nextSceneRequest = parseSceneInputAiResponse(response);

      if (!nextSceneRequest) {
        throw new Error("Scene input AI response did not include a usable scene request.");
      }

      const nextWorkflow = workflow
        ? setTimelineNodeManualResult(workflow, "scene-input", {
            rawIntent: nextSceneRequest,
            imageCount: selectedSourceImage ? 1 : selectedImageCount,
            promptProfile: selectedPromptProfile,
            ...(selectedSourceImage ? { sourceDenoise: selectedSourceDenoise } : {}),
            ...(selectedSourceImage ? { sourceImage: selectedSourceImage } : {}),
          } satisfies SceneInputTimelineResult)
        : null;

      if (nextWorkflow) {
        commitWorkflow(nextWorkflow, {
          sceneRequest: nextSceneRequest,
          selectedImageCount: selectedSourceImage ? 1 : selectedImageCount,
        });
      }
      setSceneRequest(nextSceneRequest);
      setDrafts((current) => ({
        ...current,
        "scene-input": nextSceneRequest,
      }));
      setNotices((current) => ({
        ...current,
        "scene-input": action === "rewrite"
          ? workflow
            ? "Scene request rewritten. Downstream nodes are pending regeneration."
            : "Scene request rewritten. Run the timeline when ready."
          : workflow
            ? "Scene request suggested. Downstream nodes are pending regeneration."
            : "Scene request suggested. Run the timeline when ready.",
      }));
    } catch (error) {
      if (!isCurrentRun(runId)) {
        return;
      }

      console.error("[SceneForge] [timeline] scene input AI request failed", { error });
      if (workflow) {
        commitWorkflow(workflow);
      }
      setNotices((current) => ({
        ...current,
        "scene-input": error instanceof Error ? error.message : "Scene input AI request failed.",
      }));
    } finally {
      if (isCurrentRun(runId)) {
        setIsRunning(false);
      }
    }
  }

  function handleConfirmGeneration() {
    void runConfirmGeneration(workflow);
  }

  function handleRequestAi(nodeId: TimelineNodeId) {
    setSelectedNodeId(nodeId);

    if (!workflow) {
      startWorkflow();
      return;
    }

    if (nodeId === "scene-input") {
      void handleSceneInputAi("rewrite");
      return;
    }

    if (timelineNodeContent[nodeId].reserved) {
      setNotices((current) => ({
        ...current,
        [nodeId]: "This node is reserved for a later timeline slice.",
      }));
      return;
    }

    void runTimelineGraph(workflow);
  }

  function handleNewScene() {
    invalidateTimelineRun();
    restoreVersionRef.current += 1;
    autosaveVersionRef.current += 1;
    latestAutosaveInputRef.current = null;
    shouldClearActiveWorkflowRef.current = true;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }
    setWorkflow(null);
    setWorkflowProjectId(null);
    setWorkflowProjectName("");
    setSceneRequest("");
    setSelectedPromptProfile(defaultPromptProfileId);
    setSelectedImageCount(DEFAULT_TIMELINE_IMAGE_COUNT);
    setSelectedSourceDenoise(DEFAULT_TIMELINE_SOURCE_DENOISE);
    setSelectedSourceImage(null);
    setSelectedNodeId("scene-input");
    setEditingNodeId(null);
    setDrafts({});
    setOutputDisplayModes({});
    setNotices({});
    setIsRunning(false);
    setAutosaveStatus("idle");
    setAutosaveMessage("");
    void deleteActiveTimelineWorkflowRecord().catch((error) => {
      console.error("[SceneForge] [timeline] failed to clear active workflow", { error });
      setAutosaveStatus("error");
      setAutosaveMessage(error instanceof Error ? error.message : "Unable to clear the autosaved workflow.");
    });
  }

  function handleNamedWorkflowOpened(record: TimelineWorkflowRecord) {
    invalidateTimelineRun();
    restoreVersionRef.current += 1;
    autosaveVersionRef.current += 1;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }
    setIsRunning(false);
    applyTimelineWorkflowRecord(record, "Opened the saved timeline workflow.", { saveActive: true });
  }

  function handleNamedWorkflowSaved(record: TimelineWorkflowRecord) {
    const projectId = record.projectId ?? null;
    const projectName = record.name ?? "";
    const autosaveInput = getCurrentTimelineWorkflowRecordInput({
      projectId,
      name: projectName,
    });

    setWorkflowProjectId(projectId);
    setWorkflowProjectName(projectName);
    setAutosaveStatus("saved");
    setAutosaveMessage(projectName ? `Saved ${projectName}.` : "Saved timeline workflow.");
    setNotices((current) => ({
      ...current,
      [selectedNodeId]: projectName ? `Saved workflow "${projectName}".` : "Saved workflow.",
    }));

    if (autosaveInput) {
      latestAutosaveInputRef.current = autosaveInput;
      shouldClearActiveWorkflowRef.current = false;
      cancelPendingTimelineAutosave();
      void saveActiveTimelineWorkflowRecord(autosaveInput).catch((error) => {
        console.error("[SceneForge] [timeline] failed to sync active workflow metadata after named save", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to save the active timeline workflow.");
      });
    }
  }

  function handleCurrentNamedWorkflowDeleted() {
    const autosaveInput = getCurrentTimelineWorkflowRecordInput({
      projectId: null,
      name: null,
    });

    setWorkflowProjectId(null);
    setWorkflowProjectName("");
    setAutosaveStatus("saved");
    setAutosaveMessage("Current workflow is now an unnamed autosaved draft.");
    setNotices((current) => ({
      ...current,
      [selectedNodeId]: "Deleted the saved workflow. The current timeline remains open as an unnamed draft.",
    }));

    if (autosaveInput) {
      latestAutosaveInputRef.current = autosaveInput;
      shouldClearActiveWorkflowRef.current = false;
      cancelPendingTimelineAutosave();
      void saveActiveTimelineWorkflowRecord(autosaveInput).catch((error) => {
        console.error("[SceneForge] [timeline] failed to save unnamed active workflow after named delete", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to save the active timeline workflow.");
      });
    }
  }

  function selectNode(nodeId: TimelineNodeId) {
    setSelectedNodeId(nodeId);
    if (nodeId === "scene-input") {
      setSelectedImageCount(getSceneInputImageCount(workflow));
      setSelectedSourceDenoise(getSceneInputSourceDenoise(workflow));
      setSelectedSourceImage(getSceneInputSourceImage(workflow));
    }
    setEditingNodeId(null);
  }

  function renderPromptTagReviewDialog() {
    return pendingPromptTagReview ? (
      <PromptTagImportReviewDialog
        getSuggestionTargetLabel={getTimelinePromptTagTargetLabel}
        isSaving={isSavingPromptTagReview}
        onApply={handleApplyPromptTagReview}
        onCancel={handleCancelPromptTagReview}
        review={pendingPromptTagReview.review}
        title="导入新的部位提示词"
      />
    ) : null;
  }

  function renderSceneComposer(className = "rounded-md border border-slate-200 bg-slate-50") {
    return (
      <form className={className} id="scene-composer-form" onSubmit={handleSubmit}>
        <div className="border-b border-slate-200 px-3 py-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="scene-request">
            Command composer
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <label
            className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="prompt-profile"
          >
            Prompt profile
          </label>
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={isRunning}
            id="prompt-profile"
            onChange={(event) => handlePromptProfileChange(event.target.value)}
            value={selectedPromptProfile}
          >
            {promptProfileIds.map((profile) => (
              <option key={profile} value={profile}>
                {formatPromptProfileLabel(profile)}
              </option>
            ))}
          </select>
          <label
            className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="timeline-image-count"
          >
            Images
          </label>
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            disabled={isRunning || Boolean(selectedSourceImage)}
            id="timeline-image-count"
            onChange={(event) => handleImageCountChange(event.target.value)}
            value={selectedSourceImage ? 1 : selectedImageCount}
          >
            {timelineImageCountOptions.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={handleSourceImageChange}
            ref={sourceImageInputRef}
            type="file"
          />
          <Button
            className="ml-2 h-8 px-2 text-xs shadow-none"
            disabled={isRunning}
            onClick={() => sourceImageInputRef.current?.click()}
            type="button"
            variant="secondary"
          >
            <ImageIcon className="size-3.5" />
            Upload source
          </Button>
        </div>
        <textarea
          className="min-h-28 w-full resize-none border-0 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
          id="scene-request"
          onChange={(event) => setSceneRequest(event.target.value)}
          placeholder="Describe the scene, characters, mood, camera, and constraints..."
          value={sceneRequest}
        />
        {selectedSourceImage ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-3 py-2">
            <Image
              alt="Uploaded img2img source"
              className="size-16 rounded-md border border-slate-200 object-cover"
              height={64}
              src={selectedSourceImage.dataUrl}
              unoptimized
              width={64}
            />
            <div className="min-w-0 flex-1 text-xs leading-relaxed text-slate-600">
              <p className="break-all font-medium text-slate-800">{selectedSourceImage.filename}</p>
              <p>
                {selectedSourceImage.width}x{selectedSourceImage.height} source image. Img2img uses one
                output.
              </p>
              <label className="mt-2 flex max-w-48 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Denoise
                <input
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  disabled={isRunning}
                  max={1}
                  min={0}
                  onChange={(event) => handleSourceDenoiseChange(event.target.value)}
                  onBlur={(event) => commitSourceDenoise(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  step={0.05}
                  type="number"
                  value={selectedSourceDenoise}
                />
              </label>
            </div>
            <Button
              className="h-8 px-2 text-xs shadow-none"
              disabled={isRunning}
              onClick={() => commitSceneInputSourceImage(null)}
              type="button"
              variant="secondary"
            >
              Remove
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              className="h-7 px-2 text-[11px] shadow-none"
              disabled={isRunning || !sceneInputAiSource}
              onClick={() => void handleSceneInputAi("rewrite")}
              type="button"
              variant="secondary"
            >
              Rewrite
            </Button>
            <Button
              className="h-7 px-2 text-[11px] shadow-none"
              disabled={isRunning}
              onClick={() => void handleSceneInputAi("suggest")}
              type="button"
              variant="secondary"
            >
              Suggest
            </Button>
            <Button className="h-7 px-2 text-[11px] shadow-none" disabled type="button" variant="secondary">
              <LockKeyhole className="size-3" />
              Lock
            </Button>
          </div>
          <Button className="h-8 px-3 text-xs shadow-none" disabled={!sceneRequestIsUsable || isRunning} type="submit">
            <Play className="size-3.5" />
            Start workflow
          </Button>
        </div>
      </form>
    );
  }

  if (timelineSettings.displayMode === "simple") {
    const simpleProgress = getSimpleTimelineProgress(workflow);
    const simpleNotice = notices["generation-gate"] ?? notices["scene-input"] ?? notices[selectedNodeId];
    const resultNode = activeWorkflow.nodes["result-display"];

    return (
      <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
        <header className={timelineHeaderClassName}>
          <div className={timelineHeaderPrimaryClassName}>
            <div className={timelineHeaderIdentityClassName}>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
                <Workflow className="size-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-bold text-slate-900">SceneForge</h1>
                <p className="break-words text-[11px] text-slate-500">{workflowTitle}</p>
              </div>
            </div>
          </div>
          <div className={timelineHeaderProjectClassName}>
            <TimelineWorkflowProjectMenu
              currentProjectId={workflowProjectId}
              currentProjectName={workflowProjectName}
              disabled={isRunning}
              getCurrentRecordInput={getCurrentTimelineWorkflowRecordInput}
              onDeleteCurrentProject={handleCurrentNamedWorkflowDeleted}
              onRecordOpened={handleNamedWorkflowOpened}
              onRecordSaved={handleNamedWorkflowSaved}
              workflowMode="single-image"
            />
          </div>

          <div className={timelineHeaderActionsClassName}>
            <Button className="h-9 shrink-0 gap-2 px-2.5 text-xs shadow-none sm:px-3" onClick={handleNewScene} type="button" variant="secondary">
              <RefreshCw className="size-3.5" />
              New scene
            </Button>
            <nav aria-label="Workspace mode" className={timelineHeaderNavClassName}>
              <span aria-current="page" className={cn(timelineHeaderNavCurrentClassName, "bg-white")}>
                <Workflow className="size-3.5" />
                <span className="hidden sm:inline">Run</span>
              </span>
              <Link aria-label="Open Story Graph planning" className={timelineHeaderNavLinkClassName} href="/story" title="Open Story Graph planning">
                <GitBranch className="size-3.5" />
                <span className="hidden sm:inline">Story</span>
              </Link>
              <Link aria-label="Open settings" className={timelineHeaderNavLinkClassName} href="/settings" title="Open settings">
                <Settings className="size-3.5" />
                <span className="hidden sm:inline">Settings</span>
              </Link>
            </nav>
          </div>
        </header>

        <section className="custom-scrollbar touch-scroll-region min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {renderSceneComposer("rounded-md border border-slate-200 bg-slate-50 shadow-sm")}

            {workflow ? (
              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-900">Workflow progress</h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{simpleProgress.currentTask}</p>
                  </div>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                    {simpleProgress.percent}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    aria-label="Workflow progress"
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={simpleProgress.percent}
                    className="h-full rounded-full bg-blue-600 transition-all"
                    role="progressbar"
                    style={{ width: `${simpleProgress.percent}%` }}
                  />
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <span className="font-semibold text-slate-700">Scene</span>
                    <p className="mt-1 whitespace-pre-wrap break-words text-slate-500">{sceneRequest}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <span className="font-semibold text-slate-700">Current task</span>
                    <p className="mt-1 text-slate-500">{simpleProgress.currentTask}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <span className="font-semibold text-slate-700">Result</span>
                    <p className="mt-1 text-slate-500">
                      {resultNode.status === "done" ? "Ready" : getCompactStatusLabel(resultNode.status)}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {generationCanBeConfirmed ? (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800 shadow-sm">
                <div className="flex min-w-0 gap-2">
                  <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                  <p>Review is complete. Confirm before SceneForge queues ComfyUI for rendering.</p>
                </div>
                <Button
                  className="h-9 shrink-0 px-3 text-xs shadow-none"
                  disabled={isRunning}
                  onClick={handleConfirmGeneration}
                  type="button"
                >
                  <Play className="size-3.5" />
                  Confirm and render
                </Button>
              </section>
            ) : null}

            {simpleNotice ? (
              <section className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700">
                <Bot className="mt-0.5 size-4 shrink-0" />
                <p>{simpleNotice}</p>
              </section>
            ) : null}

            {workflow && (resultNode.status === "done" || resultNode.status === "error") ? (
              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900">Artifact result</h2>
                <div className="mt-3">
                  <TimelineResultDisplayWorkspace
                    emptyState={timelineNodeContent["result-display"].emptyState}
                    key={resultNode.updatedAt}
                    node={resultNode}
                    workflow={activeWorkflow}
                  />
                </div>
              </section>
            ) : null}
          </div>
        </section>

        {renderPromptTagReviewDialog()}
      </main>
    );
  }

  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className={timelineHeaderClassName}>
        <div className={timelineHeaderPrimaryClassName}>
          <div className={timelineHeaderIdentityClassName}>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
              <Workflow className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-900">SceneForge</h1>
              <p className="break-words text-[11px] text-slate-500">{workflowTitle}</p>
            </div>
          </div>
          <div className={timelineHeaderContextClassName}>
            <CircleDot className="size-3.5 text-blue-600" />
            <span className="break-words text-right">{workflowMode}</span>
            <span className="text-slate-300">/</span>
            <span className="break-words">{selectedContent.title}</span>
          </div>
        </div>
        <div className={timelineHeaderProjectClassName}>
          <TimelineWorkflowProjectMenu
            currentProjectId={workflowProjectId}
            currentProjectName={workflowProjectName}
            disabled={isRunning}
            getCurrentRecordInput={getCurrentTimelineWorkflowRecordInput}
            onDeleteCurrentProject={handleCurrentNamedWorkflowDeleted}
            onRecordOpened={handleNamedWorkflowOpened}
            onRecordSaved={handleNamedWorkflowSaved}
            workflowMode="single-image"
          />
        </div>

        <div className={timelineHeaderActionsClassName}>
          <Button className="h-9 shrink-0 gap-2 px-2.5 text-xs shadow-none sm:px-3" onClick={handleNewScene} type="button" variant="secondary">
            <RefreshCw className="size-3.5" />
            New scene
          </Button>
          <Button
            className="h-9 shrink-0 px-2.5 text-xs shadow-none sm:px-3"
            disabled={workflow ? selectedNodeAiDisabled : !sceneRequestIsUsable || isRunning}
            onClick={workflow ? () => handleRequestAi(selectedNodeId) : startWorkflow}
            type="button"
          >
            <Play className="size-3.5" />
            {workflow ? "Run node" : "Start"}
          </Button>
          <nav aria-label="Workspace mode" className={timelineHeaderNavClassName}>
            <span aria-current="page" className={cn(timelineHeaderNavCurrentClassName, "bg-white")}>
              <Workflow className="size-3.5" />
              <span className="hidden sm:inline">Run</span>
            </span>
            <Link aria-label="Open Story Graph planning" className={timelineHeaderNavLinkClassName} href="/story" title="Open Story Graph planning">
              <GitBranch className="size-3.5" />
              <span className="hidden sm:inline">Story</span>
            </Link>
            <Link aria-label="Open settings" className={timelineHeaderNavLinkClassName} href="/settings" title="Open settings">
              <Settings className="size-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </nav>
        </div>
      </header>

      <div className="sf-agent-workbench flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="sf-agent-workbench__nav custom-scrollbar touch-scroll-region order-2 min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:order-1 lg:w-72 lg:flex-[0_0_18rem] lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</h2>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
              {workflowNodeIds.length} steps
            </span>
          </div>

          <div className="relative flex flex-col gap-1.5">
            <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 w-px bg-slate-200" />
            {workflowNodeIds.map((nodeId, index) => {
              const node = activeWorkflow.nodes[nodeId];
              const content = timelineNodeContent[nodeId];
              const display = stepDisplay[nodeId];
              const StepIcon = display.icon;
              const selected = selectedNodeId === nodeId;
              const isParallelNode = parallelNodeIds.has(nodeId);
              const isNodeRunning = node.status === "running";

              return (
                <button
                  className={cn(
                    "group relative flex w-full items-start gap-3 rounded-md border px-2 py-2 text-left transition-colors",
                    selected
                      ? "border-slate-300 bg-slate-50"
                      : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50",
                  )}
                  data-node-id={nodeId}
                  key={nodeId}
                  onClick={() => selectNode(nodeId)}
                  type="button"
                >
                  <span
                    className={cn(
                      "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ring-4 ring-white",
                      getStepTone(node.status),
                    )}
                  >
                    {isNodeRunning ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <StepIcon className="size-3.5 shrink-0 text-slate-400" />
                      <span className="break-words text-xs font-semibold text-slate-900">{content.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="break-words text-[11px] text-slate-500">{content.shellState}</span>
                      <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                        {getCompactStatusLabel(node.status)}
                      </span>
                    </span>
                    {isParallelNode ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-700">
                        <GitBranch className="size-3" />
                        Parallel
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="sf-agent-workbench__main custom-scrollbar touch-scroll-region order-1 min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4 lg:order-2 lg:min-w-0">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
            <article className="flex min-h-[50rem] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-blue-700">
                    <SelectedIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">{selectedContent.title}</h2>
                      {selectedContent.reserved ? (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase text-slate-500">
                          Reserved
                        </span>
                      ) : null}
                      {selectedIsNonEditableAiNode ? (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase text-slate-500">
                          Non-editable
                        </span>
                      ) : null}
                      {selectedIsVisualOnlyEditable ? (
                        <span className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-[11px] font-semibold uppercase text-indigo-700">
                          Visual edits only
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{selectedContent.shellState}</p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <TimelineStatusChip status={selectedNode.status} />
                  <Button
                    className="h-8 px-2.5 text-xs shadow-none"
                    disabled={!workflow || selectedNodeAiDisabled}
                    onClick={() => handleRequestAi(selectedNodeId)}
                    type="button"
                    variant="secondary"
                  >
                    <RefreshCw className="size-3.5" />
                    Regenerate
                  </Button>
                </div>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                {selectedNodeId === "scene-input" ? (
                  <form className="rounded-md border border-slate-200 bg-slate-50" id="scene-composer-form" onSubmit={handleSubmit}>
                    <div className="border-b border-slate-200 px-3 py-2">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="scene-request">
                        Command composer
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
                      <label
                        className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                        htmlFor="prompt-profile"
                      >
                        Prompt profile
                      </label>
                      <select
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        disabled={isRunning}
                        id="prompt-profile"
                        onChange={(event) => handlePromptProfileChange(event.target.value)}
                        value={selectedPromptProfile}
                      >
                        {promptProfileIds.map((profile) => (
                          <option key={profile} value={profile}>
                            {formatPromptProfileLabel(profile)}
                          </option>
                        ))}
                      </select>
                      <label
                        className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                        htmlFor="timeline-image-count"
                      >
                        Images
                      </label>
                      <select
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        disabled={isRunning || Boolean(selectedSourceImage)}
                        id="timeline-image-count"
                        onChange={(event) => handleImageCountChange(event.target.value)}
                        value={selectedSourceImage ? 1 : selectedImageCount}
                      >
                        {timelineImageCountOptions.map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={handleSourceImageChange}
                        ref={sourceImageInputRef}
                        type="file"
                      />
                      <Button
                        className="ml-2 h-8 px-2 text-xs shadow-none"
                        disabled={isRunning}
                        onClick={() => sourceImageInputRef.current?.click()}
                        type="button"
                        variant="secondary"
                      >
                        <ImageIcon className="size-3.5" />
                        Upload source
                      </Button>
                    </div>
                    <textarea
                      className="min-h-28 w-full resize-none border-0 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
                      id="scene-request"
                      onChange={(event) => setSceneRequest(event.target.value)}
                      placeholder="Describe the scene, characters, mood, camera, and constraints..."
                      value={sceneRequest}
                    />
                    {selectedSourceImage ? (
                      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-3 py-2">
                        <Image
                          alt="Uploaded img2img source"
                          className="size-16 rounded-md border border-slate-200 object-cover"
                          height={64}
                          src={selectedSourceImage.dataUrl}
                          unoptimized
                          width={64}
                        />
                        <div className="min-w-0 flex-1 text-xs leading-relaxed text-slate-600">
                          <p className="break-all font-medium text-slate-800">{selectedSourceImage.filename}</p>
                          <p>
                            {selectedSourceImage.width}x{selectedSourceImage.height} source image. Img2img uses one
                            output.
                          </p>
                          <label className="mt-2 flex max-w-48 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Denoise
                            <input
                              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                              disabled={isRunning}
                              max={1}
                              min={0}
                              onChange={(event) => handleSourceDenoiseChange(event.target.value)}
                              onBlur={(event) => commitSourceDenoise(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              step={0.05}
                              type="number"
                              value={selectedSourceDenoise}
                            />
                          </label>
                        </div>
                        <Button
                          className="h-8 px-2 text-xs shadow-none"
                          disabled={isRunning}
                          onClick={() => commitSceneInputSourceImage(null)}
                          type="button"
                          variant="secondary"
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          className="h-7 px-2 text-[11px] shadow-none"
                          disabled={isRunning || !sceneInputAiSource}
                          onClick={() => void handleSceneInputAi("rewrite")}
                          type="button"
                          variant="secondary"
                        >
                          Rewrite
                        </Button>
                        <Button
                          className="h-7 px-2 text-[11px] shadow-none"
                          disabled={isRunning}
                          onClick={() => void handleSceneInputAi("suggest")}
                          type="button"
                          variant="secondary"
                        >
                          Suggest
                        </Button>
                        <Button className="h-7 px-2 text-[11px] shadow-none" disabled type="button" variant="secondary">
                          <LockKeyhole className="size-3" />
                          Lock
                        </Button>
                      </div>
                      <Button className="h-8 px-3 text-xs shadow-none" disabled={!sceneRequestIsUsable || isRunning} type="submit">
                        <Play className="size-3.5" />
                        Start workflow
                      </Button>
                    </div>
                  </form>
                ) : null}

                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Input</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{buildDependencyText(selectedNodeId)}</p>
                  </div>
                  <div className="hidden items-center justify-center text-slate-300 md:flex">
                    <ArrowRight className="size-4" />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transform</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{selectedDisplay.transform}</p>
                  </div>
                  <div className="hidden items-center justify-center text-slate-300 md:flex">
                    <ArrowRight className="size-4" />
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Output</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{selectedDisplay.artifact}</p>
                  </div>
                </div>

                {selectedNodeId === "generation-gate" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                    <div className="flex min-w-0 gap-2">
                      <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                      <p>
                        ComfyUI execution requires explicit confirmation. The timeline stops here until you confirm the
                        render request.
                      </p>
                    </div>
                    <Button
                      className="h-8 shrink-0 px-3 text-xs shadow-none"
                      disabled={!generationCanBeConfirmed || isRunning}
                      onClick={handleConfirmGeneration}
                      type="button"
                    >
                      <Play className="size-3.5" />
                      Confirm and render
                    </Button>
                  </div>
                ) : null}

                {notices[selectedNodeId] ? (
                  <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700">
                    <Bot className="mt-0.5 size-4 shrink-0" />
                    <p>{notices[selectedNodeId]}</p>
                  </div>
                ) : null}

                <div className="flex min-h-[36rem] flex-1 flex-col rounded-md border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Step output</p>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {selectedHasVisualOutput && !selectedIsVisualOnlyEditable ? (
                        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                          <button
                            className={cn(
                              "h-7 px-2 text-[11px] font-medium transition-colors",
                              selectedOutputDisplayMode === "visual"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:bg-white",
                            )}
                            onClick={() =>
                              setOutputDisplayModes((current) => ({
                                ...current,
                                [selectedNodeId]: "visual",
                              }))
                            }
                            type="button"
                          >
                            Visual
                          </button>
                          <button
                            className={cn(
                              "h-7 border-l border-slate-200 px-2 text-[11px] font-medium transition-colors",
                              selectedOutputDisplayMode === "json"
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:bg-white",
                            )}
                            onClick={() =>
                              setOutputDisplayModes((current) => ({
                                ...current,
                                [selectedNodeId]: "json",
                              }))
                            }
                            type="button"
                          >
                            Raw JSON
                          </button>
                        </div>
                      ) : (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
                          {selectedIsVisualOnlyEditable ? "Visual only" : "Raw JSON only"}
                        </span>
                      )}
                      {selectedOutputDisplayMode === "json" && selectedRawEditable ? (
                        <Button
                          className="h-7 px-2 text-[11px] shadow-none"
                          disabled={!selectedRawEditable}
                          onClick={() => handleStartEdit(selectedNodeId)}
                          type="button"
                          variant="secondary"
                        >
                          <PencilLine className="size-3" />
                          Edit
                        </Button>
                      ) : null}
                      {selectedIsNonEditableAiNode ? (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
                          Inspect only
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                  {editingNodeId === selectedNodeId ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="min-h-28 w-full resize-y rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        onChange={(event) => handleDraftChange(selectedNodeId, event.target.value)}
                        value={drafts[selectedNodeId] ?? ""}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          className="h-8 px-2.5 text-xs shadow-none"
                          onClick={handleCancelEdit}
                          type="button"
                          variant="secondary"
                        >
                          Cancel
                        </Button>
                        <Button
                          className="h-8 px-2.5 text-xs shadow-none"
                          disabled={!(drafts[selectedNodeId] ?? "").trim()}
                          onClick={() => handleSaveEdit(selectedNodeId)}
                          type="button"
                        >
                          Save manual
                        </Button>
                      </div>
                    </div>
                  ) : selectedOutputDisplayMode === "visual" && selectedWorkspaceKey === "scene-prompt" ? (
                    <TimelineScenePromptWorkspace
                      editable={Boolean(workflow)}
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      onSave={handleSaveScenePromptVisual}
                      promptProfile={selectedPromptProfile}
                    />
                  ) : selectedOutputDisplayMode === "visual" && selectedWorkspaceKey === "resource-recommendation" ? (
                    <TimelineResourceRecommendationWorkspace
                      editable={Boolean(workflow)}
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      onSave={handleSaveResourceRecommendationVisual}
                    />
                  ) : selectedOutputDisplayMode === "visual" && selectedWorkspaceKey === "parameter-recommendation" ? (
                    <TimelineParameterRecommendationWorkspace
                      editable={Boolean(workflow)}
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      onSave={handleSaveParameterRecommendationVisual}
                    />
                  ) : selectedOutputDisplayMode === "visual" && selectedWorkspaceKey === "result-display" ? (
                    <TimelineResultDisplayWorkspace
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      workflow={activeWorkflow}
                    />
                  ) : selectedOutputDisplayMode === "visual" && isTimelineEditorWorkspaceNode(selectedNodeId) ? (
                    <TimelineEditorWorkspace
                      workflow={activeWorkflow}
                    />
                  ) : selectedOutputDisplayMode === "json" && selectedRawJsonOutput ? (
                    <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                      {selectedRawJsonOutput}
                    </pre>
                  ) : selectedOutput ? (
                    <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                      {selectedOutput}
                    </pre>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                      {selectedContent.emptyState}
                    </div>
                  )}
                  </div>
                </div>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                <span>Source: {selectedNode.source}</span>
                <span>Agent: {selectedDisplay.agent}</span>
                <span>Updated: {formatTime(selectedNode.updatedAt)}</span>
              </footer>
            </article>
          </div>
        </section>

        <aside className="sf-agent-workbench__inspector custom-scrollbar touch-scroll-region order-3 min-h-0 overflow-y-auto border-t border-slate-200 bg-white p-3 lg:order-3 lg:w-80 lg:flex-[0_0_20rem] lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-3">
            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inspector</h2>
              </header>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-xs">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-right font-medium text-slate-800">{getCompactStatusLabel(selectedNode.status)}</dd>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-right font-medium text-slate-800">{selectedNode.source}</dd>
                <dt className="text-slate-500">Workflow</dt>
                <dd className="break-all text-right font-medium text-slate-800">{activeWorkflow.workflowId}</dd>
                <dt className="text-slate-500">Tokens</dt>
                <dd className="text-right font-medium text-slate-800">Reserved</dd>
              </dl>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agent activity</h2>
              </header>
              <div className="flex flex-col gap-2 p-3 text-xs">
                <div className="flex gap-2">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", workflow ? "bg-emerald-500" : "bg-slate-300")} />
                  <p className="leading-relaxed text-slate-600">
                    {workflow ? "Scene command captured and graph state initialized." : "Waiting for scene command."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", isRunning ? "bg-indigo-500" : selectedNode.status === "ready" ? "bg-blue-500" : "bg-slate-300")} />
                  <p className="leading-relaxed text-slate-600">
                    {isRunning
                      ? "LangGraph is running timeline inference and recommendation nodes."
                      : `${selectedContent.title} is ${getCompactStatusLabel(selectedNode.status).toLowerCase()}.`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className={cn(
                    "mt-1 size-2 shrink-0 rounded-full",
                    activeWorkflow.nodes["result-display"].status === "done" ? "bg-emerald-500" : "bg-slate-300",
                  )} />
                  <p className="leading-relaxed text-slate-600">
                    Confirmed renders queue through the timeline graph and store returned images as standalone
                    result.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tool calls</h2>
              </header>
              <div className="p-3 text-xs leading-relaxed text-slate-500">
                {workflow
                  ? "Timeline uses /api/llm/chat, local Civitai recommendation, ComfyUI sampler options, and confirmed timeline generation."
                  : "No external tools have been called by this shell."}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated artifacts</h2>
              </header>
              <div className="p-3">
                {isResultDisplayTimelineResult(activeWorkflow.nodes["result-display"].result) ? (
                  <Image
                    alt="Timeline generated artifact"
                    className="aspect-square w-full rounded-md border border-slate-200 object-cover"
                    height={320}
                    src={activeWorkflow.nodes["result-display"].result.image.url}
                    unoptimized
                    width={320}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                    Artifact preview will appear after confirmed render execution.
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>

      {renderPromptTagReviewDialog()}
    </main>
  );
}
