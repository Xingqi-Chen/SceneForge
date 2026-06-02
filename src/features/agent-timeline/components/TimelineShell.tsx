"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  markTimelineNodeRunning,
  normalizeTimelineImageCount,
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
  timelineNodeIds,
  TimelineNodeExecutionError,
  type CanvasBindingTimelineResult,
  type CharacterActionTimelineResult,
  type ParameterRecommendationTimelineResult,
  type ResultDisplayTimelineResult,
  type ResourceRecommendationTimelineResult,
  type ScenePromptTimelineResult,
  type SceneInputTimelineResult,
  type TimelineNodeId,
  type TimelineNodeStatus,
  type TimelineWorkflowState,
} from "@/features/agent-timeline/types";
import type {
  CivitaiAiRecommendationResponse,
  CivitaiResourceListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library/types";
import {
  getCivitaiModelStorageKind,
  makeCivitaiResourceFileNameAliases,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library/resource-files";
import { parseCivitaiAiPromptResponse } from "@/features/editor/ai-prompt/civitai-ai-context";
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
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  getLlmProxyErrorMessage,
  isLlmChatResponse,
  LiteLlmError,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@/features/llm";
import { savePromptLibrary } from "@/features/persistence";
import type { CharacterPromptTagTarget } from "@/features/prompt-engine/prompt-library/character-image-prompt-tags";
import {
  defaultSceneForgeUserSettings,
  type CharacterTagNewTermDefaultOption,
  type CentralSettingsPayload,
  type SceneForgeWorkflowSettings,
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
import { getTimelineNodeOutputText, timelineNodeContent } from "./timeline-node-content";

type DraftMap = Partial<Record<TimelineNodeId, string>>;
type NoticeMap = Partial<Record<TimelineNodeId, string>>;
type OutputDisplayMode = "json" | "visual";
type OutputDisplayModeMap = Partial<Record<TimelineNodeId, OutputDisplayMode>>;
type SceneInputAiAction = "rewrite" | "suggest";

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

const settingsLinkClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";
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

async function completeTimelineChatViaApi(request: LlmChatRequest): Promise<LlmChatResponse> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
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
    .trim()
    .slice(0, 800) || null;
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
  selectedResources,
}: {
  baseNegativePrompt: string;
  finalPositivePrompt: string;
  selectedResources: SelectedCivitaiResourcesPreview;
}) {
  if (!selectedResources.checkpoint) {
    return null;
  }

  const preset: StylePalettePromptPreset = {
    id: "portrait",
    label: "Timeline render prompt",
    description: "Timeline prompt used for model parameter advice.",
    positive: finalPositivePrompt,
    negative: baseNegativePrompt,
  };
  const response = await completeTimelineChatViaApi({
    purpose: "stable-diffusion-prompt-generation",
    messages: buildStylePaletteAdviceMessages({
      artistPrompts: [],
      preset,
      resources: selectedResources,
    }),
    temperature: 0.25,
    maxTokens: 900,
  });

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
    .replace(/^["']|["']$/g, "")
    .slice(0, 1200);
}

function getSceneInputRawIntent(workflow: TimelineWorkflowState | null) {
  const result = workflow?.nodes["scene-input"].result;

  return isRecord(result) && typeof result.rawIntent === "string" ? result.rawIntent : "";
}

function getSceneInputImageCount(workflow: TimelineWorkflowState | null) {
  const result = workflow?.nodes["scene-input"].result;

  return isRecord(result)
    ? normalizeTimelineImageCount(result.imageCount)
    : DEFAULT_TIMELINE_IMAGE_COUNT;
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
          ? "Suggest one stronger alternate scene request inspired by the current draft."
          : "Suggest one concise, visually rich scene request for a single image.",
        "Make it specific enough to start the SceneForge timeline.",
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
) {
  if (nodeId === "scene-input") {
    return {
      rawIntent: value,
      promptProfile,
      imageCount: normalizeTimelineImageCount(imageCount),
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

function TimelineResultDisplayWorkspace({
  emptyState,
  node,
}: {
  emptyState: string;
  node: TimelineWorkflowState["nodes"][TimelineNodeId];
}) {
  const result = isResultDisplayTimelineResult(node.result) ? node.result : null;

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

  return (
    <div className="flex flex-col gap-3" data-testid="timeline-result-workspace">
      <div className={cn(
        "grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3",
        resultImages.length > 1 ? "md:grid-cols-2" : "grid-cols-1",
      )}>
        {resultImages.map((image, index) => (
          <figure className="overflow-hidden rounded-md border border-slate-200 bg-white" key={`${image.nodeId}:${image.filename}:${index}`}>
            <Image
              alt={`Timeline generated ComfyUI result ${index + 1}`}
              className="max-h-[42rem] w-full object-contain"
              height={1024}
              src={image.url}
              unoptimized
              width={1024}
            />
            {resultImages.length > 1 ? (
              <figcaption className="border-t border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-500">
                Image {index + 1} of {resultImages.length}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
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
  const [workflow, setWorkflow] = useState<TimelineWorkflowState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<TimelineNodeId>("scene-input");
  const [editingNodeId, setEditingNodeId] = useState<TimelineNodeId | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [outputDisplayModes, setOutputDisplayModes] = useState<OutputDisplayModeMap>({});
  const [notices, setNotices] = useState<NoticeMap>({});
  const [isRunning, setIsRunning] = useState(false);
  const activeRunIdRef = useRef(0);
  const [pendingPromptTagReview, setPendingPromptTagReview] =
    useState<PendingTimelinePromptTagReview | null>(null);
  const [isSavingPromptTagReview, setIsSavingPromptTagReview] = useState(false);
  const [timelineSettings, setTimelineSettings] = useState<SceneForgeWorkflowSettings>(
    defaultSceneForgeUserSettings.workflow,
  );
  const pendingPromptTagReviewRef = useRef<PendingTimelinePromptTagReview | null>(null);

  const previewWorkflow = useMemo(() => createTimelineWorkflowState({ workflowId: "draft-workflow" }), []);
  const activeWorkflow = workflow ?? previewWorkflow;
  const selectedNode = activeWorkflow.nodes[selectedNodeId];
  const selectedContent = timelineNodeContent[selectedNodeId];
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
  const workflowTitle = workflow ? sceneRequest : "Untitled workflow";
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

  useEffect(() => {
    return () => {
      activeRunIdRef.current += 1;
      const pending = pendingPromptTagReviewRef.current;
      if (pending) {
        pending.reject(new Error("Timeline run was superseded."));
        pendingPromptTagReviewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    void loadTimelineSettingsViaApi()
      .then((payload) => {
        if (canceled) {
          return;
        }

        setTimelineSettings(payload.workflow);
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

  function isCurrentRun(runId: number) {
    return activeRunIdRef.current === runId;
  }

  function invalidateTimelineRun() {
    activeRunIdRef.current += 1;
    cancelPendingPromptTagReview("Timeline run was superseded.");
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

        return mergeTimelineWorkflowUpdate(currentWorkflow, update);
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

      setWorkflow(result);
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

      return markTimelineNodeRunning(currentWorkflow, "comfyui-execution");
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

      setWorkflow(result);
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

    const nextWorkflow = createTimelineWorkflowState({
      imageCount: selectedImageCount,
      promptProfile: selectedPromptProfile,
      sceneRequest: trimmedSceneRequest,
    });

    setWorkflow(nextWorkflow);
    setSceneRequest(trimmedSceneRequest);
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
    setWorkflow(setTimelineNodeManualResult(workflow, "scene-input", {
      rawIntent,
      imageCount: selectedImageCount,
      promptProfile,
    } satisfies SceneInputTimelineResult));
  }

  function handleImageCountChange(value: string) {
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
    setWorkflow(setTimelineNodeManualResult(workflow, "scene-input", {
      rawIntent,
      imageCount,
      promptProfile: selectedPromptProfile,
    } satisfies SceneInputTimelineResult));
    setNotices((current) => ({
      ...current,
      "scene-input": "Image count updated. Downstream nodes are pending regeneration.",
    }));
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
    setWorkflow(setTimelineNodeManualResult(
      workflow,
      nodeId,
      createManualResult(nodeId, draft, selectedPromptProfile, selectedImageCount),
    ));
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

    setWorkflow(nextWorkflow);
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

    setWorkflow(nextWorkflow);
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

    setWorkflow(nextWorkflow);
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
      setWorkflow(markTimelineNodeRunning(workflow, "scene-input"));
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
            imageCount: selectedImageCount,
            promptProfile: selectedPromptProfile,
          } satisfies SceneInputTimelineResult)
        : null;

      if (nextWorkflow) {
        setWorkflow(nextWorkflow);
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
        setWorkflow(workflow);
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
    setWorkflow(null);
    setSceneRequest("");
    setSelectedPromptProfile(defaultPromptProfileId);
    setSelectedImageCount(DEFAULT_TIMELINE_IMAGE_COUNT);
    setSelectedNodeId("scene-input");
    setEditingNodeId(null);
    setDrafts({});
    setOutputDisplayModes({});
    setNotices({});
    setIsRunning(false);
  }

  function selectNode(nodeId: TimelineNodeId) {
    setSelectedNodeId(nodeId);
    if (nodeId === "scene-input") {
      setSelectedImageCount(getSceneInputImageCount(workflow));
    }
    setEditingNodeId(null);
  }

  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
            <Workflow className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-900">SceneForge</h1>
            <p className="truncate text-[11px] text-slate-500">{workflowTitle}</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <CircleDot className="size-3.5 text-blue-600" />
            <span className="truncate">{workflowMode}</span>
            <span className="text-slate-300">/</span>
            <span className="truncate">{selectedContent.title}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button className="h-9 px-3 text-xs shadow-none" onClick={handleNewScene} type="button" variant="secondary">
            New scene
          </Button>
          <Button
            className="h-9 px-3 text-xs shadow-none"
            disabled={workflow ? selectedNodeAiDisabled : !sceneRequestIsUsable || isRunning}
            onClick={workflow ? () => handleRequestAi(selectedNodeId) : startWorkflow}
            type="button"
          >
            <Play className="size-3.5" />
            Run
          </Button>
          <Link aria-label="Open settings" className={settingsLinkClassName} href="/settings" title="Open settings">
            <Settings className="size-3.5" />
            Settings
          </Link>
        </div>
      </header>

      <div className="sf-agent-workbench flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="sf-agent-workbench__nav custom-scrollbar touch-scroll-region order-2 min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:order-1 lg:w-72 lg:flex-[0_0_18rem] lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</h2>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
              {timelineNodeIds.length} steps
            </span>
          </div>

          <div className="relative flex flex-col gap-1.5">
            <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 w-px bg-slate-200" />
            {timelineNodeIds.map((nodeId, index) => {
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
                      <span className="truncate text-xs font-semibold text-slate-900">{content.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-slate-500">{content.shellState}</span>
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
                        disabled={isRunning}
                        id="timeline-image-count"
                        onChange={(event) => handleImageCountChange(event.target.value)}
                        value={selectedImageCount}
                      >
                        {timelineImageCountOptions.map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="min-h-28 w-full resize-none border-0 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
                      id="scene-request"
                      onChange={(event) => setSceneRequest(event.target.value)}
                      placeholder="Describe the scene, characters, mood, camera, and constraints..."
                      value={sceneRequest}
                    />
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
                  ) : selectedOutputDisplayMode === "visual" && selectedNodeId === "scene-prompt" ? (
                    <TimelineScenePromptWorkspace
                      editable={Boolean(workflow)}
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      onSave={handleSaveScenePromptVisual}
                      promptProfile={selectedPromptProfile}
                    />
                  ) : selectedOutputDisplayMode === "visual" && selectedNodeId === "resource-recommendation" ? (
                    <TimelineResourceRecommendationWorkspace
                      editable={Boolean(workflow)}
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      onSave={handleSaveResourceRecommendationVisual}
                    />
                  ) : selectedOutputDisplayMode === "visual" && selectedNodeId === "parameter-recommendation" ? (
                    <TimelineParameterRecommendationWorkspace
                      editable={Boolean(workflow)}
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
                      onSave={handleSaveParameterRecommendationVisual}
                    />
                  ) : selectedOutputDisplayMode === "visual" && selectedNodeId === "result-display" ? (
                    <TimelineResultDisplayWorkspace
                      emptyState={selectedContent.emptyState}
                      key={selectedNode.updatedAt}
                      node={selectedNode}
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
                <dd className="truncate text-right font-medium text-slate-800">{activeWorkflow.workflowId}</dd>
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

      {pendingPromptTagReview ? (
        <PromptTagImportReviewDialog
          getSuggestionTargetLabel={getTimelinePromptTagTargetLabel}
          isSaving={isSavingPromptTagReview}
          onApply={handleApplyPromptTagReview}
          onCancel={handleCancelPromptTagReview}
          review={pendingPromptTagReview.review}
          title="导入新的部位提示词"
        />
      ) : null}
    </main>
  );
}
