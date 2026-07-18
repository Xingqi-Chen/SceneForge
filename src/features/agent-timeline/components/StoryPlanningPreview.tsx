"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  CircleDot,
  GitBranch,
  ImageIcon,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  Settings,
  Workflow,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";

import {
  createStoryGraphInputWorkflow,
  type StoryGraphStartRequest,
} from "@/features/agent-timeline/story-input";
import {
  createStoryDetailerSettingsSnapshot,
  sanitizeStoryDetailerSettingsSnapshot,
  type StoryDetailerConfig,
  type StoryDetailerSettingsSnapshot,
} from "@/features/agent-timeline/story-detailers";
import {
  createStoryStylePaletteSnapshot,
  createStoryStyleReferenceSnapshot,
  getStoryStyleReferenceCapability,
  parseStoryStyleReferenceAnalysisContent,
  sanitizeStoryStyleReferenceIpAdapterSettings,
  STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
  type StoryStyleReferenceAnalysis,
  type StoryStyleReferenceIpAdapterSettings,
  type StoryStyleReferenceMetadata,
  type StoryStyleReferenceSnapshot,
} from "@/features/agent-timeline/story-style-palette";
import type { StoryResultDisplay } from "@/features/agent-timeline/story-api";
import type { StoryShotGraphExecutionState } from "@/features/agent-timeline/story-execution";
import {
  DEFAULT_STORY_IMG2IMG_DENOISE,
  createStoryExecutionRequestBatch,
  getSelectedStoryResourcesForPrompting,
  normalizeStoryImg2ImgDenoise,
  type StoryRenderPlan,
  type StoryResourcePlan,
} from "@/features/agent-timeline/story-planning";
import {
  setStoryNodeManualResult,
  type StoryManualEditScope,
  type StoryWorkflowNodeResult,
  type StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import {
  storyWorkflowDefinition,
} from "@/features/agent-timeline/story-workflow";
import {
  deleteActiveTimelineWorkflowRecord,
  loadActiveTimelineWorkflowRecord,
  saveActiveTimelineWorkflowRecord,
} from "@/features/agent-timeline/timeline-workflow-storage";
import {
  isStoryGraphTimelineWorkflowRecord,
  type TimelineOutputDisplayMode,
  type TimelineWorkflowRecord,
  type TimelineWorkflowRecordInput,
} from "@/features/agent-timeline/timeline-workflow-persistence";
import type {
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";
import type { ResultDisplayTimelineResult } from "@/features/agent-timeline/types";
import {
  getLlmProxyErrorMessage,
  isLlmChatResponse,
  type LlmChatRequest,
} from "@/features/llm";
import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import type { SavedComfyUiGenerationParams } from "@/shared/types";
import {
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
} from "@/features/comfyui";
import {
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
} from "@/features/editor/ai-prompt/comfyui-generation-options";
import {
  coercePromptProfileId,
  defaultPromptProfileId,
  formatPromptProfileLabel,
  normalizePromptProfileId,
  promptProfileIds,
  type PromptProfileId,
} from "@/shared/prompt-profile";
import { cn } from "@/shared/utils/cn";

import { StoryNodeOutputSummaryView } from "./StoryNodeOutputSummaryView";
import { StoryPlanningWorkspace } from "./StoryPlanningWorkspace";
import { TimelineWorkflowProjectMenu } from "./TimelineWorkflowProjectMenu";
import {
  ComfyUiGenerationDialog,
  toDraft,
  type GenerationDraft,
} from "@/features/editor/components/ImageGenerationPanel";
import {
  EMPTY_STYLE_PALETTE_ADVICE,
  StylePaletteAiAdvicePanel,
  type StylePaletteAdviceState,
} from "@/features/editor/components/StylePaletteAiAdvicePanel";
import { StylePaletteCivitaiResourceSelector } from "@/features/editor/components/StylePaletteCivitaiResourceSelector";

import { TimelineResultDisplayWorkspace } from "./TimelineResultDisplayWorkspace";

const headerLinkClassName =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 sm:px-3";
const storyHeaderClassName =
  "grid min-h-14 shrink-0 grid-cols-1 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4";
const storyHeaderPrimaryClassName = "flex min-w-0 items-center gap-3";
const storyHeaderIdentityClassName =
  "flex min-w-0 max-w-[min(38rem,50vw)] items-center gap-3";
const storyHeaderProjectClassName = "flex min-w-0 justify-center";
const storyHeaderActionsClassName =
  "flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end sm:flex-nowrap";
const storyHeaderNavClassName =
  "flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1";
const storyHeaderNavCurrentClassName =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded bg-white px-2.5 text-xs font-semibold text-slate-950 shadow-sm";
const storyHeaderNavLinkClassName =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-950";
const storyGateConfirmButtonClassName =
  "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500";
const EMPTY_SELECTED_CIVITAI_RESOURCES: SelectedCivitaiResourcesPreview = {
  checkpoint: null,
  loras: [],
};

const planningNodeIds = storyWorkflowDefinition.nodeIds;

type StoryInputAiAction = "rewrite" | "suggest";
type StoryAutosaveStatus = "idle" | "loading" | "saved" | "error";
type StoryOutputDisplayMode = TimelineOutputDisplayMode;
type StoryOutputDisplayModeMap = Partial<Record<StoryWorkflowNodeId, StoryOutputDisplayMode>>;

function formatStatusLabel(status: string) {
  return status.replace(/-/g, " ");
}

function getStoryNodeStatusTone(status: string) {
  if (status === "manual") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }

  if (status === "done") {
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

  return "border-slate-200 bg-slate-50 text-slate-500";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoryInputAiText(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (isRecord(parsed)) {
      const storyRequest = parsed.storyRequest ?? parsed.sceneRequest ?? parsed.request;
      return typeof storyRequest === "string" ? storyRequest.trim() : "";
    }
  } catch {
    return trimmed;
  }

  return "";
}

function buildStoryInputAiRequest({
  action,
  nsfwEnabled,
  promptProfile,
  storyRequest,
}: {
  action: StoryInputAiAction;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  storyRequest: string;
}): LlmChatRequest {
  const actionInstruction = action === "rewrite"
    ? [
        "Rewrite the provided story request into a clearer storyboard-generation command.",
        "Preserve the user's premise, characters, setting, mood, sequence intent, and constraints.",
        "Preserve explicit style constraints; if none are present, keep the request aligned to Japanese illustration / anime-inspired rendering.",
        "Do not add title, content warning, model, LoRA, checkpoint, or render-parameter instructions.",
      ]
    : [
        storyRequest
          ? "Suggest one stronger alternate Story Graph request inspired by the current draft."
          : "Suggest one concrete, storyboard-ready Story Graph request for a short sequence.",
        "Use Japanese illustration / anime-inspired style only as the rendering style: clean character design, expressive eyes, readable silhouettes, polished linework, and painterly color accents.",
        "The returned storyRequest must explicitly include anime-style or Japanese-illustration visual direction without turning the premise into Japanese cultural content by default.",
        "Do not add Japanese cultural content unless the user asks for it; avoid inventing shrine, kimono, school uniform, samurai, archer, yokai, torii, katana, or other Japan-themed setting, clothing, action, or props just because of the style.",
        storyRequest
          ? "Keep the alternate request grounded in visible character actions, concrete locations, and clear story causality."
          : "The request must name or clearly define one main protagonist, their visible age range or role, appearance, clothing, immediate goal, key prop or obstacle, and emotional state.",
        storyRequest
          ? "Keep any protagonist changes consistent with the current draft instead of forcing a new default archetype."
          : "Bias the default premise toward a female-led everyday slice-of-life story: school, campus, home, cafe, bookstore, studio, neighborhood errand, commute, hobby practice, friendship, self-care, chores, or a small personal goal; keep it wholesome and non-sexual by default.",
        storyRequest
          ? "Preserve the current draft's core premise while replacing vague atmosphere with specific visual beats."
          : "Include 3 to 5 sequential visual beats with distinct shootable locations, observable actions, changing character intent, and a clear final image or ending state.",
        "Do not introduce default rain, rainy streets, raincoats, yellow raincoats, yellow rain jackets, yellow jackets or coats, couriers, delivery riders, cake boxes, wet markets, bus stops, train platforms, or stations unless the current draft explicitly asks for them.",
        "Vary protagonist archetypes, wardrobe colors, locations, key props, obstacles, and ending states instead of reusing a rainy courier template.",
        "Avoid abstract summaries, purely atmospheric mood writing, hidden meanings, symbolic-only stakes, and vague phrases such as subtle signs, mysterious journey, or hidden reunion unless they are shown through concrete visible events.",
        "Prefer compact storyboard-brief prose over a single poetic sentence.",
        "Make it specific enough to start story planning while leaving shot count optional.",
        "Do not include title, content warnings, model names, checkpoint names, LoRA names, or render parameters.",
      ];

  return {
    purpose: "comic-sequence-storyboard",
    nsfw: nsfwEnabled,
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's Story Graph input agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "All natural-language fields must be English.",
          "Keep the result as a story planning request, not a single-image prompt.",
          `Selected prompt profile: ${formatPromptProfileLabel(promptProfile)} (${promptProfile}).`,
          `NSFW setting: ${nsfwEnabled ? "enabled / explicit audience" : "disabled / safe audience"}.`,
          ...actionInstruction,
          'Required shape: {"storyRequest":"..."}',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            action,
            currentStoryRequest: storyRequest,
            nsfwEnabled,
            promptProfile,
          },
          null,
          2,
        ),
      },
    ],
    temperature: action === "rewrite" ? 0.25 : storyRequest ? 0.55 : 0.75,
    maxTokens: 400,
  };
}

async function completeStoryInputAi({
  action,
  nsfwEnabled,
  promptProfile,
  storyRequest,
}: {
  action: StoryInputAiAction;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  storyRequest: string;
}) {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildStoryInputAiRequest({
        action,
        nsfwEnabled,
        promptProfile,
        storyRequest,
      }),
    ),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getLlmProxyErrorMessage(payload) ?? "Unable to update Story Graph request.");
  }

  if (!isLlmChatResponse(payload)) {
    throw new Error("Story input AI response did not include chat content.");
  }

  const nextStoryRequest = parseStoryInputAiText(payload.content);

  if (!nextStoryRequest) {
    throw new Error("Story input AI response did not include a usable story request.");
  }

  return nextStoryRequest;
}

type StoryStyleReferenceDraftStatus = "empty" | "uploading" | "analyzing" | "ready" | "error";

type StoryStyleReferenceFileInfo = {
  byteLength: number;
  contentType: string;
  name: string;
};

type StoryStyleReferenceAnalysisContext = {
  checkpointBaseModel: string | null;
  checkpointId?: string | null;
  promptProfile: PromptProfileId;
};

type StoryStyleReferenceDraft = {
  analysis?: StoryStyleReferenceAnalysis;
  analysisContext?: StoryStyleReferenceAnalysisContext;
  dataUrl?: string;
  error?: string;
  fileInfo?: StoryStyleReferenceFileInfo;
  metadata?: StoryStyleReferenceMetadata;
  status: StoryStyleReferenceDraftStatus;
};

const emptyStoryStyleReferenceDraft: StoryStyleReferenceDraft = {
  status: "empty",
};
const storyStyleReferenceAccept = "image/png,image/jpeg,image/webp";

function normalizeStoryStyleReferenceContextValue(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function getStoryStyleReferenceAnalysisContext({
  promptProfile,
  selectedCheckpoint,
  selectedCheckpointId,
}: {
  promptProfile: PromptProfileId;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
  selectedCheckpointId?: string | null;
}): StoryStyleReferenceAnalysisContext {
  const checkpointBaseModel = selectedCheckpoint?.baseModel?.trim() || promptProfile;

  return {
    checkpointBaseModel,
    ...(selectedCheckpointId ? { checkpointId: selectedCheckpointId } : {}),
    promptProfile,
  };
}

function getStoryStyleReferenceAnalysisMismatch(
  draft: StoryStyleReferenceDraft,
  currentContext: StoryStyleReferenceAnalysisContext,
) {
  if (draft.status !== "ready") {
    return "";
  }

  if (!draft.analysisContext) {
    return "Reanalyze the Story style reference for the current base model before starting planning.";
  }

  const analyzedBaseModel = normalizeStoryStyleReferenceContextValue(draft.analysisContext.checkpointBaseModel);
  const currentBaseModel = normalizeStoryStyleReferenceContextValue(currentContext.checkpointBaseModel);

  if (
    draft.analysisContext.promptProfile !== currentContext.promptProfile ||
    analyzedBaseModel !== currentBaseModel ||
    (draft.analysisContext.checkpointId ?? null) !== (currentContext.checkpointId ?? null)
  ) {
    return "Story style reference was analyzed for a different base model or checkpoint. Retry analysis or remove the reference before starting planning.";
  }

  return "";
}

function getDataUrlContentType(dataUrl: string) {
  return /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1] ?? "image/png";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Style reference image could not be read."));
      }
    };
    reader.onerror = () => reject(new Error("Style reference image could not be read."));
    reader.readAsDataURL(file);
  });
}

function parseStoryStyleReferenceStoragePayload(
  payload: unknown,
  fileInfo: StoryStyleReferenceFileInfo,
): StoryStyleReferenceMetadata {
  if (!isRecord(payload)) {
    throw new Error("Style reference upload did not return image metadata.");
  }

  const storedFilename = typeof payload.filename === "string" ? payload.filename.trim() : "";
  const url = typeof payload.url === "string" ? payload.url.trim() : "";
  const contentType = typeof payload.contentType === "string" && payload.contentType.trim()
    ? payload.contentType.trim()
    : fileInfo.contentType;
  const byteLength = typeof payload.byteLength === "number" && Number.isFinite(payload.byteLength)
    ? payload.byteLength
    : fileInfo.byteLength;

  if (!storedFilename || !url || !contentType.startsWith("image/") || byteLength <= 0) {
    throw new Error("Style reference upload returned incomplete image metadata.");
  }

  return {
    byteLength,
    contentType,
    filename: fileInfo.name,
    storedFilename,
    uploadedAt: new Date().toISOString(),
    url,
  };
}

async function uploadStoryStyleReferenceImage({
  dataUrl,
  fileInfo,
}: {
  dataUrl: string;
  fileInfo: StoryStyleReferenceFileInfo;
}) {
  const response = await fetch("/api/comfyui/sequence-references", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ dataUrl }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to upload the Story style reference."));
  }

  return parseStoryStyleReferenceStoragePayload(payload, fileInfo);
}

function buildStoryStyleReferenceAnalysisRequest({
  dataUrl,
  fileInfo,
  nsfwEnabled,
  promptProfile,
}: {
  dataUrl: string;
  fileInfo: StoryStyleReferenceFileInfo;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
}): LlmChatRequest {
  const modelPromptInstruction = promptProfile === "anima"
    ? [
        "The selected base model is Anima.",
        "Generate an Anima-compatible stylePrompt as concise natural-language visual clauses.",
        "Prefer readable descriptive phrases for medium, finish, light, palette, camera, texture, and atmosphere.",
        "Do not convert the stylePrompt into Danbooru-style tag soup.",
      ].join(" ")
    : [
        "The selected base model is Illustrious.",
        "Generate an Illustrious-compatible stylePrompt as compact comma-separated style tags and short visual phrases.",
        "Prefer SD/Danbooru-friendly fragments over prose sentences.",
        "Do not include narrative subject, character identity, pose, or story content tags.",
      ].join(" ");

  return {
    purpose: "story-style-reference-analysis",
    nsfw: nsfwEnabled,
    messages: [
      {
        role: "system",
        content: [
          "You analyze one visual style reference image for SceneForge Story Graph generation.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "Describe reusable visual style only: medium, rendering finish, linework, color palette, lighting, texture, camera/framing, atmosphere, and production style.",
          "Do not identify or imitate living artists, copyrighted characters, logos, celebrities, or specific franchise names.",
          "Do not describe the image's subject as content to reproduce unless it is necessary to explain broad style.",
          "The stylePrompt must be directly reusable as a positive prompt addition for every Story shot.",
          modelPromptInstruction,
          'Required shape: {"summary":"one concise sentence","stylePrompt":"comma-separated reusable visual style prompt"}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filename: fileInfo.name,
                contentType: fileInfo.contentType,
                promptProfile,
              },
              null,
              2,
            ),
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 700,
  };
}

async function completeStoryStyleReferenceAnalysis({
  dataUrl,
  fileInfo,
  nsfwEnabled,
  promptProfile,
}: {
  dataUrl: string;
  fileInfo: StoryStyleReferenceFileInfo;
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
}): Promise<StoryStyleReferenceAnalysis> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildStoryStyleReferenceAnalysisRequest({
        dataUrl,
        fileInfo,
        nsfwEnabled,
        promptProfile,
      }),
    ),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getLlmProxyErrorMessage(payload) ?? "Unable to analyze the Story style reference.");
  }

  if (!isLlmChatResponse(payload)) {
    throw new Error("Style reference analysis response did not include chat content.");
  }

  return parseStoryStyleReferenceAnalysisContent(payload.content, {
    analyzedAt: new Date().toISOString(),
    model: payload.model,
  });
}

function createClientStartRequest({
  checkpointId,
  detailers,
  img2imgDenoise,
  loraIds,
  nsfwEnabled,
  promptProfile,
  rawIntent,
  savedParameters,
  styleReference,
  targetShotCount,
}: {
  checkpointId?: string | null;
  detailers: StoryDetailerSettingsSnapshot;
  img2imgDenoise: string;
  loraIds?: readonly string[];
  nsfwEnabled: boolean;
  promptProfile: PromptProfileId;
  rawIntent: string;
  savedParameters?: SavedComfyUiGenerationParams | null;
  styleReference?: StoryStyleReferenceSnapshot;
  targetShotCount: string;
}): StoryGraphStartRequest {
  const normalizedShotCount = targetShotCount.trim() ? Number(targetShotCount) : undefined;
  const audienceRating = nsfwEnabled ? "explicit" : "safe";
  const stylePalette = createStoryStylePaletteSnapshot({
    checkpointId: checkpointId ?? null,
    loraIds: loraIds ?? [],
    savedParameters,
  });
  const sanitizedDetailers = sanitizeStoryDetailerSettingsSnapshot(detailers);

  return {
    nsfwEnabled,
    rawIntent,
    targetShotCount: Number.isFinite(normalizedShotCount) ? normalizedShotCount : undefined,
    settingsSnapshot: {
      audienceRating,
      detailers: sanitizedDetailers,
      img2imgDenoise: normalizeStoryImg2ImgDenoise(img2imgDenoise),
      nsfwEnabled,
      promptProfile,
      ...(stylePalette ? { stylePalette } : {}),
      ...(styleReference ? { styleReference } : {}),
      targetShotCount: Number.isFinite(normalizedShotCount) ? normalizedShotCount : undefined,
    } as StoryGraphStartRequest["settingsSnapshot"],
  };
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : fallback;
}

type StoryDetailerKind = keyof StoryDetailerSettingsSnapshot;
type StoryDetailerPatch = Partial<StoryDetailerConfig>;

const storyDetailerTextFieldClassName =
  "h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100";
const storyDetailerLabelTextClassName = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";

function StoryDetailerNumberInput({
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  id?: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className={storyDetailerLabelTextClassName}>{label}</span>
      <input
        className={storyDetailerTextFieldClassName}
        id={id}
        max={max}
        min={min}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function StoryDetailerTextInput({
  id,
  label,
  onChange,
  value,
}: {
  id?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className={storyDetailerLabelTextClassName}>{label}</span>
      <input
        className={storyDetailerTextFieldClassName}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
}

function StoryDetailerSelectInput({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  const selectedValue = options.some((option) => option.value === value) ? value : options[0]?.value ?? "";

  return (
    <label className="grid gap-1">
      <span className={storyDetailerLabelTextClassName}>{label}</span>
      <select
        className={storyDetailerTextFieldClassName}
        onChange={(event) => onChange(event.target.value)}
        value={selectedValue}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StoryDetailerBooleanInput({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700">
      <input
        checked={checked}
        className="size-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function StoryDetailerTextAreaInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 sm:col-span-2 lg:col-span-3">
      <span className={storyDetailerLabelTextClassName}>{label}</span>
      <textarea
        className="min-h-16 w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-xs leading-relaxed text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function StoryDetailerControls({
  idPrefix,
  onChange,
  parameterLabel,
  resolved,
}: {
  idPrefix: string;
  onChange: (patch: StoryDetailerPatch) => void;
  parameterLabel: string;
  resolved: Required<StoryDetailerConfig>;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StoryDetailerTextInput
          id={`${idPrefix}-detector-model`}
          label="detector model"
          onChange={(value) => onChange({ detectorModelName: value })}
          value={resolved.detectorModelName}
        />
        <StoryDetailerNumberInput
          label="guide size"
          min={64}
          onChange={(value) => onChange({ guideSize: Math.round(value / 8) * 8 })}
          step={8}
          value={resolved.guideSize}
        />
        <StoryDetailerNumberInput
          label="max size"
          min={64}
          onChange={(value) => onChange({ maxSize: Math.round(value / 8) * 8 })}
          step={8}
          value={resolved.maxSize}
        />
        <StoryDetailerNumberInput
          label={`${parameterLabel} denoise`}
          max={1}
          min={0}
          onChange={(value) => onChange({ denoise: value })}
          step={0.05}
          value={resolved.denoise}
        />
        <StoryDetailerNumberInput
          id={`${idPrefix}-steps`}
          label={`${parameterLabel} steps`}
          min={1}
          onChange={(value) => onChange({ steps: Math.round(value) })}
          value={resolved.steps}
        />
        <StoryDetailerNumberInput
          label={`${parameterLabel} cfg`}
          min={0}
          onChange={(value) => onChange({ cfg: value })}
          step={0.5}
          value={resolved.cfg}
        />
        <StoryDetailerSelectInput
          label={`${parameterLabel} sampler`}
          onChange={(value) => onChange({ samplerName: value })}
          options={COMFYUI_SAMPLER_OPTIONS}
          value={resolved.samplerName}
        />
        <StoryDetailerSelectInput
          label={`${parameterLabel} scheduler`}
          onChange={(value) => onChange({ scheduler: value })}
          options={COMFYUI_SCHEDULER_OPTIONS}
          value={resolved.scheduler}
        />
      </div>
      <details className="rounded-md border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700 marker:text-slate-400">
          Advanced parameters
        </summary>
        <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <StoryDetailerNumberInput
            label="bbox threshold"
            max={1}
            min={0}
            onChange={(value) => onChange({ bboxThreshold: value })}
            step={0.01}
            value={resolved.bboxThreshold}
          />
          <StoryDetailerNumberInput
            label="bbox dilation"
            max={512}
            min={-512}
            onChange={(value) => onChange({ bboxDilation: Math.round(value) })}
            value={resolved.bboxDilation}
          />
          <StoryDetailerNumberInput
            label="bbox crop"
            max={10}
            min={1}
            onChange={(value) => onChange({ bboxCropFactor: value })}
            step={0.1}
            value={resolved.bboxCropFactor}
          />
          <StoryDetailerNumberInput
            label="feather"
            max={100}
            min={0}
            onChange={(value) => onChange({ feather: Math.round(value) })}
            value={resolved.feather}
          />
          <StoryDetailerNumberInput
            label="drop size"
            min={1}
            onChange={(value) => onChange({ dropSize: Math.round(value) })}
            value={resolved.dropSize}
          />
          <StoryDetailerNumberInput
            label="cycle"
            max={10}
            min={1}
            onChange={(value) => onChange({ cycle: Math.round(value) })}
            value={resolved.cycle}
          />
          <StoryDetailerBooleanInput
            checked={resolved.guideSizeFor}
            label="guide size for bbox"
            onChange={(value) => onChange({ guideSizeFor: value })}
          />
          <StoryDetailerBooleanInput
            checked={resolved.noiseMask}
            label="noise mask"
            onChange={(value) => onChange({ noiseMask: value })}
          />
          <StoryDetailerBooleanInput
            checked={resolved.forceInpaint}
            label="force inpaint"
            onChange={(value) => onChange({ forceInpaint: value })}
          />
          <StoryDetailerSelectInput
            label="sam hint"
            onChange={(value) => onChange({ samDetectionHint: value as StoryDetailerConfig["samDetectionHint"] })}
            options={COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS}
            value={resolved.samDetectionHint}
          />
          <StoryDetailerNumberInput
            label="sam dilation"
            max={512}
            min={-512}
            onChange={(value) => onChange({ samDilation: Math.round(value) })}
            value={resolved.samDilation}
          />
          <StoryDetailerNumberInput
            label="sam threshold"
            max={1}
            min={0}
            onChange={(value) => onChange({ samThreshold: value })}
            step={0.01}
            value={resolved.samThreshold}
          />
          <StoryDetailerNumberInput
            label="sam bbox expansion"
            max={1000}
            min={0}
            onChange={(value) => onChange({ samBBoxExpansion: Math.round(value) })}
            value={resolved.samBBoxExpansion}
          />
          <StoryDetailerNumberInput
            label="sam mask threshold"
            max={1}
            min={0}
            onChange={(value) => onChange({ samMaskHintThreshold: value })}
            step={0.01}
            value={resolved.samMaskHintThreshold}
          />
          <StoryDetailerSelectInput
            label="sam negative"
            onChange={(value) => onChange({ samMaskHintUseNegative: value as StoryDetailerConfig["samMaskHintUseNegative"] })}
            options={COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS}
            value={resolved.samMaskHintUseNegative}
          />
          <StoryDetailerTextAreaInput
            label="wildcard"
            onChange={(value) => onChange({ wildcard: value })}
            value={resolved.wildcard}
          />
        </div>
      </details>
    </div>
  );
}

function StoryDetailerPanel({
  detailer,
  idPrefix,
  kind,
  label,
  onChange,
  onEdit,
}: {
  detailer: StoryDetailerConfig;
  idPrefix: string;
  kind: StoryDetailerKind;
  label: string;
  onChange: (patch: StoryDetailerPatch) => void;
  onEdit: () => void;
}) {
  const resolved = sanitizeStoryDetailerSettingsSnapshot({
    [kind]: detailer,
  } as Partial<StoryDetailerSettingsSnapshot>)[kind] as Required<StoryDetailerConfig>;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex min-w-0 items-start gap-2 text-xs font-semibold text-slate-800">
        <input
          checked={resolved.enabled}
          className="mt-0.5 size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
          id={`${idPrefix}-enabled`}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          type="checkbox"
        />
        <span className="grid min-w-0 gap-1">
          <span>{label}</span>
          <span className="truncate text-[11px] font-normal text-slate-500">
            {resolved.detectorModelName} - {resolved.steps} steps - CFG {resolved.cfg} - {resolved.samplerName}/{resolved.scheduler}
          </span>
        </span>
      </label>
      <button
        className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        data-testid={`${idPrefix}-settings`}
        onClick={onEdit}
        type="button"
      >
        <Settings className="size-3.5" />
        Settings
      </button>
    </div>
  );
}

function StoryDetailerSettingsDialog({
  detailer,
  idPrefix,
  kind,
  label,
  onChange,
  onClose,
  open,
  parameterLabel,
}: {
  detailer: StoryDetailerConfig;
  idPrefix: string;
  kind: StoryDetailerKind;
  label: string;
  onChange: (patch: StoryDetailerPatch) => void;
  onClose: () => void;
  open: boolean;
  parameterLabel: string;
}) {
  const resolved = sanitizeStoryDetailerSettingsSnapshot({
    [kind]: detailer,
  } as Partial<StoryDetailerSettingsSnapshot>)[kind] as Required<StoryDetailerConfig>;

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div
        aria-modal="true"
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{label} settings</h3>
            <p className="mt-1 truncate text-xs text-slate-500">
              {resolved.detectorModelName} - {resolved.steps} steps - CFG {resolved.cfg}
            </p>
          </div>
          <button
            aria-label={`Close ${label} settings`}
            className="rounded-full bg-white p-1.5 text-slate-400 shadow-sm transition hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <StoryDetailerControls
            idPrefix={idPrefix}
            onChange={onChange}
            parameterLabel={parameterLabel}
            resolved={resolved}
          />
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button
            className="inline-flex h-8 items-center justify-center rounded-md bg-slate-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GenerationDetailerSettingsEditor({
  detailers,
  disabled = false,
  idPrefix = "story",
  onChange,
}: {
  detailers: StoryDetailerSettingsSnapshot;
  disabled?: boolean;
  idPrefix?: string;
  onChange: (detailers: StoryDetailerSettingsSnapshot) => void;
}) {
  const [editingDetailer, setEditingDetailer] = useState<StoryDetailerKind | null>(null);

  function patchDetailer(kind: StoryDetailerKind, patch: StoryDetailerPatch) {
    if (disabled) {
      return;
    }

    onChange(
      sanitizeStoryDetailerSettingsSnapshot({
        ...detailers,
        [kind]: {
          ...detailers[kind],
          ...patch,
        },
      }),
    );
  }

  return (
    <fieldset
      className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Detailers</legend>
      <StoryDetailerPanel
        detailer={detailers.faceDetailer}
        idPrefix={`${idPrefix}-face-detailer`}
        kind="faceDetailer"
        label="FaceDetailer"
        onChange={(patch) => patchDetailer("faceDetailer", patch)}
        onEdit={() => {
          if (!disabled) {
            setEditingDetailer("faceDetailer");
          }
        }}
      />
      <StoryDetailerPanel
        detailer={detailers.handDetailer}
        idPrefix={`${idPrefix}-hand-detailer`}
        kind="handDetailer"
        label="HandDetailer"
        onChange={(patch) => patchDetailer("handDetailer", patch)}
        onEdit={() => {
          if (!disabled) {
            setEditingDetailer("handDetailer");
          }
        }}
      />
      <StoryDetailerSettingsDialog
        detailer={detailers.faceDetailer}
        idPrefix={`${idPrefix}-face-detailer`}
        kind="faceDetailer"
        label="FaceDetailer"
        onChange={(patch) => patchDetailer("faceDetailer", patch)}
        onClose={() => setEditingDetailer(null)}
        open={!disabled && editingDetailer === "faceDetailer"}
        parameterLabel="face"
      />
      <StoryDetailerSettingsDialog
        detailer={detailers.handDetailer}
        idPrefix={`${idPrefix}-hand-detailer`}
        kind="handDetailer"
        label="HandDetailer"
        onChange={(patch) => patchDetailer("handDetailer", patch)}
        onClose={() => setEditingDetailer(null)}
        open={!disabled && editingDetailer === "handDetailer"}
        parameterLabel="hand"
      />
    </fieldset>
  );
}

function StoryNodeErrorNotice({ node }: { node: StoryWorkflowNodeResult }) {
  if (!node.error && node.status !== "error") {
    return null;
  }

  const isBlocked = node.status === "blocked";
  const title = node.status === "error" ? "Node failed" : isBlocked ? "Node blocked" : "Node status needs review";
  const message = node.error?.message ?? `This node is currently ${formatStatusLabel(node.status)}.`;
  const code = node.error?.code;

  return (
    <div
      className={cn(
        "mb-3 rounded-md border p-3 text-xs leading-relaxed",
        isBlocked ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-700",
      )}
      data-testid="story-node-error"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {code ? <p className="mt-1 font-mono text-[11px] uppercase opacity-80">{code}</p> : null}
    </div>
  );
}

async function postStoryWorkflow(
  url: string,
  body: unknown,
  fallbackMessage: string,
): Promise<StoryWorkflowState> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message
      : fallbackMessage;
    throw new Error(message);
  }

  if (!isRecord(payload) || !isRecord(payload.workflow)) {
    throw new Error(fallbackMessage);
  }

  return payload.workflow as unknown as StoryWorkflowState;
}

type StoryPlanningStreamEvent =
  | {
      nodeId?: StoryWorkflowNodeId;
      type: "workflow";
      workflow: StoryWorkflowState;
    }
  | {
      type: "done";
      workflow: StoryWorkflowState;
    }
  | {
      error?: {
        message?: string;
      };
      type: "error";
    };

async function postStoryWorkflowStream({
  body,
  fallbackMessage,
  onUpdate,
  url,
}: {
  body: unknown;
  fallbackMessage: string;
  onUpdate: (workflow: StoryWorkflowState, nodeId?: StoryWorkflowNodeId) => void;
  url: string;
}): Promise<StoryWorkflowState> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, fallbackMessage));
  }

  const contentType = response.headers?.get("content-type") ?? "";
  if (!response.body || !contentType.includes("application/x-ndjson")) {
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || !isRecord(payload.workflow)) {
      throw new Error(fallbackMessage);
    }

    return payload.workflow as unknown as StoryWorkflowState;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestWorkflow: StoryWorkflowState | null = null;

  function handleLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const event = JSON.parse(line) as StoryPlanningStreamEvent;
    if (event.type === "error") {
      throw new Error(event.error?.message ?? fallbackMessage);
    }

    latestWorkflow = event.workflow;
    if (event.type === "workflow") {
      onUpdate(event.workflow, event.nodeId);
    } else {
      onUpdate(event.workflow);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        handleLine(line);
      }
    }

    if (done) {
      break;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    handleLine(buffer);
  }

  if (!latestWorkflow) {
    throw new Error(fallbackMessage);
  }

  return latestWorkflow;
}

function isStoryExecutionState(value: unknown): value is StoryShotGraphExecutionState {
  return isRecord(value) && Array.isArray(value.shots) && typeof value.status === "string";
}

function isStoryResultDisplay(value: unknown): value is StoryResultDisplay {
  return isRecord(value) && Array.isArray(value.finalReferences) && typeof value.status === "string";
}

function getStoryExecutionImageUrl(reference: StoryShotGraphExecutionState["shots"][number]["resultReference"]) {
  return reference?.storedImage?.url ?? reference?.storedImages?.[0]?.url ?? "";
}

function getStoryReferenceImageLabel(reference: StoryShotGraphExecutionState["shots"][number]["resultReference"]) {
  return reference?.storedImage?.filename ?? reference?.storedImages?.[0]?.filename ?? reference?.image?.filename ?? "No stored image";
}

function isStoryResourcePlan(value: unknown): value is StoryResourcePlan {
  return isRecord(value) && isRecord(value.checkpoint) && Array.isArray(value.loras);
}

function isStoryRenderPlan(value: unknown): value is StoryRenderPlan {
  return isRecord(value) && typeof value.storyId === "string" && Array.isArray(value.shots);
}

function getStoryResultSelectedResources(workflow: StoryWorkflowState): SelectedCivitaiResourcesPreview {
  const resourcePlan = workflow.nodes["resource-plan"].result;

  if (!isStoryResourcePlan(resourcePlan)) {
    return EMPTY_SELECTED_CIVITAI_RESOURCES;
  }

  return getSelectedStoryResourcesForPrompting(resourcePlan);
}

function getStoryResultDrafts(workflow: StoryWorkflowState): Map<string, GenerationDraft> {
  const renderPlan = workflow.nodes["story-render-plan"].result;
  const resourcePlan = workflow.nodes["resource-plan"].result;

  if (!isStoryRenderPlan(renderPlan) || !isStoryResourcePlan(resourcePlan)) {
    return new Map();
  }

  try {
    const batch = createStoryExecutionRequestBatch({
      mode: "final",
      renderPlan,
      resourcePlan,
    });

    return new Map(batch.requests.map((request) => [request.shotId, toDraft(request.request)]));
  } catch {
    return new Map();
  }
}

function toResultImageReference(
  image: NonNullable<StoryResultDisplay["finalReferences"][number]["image"]>,
  storedImage?: ResultDisplayTimelineResult["storedImage"],
): ResultDisplayTimelineResult["image"] {
  return {
    ...image,
    url: storedImage?.url ?? image.url,
  };
}

function toResultSourceImageReference(
  image: NonNullable<StoryResultDisplay["finalReferences"][number]["image"]>,
): ResultDisplayTimelineResult["sourceImage"] {
  return {
    filename: image.filename,
    nodeId: image.nodeId,
    ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
    ...(image.type !== undefined ? { type: image.type } : {}),
  };
}

function toStoryTimelineResult(
  reference: StoryResultDisplay["finalReferences"][number],
): ResultDisplayTimelineResult | null {
  const firstImage = reference.image ?? reference.images?.[0];
  const firstStoredImage = reference.storedImage ?? reference.storedImages?.[0];

  if (!firstImage || !firstStoredImage) {
    return null;
  }

  const rawImages = reference.images?.length ? reference.images : [firstImage];
  const storedImages = reference.storedImages?.length ? reference.storedImages : [firstStoredImage];
  const images = rawImages.map((image, index) => toResultImageReference(image, storedImages[index] ?? firstStoredImage));

  return {
    completed: reference.completed,
    image: images[0] ?? toResultImageReference(firstImage, firstStoredImage),
    images,
    promptId: reference.promptId,
    sourceImage: toResultSourceImageReference(firstImage),
    sourceImages: rawImages.map(toResultSourceImageReference),
    storedImage: firstStoredImage,
    storedImages,
    warnings: [...reference.warnings],
  };
}

function getGenerationGateReady(workflow: StoryWorkflowState | null) {
  const gate = workflow?.nodes["generation-gate"];
  return gate?.status === "done" && isRecord(gate.result) && gate.result.ready === true;
}

function canConfirmStoryGeneration(workflow: StoryWorkflowState | null) {
  if (!workflow || workflow.generationConfirmed || !getGenerationGateReady(workflow)) {
    return false;
  }

  const executionNode = workflow.nodes["shot-graph-execution"];

  return executionNode.status === "blocked" && executionNode.error?.code === "confirmation_required";
}

function getStoryWorkflowRequest(workflow: StoryWorkflowState) {
  const input = workflow.nodes["story-input"].result;
  return isRecord(input) && typeof input.rawIntent === "string" ? input.rawIntent : "";
}

function getStoryWorkflowPromptProfile(workflow: StoryWorkflowState): PromptProfileId {
  const input = workflow.nodes["story-input"].result;
  const settingsSnapshot = isRecord(input) ? input.settingsSnapshot : undefined;

  return coercePromptProfileId(
    isRecord(settingsSnapshot) && typeof settingsSnapshot.promptProfile === "string"
      ? settingsSnapshot.promptProfile
      : undefined,
  );
}

function getStoryWorkflowShotCount(workflow: StoryWorkflowState) {
  const input = workflow.nodes["story-input"].result;
  const targetShotCount = isRecord(input) ? input.targetShotCount : undefined;

  return typeof targetShotCount === "number" && Number.isFinite(targetShotCount) ? targetShotCount : 1;
}

function getStoryStyleReferenceCapabilityForStart({
  promptProfile,
  selectedCheckpoint,
}: {
  promptProfile: PromptProfileId;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
}) {
  return getStoryStyleReferenceCapability({
    baseModel: selectedCheckpoint?.baseModel ?? promptProfile,
    modelFileName: selectedCheckpoint?.modelFileName,
    name: selectedCheckpoint?.name,
  });
}

function StoryStyleReferenceNumberInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-indigo-200 bg-white px-2 text-xs text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        max={1}
        min={0}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
        step={0.01}
        type="number"
        value={value}
      />
    </label>
  );
}

function StoryStyleReferencePanel({
  draft,
  ipAdapter,
  nsfwEnabled,
  onDraftChange,
  onIpAdapterChange,
  promptProfile,
  selectedCheckpoint,
  selectedCheckpointId,
}: {
  draft: StoryStyleReferenceDraft;
  ipAdapter: StoryStyleReferenceIpAdapterSettings;
  nsfwEnabled: boolean;
  onDraftChange: (draft: StoryStyleReferenceDraft) => void;
  onIpAdapterChange: (settings: StoryStyleReferenceIpAdapterSettings) => void;
  promptProfile: PromptProfileId;
  selectedCheckpoint: SelectedCivitaiResourcesPreview["checkpoint"];
  selectedCheckpointId?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const capability = getStoryStyleReferenceCapabilityForStart({
    promptProfile,
    selectedCheckpoint,
  });
  const busy = draft.status === "uploading" || draft.status === "analyzing";
  const hasReference = draft.status !== "empty";
  const promptOnly = capability.mode !== "ipadapter";

  async function analyzeStoredReference({
    dataUrl,
    fileInfo,
    metadata,
  }: {
    dataUrl: string;
    fileInfo: StoryStyleReferenceFileInfo;
    metadata: StoryStyleReferenceMetadata;
  }) {
    const analysisContext = getStoryStyleReferenceAnalysisContext({
      promptProfile,
      selectedCheckpoint,
      selectedCheckpointId,
    });

    onDraftChange({
      analysisContext,
      dataUrl,
      fileInfo,
      metadata,
      status: "analyzing",
    });

    const analysis = await completeStoryStyleReferenceAnalysis({
      dataUrl,
      fileInfo,
      nsfwEnabled,
      promptProfile,
    });

    onDraftChange({
      analysis,
      analysisContext,
      dataUrl,
      fileInfo,
      metadata,
      status: "ready",
    });
  }

  async function handleFileChange(file: File | undefined) {
    if (!file) {
      return;
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      onDraftChange({
        error: "Story style reference must be a PNG, JPEG, or WEBP image.",
        fileInfo: {
          byteLength: file.size,
          contentType: file.type || "application/octet-stream",
          name: file.name,
        },
        status: "error",
      });
      return;
    }

    const fileInfo = {
      byteLength: file.size,
      contentType: file.type || "image/png",
      name: file.name,
    };

    onDraftChange({
      fileInfo,
      status: "uploading",
    });

    let nextDataUrl: string | undefined;
    let nextMetadata: StoryStyleReferenceMetadata | undefined;

    try {
      nextDataUrl = await readFileAsDataUrl(file);
      nextMetadata = await uploadStoryStyleReferenceImage({
        dataUrl: nextDataUrl,
        fileInfo: {
          ...fileInfo,
          contentType: fileInfo.contentType || getDataUrlContentType(nextDataUrl),
        },
      });
      await analyzeStoredReference({
        dataUrl: nextDataUrl,
        fileInfo: {
          ...fileInfo,
          contentType: nextMetadata.contentType,
        },
        metadata: nextMetadata,
      });
    } catch (styleError) {
      onDraftChange({
        dataUrl: nextDataUrl,
        error: styleError instanceof Error ? styleError.message : "Story style reference failed.",
        fileInfo,
        metadata: nextMetadata,
        status: "error",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleRetry() {
    if (!draft.dataUrl || !draft.metadata || !draft.fileInfo) {
      onDraftChange({
        ...draft,
        error: "Reupload the Story style reference before retrying analysis.",
        status: "error",
      });
      return;
    }

    try {
      await analyzeStoredReference({
        dataUrl: draft.dataUrl,
        fileInfo: draft.fileInfo,
        metadata: draft.metadata,
      });
    } catch (styleError) {
      onDraftChange({
        ...draft,
        error: styleError instanceof Error ? styleError.message : "Story style reference analysis failed.",
        status: "error",
      });
    }
  }

  function patchIpAdapter(patch: Partial<StoryStyleReferenceIpAdapterSettings>) {
    onIpAdapterChange(sanitizeStoryStyleReferenceIpAdapterSettings({
      ...ipAdapter,
      ...patch,
    }));
  }

  return (
    <section className="rounded-md border border-indigo-100 bg-white p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Style reference</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Optional global style image for every Story shot.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md border border-indigo-200 bg-white px-3 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
            {hasReference ? "Replace" : "Upload"}
            <input
              accept={storyStyleReferenceAccept}
              className="sr-only"
              disabled={busy}
              onChange={(event) => void handleFileChange(event.target.files?.[0])}
              ref={fileInputRef}
              type="file"
            />
          </label>
          {hasReference ? (
            <button
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => onDraftChange(emptyStoryStyleReferenceDraft)}
              type="button"
            >
              <X className="size-3.5" />
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          {capability.reason}
        </div>

        {draft.status === "empty" ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
            No Story style reference selected.
          </div>
        ) : null}

        {busy ? (
          <div className="flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            <LoaderCircle className="size-3.5 animate-spin" />
            {draft.status === "uploading" ? "Uploading style reference..." : "Analyzing style reference..."}
          </div>
        ) : null}

        {draft.status === "error" ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700">
            <p>{draft.error ?? "Story style reference is invalid."}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50"
                onClick={() => void handleRetry()}
                type="button"
              >
                <RefreshCw className="size-3.5" />
                Retry
              </button>
              <button
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => onDraftChange(emptyStoryStyleReferenceDraft)}
                type="button"
              >
                <X className="size-3.5" />
                Remove
              </button>
            </div>
          </div>
        ) : null}

        {draft.status === "ready" && draft.analysis ? (
          <div className="grid gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-relaxed">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-emerald-800">
                {draft.metadata?.filename ?? draft.metadata?.storedFilename ?? "Style reference"} analyzed
              </span>
              <span className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium uppercase text-emerald-700">
                {promptOnly ? "Prompt-only" : "IPAdapter"}
              </span>
            </div>
            <p className="text-slate-700">{draft.analysis.summary}</p>
            <p className="rounded-md border border-emerald-100 bg-white p-2 text-slate-700">
              {draft.analysis.stylePrompt}
            </p>
          </div>
        ) : null}

        {draft.status === "ready" && capability.mode === "ipadapter" ? (
          <div className="grid gap-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StoryStyleReferenceNumberInput
                label="weight"
                onChange={(value) => patchIpAdapter({ weight: value })}
                value={ipAdapter.weight}
              />
              <StoryStyleReferenceNumberInput
                label="start_at"
                onChange={(value) => patchIpAdapter({ startPercent: value })}
                value={ipAdapter.startPercent}
              />
              <StoryStyleReferenceNumberInput
                label="end_at"
                onChange={(value) => patchIpAdapter({ endPercent: value })}
                value={ipAdapter.endPercent}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StartPanel({
  nsfwEnabled,
  onStart,
}: {
  nsfwEnabled: boolean;
  onStart: (request: StoryGraphStartRequest) => void;
}) {
  const [rawIntent, setRawIntent] = useState("");
  const [targetShotCount, setTargetShotCount] = useState("");
  const [img2imgDenoise, setImg2ImgDenoise] = useState(String(DEFAULT_STORY_IMG2IMG_DENOISE));
  const [promptProfile, setPromptProfile] = useState<PromptProfileId>(defaultPromptProfileId);
  const [detailers, setDetailers] = useState<StoryDetailerSettingsSnapshot>(() => createStoryDetailerSettingsSnapshot());
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);
  const [selectedLoraIds, setSelectedLoraIds] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_CIVITAI_RESOURCES);
  const [savedParameters, setSavedParameters] = useState<SavedComfyUiGenerationParams | null>(null);
  const [styleReferenceDraft, setStyleReferenceDraft] =
    useState<StoryStyleReferenceDraft>(emptyStoryStyleReferenceDraft);
  const [styleReferenceIpAdapter, setStyleReferenceIpAdapter] =
    useState<StoryStyleReferenceIpAdapterSettings>({ ...STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS });
  const [styleAdvice, setStyleAdvice] = useState<StylePaletteAdviceState>(EMPTY_STYLE_PALETTE_ADVICE);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<StoryInputAiAction | null>(null);
  const [error, setError] = useState("");
  const canEditStyleParameters = Boolean(selectedCheckpointId);

  async function handleStoryInputAi(action: StoryInputAiAction) {
    const currentStoryRequest = rawIntent.trim();

    if (action === "rewrite" && !currentStoryRequest) {
      setError("Add a story request before asking AI to rewrite it.");
      return;
    }

    setError("");
    setAiStatus(action);

    try {
      const nextStoryRequest = await completeStoryInputAi({
        action,
        nsfwEnabled,
        promptProfile,
        storyRequest: currentStoryRequest,
      });
      setRawIntent(nextStoryRequest);
    } catch (inputError) {
      setError(inputError instanceof Error ? inputError.message : "Story input AI request failed.");
    } finally {
      setAiStatus(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rawIntent.trim()) {
      setError("Story request is required.");
      return;
    }

    let styleReference: StoryStyleReferenceSnapshot | undefined;

    if (styleReferenceDraft.status === "uploading" || styleReferenceDraft.status === "analyzing") {
      setError("Finish analyzing the Story style reference or remove it before starting planning.");
      return;
    }

    if (styleReferenceDraft.status === "error") {
      setError("Retry or remove the Story style reference before starting planning.");
      return;
    }

    if (styleReferenceDraft.status === "ready") {
      if (!styleReferenceDraft.metadata || !styleReferenceDraft.analysis) {
        setError("Story style reference metadata or analysis is missing. Retry or remove the reference.");
        return;
      }

      const analysisMismatch = getStoryStyleReferenceAnalysisMismatch(
        styleReferenceDraft,
        getStoryStyleReferenceAnalysisContext({
          promptProfile,
          selectedCheckpoint: selectedResources.checkpoint,
          selectedCheckpointId,
        }),
      );

      if (analysisMismatch) {
        setStyleReferenceDraft({
          ...styleReferenceDraft,
          error: analysisMismatch,
          status: "error",
        });
        setError(analysisMismatch);
        return;
      }

      const capability = getStoryStyleReferenceCapabilityForStart({
        promptProfile,
        selectedCheckpoint: selectedResources.checkpoint,
      });
      styleReference = createStoryStyleReferenceSnapshot({
        analysis: styleReferenceDraft.analysis,
        capturedAt: new Date().toISOString(),
        checkpointBaseModel: selectedResources.checkpoint?.baseModel ?? promptProfile,
        checkpointId: selectedCheckpointId,
        ipAdapter: styleReferenceIpAdapter,
        metadata: styleReferenceDraft.metadata,
        mode: capability.mode,
        modeReason: capability.reason,
        promptProfile,
      });

      if (styleReference.status !== "ready") {
        setError(styleReference.error ?? "Story style reference is invalid. Retry or remove the reference.");
        return;
      }
    }

    setError("");
    onStart(
      createClientStartRequest({
        checkpointId: selectedCheckpointId,
        detailers,
        img2imgDenoise,
        loraIds: selectedLoraIds,
        nsfwEnabled,
        promptProfile,
        rawIntent,
        savedParameters,
        styleReference,
        targetShotCount,
      }),
    );
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-4.5rem)] w-full max-w-7xl px-4 py-4">
      <form
        className="grid min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Start Story Graph</h2>
            <p className="mt-1 text-xs text-slate-500">Create an inspectable in-memory story planning workflow.</p>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <div className="grid min-h-0 gap-4">
              <label className="flex min-h-0 flex-col gap-1 text-xs font-medium text-slate-700">
                <span className="flex items-center justify-between gap-3">
                  Story request
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={aiStatus !== null || !rawIntent.trim()}
                      onClick={() => void handleStoryInputAi("rewrite")}
                      type="button"
                    >
                      <RefreshCw className="size-3.5" />
                      Rewrite
                    </button>
                    <button
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={aiStatus !== null}
                      onClick={() => void handleStoryInputAi("suggest")}
                      type="button"
                    >
                      <Bot className="size-3.5" />
                      Suggest
                    </button>
                  </span>
                </span>
                <textarea
                  className="min-h-40 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 xl:min-h-[20rem]"
                  onChange={(event) => setRawIntent(event.target.value)}
                  placeholder="A short comic scene, storyboard sequence, or visual story beat..."
                  value={rawIntent}
                />
              </label>

              <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">Core settings</h3>
                <div className="grid gap-3 md:grid-cols-[minmax(0,12rem)_8rem_10rem]">
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                    Base model
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      onChange={(event) => setPromptProfile(normalizePromptProfileId(event.target.value))}
                      value={promptProfile}
                    >
                      {promptProfileIds.map((profile) => (
                        <option key={profile} value={profile}>
                          {formatPromptProfileLabel(profile)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                    Shots
                    <input
                      id="story-target-shot-count"
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      min={1}
                      max={24}
                      onChange={(event) => setTargetShotCount(event.target.value)}
                      placeholder="Auto"
                      type="number"
                      value={targetShotCount}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                    Img2img denoise
                    <input
                      id="story-img2img-denoise"
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      max={1}
                      min={0}
                      onBlur={(event) => setImg2ImgDenoise(String(normalizeStoryImg2ImgDenoise(event.target.value)))}
                      onChange={(event) => setImg2ImgDenoise(event.target.value)}
                      step={0.01}
                      type="number"
                      value={img2imgDenoise}
                    />
                  </label>
                </div>
              </section>
            </div>

            <div className="grid min-h-0 content-start gap-4">
              <GenerationDetailerSettingsEditor detailers={detailers} onChange={setDetailers} />

              <StoryStyleReferencePanel
                draft={styleReferenceDraft}
                ipAdapter={styleReferenceIpAdapter}
                nsfwEnabled={nsfwEnabled}
                onDraftChange={setStyleReferenceDraft}
                onIpAdapterChange={setStyleReferenceIpAdapter}
                promptProfile={promptProfile}
                selectedCheckpoint={selectedResources.checkpoint}
                selectedCheckpointId={selectedCheckpointId}
              />

              <section className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Style resources / parameters
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Optional manual checkpoint, LoRA, and generation settings for this planning run.
                    </p>
                  </div>
                  <button
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-indigo-200 bg-white px-3 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!canEditStyleParameters}
                    onClick={() => setParametersOpen(true)}
                    title={
                      canEditStyleParameters
                        ? "Edit Story style parameters"
                        : "Select a checkpoint before editing Story style parameters"
                    }
                    type="button"
                  >
                    Parameters
                  </button>
                </div>
                <StylePaletteCivitaiResourceSelector
                  onSelectedResourcesChange={setSelectedResources}
                  onSelectionChange={(selection) => {
                    setSelectedCheckpointId(selection.checkpointId);
                    setSelectedLoraIds(selection.loraIds);
                    setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
                    setSavedParameters(null);
                    setStyleAdvice(EMPTY_STYLE_PALETTE_ADVICE);
                    setParametersOpen(false);
                  }}
                  pickerLayout="dialog"
                  selectedCheckpointId={selectedCheckpointId}
                  selectedLoraIds={selectedLoraIds}
                />
                {savedParameters ? (
                  <p className="mt-2 rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs leading-relaxed text-emerald-700">
                    Saved parameters: {savedParameters.width}x{savedParameters.height}, {savedParameters.steps} steps, CFG{" "}
                    {savedParameters.cfg}, {savedParameters.samplerName}/{savedParameters.scheduler}
                    {savedParameters.seedMode === "fixed" ? `, fixed seed ${savedParameters.seed}` : ", random seed"}
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          ) : (
            <span className="hidden text-xs text-slate-500 sm:block">Ready to start Story planning.</span>
          )}
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
            type="submit"
          >
            <Play className="size-3.5" />
            Start planning
          </button>
        </div>
        <ComfyUiGenerationDialog
          activePrompt={rawIntent || "Story Graph planning style parameter preview"}
          advice={styleAdvice.result}
          allowControlNet={false}
          allowDiagnosis={false}
          allowInpaint={false}
          baseNegativePrompt=""
          description="Save Story Graph generation parameters without submitting a ComfyUI test generation."
          introContent={
            <StylePaletteAiAdvicePanel
              advice={styleAdvice}
              emptyMessage="Advice uses only the selected Civitai resources for this Story planning run."
              onAdviceChange={setStyleAdvice}
              resources={selectedResources}
            />
          }
          onClose={() => setParametersOpen(false)}
          onSaveParameters={(parameters) => {
            setSavedParameters(parameters);
            setParametersOpen(false);
          }}
          open={parametersOpen && canEditStyleParameters}
          parametersOnly
          promptRefreshKey={[
            rawIntent,
            selectedCheckpointId ?? "",
            selectedLoraIds.join(","),
          ].join("\u0000")}
          savedParameters={savedParameters}
          selectedCheckpointId={selectedCheckpointId}
          selectedLoraIds={selectedLoraIds}
          title="Story style parameters"
        />
      </form>
    </section>
  );
}

function StoryExecutionPanel({
  busy,
  execution,
  onRegenerateShot,
  onSelectShot,
  selectedShotId,
}: {
  busy: boolean;
  execution: StoryShotGraphExecutionState;
  onRegenerateShot: (shotId: string) => void;
  onSelectShot: (shotId: string) => void;
  selectedShotId: string | null;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="story-execution-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shot execution</h3>
          <p className="mt-1 text-xs text-slate-600">
            {execution.status} / {execution.shots.length} shots
          </p>
        </div>
        <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
          {execution.updatedAt ?? "not run"}
        </span>
      </div>
      <div className="grid gap-2">
        {execution.shots.map((shot) => {
          const selected = shot.shotId === selectedShotId;
          const imageUrl = getStoryExecutionImageUrl(shot.resultReference);
          const imageLabel = getStoryReferenceImageLabel(shot.resultReference);

          return (
            <article
              className={cn(
                "rounded-md border bg-white p-3",
                selected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200",
              )}
              data-selected={selected ? "true" : "false"}
              key={shot.shotId}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    className="text-left text-xs font-semibold text-slate-900 underline-offset-2 hover:underline"
                    onClick={() => onSelectShot(shot.shotId)}
                    type="button"
                  >
                    {shot.shotId}
                  </button>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Sources: {shot.sourceShotIds.join(", ") || "none"}
                  </p>
                </div>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
                  {shot.status}
                </span>
              </div>
              {shot.resultReference?.image ? (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                  <ImageIcon className="size-3.5" />
                  {imageUrl ? (
                    <a className="break-all text-blue-700 underline-offset-2 hover:underline" href={imageUrl} target="_blank" rel="noreferrer">
                      {imageLabel}
                    </a>
                  ) : (
                    <span className="break-all">{imageLabel}</span>
                  )}
                </div>
              ) : null}
              {shot.error ? (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                  {shot.error.message}
                </div>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                  onClick={() => {
                    onSelectShot(shot.shotId);
                    onRegenerateShot(shot.shotId);
                  }}
                  type="button"
                >
                  <RefreshCw className="size-3.5" />
                  Regenerate shot
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoryResultGrid({
  result,
  workflow,
}: {
  result: StoryResultDisplay;
  workflow: StoryWorkflowState;
}) {
  const draftByShotId = useMemo(() => getStoryResultDrafts(workflow), [workflow]);
  const selectedResources = useMemo(() => getStoryResultSelectedResources(workflow), [workflow]);

  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="story-result-grid">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final result grid</h3>
          <p className="mt-1 text-xs text-slate-600">
            {result.status} / {result.finalReferences.length} rendered references
          </p>
        </div>
        <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
          {result.nsfwContext.enabled ? "nsfw enabled" : "safe context"}
        </span>
      </div>
      <div className={cn("grid gap-3", result.finalReferences.length > 1 ? "2xl:grid-cols-2" : "")}>
        {result.finalReferences.map((reference) => {
          const timelineResult = toStoryTimelineResult(reference);
          const draft = draftByShotId.get(reference.shotId) ?? null;

          return (
            <article className="rounded-md border border-slate-200 bg-white p-3" key={reference.shotId}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">{reference.shotId}</p>
                  <p className="mt-1 break-all text-[11px] text-slate-500">
                    {reference.storedImage?.filename ?? reference.storedImages?.[0]?.filename ?? reference.image?.filename ?? "No stored image"}
                  </p>
                </div>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
                  {reference.completed ? "complete" : "partial"}
                </span>
              </div>
              <TimelineResultDisplayWorkspace
                draft={draft}
                emptyState="This story shot has no stored generated image."
                generatedImageAlt={(_, index) =>
                  index === 0 ? `Generated ${reference.shotId}` : `Generated ${reference.shotId} image ${index + 1}`}
                generatedImageCaption={(_, index, total) =>
                  total > 1 ? `${reference.shotId} image ${index + 1} of ${total}` : `${reference.shotId} generated image`}
                inpaintClientIdPrefix={`story-inpaint-${reference.shotId}`}
                itemIdPrefix={`story-${reference.shotId}`}
                key={`${reference.shotId}:${reference.promptId}:${reference.storedImage?.filename ?? ""}`}
                result={timelineResult}
                selectedResources={selectedResources}
                testId="story-result-workspace"
              />
            </article>
          );
        })}
      </div>
      {result.errors.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          {result.errors.map((error) => error.message).join(" ")}
        </div>
      ) : null}
    </section>
  );
}

export function StoryPlanningPreview() {
  const [workflow, setWorkflow] = useState<StoryWorkflowState | null>(null);
  const [workflowProjectId, setWorkflowProjectId] = useState<string | null>(null);
  const [workflowProjectName, setWorkflowProjectName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<StoryWorkflowNodeId>("story-input");
  const [selectedStoryShotId, setSelectedStoryShotId] = useState<string | null>(null);
  const [outputDisplayModes, setOutputDisplayModes] = useState<StoryOutputDisplayModeMap>({});
  const [artifactEditorState, setArtifactEditorState] = useState({ key: "", open: false });
  const [settingsNsfwEnabled, setSettingsNsfwEnabled] = useState(false);
  const [settingsAutoReviewEnabled, setSettingsAutoReviewEnabled] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const [planningStatus, setPlanningStatus] = useState<"idle" | "planning" | "generating" | "regenerating">("idle");
  const [, setAutosaveStatus] = useState<StoryAutosaveStatus>("idle");
  const [, setAutosaveMessage] = useState("");
  const autosaveTimeoutRef = useRef<number | null>(null);
  const autosaveVersionRef = useRef(0);
  const restoreVersionRef = useRef(0);
  const latestAutosaveInputRef = useRef<TimelineWorkflowRecordInput | null>(null);
  const isMountedRef = useRef(true);
  const selectedNode = workflow?.nodes[selectedNodeId];
  const metadata = storyWorkflowDefinition.metadata[selectedNodeId];
  const selectedOutputDisplayMode: StoryOutputDisplayMode = outputDisplayModes[selectedNodeId] ?? "visual";
  const artifactEditorKey = `${selectedNodeId}:${selectedOutputDisplayMode}`;
  const artifactEditorOpen = artifactEditorState.key === artifactEditorKey && artifactEditorState.open;
  const rawJson = useMemo(
    () => JSON.stringify(selectedNode?.result ?? selectedNode?.error ?? {}, null, 2),
    [selectedNode],
  );
  const selectedIndex = planningNodeIds.indexOf(selectedNodeId) + 1;
  const selectedDependencies = storyWorkflowDefinition.dependencyDag[selectedNodeId];

  const getCurrentStoryWorkflowRecordInput = useCallback((
    overrides: Partial<Omit<TimelineWorkflowRecordInput, "workflow">> = {},
  ): TimelineWorkflowRecordInput | null => {
    if (!workflow) {
      return null;
    }

    const nextProjectId = "projectId" in overrides ? overrides.projectId : workflowProjectId;
    const nextProjectName = "name" in overrides ? overrides.name : workflowProjectName;

    return {
      ...(nextProjectId ? { projectId: nextProjectId } : {}),
      ...(nextProjectName ? { name: nextProjectName } : {}),
      workflow,
      sceneRequest: overrides.sceneRequest ?? getStoryWorkflowRequest(workflow),
      selectedPromptProfile: overrides.selectedPromptProfile ?? getStoryWorkflowPromptProfile(workflow),
      selectedImageCount: overrides.selectedImageCount ?? getStoryWorkflowShotCount(workflow),
      selectedNodeId: overrides.selectedNodeId ?? selectedNodeId,
      selectedStoryShotId: overrides.selectedStoryShotId ?? selectedStoryShotId,
      outputDisplayModes: overrides.outputDisplayModes ?? outputDisplayModes,
    };
  }, [
    outputDisplayModes,
    selectedNodeId,
    selectedStoryShotId,
    workflow,
    workflowProjectId,
    workflowProjectName,
  ]);

  function applyStoryWorkflowRecord(
    record: TimelineWorkflowRecord,
    message: string,
    options: { saveActive?: boolean } = {},
  ) {
    if (!isStoryGraphTimelineWorkflowRecord(record)) {
      setPlanningError("Open single-image workflow records from the Run page.");
      return;
    }

    const recordInput: TimelineWorkflowRecordInput = {
      ...(record.projectId ? { projectId: record.projectId } : {}),
      ...(record.name ? { name: record.name } : {}),
      workflow: record.workflow,
      sceneRequest: record.sceneRequest,
      selectedPromptProfile: record.selectedPromptProfile,
      selectedImageCount: record.selectedImageCount,
      selectedNodeId: record.selectedNodeId,
      selectedStoryShotId: record.selectedStoryShotId ?? null,
      outputDisplayModes: record.outputDisplayModes,
    };

    latestAutosaveInputRef.current = recordInput;
    setWorkflow(record.workflow);
    setWorkflowProjectId(record.projectId ?? null);
    setWorkflowProjectName(record.name ?? "");
    setSelectedNodeId(record.selectedNodeId);
    setSelectedStoryShotId(record.selectedStoryShotId ?? null);
    setOutputDisplayModes(record.outputDisplayModes as StoryOutputDisplayModeMap);
    setPlanningError("");
    setAutosaveStatus("saved");
    setAutosaveMessage(message || (record.name ? `Restored ${record.name}.` : `Restored ${record.workflow.workflowId}.`));

    if (options.saveActive) {
      void saveActiveTimelineWorkflowRecord(recordInput).catch((error) => {
        console.error("[SceneForge] [story] failed to update active workflow after opening named workflow", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to save the active Story Graph workflow.");
      });
    }
  }

  function flushLatestStoryAutosave() {
    const input = latestAutosaveInputRef.current;
    if (!input) {
      return;
    }

    void saveActiveTimelineWorkflowRecord(input).catch((error) => {
      console.error("[SceneForge] [story] failed to flush active workflow autosave", { error });
    });
  }

  function clearPendingStoryAutosave() {
    autosaveVersionRef.current += 1;
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }

  function handleCurrentNamedWorkflowDeleted() {
    const autosaveInput = getCurrentStoryWorkflowRecordInput({
      projectId: null,
      name: null,
    });

    setWorkflowProjectId(null);
    setWorkflowProjectName("");
    setAutosaveStatus("saved");
    setAutosaveMessage("Current Story Graph workflow is now an unnamed autosaved draft.");

    if (autosaveInput) {
      latestAutosaveInputRef.current = autosaveInput;
      clearPendingStoryAutosave();
      void saveActiveTimelineWorkflowRecord(autosaveInput).catch((error) => {
        console.error("[SceneForge] [story] failed to save unnamed active workflow after named delete", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to save the active Story Graph workflow.");
      });
    }
  }

  function handleNewStoryWorkflow() {
    clearPendingStoryAutosave();
    restoreVersionRef.current += 1;
    latestAutosaveInputRef.current = null;
    setWorkflow(null);
    setWorkflowProjectId(null);
    setWorkflowProjectName("");
    setSelectedNodeId("story-input");
    setSelectedStoryShotId(null);
    setOutputDisplayModes({});
    setPlanningError("");
    setAutosaveStatus("idle");
    setAutosaveMessage("");

    void deleteActiveTimelineWorkflowRecord().catch((error) => {
      console.error("[SceneForge] [story] failed to clear active workflow", { error });
      setAutosaveStatus("error");
      setAutosaveMessage(error instanceof Error ? error.message : "Unable to clear the active Story Graph workflow.");
    });
  }

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
      flushLatestStoryAutosave();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const restoreVersion = restoreVersionRef.current;

    void loadActiveTimelineWorkflowRecord()
      .then((record) => {
        if (
          canceled ||
          restoreVersionRef.current !== restoreVersion ||
          !record ||
          !isStoryGraphTimelineWorkflowRecord(record)
        ) {
          return;
        }

        applyStoryWorkflowRecord(record, "Restored the autosaved Story Graph workflow.");
      })
      .catch((error) => {
        if (canceled || restoreVersionRef.current !== restoreVersion) {
          return;
        }

        console.error("[SceneForge] [story] failed to restore active workflow", { error });
        setAutosaveStatus("error");
        setAutosaveMessage(error instanceof Error ? error.message : "Unable to restore the autosaved Story Graph workflow.");
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!workflow) {
      return;
    }

    const autosaveInput = getCurrentStoryWorkflowRecordInput();
    if (!autosaveInput) {
      return;
    }

    clearPendingStoryAutosave();
    latestAutosaveInputRef.current = autosaveInput;

    const autosaveVersion = autosaveVersionRef.current + 1;
    autosaveVersionRef.current = autosaveVersion;
    autosaveTimeoutRef.current = window.setTimeout(() => {
      setAutosaveStatus("loading");
      setAutosaveMessage("Saving Story Graph workflow...");

      void saveActiveTimelineWorkflowRecord(autosaveInput)
        .then((record) => {
          if (autosaveVersionRef.current !== autosaveVersion || !isMountedRef.current) {
            return;
          }

          setAutosaveStatus("saved");
          setAutosaveMessage(`Autosaved ${record.workflow.workflowId}.`);
        })
        .catch((error) => {
          if (autosaveVersionRef.current !== autosaveVersion || !isMountedRef.current) {
            return;
          }

          console.error("[SceneForge] [story] autosave failed", { error });
          setAutosaveStatus("error");
          setAutosaveMessage(error instanceof Error ? error.message : "Unable to autosave the Story Graph workflow.");
        });
    }, 250);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [getCurrentStoryWorkflowRecordInput, workflow]);

  useEffect(() => {
    if (typeof fetch !== "function") {
      return;
    }

    let active = true;

    void fetch("/api/settings")
      .then((response) => (response.ok ? response.json() as Promise<unknown> : null))
      .then((payload) => {
        if (!active || !payload || typeof payload !== "object") {
          return;
        }

        const settingsPayload = payload as {
          general?: { nsfw?: { supportsNsfw?: boolean } };
          workflow?: { autoReview?: boolean };
        };
        const nsfw = settingsPayload.general?.nsfw;
        setSettingsNsfwEnabled(nsfw?.supportsNsfw === true);
        setSettingsAutoReviewEnabled(settingsPayload.workflow?.autoReview === true);
      })
      .catch(() => {
        if (active) {
          setSettingsNsfwEnabled(false);
          setSettingsAutoReviewEnabled(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleStart(request: StoryGraphStartRequest) {
    setPlanningError("");
    restoreVersionRef.current += 1;
    setWorkflowProjectId(null);
    setWorkflowProjectName("");
    setSelectedNodeId("story-input");
    setSelectedStoryShotId(null);
    setOutputDisplayModes({});
    setPlanningStatus("planning");

    try {
      const initialStart = createStoryGraphInputWorkflow(request);
      setWorkflow(initialStart.workflow);
      const promptProfile = normalizePromptProfileId(request.settingsSnapshot?.promptProfile);
      const settingsSnapshot = {
        ...(isRecord(request.settingsSnapshot) ? request.settingsSnapshot : {}),
        promptProfile,
      };
      const planned = await postStoryWorkflowStream({
        url: "/api/agent-timeline/story/run-planning",
        body: {
          rawIntent: request.rawIntent,
          storyId: initialStart.input.storyId,
          targetShotCount: request.targetShotCount,
          nsfwEnabled: request.nsfwEnabled,
          settingsSnapshot,
          workflowId: initialStart.workflow.workflowId,
        },
        fallbackMessage: "Story Graph planning failed.",
        onUpdate: (updatedWorkflow, nodeId) => {
          setWorkflow(updatedWorkflow);
          if (nodeId) {
            setSelectedNodeId(nodeId);
          }
        },
      });
      setWorkflow(planned);
      if (canConfirmStoryGeneration(planned)) {
        setSelectedNodeId(settingsAutoReviewEnabled ? "shot-graph-execution" : "generation-gate");
        if (settingsAutoReviewEnabled) {
          await handleConfirmGeneration(planned);
        }
      }
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Story Graph planning failed.");
    } finally {
      setPlanningStatus("idle");
    }
  }

  async function handleConfirmGeneration(targetWorkflow: StoryWorkflowState | null = workflow) {
    if (!targetWorkflow || !canConfirmStoryGeneration(targetWorkflow)) {
      return;
    }

    setPlanningError("");
    setPlanningStatus("generating");

    try {
      const generated = await postStoryWorkflow("/api/agent-timeline/story/confirm-generation", {
        workflow: targetWorkflow,
      }, "Story Graph generation failed.");
      const execution = isStoryExecutionState(generated.nodes["shot-graph-execution"].result)
        ? generated.nodes["shot-graph-execution"].result
        : null;
      setWorkflow(generated);
      setSelectedNodeId("shot-graph-execution");
      setSelectedStoryShotId(execution?.shots[0]?.shotId ?? selectedStoryShotId);
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Story Graph generation failed.");
    } finally {
      setPlanningStatus("idle");
    }
  }

  async function handleRegenerateShot(shotId: string) {
    if (!workflow) {
      return;
    }

    setPlanningError("");
    setSelectedStoryShotId(shotId);
    setPlanningStatus("regenerating");

    try {
      const regenerated = await postStoryWorkflow("/api/agent-timeline/story/regenerate-shot", {
        workflow,
        shotId,
      }, "Story Graph shot regeneration failed.");
      setWorkflow(regenerated);
      setSelectedNodeId("shot-graph-execution");
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Story Graph shot regeneration failed.");
    } finally {
      setPlanningStatus("idle");
    }
  }

  function handleSave(nodeId: StoryWorkflowNodeId, result: unknown, scope: StoryManualEditScope) {
    setWorkflow((current) =>
      current
        ? setStoryNodeManualResult(current, nodeId, result, {
            scope,
          })
        : current,
    );
  }

  const generationCanBeConfirmed = canConfirmStoryGeneration(workflow);
  const executionResult = isStoryExecutionState(workflow?.nodes["shot-graph-execution"].result)
    ? workflow?.nodes["shot-graph-execution"].result
    : null;
  const storyResult = isStoryResultDisplay(workflow?.nodes["story-result-display"].result)
    ? workflow?.nodes["story-result-display"].result
    : null;
  const actionBusy = planningStatus !== "idle";

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className={storyHeaderClassName}>
        <div className={storyHeaderPrimaryClassName}>
          <div className={storyHeaderIdentityClassName}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
              <Workflow className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="break-words text-sm font-bold text-slate-900">SceneForge</h1>
              <p className="break-words text-[11px] text-slate-500">
                {workflow ? "User-started planning workflow" : "Story input / start workflow"}
              </p>
            </div>
          </div>
        </div>
        <div className={storyHeaderProjectClassName}>
          <TimelineWorkflowProjectMenu
            currentProjectId={workflowProjectId}
            currentProjectName={workflowProjectName}
            disabled={actionBusy}
            getCurrentRecordInput={getCurrentStoryWorkflowRecordInput}
            onDeleteCurrentProject={handleCurrentNamedWorkflowDeleted}
            onRecordOpened={(record) => {
              restoreVersionRef.current += 1;
              applyStoryWorkflowRecord(record, "Opened saved Story Graph workflow.", { saveActive: true });
            }}
            onRecordSaved={(record) => applyStoryWorkflowRecord(record, "Saved Story Graph workflow.")}
            workflowMode="story-graph"
          />
        </div>

        <div className={storyHeaderActionsClassName}>
          <button className={headerLinkClassName} onClick={handleNewStoryWorkflow} type="button">
            <RefreshCw className="size-3.5" />
            New story
          </button>
          <nav aria-label="Workspace mode" className={storyHeaderNavClassName}>
            <Link aria-label="Open Run workspace" className={storyHeaderNavLinkClassName} href="/" title="Open Run workspace">
              <Workflow className="size-3.5" />
              <span className="hidden sm:inline">Run</span>
            </Link>
            <span aria-current="page" className={storyHeaderNavCurrentClassName}>
              <GitBranch className="size-3.5" />
              <span className="hidden sm:inline">Story</span>
            </span>
            <Link aria-label="Open settings" className={storyHeaderNavLinkClassName} href="/settings" title="Open settings">
              <Settings className="size-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </nav>
        </div>
      </header>

      {!workflow || !selectedNode ? (
        <>
          {planningError ? (
            <div className="mx-auto mt-4 w-full max-w-4xl rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {planningError}
            </div>
          ) : null}
          <StartPanel nsfwEnabled={settingsNsfwEnabled} onStart={(request) => void handleStart(request)} />
        </>
      ) : (
        <div className="sf-agent-workbench flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <aside className="sf-agent-workbench__nav custom-scrollbar touch-scroll-region order-2 min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-3 lg:order-1 lg:w-72 lg:flex-[0_0_18rem] lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</h2>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                {planningNodeIds.length} steps
              </span>
            </div>
            <nav className="relative flex flex-col gap-1.5">
              <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 w-px bg-slate-200" />
              {planningNodeIds.map((nodeId) => {
                const node = workflow.nodes[nodeId];
                const nodeMetadata = storyWorkflowDefinition.metadata[nodeId];
                const selected = selectedNodeId === nodeId;

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
                    onClick={() => setSelectedNodeId(nodeId)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ring-4 ring-white",
                        getStoryNodeStatusTone(node.status),
                      )}
                    >
                      {node.status === "running" ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        planningNodeIds.indexOf(nodeId) + 1
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <GitBranch className="size-3.5 shrink-0 text-slate-400" />
                        <span className="break-words text-xs font-semibold text-slate-900">{nodeMetadata.title}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="break-words text-[11px] text-slate-500">{nodeMetadata.manualEdit.label}</span>
                        <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                          {formatStatusLabel(node.status)}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="sf-agent-workbench__workspace custom-scrollbar touch-scroll-region order-1 min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 lg:order-2">
            <div className="mx-auto flex max-w-5xl flex-col gap-4">
              <article className="flex min-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                <header className="border-b border-slate-100 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Step {selectedIndex} / {planningNodeIds.length}
                      </p>
                      <h2 className="mt-1 text-base font-semibold text-slate-950">{metadata.title}</h2>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{metadata.manualEdit.label}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
                      {selectedNode.status === "running" ? (
                        <LoaderCircle className="size-3.5 animate-spin text-indigo-500" />
                      ) : selectedNode.status === "manual" ? (
                        <CheckCircle2 className="size-3.5 text-violet-500" />
                      ) : (
                        <CircleDot className="size-3.5" />
                      )}
                      {formatStatusLabel(selectedNode.status)}
                    </span>
                  </div>
                </header>

                <div className="flex flex-1 flex-col gap-4 p-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Input</p>
                      <p className="mt-2 text-xs leading-relaxed text-slate-700">
                        {selectedDependencies.length > 0 ? selectedDependencies.join(", ") : "Story request"}
                      </p>
                    </div>
                    <div className="hidden items-center justify-center text-slate-300 md:flex">/</div>
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transform</p>
                      <p className="mt-2 text-xs leading-relaxed text-slate-700">Story Graph planning action</p>
                    </div>
                    <div className="hidden items-center justify-center text-slate-300 md:flex">/</div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Output</p>
                      <p className="mt-2 text-xs leading-relaxed text-slate-700">{metadata.workspace.key}</p>
                    </div>
                  </div>

                  {selectedNodeId === "generation-gate" ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                      <div className="flex min-w-0 gap-2">
                        <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                        <p>
                          Shot graph execution requires confirmation. The Story workflow stops here until you start shot
                          generation.
                        </p>
                      </div>
                      <button
                        className={storyGateConfirmButtonClassName}
                        disabled={!generationCanBeConfirmed || actionBusy}
                        onClick={() => void handleConfirmGeneration()}
                        type="button"
                      >
                        <Play className="size-3.5" />
                        {planningStatus === "generating" ? "Generating" : "Start shot generation"}
                      </button>
                    </div>
                  ) : null}

                  <div className="flex min-h-[36rem] flex-1 flex-col rounded-md border border-slate-200 bg-white p-3">
                    {planningError ? (
                      <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                        {planningError}
                      </div>
                    ) : null}
                    <StoryNodeErrorNotice node={selectedNode} />
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Step output</p>
                      <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                        {(["visual", "json"] as const).map((mode) => (
                          <button
                            className={cn(
                              "h-7 rounded px-2 text-[11px] font-medium uppercase transition-colors",
                              selectedOutputDisplayMode === mode
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-800",
                            )}
                            key={mode}
                            onClick={() =>
                              setOutputDisplayModes((current) => ({
                                ...current,
                                [selectedNodeId]: mode,
                              }))
                            }
                            type="button"
                          >
                            {mode === "visual" ? "Visual" : "Raw JSON"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {selectedOutputDisplayMode === "json" ? (
                      <pre className="min-h-96 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                        {rawJson}
                      </pre>
                    ) : (
                      <>
                        <StoryNodeOutputSummaryView nodeId={selectedNodeId} result={selectedNode.result} />
                        <details
                          className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3"
                          onToggle={(event) =>
                            setArtifactEditorState({
                              key: artifactEditorKey,
                              open: event.currentTarget.open,
                            })
                          }
                          open={artifactEditorOpen}
                        >
                          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                            Edit artifact
                          </summary>
                          {artifactEditorOpen ? (
                            <div className="mt-3">
                              <StoryPlanningWorkspace
                                editable
                                emptyState="This story artifact has not been generated yet."
                                key={`${selectedNodeId}:${selectedNode.updatedAt}`}
                                node={selectedNode}
                                onSave={handleSave}
                                storyId={workflow.storyId}
                              />
                            </div>
                          ) : null}
                        </details>
                        {selectedNodeId === "shot-graph-execution" && executionResult ? (
                          <div className="mt-4">
                            <StoryExecutionPanel
                              busy={actionBusy}
                              execution={executionResult}
                              onRegenerateShot={(shotId) => void handleRegenerateShot(shotId)}
                              onSelectShot={setSelectedStoryShotId}
                              selectedShotId={selectedStoryShotId}
                            />
                          </div>
                        ) : null}
                        {selectedNodeId === "story-result-display" && storyResult ? (
                          <div className="mt-4">
                            <StoryResultGrid result={storyResult} workflow={workflow} />
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                  <span>Source: {selectedNode.source}</span>
                  <span>Workspace: {metadata.workspace.key}</span>
                  <span>Updated: {selectedNode.updatedAt}</span>
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
                  <dd className="text-right font-medium text-slate-800">{formatStatusLabel(selectedNode.status)}</dd>
                  <dt className="text-slate-500">Source</dt>
                  <dd className="text-right font-medium text-slate-800">{selectedNode.source}</dd>
                  <dt className="text-slate-500">Workflow</dt>
                  <dd className="break-all text-right font-medium text-slate-800">{workflow.workflowId}</dd>
                  <dt className="text-slate-500">Mode</dt>
                  <dd className="text-right font-medium text-slate-800">{workflow.workflowMode}</dd>
                </dl>
              </section>

              {selectedOutputDisplayMode === "json" ? (
                <section className="rounded-md border border-slate-200 bg-white">
                  <header className="border-b border-slate-100 px-3 py-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Raw JSON</h2>
                  </header>
                  <div className="p-3">
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                      {rawJson}
                    </pre>
                  </div>
                </section>
              ) : null}

              <section className="rounded-md border border-slate-200 bg-white">
                <header className="border-b border-slate-100 px-3 py-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual scope</h2>
                </header>
                <div className="p-3 text-xs leading-relaxed text-slate-600">
                  {selectedNode.manualEdit ? (
                    <>
                      <p>Scope: {selectedNode.manualEdit.scope.kind}</p>
                      {"shotId" in selectedNode.manualEdit.scope ? <p>Shot: {selectedNode.manualEdit.scope.shotId}</p> : null}
                      <p>Stale nodes: {selectedNode.manualEdit.staleNodeIds.join(", ") || "none"}</p>
                      <p>Stale shots: {selectedNode.manualEdit.staleShotIds.join(", ") || "none"}</p>
                    </>
                  ) : (
                    "No manual edit has been saved for this node."
                  )}
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white">
                <header className="border-b border-slate-100 px-3 py-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tool calls</h2>
                </header>
                <div className="p-3 text-xs leading-relaxed text-slate-500">
                  Story planning runs through the server Story Graph LiteLLM adapters. Shot generation is confirmation-gated and uses the Story ComfyUI shot graph scheduler.
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
