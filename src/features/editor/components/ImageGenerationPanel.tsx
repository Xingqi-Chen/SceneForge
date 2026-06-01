"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eraser,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  Minus,
  Paintbrush,
  Play,
  Plus,
  Save,
  Settings,
  Sparkles,
  Square,
  SquareDashedMousePointer,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import NextImage from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type {
  CivitaiResourceDownloadResult,
  CivitaiResourceDownloadStatus,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import {
  buildBasicTextToImageWorkflow,
  COMFYUI_FACE_DETAILER_DEFAULTS,
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
  COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS,
  COMFYUI_INPAINT_MODE_OPTIONS,
  createComfyUiInpaintPreviewRequest,
  createComfyUiTextToImagePreviewRequest,
  DEFAULT_COMFYUI_ANIMA_CLIP_DEVICE,
  DEFAULT_COMFYUI_ANIMA_CLIP_NAME,
  DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE,
  DEFAULT_COMFYUI_ANIMA_VAE_NAME,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_INPAINT_DENOISE,
  DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY,
  DEFAULT_COMFYUI_INPAINT_MODE,
  MIN_COMFYUI_VAE_INPAINT_DENOISE,
  COMFYUI_LATENT_IMAGE_NODE_OPTIONS,
  getComfyUiPreviewSteps,
  normalizeComfyUiInpaintDenoiseForMode,
  resolveComfyUiTextToImageWorkflowProfile,
  type ComfyUiGeneratedImage,
  type ComfyUiGenerateSam2MaskResponse,
  type ComfyUiInpaintMode,
  type ComfyUiInpaintLocalRegionConfig,
  type ComfyUiInpaintRequest,
  type ComfyUiInpaintUpscaleModelPresetMode,
  type ComfyUiInpaintUpscaleMode,
  type ComfyUiInpaintUpscaleStrategy,
  type ComfyUiInputValue,
  type ComfyUiIpAdapterReferenceMode,
  type ComfyUiPromptHistoryResponse,
  type ComfyUiSam2Bbox,
  type ComfyUiSam2Point,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
import {
  buildComicSequenceStoryboardMessages,
  COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS,
  COMIC_SEQUENCE_STORYBOARD_MIN_SHOTS,
  normalizeComicSequenceStoryboardTargetCount,
  parseComicSequenceStoryboardResponse,
} from "@/features/editor/ai-prompt/comic-sequence-storyboard";
import {
  applyComfyUiGenerationDiagnosisAdjustments,
  buildComfyUiGenerationAdjustmentMessages,
  buildComfyUiGenerationVisualDiagnosisMessages,
  type ComfyUiDiagnosisWebContext,
  parseComfyUiGenerationDiagnosisResponse,
  parseComfyUiGenerationVisualDiagnosisResponse,
  type ComfyUiGenerationDiagnosisAdjustmentScopes,
  type ComfyUiGenerationDiagnosisConfig,
  type ComfyUiGenerationDiagnosisChangeRationale,
  type ComfyUiGenerationDiagnosisResult,
  type ComfyUiGenerationDiagnosisLoraConfig,
  type ComfyUiGenerationVisualDiagnosisResult,
} from "@/features/editor/ai-prompt/comfyui-generation-diagnosis";
import {
  applyComfyUiInpaintDiagnosisAdjustments,
  buildComfyUiInpaintDiagnosisMessages,
  parseComfyUiInpaintDiagnosisResponse,
  type ComfyUiInpaintDiagnosisConfig,
  type ComfyUiInpaintDiagnosisLoraConfig,
  type ComfyUiInpaintDiagnosisMaskShape,
  type ComfyUiInpaintDiagnosisResult,
} from "@/features/editor/ai-prompt/comfyui-inpaint-diagnosis";
import {
  resolveComfyUiGenerationSettings,
  type ComfyUiGenerationLoraSetting,
  type ComfyUiGenerationParameterSource,
} from "@/features/editor/ai-prompt/comfyui-generation-params";
import { mergeDraftWithPromptRefresh } from "@/features/editor/ai-prompt/comfyui-generation-draft";
import {
  buildComfyUiOptionsFromValues,
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
  normalizeComfyUiSamplerSettings,
} from "@/features/editor/ai-prompt/comfyui-generation-options";
import type { CivitaiAiPromptResult } from "@/features/editor/ai-prompt/civitai-ai-context";
import {
  buildIllustriousComicSequencePrompt,
  mergeNegativePrompts,
} from "@/features/editor/ai-prompt/illustrious-prompt";
import {
  buildAnimaComicSequencePrompt,
  isAnimaPromptContext,
  mergeAnimaNegativePrompts,
} from "@/features/editor/ai-prompt/anima-prompt";
import {
  findMaskAlphaBounds,
  padAndAlignLocalRegion,
  resolveInpaintLocalRegion,
  type InpaintLocalRegionRect,
} from "@/features/editor/inpaint-local-region";
import {
  createComicSequenceSavedPreviousShotResults,
  createComicSequenceImageFromSavedImage,
  createFullImageMaskDataUrl,
  findComicSequencePreviousShotSource,
  getComfyUiGeneratedImageReferenceKey,
  PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY,
  promoteComicSequenceResultImage,
  resolveComicSequencePreviousShotAction,
  type ComicSequencePreviousShotSource,
} from "@/features/editor/comic-sequence-previous-shot";
import {
  planComicSequenceGeneration,
  type ComicSequenceSubmitMode,
} from "@/features/editor/comic-sequence-generation";
import {
  applyComicSequenceShotSettingsPatchToSequence,
  bindComicSequenceShotImageIds,
  type ComicSequenceShotSettingsPatch,
} from "@/features/editor/comic-sequence-shot-settings";
import {
  buildComfyUiControlNetOpenPosePreview,
  type ComfyUiControlNetOpenPosePreview,
} from "@/features/editor/ai-prompt/comfyui-controlnet-preview";
import {
  renderComfyUiNormalControlImage,
  type ComfyUiNormalControlImagePreview,
} from "@/features/editor/ai-prompt/comfyui-normal-control-image";
import {
  getComfyUiGenerationDownloadReadiness,
  isComfyUiGenerationResourceReady,
  shouldDownloadComfyUiGenerationResource,
  type ComfyUiGenerationDownloadReadiness,
} from "@/features/editor/ai-prompt/comfyui-generation-downloads";
import {
  createComfyUiGenerationSeed,
  getInitialComfyUiGenerationSeedMode,
  MAX_COMFYUI_GENERATION_IMAGE_COUNT,
  normalizeComfyUiGenerationImageCount,
  resolveComfyUiGenerationSeed,
  type ComfyUiGenerationSeedMode,
} from "@/features/editor/ai-prompt/comfyui-generation-seed";
import { saveProject } from "@/features/persistence";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import { generatePrompt } from "@/features/prompt-engine";
import type {
  SavedComicSequence,
  SavedComicSequencePreviousShotReference,
  SavedComicSequenceReferenceChannelParams,
  SavedComicSequenceReferenceParams,
  SavedComicSequenceControlNetParams,
  SavedComicSequenceReferenceImage,
  SavedComicSequenceShot,
  SavedComfyUiGeneratedImage,
  SavedComfyUiGeneratedImageSource,
  SavedComfyUiGeneratedImageStorage,
  SavedComfyUiImageReference,
  SavedComfyUiGenerationParams,
  PromptModelFormat,
  Scene,
  SceneForgeProject,
} from "@/shared/types";

type LoadStatus = "idle" | "loading" | "success" | "error";
type SubmitStatus = "idle" | "loading" | "success" | "error";
type GenerationSubmitMode = "full" | "preview";
type DownloadActionStatus = "idle" | "loading" | "success" | "error";
type DiagnosisStatus = "idle" | "analyzing" | "searching" | "suggesting" | "success" | "error";
type InpaintMaskTool = "brush" | "eraser" | "sam-positive" | "sam-negative" | "sam-box";
type SamMaskStatus = "idle" | "generating" | "success" | "error";

type ComfyUiOption = {
  label: string;
  value: string;
};

type ControlNetModelOption = {
  label: string;
  value: string;
};

type ControlNetModelsResponse = {
  modelPath: string;
  models: ControlNetModelOption[];
};

type InpaintModelUpscaleOption = {
  available: boolean;
  label: string;
  mode: ComfyUiInpaintUpscaleModelPresetMode;
  modelName: string;
};

type UpscaleModelsResponse = {
  models: string[];
  modelUpscaleOptions: InpaintModelUpscaleOption[];
};

type KSamplerOptionsResponse = {
  samplers: string[];
  schedulers: string[];
};

type GenerationHistoryContext = {
  draftSnapshot: GenerationDraft;
  negativePrompt: string;
  parentImageId?: string;
  positivePrompt: string;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
};

type GenerationResult = {
  characterReferenceIds?: string[];
  historyContext: GenerationHistoryContext;
  imageCount: number;
  images: ComfyUiGeneratedImage[];
  promptId: string;
  number?: number;
  outputNodeId: string;
  sequenceId?: string;
  seed: number;
  shotId?: string;
  shotNumber?: number;
  shotTitle?: string;
  source: SavedComfyUiGeneratedImageSource;
};

type GeneratedImageItem = {
  createdAt?: string;
  favorited: boolean;
  historyId?: string;
  id: string;
  image: ComfyUiGeneratedImage;
  localFilename?: string;
  persisted: boolean;
  promptId?: string;
  resultSource: SavedComfyUiGeneratedImageSource;
  sessionGenerated: boolean;
  sourceReference?: SavedComfyUiImageReference;
  storage?: SavedComfyUiGeneratedImageStorage;
  seed: number;
};

type GeneratedImageFilter = "all" | "favorites" | "session";

type GenerationProgress = {
  value: number;
  max: number;
  node?: string;
};

type SavedGeneratedImageResponse = {
  byteLength: number;
  contentType: string;
  filename: string;
  sourceDeletion?: {
    attempted: boolean;
    deleted: boolean;
    error?: string;
    reason?: string;
  };
  url: string;
};

type GenerationDraftLora = Required<NonNullable<ComfyUiTextToImageRequest["loras"]>[number]> & {
  enabled: boolean;
};

type GenerationDraftControlNetUnit = {
  type: "openpose" | "depth" | "normal";
  enabled: boolean;
  modelName: string;
  strength: number;
  startPercent: number;
  endPercent: number;
  svg: string;
  imageDataUrl: string;
  imageName: string;
};

type GenerationDraftControlNets = {
  depth: GenerationDraftControlNetUnit;
  normal: GenerationDraftControlNetUnit;
  openpose: GenerationDraftControlNetUnit;
};

type GenerationDraftInpaint = {
  brushSize: number;
  denoise: number;
  growMaskBy: number;
  mode: ComfyUiInpaintMode;
};

type GenerationDraft = Required<Omit<
  ComfyUiTextToImageRequest,
  | "loras"
  | "promptWrapper"
  | "faceDetailer"
  | "handDetailer"
  | "controlNet"
  | "controlNets"
  | "characterReferences"
  | "preview"
  | "workflowProfile"
  | "modelBaseModel"
  | "modelStorageKind"
  | "clipName"
  | "clipDevice"
  | "vaeName"
  | "unetWeightDtype"
>> & {
  workflowProfile?: ComfyUiTextToImageRequest["workflowProfile"];
  modelBaseModel?: ComfyUiTextToImageRequest["modelBaseModel"];
  modelStorageKind?: ComfyUiTextToImageRequest["modelStorageKind"];
  clipName?: ComfyUiTextToImageRequest["clipName"];
  clipDevice?: ComfyUiTextToImageRequest["clipDevice"];
  vaeName?: ComfyUiTextToImageRequest["vaeName"];
  unetWeightDtype?: ComfyUiTextToImageRequest["unetWeightDtype"];
  loras: GenerationDraftLora[];
  imageCount: number;
  promptWrapper: Required<NonNullable<ComfyUiTextToImageRequest["promptWrapper"]>>;
  faceDetailer: Required<NonNullable<ComfyUiTextToImageRequest["faceDetailer"]>>;
  handDetailer: Required<NonNullable<ComfyUiTextToImageRequest["handDetailer"]>>;
  controlNets: GenerationDraftControlNets;
  inpaint: GenerationDraftInpaint;
  seedMode: ComfyUiGenerationSeedMode;
};

type ResourceDownloadItem = {
  resource: SelectedCivitaiResourcePreview;
  label: "Checkpoint" | "LoRA";
  status: CivitaiResourceDownloadStatus | null;
  error: string | null;
};

type DiagnosisDiffRow = {
  current: string;
  expectedEffect?: string;
  label: string;
  next: string;
  reason?: string;
  risk?: string;
};

const COMFYUI_TEXT_FIELD_CLASS =
  "h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100";
const COMFYUI_SELECT_FIELD_CLASS =
  `${COMFYUI_TEXT_FIELD_CLASS} w-full appearance-none pr-9`;

const EMPTY_SELECTED_RESOURCES: SelectedCivitaiResourcesPreview = {
  checkpoint: null,
  loras: [],
};
const COMFYUI_HISTORY_POLL_INTERVAL_MS = 2000;
const COMFYUI_HISTORY_POLL_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_INPAINT_MODEL_UPSCALE_OPTIONS = Object.entries(COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS).map(
  ([mode, preset]): InpaintModelUpscaleOption => ({
    available: false,
    label: preset.label,
    mode: mode as ComfyUiInpaintUpscaleModelPresetMode,
    modelName: preset.modelName,
  }),
);
const COMFYUI_PROMPT_WRAPPER_PRESETS = [
  {
    id: "none",
    label: "None",
    negativePrefix: "",
    positivePrefix: "",
  },
  {
    id: "assistant-prompt-start",
    label: "ComfyUI <Prompt Start>",
    negativePrefix: "You are an assistant designed to generate low-quality images based on textual prompts <Prompt Start> ",
    positivePrefix: "You are an assistant designed to generate high quality anime images based on textual prompts. <Prompt Start> ",
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPromptWrapperPresetId(wrapper: { negativePrefix: string; positivePrefix: string }) {
  return COMFYUI_PROMPT_WRAPPER_PRESETS.find(
    (preset) =>
      preset.negativePrefix === wrapper.negativePrefix &&
      preset.positivePrefix === wrapper.positivePrefix,
  )?.id;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    const details = payload.error.details;
    const detailErrors = isRecord(details) && Array.isArray(details.errors)
      ? details.errors.filter((error): error is string => typeof error === "string" && error.trim().length > 0)
      : [];

    if (detailErrors.length > 0) {
      return `${payload.error.message}: ${detailErrors.join("; ")}`;
    }

    return payload.error.message;
  }

  return fallback;
}

function isComfyUiDiagnosisWebContextPayload(value: unknown): value is ComfyUiDiagnosisWebContext {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.queries) &&
    Array.isArray(value.sources) &&
    typeof value.summary === "string" &&
    Array.isArray(value.warnings)
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.statusText || "请求失败。"));
  }

  return payload as T;
}

function useComfyUiKSamplerOptions(open: boolean) {
  const [samplerOptions, setSamplerOptions] = useState<ComfyUiOption[]>(() => [...COMFYUI_SAMPLER_OPTIONS]);
  const [schedulerOptions, setSchedulerOptions] = useState<ComfyUiOption[]>(() => [...COMFYUI_SCHEDULER_OPTIONS]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    void fetchJson<KSamplerOptionsResponse>("/api/comfyui/sampler-options")
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setSamplerOptions(buildComfyUiOptionsFromValues(payload.samplers, COMFYUI_SAMPLER_OPTIONS));
        setSchedulerOptions(buildComfyUiOptionsFromValues(payload.schedulers, COMFYUI_SCHEDULER_OPTIONS));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setSamplerOptions([...COMFYUI_SAMPLER_OPTIONS]);
        setSchedulerOptions([...COMFYUI_SCHEDULER_OPTIONS]);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  return {
    samplerOptions,
    schedulerOptions,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createComfyUiClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `sceneforge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseEventData<T>(event: MessageEvent<string>): T {
  return JSON.parse(event.data) as T;
}

function readComfyUiProgress(value: unknown): GenerationProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const progressValue = typeof record.value === "number" ? record.value : null;
  const progressMax = typeof record.max === "number" ? record.max : null;

  if (progressValue === null || progressMax === null || progressMax <= 0) {
    return null;
  }

  return {
    max: progressMax,
    node: typeof record.node === "string" ? record.node : undefined,
    value: Math.max(0, Math.min(progressMax, progressValue)),
  };
}

function getProgressPercent(progress: GenerationProgress | null) {
  if (!progress) {
    return 0;
  }

  return Math.round((progress.value / progress.max) * 100);
}

function getGeneratedImageReferenceKey(image: Pick<ComfyUiGeneratedImage, "filename" | "nodeId" | "subfolder" | "type">) {
  return getComfyUiGeneratedImageReferenceKey(image);
}

function getGeneratedImageItemKey(item: GeneratedImageItem) {
  return item.id;
}

function getGeneratedImageItemReferenceKey(item: GeneratedImageItem) {
  return [item.promptId ?? "", getGeneratedImageReferenceKey(item.image)].join("\u0000");
}

function getGeneratedImageSessionKey(promptId: string, image: Pick<ComfyUiGeneratedImage, "filename" | "nodeId" | "subfolder" | "type">) {
  return [promptId, getGeneratedImageReferenceKey(image)].join("\u0000");
}

function getSavedGeneratedImageSessionKey(record: SavedComfyUiGeneratedImage) {
  const sourceReference = record.sourceReference ?? record;

  return [
    record.promptId,
    getGeneratedImageReferenceKey({
      filename: sourceReference.filename,
      nodeId: record.nodeId,
      ...(sourceReference.subfolder !== undefined ? { subfolder: sourceReference.subfolder } : {}),
      ...(sourceReference.type !== undefined ? { type: sourceReference.type } : {}),
    }),
  ].join("\u0000");
}

function findSavedGeneratedImageIdsForImages(
  savedImages: SavedComfyUiGeneratedImage[],
  promptId: string,
  images: ComfyUiGeneratedImage[],
) {
  const imageKeys = new Set(images.map((image) => getGeneratedImageSessionKey(promptId, image)));

  return savedImages
    .filter((record) => imageKeys.has(getSavedGeneratedImageSessionKey(record)))
    .map((record) => record.id);
}

function createGeneratedImageHistoryId() {
  return `comfyui-image-${createComfyUiClientId()}`;
}

function toGeneratedImageFromHistory(record: SavedComfyUiGeneratedImage): ComfyUiGeneratedImage {
  return {
    filename: record.filename,
    nodeId: record.nodeId,
    ...(record.subfolder !== undefined ? { subfolder: record.subfolder } : {}),
    ...(record.type !== undefined ? { type: record.type } : {}),
    url: record.url,
  };
}

function historyRecordToGeneratedImageItem(record: SavedComfyUiGeneratedImage): GeneratedImageItem {
  return {
    createdAt: record.createdAt,
    favorited: record.favorited,
    historyId: record.id,
    id: `history:${record.id}`,
    image: toGeneratedImageFromHistory(record),
    ...(record.localFilename ? { localFilename: record.localFilename } : {}),
    persisted: true,
    promptId: record.promptId,
    resultSource: record.source,
    sessionGenerated: false,
    ...(record.sourceReference ? { sourceReference: record.sourceReference } : {}),
    ...(record.storage ? { storage: record.storage } : {}),
    seed: record.seed,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("无法读取当前生成图片。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("无法读取当前生成图片。"));
    reader.readAsDataURL(blob);
  });
}

async function loadOriginalImageUrlToDataUrl(imageUrl: string) {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("无法读取当前生成图片，请确认 ComfyUI 图片仍可访问。");
  }

  return blobToDataUrl(await response.blob());
}

async function waitForComfyUiGeneratedImages(
  clientId: string,
  promptId: string,
  expectedImageCount: number,
  onPoll?: (history: ComfyUiPromptHistoryResponse) => void,
) {
  const pollHistoryUntilComplete = async () => {
    const deadline = Date.now() + COMFYUI_HISTORY_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const history = await fetchJson<ComfyUiPromptHistoryResponse>(
        `/api/comfyui/history/${encodeURIComponent(promptId)}`,
      );
      onPoll?.(history);

      if (history.images.length >= expectedImageCount) {
        return history;
      }

      if (history.completed && history.images.length > 0) {
        return history;
      }

      if (history.completed) {
        throw new Error("ComfyUI 生成已完成，但 history 中没有找到预览输出。");
      }

      await delay(COMFYUI_HISTORY_POLL_INTERVAL_MS);
    }

    throw new Error("等待 ComfyUI 生成结果超时。任务可能仍在 ComfyUI 队列中，请稍后在 ComfyUI history 中查看该 prompt。");
  };

  if (clientId) {
    const params = new URLSearchParams({
      expectedImages: String(expectedImageCount),
      promptId,
    });

    return new Promise<ComfyUiPromptHistoryResponse>((resolve, reject) => {
      const events = new EventSource(`/api/comfyui/events/${encodeURIComponent(clientId)}?${params.toString()}`);
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        events.close();
        callback();
      };

      const fallbackToHistoryPolling = () => {
        finish(() => {
          void pollHistoryUntilComplete().then(resolve, reject);
        });
      };

      events.addEventListener("connected", () => {
        onPoll?.({
          promptId,
          completed: false,
          images: [],
          raw: null,
        });
      });

      events.addEventListener("progress", (event) => {
        onPoll?.({
          promptId,
          completed: false,
          images: [],
          raw: parseEventData(event as MessageEvent<string>),
        });
      });

      events.addEventListener("images", (event) => {
        onPoll?.(parseEventData<ComfyUiPromptHistoryResponse>(event as MessageEvent<string>));
      });

      events.addEventListener("complete", (event) => {
        finish(() => resolve(parseEventData<ComfyUiPromptHistoryResponse>(event as MessageEvent<string>)));
      });

      events.addEventListener("listener-timeout", () => {
        fallbackToHistoryPolling();
      });

      events.addEventListener("comfyui-error", (event) => {
        const payload = parseEventData<{ message?: string; retryable?: boolean }>(event as MessageEvent<string>);
        if (payload.retryable) {
          fallbackToHistoryPolling();
          return;
        }

        finish(() => reject(new Error(payload.message ?? "ComfyUI WebSocket 监听失败。")));
      });

      events.onerror = () => {
        fallbackToHistoryPolling();
      };
    });
  }

  return pollHistoryUntilComplete();
}

function buildSelectedCivitaiResourcesQuery(checkpointId: string | null, loraIds: string[]) {
  const params = new URLSearchParams();

  if (checkpointId) {
    params.set("checkpointId", checkpointId);
  }

  if (loraIds.length > 0) {
    params.set("loraIds", loraIds.join(","));
  }

  return params.toString();
}

function getDownloadableResources(resources: SelectedCivitaiResourcesPreview) {
  const items: Array<{ resource: SelectedCivitaiResourcePreview; label: "Checkpoint" | "LoRA" }> = [];

  if (resources.checkpoint) {
    items.push({ resource: resources.checkpoint, label: "Checkpoint" });
  }

  for (const lora of resources.loras) {
    items.push({ resource: lora, label: "LoRA" });
  }

  return items;
}

async function loadResourceDownloadItems(resources: SelectedCivitaiResourcesPreview): Promise<ResourceDownloadItem[]> {
  return Promise.all(
    getDownloadableResources(resources).map(async (item) => {
      try {
        const status = await fetchJson<CivitaiResourceDownloadStatus>(
          `/api/civitai-lora-library/resources/${encodeURIComponent(item.resource.id)}/download`,
        );

        return { ...item, status, error: null };
      } catch (error) {
        return {
          ...item,
          status: null,
          error: error instanceof Error ? error.message : "无法读取模型下载状态。",
        };
      }
    }),
  );
}

function getResourceDownloadReadiness(item: ResourceDownloadItem): ComfyUiGenerationDownloadReadiness {
  return item.error ? "blocked" : getComfyUiGenerationDownloadReadiness(item.status);
}

function getResourceDownloadStatusLabel(item: ResourceDownloadItem) {
  const readiness = getResourceDownloadReadiness(item);

  if (readiness === "ready") {
    return item.status?.status === "verified" ? "已下载并校验" : "已下载";
  }

  if (readiness === "needs_download") {
    return item.status?.status === "checksum_mismatch" ? "校验不一致，需重新下载" : "未下载";
  }

  if (readiness === "blocked") {
    return "无法下载";
  }

  return "检查中";
}

function getResourceDownloadStatusClass(item: ResourceDownloadItem) {
  const readiness = getResourceDownloadReadiness(item);

  switch (readiness) {
    case "ready":
      return "bg-emerald-50 text-emerald-700";
    case "needs_download":
      return "bg-amber-50 text-amber-700";
    case "blocked":
      return "bg-rose-50 text-rose-700";
    case "checking":
      return "bg-slate-100 text-slate-500";
  }
}

function ResourceDownloadBadge({ item }: { item: ResourceDownloadItem | undefined }) {
  if (!item) {
    return (
      <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-slate-100 px-2.5 text-[10px] font-medium leading-none text-slate-500">
        检查中
      </span>
    );
  }

  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[10px] font-medium leading-none ${getResourceDownloadStatusClass(item)}`}
    >
      {getResourceDownloadStatusLabel(item)}
    </span>
  );
}

function findRequestControlNetUnit(
  request: ComfyUiTextToImageRequest,
  type: GenerationDraftControlNetUnit["type"],
) {
  return request.controlNets?.find((unit) => unit.type === type);
}

function createDraftControlNetUnit(
  request: ComfyUiTextToImageRequest,
  type: GenerationDraftControlNetUnit["type"],
): GenerationDraftControlNetUnit {
  const unit = findRequestControlNetUnit(request, type);
  const legacyOpenPose = type === "openpose" ? request.controlNet : undefined;
  const defaultImageName = type === "depth"
    ? "SceneForgeControlNetDepth.png"
    : type === "normal"
      ? "SceneForgeControlNetNormal.png"
      : "SceneForgeControlNetOpenPose.png";
  const defaultStrength = type === "depth" ? 0.75 : type === "normal" ? 0.7 : 0.85;

  return {
    type,
    enabled: unit?.enabled ?? legacyOpenPose?.enabled ?? false,
    modelName: unit?.modelName ?? legacyOpenPose?.modelName ?? "",
    strength: unit?.strength ?? legacyOpenPose?.strength ?? defaultStrength,
    startPercent: unit?.startPercent ?? legacyOpenPose?.startPercent ?? 0,
    endPercent: unit?.endPercent ?? legacyOpenPose?.endPercent ?? 1,
    svg: "",
    imageDataUrl: "",
    imageName: unit?.imageName ?? legacyOpenPose?.imageName ?? defaultImageName,
  };
}

function createDraftInpaint(savedParameters?: SavedComfyUiGenerationParams | null): GenerationDraftInpaint {
  const savedMode = COMFYUI_INPAINT_MODE_OPTIONS.some((option) => option.value === savedParameters?.inpaint?.mode)
    ? savedParameters?.inpaint?.mode
    : DEFAULT_COMFYUI_INPAINT_MODE;

  return {
    brushSize: 48,
    denoise: typeof savedParameters?.inpaint?.denoise === "number"
      ? Math.min(1, Math.max(0, savedParameters.inpaint.denoise))
      : DEFAULT_COMFYUI_INPAINT_DENOISE,
    growMaskBy: typeof savedParameters?.inpaint?.growMaskBy === "number"
      ? Math.min(512, Math.max(0, Math.round(savedParameters.inpaint.growMaskBy)))
      : DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY,
    mode: savedMode ?? DEFAULT_COMFYUI_INPAINT_MODE,
  };
}

function createDraftDetailer(
  detailer: ComfyUiTextToImageRequest["faceDetailer"] | undefined,
  request: ComfyUiTextToImageRequest,
  samplerSettings: ReturnType<typeof normalizeComfyUiSamplerSettings>,
  defaultDetectorModel: string,
): GenerationDraft["faceDetailer"] {
  return {
    bboxCropFactor: detailer?.bboxCropFactor ?? COMFYUI_FACE_DETAILER_DEFAULTS.bboxCropFactor,
    bboxDilation: detailer?.bboxDilation ?? COMFYUI_FACE_DETAILER_DEFAULTS.bboxDilation,
    bboxThreshold: detailer?.bboxThreshold ?? COMFYUI_FACE_DETAILER_DEFAULTS.bboxThreshold,
    cfg: detailer?.cfg ?? request.cfg ?? 7,
    cycle: detailer?.cycle ?? COMFYUI_FACE_DETAILER_DEFAULTS.cycle,
    denoise: detailer?.denoise ?? COMFYUI_FACE_DETAILER_DEFAULTS.denoise,
    enabled: detailer?.enabled ?? false,
    detectorModelName: detailer?.detectorModelName ?? defaultDetectorModel,
    dropSize: detailer?.dropSize ?? COMFYUI_FACE_DETAILER_DEFAULTS.dropSize,
    feather: detailer?.feather ?? COMFYUI_FACE_DETAILER_DEFAULTS.feather,
    forceInpaint: detailer?.forceInpaint ?? COMFYUI_FACE_DETAILER_DEFAULTS.forceInpaint,
    guideSize: detailer?.guideSize ?? COMFYUI_FACE_DETAILER_DEFAULTS.guideSize,
    guideSizeFor: detailer?.guideSizeFor ?? COMFYUI_FACE_DETAILER_DEFAULTS.guideSizeFor,
    maxSize: detailer?.maxSize ?? COMFYUI_FACE_DETAILER_DEFAULTS.maxSize,
    noiseMask: detailer?.noiseMask ?? COMFYUI_FACE_DETAILER_DEFAULTS.noiseMask,
    samBBoxExpansion: detailer?.samBBoxExpansion ?? COMFYUI_FACE_DETAILER_DEFAULTS.samBBoxExpansion,
    samDetectionHint: detailer?.samDetectionHint ?? COMFYUI_FACE_DETAILER_DEFAULTS.samDetectionHint,
    samDilation: detailer?.samDilation ?? COMFYUI_FACE_DETAILER_DEFAULTS.samDilation,
    samMaskHintThreshold: detailer?.samMaskHintThreshold ?? COMFYUI_FACE_DETAILER_DEFAULTS.samMaskHintThreshold,
    samMaskHintUseNegative: detailer?.samMaskHintUseNegative ?? COMFYUI_FACE_DETAILER_DEFAULTS.samMaskHintUseNegative,
    samThreshold: detailer?.samThreshold ?? COMFYUI_FACE_DETAILER_DEFAULTS.samThreshold,
    samplerName: detailer?.samplerName ?? samplerSettings.samplerName ?? "euler",
    scheduler: detailer?.scheduler ?? samplerSettings.scheduler ?? "normal",
    steps: detailer?.steps ?? request.steps ?? 30,
    wildcard: detailer?.wildcard ?? COMFYUI_FACE_DETAILER_DEFAULTS.wildcard,
  };
}

function toDraft(
  request: ComfyUiTextToImageRequest,
  loraSettings?: ComfyUiGenerationLoraSetting[],
  savedSeedMode?: ComfyUiGenerationSeedMode,
  savedParameters?: SavedComfyUiGenerationParams | null,
): GenerationDraft {
  const samplerSettings = normalizeComfyUiSamplerSettings({
    samplerName: request.samplerName,
    scheduler: request.scheduler,
  });

  return {
    checkpointName: request.checkpointName,
    workflowProfile: request.workflowProfile,
    modelBaseModel: request.modelBaseModel,
    modelStorageKind: request.modelStorageKind,
    clipName: request.clipName,
    clipDevice: request.clipDevice,
    vaeName: request.vaeName,
    unetWeightDtype: request.unetWeightDtype,
    positivePrompt: request.positivePrompt,
    negativePrompt: request.negativePrompt ?? "",
    loras: loraSettings
      ? loraSettings.map((lora) => ({
          enabled: lora.enabled,
          loraName: lora.loraName,
          strengthModel: lora.strengthModel,
          strengthClip: lora.strengthClip,
        }))
      : (request.loras ?? []).map((lora) => ({
      enabled: true,
      loraName: lora.loraName,
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip ?? lora.strengthModel,
    })),
    imageCount: normalizeComfyUiGenerationImageCount(request.batchSize ?? 1),
    width: request.width ?? 1024,
    height: request.height ?? 1024,
    seed: request.seed ?? createComfyUiGenerationSeed(),
    seedMode: savedSeedMode ?? getInitialComfyUiGenerationSeedMode(request),
    steps: request.steps ?? 30,
    cfg: request.cfg ?? 7,
    samplerName: samplerSettings.samplerName ?? "euler",
    scheduler: samplerSettings.scheduler ?? "normal",
    denoise: request.denoise ?? 1,
    batchSize: request.batchSize ?? 1,
    latentImageNode: request.latentImageNode ?? "EmptyLatentImage",
    promptWrapper: {
      positivePrefix: request.promptWrapper?.positivePrefix ?? "",
      negativePrefix: request.promptWrapper?.negativePrefix ?? "",
    },
    outputPrefix: request.outputPrefix ?? "SceneForge",
    controlNets: {
      openpose: createDraftControlNetUnit(request, "openpose"),
      depth: createDraftControlNetUnit(request, "depth"),
      normal: createDraftControlNetUnit(request, "normal"),
    },
    inpaint: createDraftInpaint(savedParameters),
    faceDetailer: createDraftDetailer(
      request.faceDetailer,
      request,
      samplerSettings,
      DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
    ),
    handDetailer: createDraftDetailer(
      request.handDetailer,
      request,
      samplerSettings,
      DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
    ),
  };
}

function trimOptionalModelSetting(value: string | undefined) {
  return value?.trim() || undefined;
}

function toSavedParameters(draft: GenerationDraft): SavedComfyUiGenerationParams {
  const workflowProfile = resolveComfyUiTextToImageWorkflowProfile(draft).id;
  const modelBaseModel = trimOptionalModelSetting(draft.modelBaseModel);
  const isAnimaProfile = workflowProfile === "anima";

  return {
    workflowProfile,
    ...(modelBaseModel ? { modelBaseModel } : {}),
    ...(draft.modelStorageKind ? { modelStorageKind: draft.modelStorageKind } : {}),
    ...(isAnimaProfile
      ? {
          clipName: DEFAULT_COMFYUI_ANIMA_CLIP_NAME,
          clipDevice: DEFAULT_COMFYUI_ANIMA_CLIP_DEVICE,
          vaeName: DEFAULT_COMFYUI_ANIMA_VAE_NAME,
          unetWeightDtype: DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE,
        }
      : {
          ...(trimOptionalModelSetting(draft.clipName) ? { clipName: trimOptionalModelSetting(draft.clipName) } : {}),
          ...(trimOptionalModelSetting(draft.clipDevice) ? { clipDevice: trimOptionalModelSetting(draft.clipDevice) } : {}),
          ...(trimOptionalModelSetting(draft.vaeName) ? { vaeName: trimOptionalModelSetting(draft.vaeName) } : {}),
          ...(trimOptionalModelSetting(draft.unetWeightDtype) ? { unetWeightDtype: trimOptionalModelSetting(draft.unetWeightDtype) } : {}),
        }),
    width: draft.width,
    height: draft.height,
    seed: draft.seed,
    seedMode: draft.seedMode,
    steps: draft.steps,
    cfg: draft.cfg,
    samplerName: draft.samplerName,
    scheduler: draft.scheduler,
    denoise: draft.denoise,
    imageCount: normalizeComfyUiGenerationImageCount(draft.imageCount),
    latentImageNode: draft.latentImageNode,
    promptWrapper: draft.promptWrapper,
    inpaint: {
      denoise: draft.inpaint.denoise,
      growMaskBy: draft.inpaint.growMaskBy,
      mode: draft.inpaint.mode,
    },
    outputPrefix: draft.outputPrefix,
    faceDetailer: draft.faceDetailer,
    handDetailer: draft.handDetailer,
    loras: draft.loras.map((lora) => ({
      loraName: lora.loraName,
      enabled: lora.enabled,
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip,
    })),
    savedAt: new Date().toISOString(),
  };
}

function createComfyUiGeneratedImageRecords({
  draft,
  images,
  negativePrompt,
  parentImageId,
  positivePrompt,
  result,
  savedImage,
  selectedCheckpointId,
  selectedLoraIds,
}: {
  draft: GenerationDraft;
  images: ComfyUiGeneratedImage[];
  negativePrompt: string;
  parentImageId?: string;
  positivePrompt: string;
  result: GenerationResult;
  savedImage: SavedGeneratedImageResponse;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
}): SavedComfyUiGeneratedImage[] {
  if (images.length === 0) {
    return [];
  }

  const createdAt = new Date().toISOString();
  const parameters = toSavedParameters({
    ...draft,
    imageCount: result.imageCount,
    seed: result.seed,
  });
  const batchId = result.number !== undefined
    ? `${result.promptId}:${result.number}`
    : result.promptId;

  return images.map((image) => ({
    id: createGeneratedImageHistoryId(),
    promptId: result.promptId,
    batchId,
    nodeId: image.nodeId,
    filename: image.filename,
    ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
    ...(image.type !== undefined ? { type: image.type } : {}),
    url: savedImage.url,
    seed: result.seed,
    source: result.source,
    storage: "sceneforge",
    localFilename: savedImage.filename,
    sourceReference: {
      filename: image.filename,
      ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
      ...(image.type !== undefined ? { type: image.type } : {}),
    },
    createdAt,
    favorited: false,
    ...(parentImageId ? { parentImageId } : {}),
    ...(result.sequenceId ? { sequenceId: result.sequenceId } : {}),
    ...(result.shotId ? { shotId: result.shotId } : {}),
    ...(result.characterReferenceIds?.length ? { characterReferenceIds: [...result.characterReferenceIds] } : {}),
    outputNodeId: result.outputNodeId,
    width: draft.width,
    height: draft.height,
    positivePrompt,
    negativePrompt,
    parameters,
    selectedCheckpointId,
    selectedLoraIds: [...selectedLoraIds],
  }));
}

function formatSavedImageSourceDeletionMessage(savedImage: SavedGeneratedImageResponse) {
  const sourceDeletion = savedImage.sourceDeletion;
  if (!sourceDeletion?.attempted) {
    return "";
  }

  if (sourceDeletion.deleted) {
    return "ComfyUI 临时文件已清理。";
  }

  return sourceDeletion.error
    ? `但 ComfyUI 临时文件未清理：${sourceDeletion.error}`
    : "但 ComfyUI 临时文件未清理。";
}

function toRequestPayload(
  draft: GenerationDraft,
  seed: number,
  controlNetPreview?: ComfyUiControlNetOpenPosePreview | null,
  normalPreview?: ComfyUiNormalControlImagePreview | null,
): ComfyUiTextToImageRequest {
  const workflowProfile = resolveComfyUiTextToImageWorkflowProfile(draft).id;
  const isAnimaProfile = workflowProfile === "anima";
  const controlNetUnits = [
    {
      draft: draft.controlNets.openpose,
      svg: controlNetPreview?.openPose.svg ?? "",
      imageDataUrl: "",
    },
    {
      draft: draft.controlNets.depth,
      svg: controlNetPreview?.depth.svg ?? "",
      imageDataUrl: "",
    },
    {
      draft: draft.controlNets.normal,
      svg: "",
      imageDataUrl: normalPreview?.imageDataUrl ?? "",
    },
  ].flatMap(({ draft: controlNet, imageDataUrl, svg }) => {
    const previewAvailable = controlNet.type === "normal"
      ? normalPreview?.available
      : controlNetPreview?.available;

    if (!controlNet.enabled || !previewAvailable || (!svg && !imageDataUrl)) {
      return [];
    }

    return [
      {
        type: controlNet.type,
        enabled: true,
        modelName: controlNet.modelName,
        strength: controlNet.strength,
        startPercent: Math.min(controlNet.startPercent, controlNet.endPercent),
        endPercent: Math.max(controlNet.startPercent, controlNet.endPercent),
        svg,
        imageDataUrl,
        imageName: controlNet.imageName,
      },
    ];
  });

  return {
    checkpointName: draft.checkpointName,
    workflowProfile,
    modelBaseModel: draft.modelBaseModel,
    modelStorageKind: draft.modelStorageKind,
    ...(isAnimaProfile ? {} : { clipName: draft.clipName }),
    ...(isAnimaProfile ? {} : { clipDevice: draft.clipDevice }),
    ...(isAnimaProfile ? {} : { vaeName: draft.vaeName }),
    ...(isAnimaProfile ? {} : { unetWeightDtype: draft.unetWeightDtype }),
    positivePrompt: draft.positivePrompt,
    negativePrompt: draft.negativePrompt,
    loras: draft.loras
      .filter((lora) => lora.enabled)
      .map((lora) => ({
        loraName: lora.loraName,
        strengthModel: lora.strengthModel,
        strengthClip: lora.strengthClip,
      })),
    width: draft.width,
    height: draft.height,
    seed,
    steps: draft.steps,
    cfg: draft.cfg,
    samplerName: draft.samplerName,
    scheduler: draft.scheduler,
    denoise: draft.denoise,
    batchSize: draft.imageCount,
    latentImageNode: draft.latentImageNode,
    promptWrapper: draft.promptWrapper,
    outputPrefix: draft.outputPrefix,
    faceDetailer: draft.faceDetailer,
    handDetailer: draft.handDetailer,
    controlNets: controlNetUnits,
  };
}

type InpaintSubmitInput = {
  denoise: number;
  faceDetailer: GenerationDraft["faceDetailer"];
  growMaskBy: number;
  handDetailer: GenerationDraft["handDetailer"];
  image: ComfyUiGeneratedImage;
  maskDataUrl: string;
  mode: ComfyUiInpaintMode;
  negativePrompt: string;
  positivePrompt: string;
  seed: number;
  sourceImageDataUrl?: string;
  upscaleBeforeInpaint: {
    enabled: boolean;
    localRegion?: ComfyUiInpaintLocalRegionConfig;
    mode: ComfyUiInpaintUpscaleMode;
    scaleBy: 2;
    modelName?: string;
    strategy?: ComfyUiInpaintUpscaleStrategy;
  };
};

function toInpaintRequestPayload(draft: GenerationDraft, input: InpaintSubmitInput): ComfyUiInpaintRequest {
  const workflowProfile = resolveComfyUiTextToImageWorkflowProfile(draft).id;
  const isAnimaProfile = workflowProfile === "anima";

  return {
    checkpointName: draft.checkpointName,
    workflowProfile,
    modelBaseModel: draft.modelBaseModel,
    modelStorageKind: draft.modelStorageKind,
    ...(isAnimaProfile ? {} : { clipName: draft.clipName }),
    ...(isAnimaProfile ? {} : { clipDevice: draft.clipDevice }),
    ...(isAnimaProfile ? {} : { vaeName: draft.vaeName }),
    ...(isAnimaProfile ? {} : { unetWeightDtype: draft.unetWeightDtype }),
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt,
    loras: draft.loras
      .filter((lora) => lora.enabled)
      .map((lora) => ({
        loraName: lora.loraName,
        strengthModel: lora.strengthModel,
        strengthClip: lora.strengthClip,
      })),
    seed: input.seed,
    steps: draft.steps,
    cfg: draft.cfg,
    samplerName: draft.samplerName,
    scheduler: draft.scheduler,
    denoise: input.denoise,
    faceDetailer: input.faceDetailer,
    handDetailer: input.handDetailer,
    promptWrapper: draft.promptWrapper,
    outputPrefix: `${draft.outputPrefix}_inpaint`,
    sourceImage: {
      filename: input.image.filename,
      ...(input.image.subfolder !== undefined ? { subfolder: input.image.subfolder } : {}),
      ...(input.image.type !== undefined ? { type: input.image.type } : {}),
    },
    ...(input.sourceImageDataUrl ? { sourceImageDataUrl: input.sourceImageDataUrl } : {}),
    maskDataUrl: input.maskDataUrl,
    inpaintMode: input.mode,
    growMaskBy: input.growMaskBy,
    upscaleBeforeInpaint: input.upscaleBeforeInpaint,
  };
}

function formatSource(source: ComfyUiGenerationParameterSource) {
  if (source === "ai") {
    return "AI 参数";
  }

  if (source === "diagnosis") {
    return "AI 诊断";
  }

  if (source === "saved") {
    return "已保存参数";
  }

  return "参考值";
}

function formatNodeInput(value: ComfyUiInputValue): string {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number") {
    return `node ${value[0]}:${value[1]}`;
  }

  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
  }

  return JSON.stringify(value);
}

function toDiagnosisConfig(
  draft: GenerationDraft,
  resources: SelectedCivitaiResourcesPreview,
  loraSettings: ComfyUiGenerationLoraSetting[],
): ComfyUiGenerationDiagnosisConfig {
  return {
    checkpointBaseModel: resources.checkpoint?.baseModel,
    cfg: draft.cfg,
    checkpointName: draft.checkpointName,
    checkpointPromptReferences: resources.checkpoint?.promptReferences ?? [],
    checkpointResourceName: resources.checkpoint?.name,
    checkpointTags: resources.checkpoint?.tags,
    denoise: draft.denoise,
    height: draft.height,
    imageCount: draft.imageCount,
    loras: draft.loras.map((lora, index): ComfyUiGenerationDiagnosisLoraConfig => {
      const resource = loraSettings[index]?.resource;
      return {
        averageWeight: resource?.averageWeight,
        categories: resource?.categories,
        enabled: lora.enabled,
        loraName: lora.loraName,
        maxWeight: resource?.maxWeight,
        minWeight: resource?.minWeight,
        recommendations: resource?.recommendations,
        resourceName: resource?.name,
        strengthClip: lora.strengthClip,
        strengthModel: lora.strengthModel,
        tags: resource?.tags,
        trainedWords: resource?.trainedWords,
        usageGuide: resource?.usageGuide,
      };
    }),
    negativePrompt: draft.negativePrompt,
    outputPrefix: draft.outputPrefix,
    positivePrompt: draft.positivePrompt,
    samplerName: draft.samplerName,
    scheduler: draft.scheduler,
    seed: draft.seed,
    seedMode: draft.seedMode,
    steps: draft.steps,
    width: draft.width,
  };
}

function toInpaintDiagnosisConfig({
  brushSize,
  denoise,
  draft,
  faceDetailerEnabled,
  growMaskBy,
  handDetailerEnabled,
  imageItem,
  loraSettings,
  mode,
  negativePrompt,
  positivePrompt,
  resources,
  seed,
  sourceSize,
}: {
  brushSize: number;
  denoise: number;
  draft: GenerationDraft;
  faceDetailerEnabled: boolean;
  growMaskBy: number;
  handDetailerEnabled: boolean;
  imageItem: GeneratedImageItem;
  loraSettings: ComfyUiGenerationLoraSetting[];
  mode: ComfyUiInpaintMode;
  negativePrompt: string;
  positivePrompt: string;
  resources: SelectedCivitaiResourcesPreview;
  seed: number;
  sourceSize: { height: number; width: number };
}): ComfyUiInpaintDiagnosisConfig {
  return {
    brushSize,
    checkpointBaseModel: resources.checkpoint?.baseModel,
    checkpointName: draft.checkpointName,
    checkpointPromptReferences: resources.checkpoint?.promptReferences ?? [],
    checkpointResourceName: resources.checkpoint?.name,
    checkpointTags: resources.checkpoint?.tags,
    denoise,
    faceDetailerEnabled,
    growMaskBy,
    handDetailerEnabled,
    image: {
      filename: imageItem.image.filename,
      height: sourceSize.height,
      seed,
      width: sourceSize.width,
    },
    loras: draft.loras.map((lora, index): ComfyUiInpaintDiagnosisLoraConfig => {
      const resource = loraSettings[index]?.resource;
      return {
        averageWeight: resource?.averageWeight,
        categories: resource?.categories,
        enabled: lora.enabled,
        loraName: lora.loraName,
        maxWeight: resource?.maxWeight,
        minWeight: resource?.minWeight,
        recommendations: resource?.recommendations,
        resourceName: resource?.name,
        strengthClip: lora.strengthClip,
        strengthModel: lora.strengthModel,
        tags: resource?.tags,
        trainedWords: resource?.trainedWords,
        usageGuide: resource?.usageGuide,
      };
    }),
    mode,
    negativePrompt,
    positivePrompt,
  };
}

function formatDiffValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "启用" : "禁用";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  }

  return String(value ?? "");
}

function normalizeRationaleKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_.:-]+/g, "");
}

function findChangeRationale(
  rationales: ComfyUiGenerationDiagnosisChangeRationale[],
  candidates: string[],
) {
  const normalizedCandidates = candidates.map(normalizeRationaleKey).filter(Boolean);
  return rationales.find((rationale) => {
    const field = normalizeRationaleKey(rationale.field);
    return normalizedCandidates.some((candidate) => field === candidate || field.includes(candidate) || candidate.includes(field));
  });
}

function addDiffRow(
  rows: DiagnosisDiffRow[],
  label: string,
  current: unknown,
  next: unknown,
  rationale?: ComfyUiGenerationDiagnosisChangeRationale,
) {
  if (next === undefined || formatDiffValue(current) === formatDiffValue(next)) {
    return;
  }

  rows.push({
    current: formatDiffValue(current),
    expectedEffect: rationale?.expectedEffect,
    label,
    next: formatDiffValue(next),
    reason: rationale?.reason,
    risk: rationale?.risk,
  });
}

function buildDiagnosisDiffRows(
  baseConfig: ComfyUiGenerationDiagnosisConfig,
  result: ComfyUiGenerationDiagnosisResult,
) {
  const nextConfig = applyComfyUiGenerationDiagnosisAdjustments(baseConfig, result.adjustments);
  const rows: DiagnosisDiffRow[] = [];
  const rationales = result.changeRationale;

  addDiffRow(rows, "Positive Prompt", baseConfig.positivePrompt, nextConfig.positivePrompt, findChangeRationale(rationales, ["positivePrompt", "prompt"]));
  addDiffRow(rows, "Negative Prompt", baseConfig.negativePrompt, nextConfig.negativePrompt, findChangeRationale(rationales, ["negativePrompt"]));
  addDiffRow(rows, "width", baseConfig.width, nextConfig.width, findChangeRationale(rationales, ["width", "resolution"]));
  addDiffRow(rows, "height", baseConfig.height, nextConfig.height, findChangeRationale(rationales, ["height", "resolution"]));
  addDiffRow(rows, "steps", baseConfig.steps, nextConfig.steps, findChangeRationale(rationales, ["steps"]));
  addDiffRow(rows, "cfg", baseConfig.cfg, nextConfig.cfg, findChangeRationale(rationales, ["cfg", "cfgScale"]));
  addDiffRow(rows, "sampler", baseConfig.samplerName, nextConfig.samplerName, findChangeRationale(rationales, ["samplerName", "sampler"]));
  addDiffRow(rows, "scheduler", baseConfig.scheduler, nextConfig.scheduler, findChangeRationale(rationales, ["scheduler"]));
  addDiffRow(rows, "denoise", baseConfig.denoise, nextConfig.denoise, findChangeRationale(rationales, ["denoise"]));
  addDiffRow(rows, "seed mode", baseConfig.seedMode, nextConfig.seedMode, findChangeRationale(rationales, ["seedMode"]));
  addDiffRow(rows, "seed", baseConfig.seed, nextConfig.seed, findChangeRationale(rationales, ["seed"]));

  for (const nextLora of nextConfig.loras) {
    const currentLora = baseConfig.loras.find((lora) => lora.loraName === nextLora.loraName);
    const label = nextLora.resourceName ?? nextLora.loraName;
    if (!currentLora) {
      continue;
    }

    const loraRationale = findChangeRationale(rationales, [label, nextLora.loraName]);
    addDiffRow(rows, `${label} enabled`, currentLora.enabled, nextLora.enabled, loraRationale);
    addDiffRow(rows, `${label} model`, currentLora.strengthModel, nextLora.strengthModel, loraRationale);
    addDiffRow(rows, `${label} clip`, currentLora.strengthClip, nextLora.strengthClip, loraRationale);
  }

  return rows;
}

function hasModelParameterDiagnosisAdjustments(adjustments: ComfyUiGenerationDiagnosisResult["adjustments"]) {
  return (
    adjustments.cfg !== undefined ||
    adjustments.denoise !== undefined ||
    adjustments.height !== undefined ||
    adjustments.loras !== undefined ||
    adjustments.samplerName !== undefined ||
    adjustments.scheduler !== undefined ||
    adjustments.seed !== undefined ||
    adjustments.seedMode !== undefined ||
    adjustments.steps !== undefined ||
    adjustments.width !== undefined
  );
}

function buildInpaintDiagnosisDiffRows(
  baseConfig: ComfyUiInpaintDiagnosisConfig,
  result: ComfyUiInpaintDiagnosisResult,
) {
  const nextConfig = applyComfyUiInpaintDiagnosisAdjustments(baseConfig, result.adjustments);
  const rows: DiagnosisDiffRow[] = [];
  const rationales = result.changeRationale;

  addDiffRow(rows, "Positive Prompt", baseConfig.positivePrompt, nextConfig.positivePrompt, findChangeRationale(rationales, ["positivePrompt", "prompt"]));
  addDiffRow(rows, "Negative Prompt", baseConfig.negativePrompt, nextConfig.negativePrompt, findChangeRationale(rationales, ["negativePrompt"]));
  addDiffRow(rows, "denoise", baseConfig.denoise, nextConfig.denoise, findChangeRationale(rationales, ["denoise"]));
  addDiffRow(rows, "grow mask", baseConfig.growMaskBy, nextConfig.growMaskBy, findChangeRationale(rationales, ["growMaskBy", "growMask"]));
  addDiffRow(rows, "mode", baseConfig.mode, nextConfig.mode, findChangeRationale(rationales, ["mode", "inpaintMode"]));
  addDiffRow(rows, "seed", baseConfig.image.seed, nextConfig.image.seed, findChangeRationale(rationales, ["seed"]));
  addDiffRow(rows, "brush size", baseConfig.brushSize, nextConfig.brushSize, findChangeRationale(rationales, ["brushSize"]));
  addDiffRow(rows, "FaceDetailer", baseConfig.faceDetailerEnabled, nextConfig.faceDetailerEnabled, findChangeRationale(rationales, ["faceDetailer"]));
  addDiffRow(rows, "HandDetailer", baseConfig.handDetailerEnabled, nextConfig.handDetailerEnabled, findChangeRationale(rationales, ["handDetailer"]));

  return rows;
}

function getScaledPoint(point: { x: number; y: number }, width: number, height: number) {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

function drawInpaintDiagnosisMaskShape(
  context: CanvasRenderingContext2D,
  shape: ComfyUiInpaintDiagnosisMaskShape,
  canvasWidth: number,
  canvasHeight: number,
  fallbackBrushSize: number,
) {
  context.save();

  if (shape.type === "stroke") {
    const firstPoint = getScaledPoint(shape.points[0], canvasWidth, canvasHeight);
    const brushSize = shape.brushSize ?? fallbackBrushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.beginPath();
    context.moveTo(firstPoint.x, firstPoint.y);

    if (shape.points.length === 1) {
      context.arc(firstPoint.x, firstPoint.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    for (const point of shape.points.slice(1)) {
      const scaled = getScaledPoint(point, canvasWidth, canvasHeight);
      context.lineTo(scaled.x, scaled.y);
    }

    context.stroke();
    context.restore();
    return;
  }

  if (shape.type === "ellipse") {
    context.beginPath();
    context.ellipse(
      shape.x * canvasWidth,
      shape.y * canvasHeight,
      shape.radiusX * canvasWidth,
      shape.radiusY * canvasHeight,
      ((shape.rotation ?? 0) / 180) * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
    return;
  }

  if (shape.type === "rect") {
    context.translate(shape.x * canvasWidth, shape.y * canvasHeight);
    context.rotate(((shape.rotation ?? 0) / 180) * Math.PI);
    context.fillRect(
      (-shape.width * canvasWidth) / 2,
      (-shape.height * canvasHeight) / 2,
      shape.width * canvasWidth,
      shape.height * canvasHeight,
    );
    context.restore();
    return;
  }

  const firstPoint = getScaledPoint(shape.points[0], canvasWidth, canvasHeight);
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);
  for (const point of shape.points.slice(1)) {
    const scaled = getScaledPoint(point, canvasWidth, canvasHeight);
    context.lineTo(scaled.x, scaled.y);
  }
  context.closePath();
  context.fill();
  context.restore();
}

function drawInpaintDiagnosisMaskShapes(
  canvas: HTMLCanvasElement,
  shapes: ComfyUiInpaintDiagnosisMaskShape[],
  fallbackBrushSize: number,
) {
  const context = canvas.getContext("2d");
  if (!context || shapes.length === 0) {
    return false;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.strokeStyle = "#fff";
  for (const shape of shapes) {
    drawInpaintDiagnosisMaskShape(context, shape, canvas.width, canvas.height, fallbackBrushSize);
  }

  return true;
}

function normalizeSamMaskBox(
  start: ComfyUiSam2Point,
  end: ComfyUiSam2Point,
  sourceSize: { height: number; width: number },
): ComfyUiSam2Bbox | null {
  const x0 = Math.max(0, Math.min(sourceSize.width, Math.round(Math.min(start.x, end.x))));
  const y0 = Math.max(0, Math.min(sourceSize.height, Math.round(Math.min(start.y, end.y))));
  const x1 = Math.max(0, Math.min(sourceSize.width, Math.round(Math.max(start.x, end.x))));
  const y1 = Math.max(0, Math.min(sourceSize.height, Math.round(Math.max(start.y, end.y))));

  if (x1 <= x0 || y1 <= y0 || x1 - x0 < 2 || y1 - y0 < 2) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
  };
}

function getSamMaskBoxStyle(box: ComfyUiSam2Bbox, sourceSize: { height: number; width: number }) {
  return {
    height: `${(box.height / sourceSize.height) * 100}%`,
    left: `${(box.x / sourceSize.width) * 100}%`,
    top: `${(box.y / sourceSize.height) * 100}%`,
    width: `${(box.width / sourceSize.width) * 100}%`,
  };
}

async function createCanvasMaskDataUrlFromSamMaskUrl(
  imageUrl: string,
  sourceSize: { height: number; width: number },
) {
  const imageDataUrl = await loadOriginalImageUrlToDataUrl(imageUrl);
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = sourceSize.width;
  canvas.height = sourceSize.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare SAM mask preview.");
  }

  context.drawImage(image, 0, 0, sourceSize.width, sourceSize.height);
  const imageData = context.getImageData(0, 0, sourceSize.width, sourceSize.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = Math.max(data[index], data[index + 1], data[index + 2]);
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

function NumberInput({
  label,
  min,
  max,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className={COMFYUI_TEXT_FIELD_CLASS}
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

function TextInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className={COMFYUI_TEXT_FIELD_CLASS}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  );
}

function TextAreaInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <textarea
        className="min-h-16 w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-xs leading-relaxed text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function BooleanInput({
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
        className="size-3.5 rounded border-slate-300 text-sky-600"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function SelectInput({
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
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="relative min-w-0">
        <select
          className={COMFYUI_SELECT_FIELD_CLASS}
          onChange={(event) => onChange(event.target.value)}
          value={selectedValue}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}

function DetailerFoldout({
  detailer,
  label,
  onChange,
  parameterLabel,
  samplerOptions,
  schedulerOptions,
}: {
  detailer: GenerationDraft["faceDetailer"];
  label: string;
  onChange: (patch: Partial<GenerationDraft["faceDetailer"]>) => void;
  parameterLabel: string;
  samplerOptions: readonly ComfyUiOption[];
  schedulerOptions: readonly ComfyUiOption[];
}) {
  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:col-span-2 lg:col-span-3">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input
          checked={detailer.enabled}
          className="size-3.5 rounded border-slate-300 text-sky-600"
          onChange={(event) => onChange({ enabled: event.target.checked })}
          type="checkbox"
        />
        {label}
      </label>
      {detailer.enabled ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextInput
            label="detector model"
            onChange={(value) => onChange({ detectorModelName: value })}
            value={detailer.detectorModelName}
          />
          <NumberInput
            label="guide size"
            min={64}
            onChange={(value) => onChange({ guideSize: Math.round(value / 8) * 8 })}
            step={8}
            value={detailer.guideSize}
          />
          <NumberInput
            label="max size"
            min={64}
            onChange={(value) => onChange({ maxSize: Math.round(value / 8) * 8 })}
            step={8}
            value={detailer.maxSize}
          />
          <NumberInput
            label={`${parameterLabel} denoise`}
            max={1}
            min={0}
            onChange={(value) => onChange({ denoise: value })}
            step={0.05}
            value={detailer.denoise}
          />
          <NumberInput
            label={`${parameterLabel} steps`}
            min={1}
            onChange={(value) => onChange({ steps: Math.round(value) })}
            value={detailer.steps}
          />
          <NumberInput
            label={`${parameterLabel} cfg`}
            min={0}
            onChange={(value) => onChange({ cfg: value })}
            step={0.5}
            value={detailer.cfg}
          />
          <SelectInput
            label={`${parameterLabel} sampler`}
            onChange={(value) => onChange({ samplerName: value })}
            options={samplerOptions}
            value={detailer.samplerName}
          />
          <SelectInput
            label={`${parameterLabel} scheduler`}
            onChange={(value) => onChange({ scheduler: value })}
            options={schedulerOptions}
            value={detailer.scheduler}
          />
          <NumberInput
            label="bbox threshold"
            max={1}
            min={0}
            onChange={(value) => onChange({ bboxThreshold: value })}
            step={0.01}
            value={detailer.bboxThreshold}
          />
          <NumberInput
            label="bbox dilation"
            max={512}
            min={-512}
            onChange={(value) => onChange({ bboxDilation: Math.round(value) })}
            value={detailer.bboxDilation}
          />
          <NumberInput
            label="bbox crop"
            max={10}
            min={1}
            onChange={(value) => onChange({ bboxCropFactor: value })}
            step={0.1}
            value={detailer.bboxCropFactor}
          />
          <NumberInput
            label="feather"
            max={100}
            min={0}
            onChange={(value) => onChange({ feather: Math.round(value) })}
            value={detailer.feather}
          />
          <NumberInput
            label="drop size"
            min={1}
            onChange={(value) => onChange({ dropSize: Math.round(value) })}
            value={detailer.dropSize}
          />
          <NumberInput
            label="cycle"
            max={10}
            min={1}
            onChange={(value) => onChange({ cycle: Math.round(value) })}
            value={detailer.cycle}
          />
          <BooleanInput
            checked={detailer.guideSizeFor}
            label="guide size for bbox"
            onChange={(value) => onChange({ guideSizeFor: value })}
          />
          <BooleanInput
            checked={detailer.noiseMask}
            label="noise mask"
            onChange={(value) => onChange({ noiseMask: value })}
          />
          <BooleanInput
            checked={detailer.forceInpaint}
            label="force inpaint"
            onChange={(value) => onChange({ forceInpaint: value })}
          />
          <SelectInput
            label="sam hint"
            onChange={(value) => onChange({ samDetectionHint: value as GenerationDraft["faceDetailer"]["samDetectionHint"] })}
            options={COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS}
            value={detailer.samDetectionHint}
          />
          <NumberInput
            label="sam dilation"
            max={512}
            min={-512}
            onChange={(value) => onChange({ samDilation: Math.round(value) })}
            value={detailer.samDilation}
          />
          <NumberInput
            label="sam threshold"
            max={1}
            min={0}
            onChange={(value) => onChange({ samThreshold: value })}
            step={0.01}
            value={detailer.samThreshold}
          />
          <NumberInput
            label="sam bbox expansion"
            max={1000}
            min={0}
            onChange={(value) => onChange({ samBBoxExpansion: Math.round(value) })}
            value={detailer.samBBoxExpansion}
          />
          <NumberInput
            label="sam mask threshold"
            max={1}
            min={0}
            onChange={(value) => onChange({ samMaskHintThreshold: value })}
            step={0.01}
            value={detailer.samMaskHintThreshold}
          />
          <SelectInput
            label="sam negative"
            onChange={(value) => onChange({ samMaskHintUseNegative: value as GenerationDraft["faceDetailer"]["samMaskHintUseNegative"] })}
            options={COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS}
            value={detailer.samMaskHintUseNegative}
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <TextAreaInput
              label="wildcard"
              onChange={(value) => onChange({ wildcard: value })}
              value={detailer.wildcard}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ControlNetModelField({
  label,
  modelOptions,
  onChange,
  value,
}: {
  label: string;
  modelOptions: readonly ControlNetModelOption[];
  onChange: (value: string) => void;
  value: string;
}) {
  const selectId = useId();
  const manualInputId = useId();
  const [manualEntryOpen, setManualEntryOpen] = useState(() => Boolean(value.trim()));
  const hasModelChoices = modelOptions.length > 0;
  const hasCurrentValue = Boolean(value) && !modelOptions.some((option) => option.value === value);
  const options = [
    { label: "Auto pick from ComfyUI", value: "" },
    ...(hasCurrentValue ? [{ label: `Current: ${value}`, value }] : []),
    ...modelOptions,
  ];
  const selectedValue = options.some((option) => option.value === value) ? value : "";

  return (
    <div className="grid gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500" htmlFor={selectId}>
        {label}
      </label>
      <div className="relative min-w-0">
        <select
          className={COMFYUI_SELECT_FIELD_CLASS}
          id={selectId}
          onChange={(event) => onChange(event.target.value)}
          value={selectedValue}
        >
          {options.map((option) => (
            <option key={option.value || "__auto"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      </div>
      {!hasModelChoices ? (
        <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <Button
            className="h-9 justify-center rounded-md border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-100"
            onClick={() => setManualEntryOpen((current) => !current)}
            type="button"
            variant="secondary"
          >
            {manualEntryOpen ? "隐藏手动输入" : "手动输入模型名"}
          </Button>
          {manualEntryOpen ? (
            <label className="grid min-w-0 gap-1" htmlFor={manualInputId}>
              <span className="sr-only">{label} manual model name</span>
              <input
                className={COMFYUI_TEXT_FIELD_CLASS}
                id={manualInputId}
                onChange={(event) => onChange(event.target.value)}
                placeholder="可选：control_xxx.safetensors"
                type="text"
                value={value}
              />
            </label>
          ) : (
            <p className="min-w-0 text-[11px] leading-relaxed text-slate-500">
              未扫描到模型列表时会自动选择匹配模型；需要固定文件名时可手动输入。
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GeneratedImageResults({
  allGeneratedImageItems,
  filter,
  generatedImageItems,
  historySaveMessage,
  historySaveStatus,
  onDeleteImage,
  onFilterChange,
  onSaveImage,
  onSelectImage,
  onToggleFavorite,
  progress,
  resultsCount,
  selectedImageKey,
  submitStatus,
  waitMessage,
}: {
  allGeneratedImageItems: GeneratedImageItem[];
  filter: GeneratedImageFilter;
  generatedImageItems: GeneratedImageItem[];
  historySaveMessage: string;
  historySaveStatus: "idle" | "saving" | "success" | "error";
  onDeleteImage: (item: GeneratedImageItem) => void;
  onFilterChange: (filter: GeneratedImageFilter) => void;
  onSaveImage: (item: GeneratedImageItem) => void;
  onSelectImage: (imageKey: string) => void;
  onToggleFavorite: (id: string) => void;
  progress: GenerationProgress | null;
  resultsCount: number;
  selectedImageKey: string;
  submitStatus: SubmitStatus;
  waitMessage: string;
}) {
  const [previewImageItem, setPreviewImageItem] = useState<GeneratedImageItem | null>(null);

  useEffect(() => {
    if (!previewImageItem) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewImageItem(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImageItem]);

  const previewImage = previewImageItem?.image ?? null;
  const filterCounts: Record<GeneratedImageFilter, number> = {
    all: allGeneratedImageItems.length,
    favorites: allGeneratedImageItems.filter((item) => item.favorited).length,
    session: allGeneratedImageItems.filter((item) => item.sessionGenerated).length,
  };
  const progressPercent = getProgressPercent(progress);
  const progressContent = resultsCount > 0 && submitStatus === "loading"
    ? (
        <div className="rounded-md border border-sky-100 bg-sky-50 p-3 text-xs leading-relaxed text-sky-700">
          <div>
            <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
            {waitMessage || "正在等待 ComfyUI 生成完成..."}
          </div>
          <div
            aria-label="ComfyUI generation progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress ? progressPercent : 0}
            className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-sky-600 transition-all duration-300"
              style={{ width: (progress ? progressPercent : 8) + "%" }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] font-medium text-sky-600">
            <span>{progress ? String(progress.value) + "/" + String(progress.max) + (progress.node ? " · node " + progress.node : "") : "等待进度事件"}</span>
            <span>{progress ? String(progressPercent) + "%" : ""}</span>
          </div>
        </div>
      )
    : null;

  if (allGeneratedImageItems.length === 0 && !progressContent) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">生成图片</p>
          <p className="mt-0.5 text-[11px] text-slate-500">点击图片设为当前诊断 / inpaint 图。</p>
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-[11px] font-medium">
          {[
            { label: "全部", value: "all" as const },
            { label: "收藏", value: "favorites" as const },
            { label: "本轮", value: "session" as const },
          ].map((option) => (
            <button
              className={"rounded px-2 py-1 transition " + (filter === option.value ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50")}
              key={option.value}
              onClick={() => onFilterChange(option.value)}
              type="button"
            >
              {option.label} {filterCounts[option.value]}
            </button>
          ))}
        </div>
      </div>
      {historySaveMessage ? (
        <p
          className={
            "rounded-md border px-3 py-2 text-[11px] leading-relaxed " +
            (historySaveStatus === "error"
              ? "border-rose-100 bg-rose-50 text-rose-700"
              : historySaveStatus === "success"
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-sky-100 bg-sky-50 text-sky-700")
          }
        >
          {historySaveStatus === "saving" ? <Loader2 className="mr-1.5 inline size-3.5 animate-spin" /> : null}
          {historySaveMessage}
        </p>
      ) : null}
      {progressContent}
      {generatedImageItems.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {generatedImageItems.map((item, index) => {
            const { image } = item;
            const imageKey = getGeneratedImageItemKey(item);
            const selected = selectedImageKey ? selectedImageKey === imageKey : index === 0;

            return (
              <div
                className={
                  "relative overflow-hidden rounded-md border bg-slate-50 transition " +
                  (selected ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200 hover:border-sky-200")
                }
                key={imageKey}
              >
                <button
                  className="group block w-full text-left"
                  onClick={() => onSelectImage(imageKey)}
                  title={image.filename}
                  type="button"
                >
                  <img
                    alt={"ComfyUI generated image " + String(index + 1)}
                    className="aspect-square w-full object-cover transition group-hover:scale-[1.02]"
                    src={image.url}
                  />
                  <div className="border-t border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                    <span className="block truncate">
                      {selected ? "当前图 · " : ""}
                      {image.filename}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-slate-600">seed {item.seed}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {item.sessionGenerated
                        ? item.persisted
                          ? (item.resultSource === "inpaint" ? "本轮 · inpaint" : "本轮 · 文生图")
                          : "本轮临时结果"
                        : (item.resultSource === "inpaint" ? "历史 · inpaint" : "历史 · 文生图")}
                    </span>
                  </div>
                </button>
                <button
                  aria-label={"放大图片：" + image.filename}
                  className="absolute right-1.5 top-1.5 z-10 grid size-8 place-items-center rounded-md border border-white/70 bg-slate-950/70 text-white shadow-sm backdrop-blur transition hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  onClick={() => setPreviewImageItem(item)}
                  title="放大图片"
                  type="button"
                >
                  <Maximize2 className="size-4" />
                </button>
                <div className="flex items-center gap-1 border-t border-slate-200 bg-white px-1.5 py-1.5">
                  {item.persisted && item.historyId ? (
                    <button
                      aria-label={item.favorited ? "取消收藏" : "收藏图片"}
                      className={
                        "grid size-7 place-items-center rounded-md transition " +
                        (item.favorited
                          ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
                      }
                      onClick={() => onToggleFavorite(item.historyId!)}
                      title={item.favorited ? "取消收藏" : "收藏图片"}
                      type="button"
                    >
                      <Star className={"size-3.5 " + (item.favorited ? "fill-current" : "")} />
                    </button>
                  ) : null}
                  <a
                    aria-label={"打开原图：" + image.filename}
                    className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    href={image.url}
                    rel="noreferrer"
                    target="_blank"
                    title="打开原图"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                  {!item.persisted ? (
                    <button
                      aria-label={"保存到项目历史：" + image.filename}
                      className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={historySaveStatus === "saving"}
                      onClick={() => onSaveImage(item)}
                      title="保存到项目历史"
                      type="button"
                    >
                      {historySaveStatus === "saving" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                    </button>
                  ) : null}
                  <button
                    aria-label={(item.persisted ? "删除图片：" : "删除临时图片：") + image.filename}
                    className="ml-auto grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={historySaveStatus === "saving"}
                    onClick={() => onDeleteImage(item)}
                    title={item.persisted ? "删除图片" : "删除临时图片"}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          当前筛选下没有图片。
        </p>
      )}
      {previewImage && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-[80] flex flex-col bg-slate-950/95 p-3 text-white sm:p-5"
              onClick={() => setPreviewImageItem(null)}
              role="dialog"
            >
              <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{previewImage.filename}</p>
                  <p className="mt-0.5 text-[11px] text-slate-300">seed {previewImageItem?.seed}</p>
                </div>
                <button
                  aria-label="关闭放大预览"
                  className="grid size-9 shrink-0 place-items-center rounded-md border border-white/20 bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  onClick={() => setPreviewImageItem(null)}
                  title="关闭"
                  type="button"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={(event) => event.stopPropagation()}>
                <NextImage
                  alt={"ComfyUI generated image preview: " + previewImage.filename}
                  className="object-contain"
                  fill
                  sizes="100vw"
                  src={previewImage.url}
                  unoptimized
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function InpaintMaskDialog({
  busy,
  draft,
  imageItem,
  loraSettings,
  onClose,
  onSubmit,
  open,
  selectedResources,
}: {
  busy: boolean;
  draft: GenerationDraft;
  imageItem: GeneratedImageItem | null;
  loraSettings: ComfyUiGenerationLoraSetting[];
  onClose: () => void;
  onSubmit: (input: InpaintSubmitInput) => Promise<void>;
  open: boolean;
  selectedResources: SelectedCivitaiResourcesPreview;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const samBoxDrawingRef = useRef(false);
  const samBoxStartRef = useRef<ComfyUiSam2Point | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const [brushSize, setBrushSize] = useState(draft.inpaint.brushSize);
  const [denoise, setDenoise] = useState(draft.inpaint.denoise);
  const [error, setError] = useState("");
  const [faceDetailerEnabled, setFaceDetailerEnabled] = useState(draft.faceDetailer.enabled);
  const [growMaskBy, setGrowMaskBy] = useState(draft.inpaint.growMaskBy);
  const [highResInpaintEnabled, setHighResInpaintEnabled] = useState(false);
  const [highResInpaintMode, setHighResInpaintMode] = useState<ComfyUiInpaintUpscaleMode>("lanczos");
  const [highResInpaintStrategy, setHighResInpaintStrategy] = useState<ComfyUiInpaintUpscaleStrategy>("local-region");
  const [localRegionPadding, setLocalRegionPadding] = useState(128);
  const [localRegionFeather, setLocalRegionFeather] = useState(32);
  const [localRegionHarmonizeEnabled, setLocalRegionHarmonizeEnabled] = useState(false);
  const [localRegionHarmonizeDenoise, setLocalRegionHarmonizeDenoise] = useState(0.12);
  const [maskBounds, setMaskBounds] = useState<InpaintLocalRegionRect | null>(null);
  const [upscaleModelStatus, setUpscaleModelStatus] = useState<LoadStatus>("idle");
  const [upscaleModelError, setUpscaleModelError] = useState("");
  const [modelUpscaleOptions, setModelUpscaleOptions] = useState<InpaintModelUpscaleOption[]>(DEFAULT_INPAINT_MODEL_UPSCALE_OPTIONS);
  const [handDetailerEnabled, setHandDetailerEnabled] = useState(draft.handDetailer.enabled);
  const [mode, setMode] = useState<ComfyUiInpaintMode>(draft.inpaint.mode);
  const [negativePrompt, setNegativePrompt] = useState(draft.negativePrompt);
  const [positivePrompt, setPositivePrompt] = useState(draft.positivePrompt);
  const [seed, setSeed] = useState(imageItem?.seed ?? draft.seed);
  const [sourceSize, setSourceSize] = useState<{ height: number; width: number } | null>(null);
  const [tool, setTool] = useState<InpaintMaskTool>("brush");
  const [samPositivePoints, setSamPositivePoints] = useState<ComfyUiSam2Point[]>([]);
  const [samNegativePoints, setSamNegativePoints] = useState<ComfyUiSam2Point[]>([]);
  const [samBox, setSamBox] = useState<ComfyUiSam2Bbox | null>(null);
  const [samBoxDraft, setSamBoxDraft] = useState<ComfyUiSam2Bbox | null>(null);
  const [samMaskStatus, setSamMaskStatus] = useState<SamMaskStatus>("idle");
  const [samMaskError, setSamMaskError] = useState("");
  const [samMaskPreviewUrl, setSamMaskPreviewUrl] = useState("");
  const [samMaskApplied, setSamMaskApplied] = useState(false);
  const [aiDiagnosisInput, setAiDiagnosisInput] = useState("");
  const [aiDiagnosisStatus, setAiDiagnosisStatus] = useState<DiagnosisStatus>("idle");
  const [aiDiagnosisError, setAiDiagnosisError] = useState("");
  const [aiDiagnosisResult, setAiDiagnosisResult] = useState<ComfyUiInpaintDiagnosisResult | null>(null);
  const [aiDiagnosisBaseConfig, setAiDiagnosisBaseConfig] = useState<ComfyUiInpaintDiagnosisConfig | null>(null);
  const [aiDiagnosisApplied, setAiDiagnosisApplied] = useState(false);
  const aiDiagnosisBusy = aiDiagnosisStatus === "analyzing";
  const samMaskBusy = samMaskStatus === "generating";
  const maskToolBusy = busy || aiDiagnosisBusy || samMaskBusy;
  const aiDiagnosisDiffRows = aiDiagnosisResult && aiDiagnosisBaseConfig
    ? buildInpaintDiagnosisDiffRows(aiDiagnosisBaseConfig, aiDiagnosisResult)
    : [];
  const localRegionPreview = useMemo(() => {
    if (!highResInpaintEnabled || highResInpaintStrategy !== "local-region" || !sourceSize) {
      return null;
    }

    const source = samBox ? "box" : "mask-bounds";
    const baseRegion = samBox ?? maskBounds;
    if (!baseRegion) {
      return null;
    }

    const region = padAndAlignLocalRegion(baseRegion, sourceSize, localRegionPadding);
    if (!region) {
      return null;
    }

    return {
      ...region,
      source,
      padding: localRegionPadding,
      feather: localRegionFeather,
      harmonizeAfter: {
        enabled: localRegionHarmonizeEnabled,
        denoise: localRegionHarmonizeDenoise,
      },
    };
  }, [
    highResInpaintEnabled,
    highResInpaintStrategy,
    localRegionFeather,
    localRegionHarmonizeDenoise,
    localRegionHarmonizeEnabled,
    localRegionPadding,
    maskBounds,
    samBox,
    sourceSize,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setUpscaleModelStatus("loading");
      setUpscaleModelError("");
    });
    void fetchJson<UpscaleModelsResponse>("/api/comfyui/upscale-models")
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const options = payload.modelUpscaleOptions.length > 0 ? payload.modelUpscaleOptions : DEFAULT_INPAINT_MODEL_UPSCALE_OPTIONS;
        const availableModes = new Set(options.filter((option) => option.available).map((option) => option.mode));
        setModelUpscaleOptions(options);
        setHighResInpaintMode((current) => (
          current !== "lanczos" && !availableModes.has(current as ComfyUiInpaintUpscaleModelPresetMode) ? "lanczos" : current
        ));
        setUpscaleModelStatus("success");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setModelUpscaleOptions(DEFAULT_INPAINT_MODEL_UPSCALE_OPTIONS);
        setHighResInpaintMode("lanczos");
        setUpscaleModelStatus("error");
        setUpscaleModelError(loadError instanceof Error ? loadError.message : "Unable to load ComfyUI upscale models.");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  function clearAiDiagnosisReview() {
    setAiDiagnosisStatus("idle");
    setAiDiagnosisError("");
    setAiDiagnosisResult(null);
    setAiDiagnosisBaseConfig(null);
    setAiDiagnosisApplied(false);
  }

  function clearSamMaskResult() {
    setSamMaskStatus("idle");
    setSamMaskError("");
    setSamMaskPreviewUrl("");
    setSamMaskApplied(false);
  }

  function clearSamHints() {
    setSamPositivePoints([]);
    setSamNegativePoints([]);
    setSamBox(null);
    setSamBoxDraft(null);
    samBoxDrawingRef.current = false;
    samBoxStartRef.current = null;
    clearSamMaskResult();
  }

  function readCurrentMaskBounds() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return null;
    }

    return findMaskAlphaBounds(context.getImageData(0, 0, canvas.width, canvas.height));
  }

  function refreshMaskBounds() {
    setMaskBounds(readCurrentMaskBounds());
  }

  function resetCanvas(width: number, height: number) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, width, height);
    undoStackRef.current = [];
    setMaskBounds(null);
    clearAiDiagnosisReview();
    clearSamHints();
  }

  function pushUndoSnapshot() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    undoStackRef.current = [
      ...undoStackRef.current.slice(-9),
      context.getImageData(0, 0, canvas.width, canvas.height),
    ];
  }

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function drawTo(point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const lastPoint = lastPointRef.current ?? point;
    if (!canvas || !context) {
      return;
    }

    context.save();
    context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = "#fff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
    lastPointRef.current = point;
  }

  function beginStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (maskToolBusy) {
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    clearAiDiagnosisReview();
    if (tool === "sam-positive") {
      setSamPositivePoints((current) => [...current, { x: Math.round(point.x), y: Math.round(point.y) }]);
      clearSamMaskResult();
      return;
    }

    if (tool === "sam-negative") {
      setSamNegativePoints((current) => [...current, { x: Math.round(point.x), y: Math.round(point.y) }]);
      clearSamMaskResult();
      return;
    }

    if (tool === "sam-box") {
      samBoxDrawingRef.current = true;
      samBoxStartRef.current = { x: point.x, y: point.y };
      setSamBox(null);
      setSamBoxDraft(sourceSize ? normalizeSamMaskBox(point, point, sourceSize) : null);
      clearSamMaskResult();
      return;
    }

    pushUndoSnapshot();
    clearSamMaskResult();
    drawingRef.current = true;
    lastPointRef.current = point;
    drawTo(point);
  }

  function moveStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (samBoxDrawingRef.current && sourceSize) {
      const point = getCanvasPoint(event);
      const start = samBoxStartRef.current;
      if (point && start) {
        setSamBoxDraft(normalizeSamMaskBox(start, point, sourceSize));
      }
      return;
    }

    if (!drawingRef.current) {
      return;
    }

    const point = getCanvasPoint(event);
    if (point) {
      drawTo(point);
    }
  }

  function endStroke(event?: PointerEvent<HTMLCanvasElement>) {
    const wasDrawing = drawingRef.current;
    if (samBoxDrawingRef.current) {
      const start = samBoxStartRef.current;
      const point = event ? getCanvasPoint(event) : null;
      const nextBox = start && point && sourceSize ? normalizeSamMaskBox(start, point, sourceSize) : samBoxDraft;
      if (nextBox) {
        setSamBox(nextBox);
      }
      setSamBoxDraft(null);
      samBoxDrawingRef.current = false;
      samBoxStartRef.current = null;
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    if (wasDrawing) {
      refreshMaskBounds();
    }
  }

  function undoMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const snapshot = undoStackRef.current.at(-1);
    if (!canvas || !context || !snapshot) {
      return;
    }

    context.putImageData(snapshot, 0, 0);
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    refreshMaskBounds();
    clearAiDiagnosisReview();
    clearSamMaskResult();
  }

  function clearMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    pushUndoSnapshot();
    context.clearRect(0, 0, canvas.width, canvas.height);
    setMaskBounds(null);
    clearAiDiagnosisReview();
    clearSamMaskResult();
  }

  function canvasHasMask(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }

    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) {
        return true;
      }
    }

    return false;
  }

  function exportMaskDataUrl() {
    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas || !sourceSize) {
      throw new Error("Mask canvas is not ready.");
    }

    if (!canvasHasMask(sourceCanvas)) {
      throw new Error("Paint at least one mask area before inpainting.");
    }

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = sourceCanvas.width;
    maskCanvas.height = sourceCanvas.height;
    const context = maskCanvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to export mask.");
    }

    context.fillStyle = "#000";
    context.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    context.drawImage(sourceCanvas, 0, 0);

    return maskCanvas.toDataURL("image/png");
  }

  function readCurrentLocalRegion() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !sourceSize) {
      return null;
    }

    return resolveInpaintLocalRegion({
      box: samBox,
      feather: localRegionFeather,
      harmonizeAfter: {
        enabled: localRegionHarmonizeEnabled,
        denoise: localRegionHarmonizeDenoise,
      },
      mask: context.getImageData(0, 0, canvas.width, canvas.height),
      padding: localRegionPadding,
      sourceSize,
    });
  }

  function getCurrentInpaintDiagnosisConfig() {
    if (!imageItem || !sourceSize) {
      return null;
    }

    return toInpaintDiagnosisConfig({
      brushSize,
      denoise,
      draft,
      faceDetailerEnabled,
      growMaskBy,
      handDetailerEnabled,
      imageItem,
      loraSettings,
      mode,
      negativePrompt,
      positivePrompt,
      resources: selectedResources,
      seed,
      sourceSize,
    });
  }

  async function runAiInpaintDiagnosis() {
    if (!imageItem || !sourceSize || maskToolBusy) {
      return;
    }

    const baseConfig = getCurrentInpaintDiagnosisConfig();
    if (!baseConfig) {
      setAiDiagnosisStatus("error");
      setAiDiagnosisError("Mask canvas is not ready.");
      return;
    }

    setAiDiagnosisStatus("analyzing");
    setAiDiagnosisError("");
    setAiDiagnosisResult(null);
    setAiDiagnosisBaseConfig(null);
    setAiDiagnosisApplied(false);

    try {
      const imageDataUrl = await loadOriginalImageUrlToDataUrl(imageItem.image.url);
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          purpose: "comfyui-inpaint-diagnosis",
          messages: buildComfyUiInpaintDiagnosisMessages({
            config: baseConfig,
            imageDataUrl,
            userInput: aiDiagnosisInput,
          }),
          temperature: 0.15,
          maxTokens: 1600,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI inpaint diagnosis returned an invalid response.");
      }

      const parsed = parseComfyUiInpaintDiagnosisResponse(payload.content, baseConfig);
      if (!parsed) {
        throw new Error("AI inpaint diagnosis did not return usable JSON.");
      }

      setAiDiagnosisResult(parsed);
      setAiDiagnosisBaseConfig(baseConfig);
      setAiDiagnosisStatus("success");
    } catch (diagnosisError) {
      console.error("[SceneForge] [comfyui] AI inpaint diagnosis failed", { error: diagnosisError });
      setAiDiagnosisStatus("error");
      setAiDiagnosisError(
        diagnosisError instanceof Error
          ? diagnosisError.message
          : "AI inpaint diagnosis failed. Check LiteLLM configuration and retry.",
      );
    }
  }

  function applyAiInpaintDiagnosis() {
    if (!aiDiagnosisResult || !aiDiagnosisBaseConfig) {
      return;
    }

    const nextConfig = applyComfyUiInpaintDiagnosisAdjustments(aiDiagnosisBaseConfig, aiDiagnosisResult.adjustments);
    setBrushSize(nextConfig.brushSize);
    setDenoise(nextConfig.denoise);
    setFaceDetailerEnabled(nextConfig.faceDetailerEnabled);
    setGrowMaskBy(nextConfig.growMaskBy);
    setHandDetailerEnabled(nextConfig.handDetailerEnabled);
    setMode(nextConfig.mode);
    setNegativePrompt(nextConfig.negativePrompt);
    setPositivePrompt(nextConfig.positivePrompt);
    setSeed(nextConfig.image.seed);
    if (sourceSize && aiDiagnosisResult.mask.shapes.length > 0) {
      const canvas = canvasRef.current;
      if (canvas) {
        pushUndoSnapshot();
        if (drawInpaintDiagnosisMaskShapes(canvas, aiDiagnosisResult.mask.shapes, nextConfig.brushSize)) {
          clearSamHints();
          refreshMaskBounds();
        }
      }
    }
    setTool("brush");
    setAiDiagnosisApplied(true);
    setAiDiagnosisError("");
    setAiDiagnosisStatus("success");
  }

  async function runSamMaskGeneration() {
    if (!imageItem || !sourceSize || maskToolBusy) {
      return;
    }

    if (samPositivePoints.length === 0 && !samBox) {
      setSamMaskStatus("error");
      setSamMaskError("Add at least one positive point or draw a box before generating a SAM mask.");
      return;
    }

    setSamMaskStatus("generating");
    setSamMaskError("");
    setSamMaskPreviewUrl("");
    setSamMaskApplied(false);

    try {
      const clientId = createComfyUiClientId();
      const payload = await fetchJson<ComfyUiGenerateSam2MaskResponse>("/api/comfyui/sam2-mask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceImage: {
            filename: imageItem.image.filename,
            subfolder: imageItem.image.subfolder,
            type: imageItem.image.type,
          },
          imageWidth: sourceSize.width,
          imageHeight: sourceSize.height,
          positivePoints: samPositivePoints,
          negativePoints: samNegativePoints,
          ...(samBox ? { bbox: samBox } : {}),
          model: "sam2.1_hiera_small.safetensors",
          device: "cuda",
          precision: "fp16",
          keepModelLoaded: true,
          clientId,
        }),
      });
      const history = await waitForComfyUiGeneratedImages(clientId, payload.promptId, 1);
      const maskImage = history.images.find((image) => image.nodeId === payload.outputNodeId) ?? history.images.at(-1);

      if (!maskImage) {
        throw new Error("SAM2 finished without a mask image.");
      }

      setSamMaskPreviewUrl(await createCanvasMaskDataUrlFromSamMaskUrl(maskImage.url, sourceSize));
      setSamMaskStatus("success");
    } catch (samError) {
      console.error("[SceneForge] [comfyui] SAM2 mask generation failed", { error: samError });
      setSamMaskStatus("error");
      setSamMaskError(samError instanceof Error ? samError.message : "SAM2 mask generation failed.");
    }
  }

  async function applySamMaskPreview() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !samMaskPreviewUrl || maskToolBusy) {
      return;
    }

    try {
      const maskImage = await loadImage(samMaskPreviewUrl);
      pushUndoSnapshot();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
      setTool("brush");
      refreshMaskBounds();
      setSamMaskApplied(true);
      setSamMaskError("");
      setSamMaskStatus("success");
      clearAiDiagnosisReview();
    } catch (samError) {
      setSamMaskStatus("error");
      setSamMaskError(samError instanceof Error ? samError.message : "Unable to apply SAM mask.");
    }
  }

  async function submit() {
    if (!imageItem || maskToolBusy) {
      return;
    }

    setError("");

    try {
      const maskDataUrl = exportMaskDataUrl();
      const submitDenoise = normalizeComfyUiInpaintDenoiseForMode(denoise, mode);
      if (submitDenoise !== denoise) {
        setDenoise(submitDenoise);
      }
      const selectedModelUpscaleOption = highResInpaintMode === "lanczos"
        ? null
        : modelUpscaleOptions.find((option) => option.mode === highResInpaintMode && option.available) ?? null;
      const resolvedHighResInpaintMode = highResInpaintMode !== "lanczos" && !selectedModelUpscaleOption
        ? "lanczos"
        : highResInpaintMode;
      const localRegion = highResInpaintEnabled && highResInpaintStrategy === "local-region"
        ? readCurrentLocalRegion()
        : null;
      if (highResInpaintEnabled && highResInpaintStrategy === "local-region" && !localRegion) {
        throw new Error("Local region 2x needs a painted mask or a SAM box.");
      }

      await onSubmit({
        denoise: submitDenoise,
        faceDetailer: {
          ...draft.faceDetailer,
          enabled: faceDetailerEnabled,
        },
        growMaskBy,
        handDetailer: {
          ...draft.handDetailer,
          enabled: handDetailerEnabled,
        },
        image: imageItem.image,
        maskDataUrl,
        mode,
        negativePrompt,
        positivePrompt,
        seed,
        sourceImageDataUrl: await loadOriginalImageUrlToDataUrl(imageItem.image.url),
        upscaleBeforeInpaint: {
          enabled: highResInpaintEnabled,
          ...(localRegion ? { localRegion } : {}),
          mode: resolvedHighResInpaintMode,
          scaleBy: 2,
          ...(selectedModelUpscaleOption && resolvedHighResInpaintMode !== "lanczos"
            ? { modelName: selectedModelUpscaleOption.modelName }
            : {}),
          strategy: highResInpaintEnabled ? highResInpaintStrategy : "full-image",
        },
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Inpaint failed.");
    }
  }

  if (!open || !imageItem || typeof document === "undefined") {
    return null;
  }

  const renderedSamBox = samBoxDraft ?? samBox;
  const selectedModelUpscaleOption = highResInpaintMode === "lanczos"
    ? null
    : modelUpscaleOptions.find((option) => option.mode === highResInpaintMode) ?? null;
  const missingModelUpscaleOptions = modelUpscaleOptions.filter((option) => !option.available);

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Inpaint selected image</h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{imageItem.image.filename}</p>
          </div>
          <button
            className="grid size-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            disabled={maskToolBusy}
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="relative mx-auto overflow-hidden rounded-md border border-slate-200 bg-slate-950">
              <img
                alt="Inpaint source"
                className="block h-auto w-full select-none"
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  const width = image.naturalWidth || 1;
                  const height = image.naturalHeight || 1;
                  setSourceSize({ width, height });
                  resetCanvas(width, height);
                }}
                src={imageItem.image.url}
              />
              <canvas
                className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                onPointerCancel={endStroke}
                onPointerDown={beginStroke}
                onPointerLeave={endStroke}
                onPointerMove={moveStroke}
                onPointerUp={endStroke}
                ref={canvasRef}
              />
              {sourceSize ? (
                <div className="pointer-events-none absolute inset-0">
                  {renderedSamBox ? (
                    <div
                      className="absolute border-2 border-sky-300 bg-sky-300/15 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]"
                      style={getSamMaskBoxStyle(renderedSamBox, sourceSize)}
                    />
                  ) : null}
                  {localRegionPreview ? (
                    <div
                      className="absolute border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]"
                      style={getSamMaskBoxStyle(localRegionPreview, sourceSize)}
                    />
                  ) : null}
                  {samPositivePoints.map((point, index) => (
                    <span
                      className="absolute grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white bg-emerald-500 text-[10px] font-bold leading-none text-white shadow"
                      key={`sam-positive-${index}-${point.x}-${point.y}`}
                      style={{
                        left: `${(point.x / sourceSize.width) * 100}%`,
                        top: `${(point.y / sourceSize.height) * 100}%`,
                      }}
                    >
                      +
                    </span>
                  ))}
                  {samNegativePoints.map((point, index) => (
                    <span
                      className="absolute grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white bg-rose-500 text-[10px] font-bold leading-none text-white shadow"
                      key={`sam-negative-${index}-${point.x}-${point.y}`}
                      style={{
                        left: `${(point.x / sourceSize.width) * 100}%`,
                        top: `${(point.y / sourceSize.height) * 100}%`,
                      }}
                    >
                      -
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid grid-cols-5 gap-1.5">
              <button
                aria-pressed={tool === "brush"}
                className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition ${
                  tool === "brush" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                disabled={maskToolBusy}
                onClick={() => setTool("brush")}
                title="Brush"
                type="button"
              >
                <Paintbrush className="size-3.5" />
              </button>
              <button
                aria-pressed={tool === "eraser"}
                className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition ${
                  tool === "eraser" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                disabled={maskToolBusy}
                onClick={() => setTool("eraser")}
                title="Eraser"
                type="button"
              >
                <Eraser className="size-3.5" />
              </button>
              <button
                aria-pressed={tool === "sam-positive"}
                className={`flex h-9 items-center justify-center rounded-md border text-xs font-semibold transition ${
                  tool === "sam-positive" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                disabled={maskToolBusy}
                onClick={() => setTool("sam-positive")}
                title="SAM positive point"
                type="button"
              >
                <Plus className="size-3.5" />
              </button>
              <button
                aria-pressed={tool === "sam-negative"}
                className={`flex h-9 items-center justify-center rounded-md border text-xs font-semibold transition ${
                  tool === "sam-negative" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                disabled={maskToolBusy}
                onClick={() => setTool("sam-negative")}
                title="SAM negative point"
                type="button"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                aria-pressed={tool === "sam-box"}
                className={`flex h-9 items-center justify-center rounded-md border text-xs font-semibold transition ${
                  tool === "sam-box" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                disabled={maskToolBusy}
                onClick={() => setTool("sam-box")}
                title="SAM box"
                type="button"
              >
                <Square className="size-3.5" />
              </button>
            </div>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">brush size</span>
              <input
                className="h-2 accent-sky-600"
                disabled={maskToolBusy}
                max={160}
                min={4}
                onChange={(event) => {
                  setBrushSize(Number(event.target.value));
                  clearAiDiagnosisReview();
                  clearSamMaskResult();
                }}
                type="range"
                value={brushSize}
              />
              <span className="text-[11px] text-slate-500">{brushSize}px</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-9 rounded-md border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50"
                disabled={maskToolBusy}
                onClick={undoMask}
                type="button"
                variant="secondary"
              >
                <Undo2 className="size-3.5" />
                Undo
              </Button>
              <Button
                className="h-9 rounded-md border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50"
                disabled={maskToolBusy}
                onClick={clearMask}
                type="button"
                variant="secondary"
              >
                Clear
              </Button>
            </div>
            <div className="rounded-md border border-emerald-100 bg-emerald-50/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">SAM mask</p>
                  <p className="mt-0.5 truncate text-[11px] text-emerald-600">
                    {samPositivePoints.length} positive / {samNegativePoints.length} negative{samBox ? " / box" : ""}
                  </p>
                </div>
                <Button
                  className="h-8 shrink-0 rounded-md bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                  disabled={maskToolBusy || !sourceSize || (samPositivePoints.length === 0 && !samBox)}
                  onClick={() => void runSamMaskGeneration()}
                  type="button"
                >
                  {samMaskBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Generate
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  className="h-8 rounded-md border-emerald-100 bg-white text-xs text-emerald-700 hover:bg-emerald-50"
                  disabled={maskToolBusy}
                  onClick={clearSamHints}
                  type="button"
                  variant="secondary"
                >
                  Clear hints
                </Button>
                <Button
                  className="h-8 rounded-md bg-slate-900 px-3 text-xs text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={maskToolBusy || !samMaskPreviewUrl || samMaskApplied}
                  onClick={() => void applySamMaskPreview()}
                  type="button"
                >
                  Apply mask
                </Button>
              </div>
              {samMaskBusy ? (
                <p className="mt-2 rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs leading-relaxed text-emerald-700">
                  <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                  Generating mask with SAM2...
                </p>
              ) : null}
              {samMaskStatus === "error" && samMaskError ? (
                <p className="mt-2 rounded-md border border-rose-100 bg-white px-3 py-2 text-xs leading-relaxed text-rose-700">
                  {samMaskError}
                </p>
              ) : null}
              {samMaskPreviewUrl ? (
                <div className="mt-3 space-y-2 rounded-md border border-emerald-100 bg-white p-2">
                  <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-950">
                    <div className="relative">
                      <img alt="SAM source preview" className="block h-auto w-full select-none" draggable={false} src={imageItem.image.url} />
                      <img alt="SAM mask preview" className="absolute inset-0 h-full w-full object-fill opacity-70" src={samMaskPreviewUrl} />
                    </div>
                  </div>
                  {samMaskApplied ? (
                    <p className="text-[11px] text-emerald-700">Applied to the current mask canvas. Start inpaint is still manual.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-sky-100 bg-sky-50/70 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-sky-800">
                <input
                  checked={highResInpaintEnabled}
                  className="size-3.5 rounded border-slate-300 text-sky-600"
                  disabled={maskToolBusy}
                  onChange={(event) => setHighResInpaintEnabled(event.target.checked)}
                  type="checkbox"
                />
                High-res inpaint 2x
              </label>
              {highResInpaintEnabled ? (
                <div className="mt-3 grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      aria-pressed={highResInpaintStrategy === "local-region"}
                      className={`h-8 rounded-md border px-2 text-xs font-semibold transition ${
                        highResInpaintStrategy === "local-region"
                          ? "border-sky-300 bg-white text-sky-700"
                          : "border-sky-100 bg-sky-50 text-sky-700 hover:bg-white"
                      }`}
                      disabled={maskToolBusy}
                      onClick={() => setHighResInpaintStrategy("local-region")}
                      type="button"
                    >
                      Local region 2x
                    </button>
                    <button
                      aria-pressed={highResInpaintStrategy === "full-image"}
                      className={`h-8 rounded-md border px-2 text-xs font-semibold transition ${
                        highResInpaintStrategy === "full-image"
                          ? "border-sky-300 bg-white text-sky-700"
                          : "border-sky-100 bg-sky-50 text-sky-700 hover:bg-white"
                      }`}
                      disabled={maskToolBusy}
                      onClick={() => setHighResInpaintStrategy("full-image")}
                      type="button"
                    >
                      Full image 2x
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      aria-pressed={highResInpaintMode === "lanczos"}
                      className={`h-8 rounded-md border px-2 text-xs font-semibold transition ${
                        highResInpaintMode === "lanczos"
                          ? "border-sky-300 bg-white text-sky-700"
                          : "border-sky-100 bg-sky-50 text-sky-700 hover:bg-white"
                      }`}
                      disabled={maskToolBusy}
                      onClick={() => setHighResInpaintMode("lanczos")}
                      type="button"
                    >
                      Fast lanczos
                    </button>
                    {modelUpscaleOptions.map((option) => (
                      <button
                        aria-pressed={highResInpaintMode === option.mode}
                        className={`min-h-8 rounded-md border px-2 py-1 text-xs font-semibold leading-tight transition ${
                          highResInpaintMode === option.mode
                            ? "border-sky-300 bg-white text-sky-700"
                            : "border-sky-100 bg-sky-50 text-sky-700 hover:bg-white"
                        }`}
                        disabled={maskToolBusy || !option.available}
                        key={option.mode}
                        onClick={() => setHighResInpaintMode(option.mode)}
                        title={option.available ? `Use ${option.modelName}` : `${option.modelName} is not available in ComfyUI`}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-sky-700">
                    {highResInpaintStrategy === "local-region"
                      ? `Only upscales the ${localRegionPreview?.source === "box" ? "box" : "mask"} region, then composites it back into the original image.`
                      : highResInpaintMode !== "lanczos" && selectedModelUpscaleOption?.available
                        ? `Uses ${selectedModelUpscaleOption.modelName} for true 2x source upscale and nearest-exact 2x for the mask before inpaint.`
                        : "Uses lanczos 2x for the source and nearest-exact 2x for the mask before inpaint."}
                  </p>
                  {highResInpaintStrategy === "local-region" ? (
                    <div className="grid gap-2 rounded-md border border-sky-100 bg-white/70 p-2">
                      <div className="grid grid-cols-2 gap-2">
                        <NumberInput
                          label="padding"
                          max={2048}
                          min={0}
                          onChange={(value) => setLocalRegionPadding(Math.max(0, Math.round(value)))}
                          step={8}
                          value={localRegionPadding}
                        />
                        <NumberInput
                          label="feather"
                          max={1024}
                          min={0}
                          onChange={(value) => setLocalRegionFeather(Math.max(0, Math.round(value)))}
                          step={4}
                          value={localRegionFeather}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-[11px] font-semibold text-sky-700">
                        <input
                          checked={localRegionHarmonizeEnabled}
                          className="size-3.5 rounded border-slate-300 text-sky-600"
                          disabled={maskToolBusy}
                          onChange={(event) => setLocalRegionHarmonizeEnabled(event.target.checked)}
                          type="checkbox"
                        />
                        Global harmonize
                      </label>
                      {localRegionHarmonizeEnabled ? (
                        <NumberInput
                          label="harmonize denoise"
                          max={0.3}
                          min={0}
                          onChange={(value) => setLocalRegionHarmonizeDenoise(Math.max(0, Math.min(0.3, value)))}
                          step={0.01}
                          value={localRegionHarmonizeDenoise}
                        />
                      ) : null}
                      {localRegionPreview ? (
                        <p className="text-[11px] leading-relaxed text-sky-700">
                          Region: {localRegionPreview.x}, {localRegionPreview.y}, {localRegionPreview.width}x{localRegionPreview.height}
                        </p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-amber-700">Paint a mask or draw a SAM box to preview the local crop.</p>
                      )}
                    </div>
                  ) : null}
                  {upscaleModelStatus === "loading" || upscaleModelStatus === "error" || missingModelUpscaleOptions.length > 0 ? (
                    <p className="text-[11px] leading-relaxed text-amber-700">
                      {upscaleModelStatus === "loading"
                        ? "Checking 2x upscale model availability..."
                        : upscaleModelError || `Missing 2x model: ${missingModelUpscaleOptions.map((option) => option.modelName).join(", ")}`}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-violet-100 bg-violet-50/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">AI 诊断</p>
                  <p className="mt-0.5 truncate text-[11px] text-violet-600">Prompt / inpaint params</p>
                </div>
                <Button
                  className="h-8 shrink-0 rounded-md bg-violet-600 px-3 text-xs text-white hover:bg-violet-700 disabled:opacity-60"
                  disabled={maskToolBusy || !sourceSize}
                  onClick={() => void runAiInpaintDiagnosis()}
                  type="button"
                >
                  {aiDiagnosisBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  AI 诊断
                </Button>
              </div>
              <textarea
                className="mt-3 min-h-[64px] w-full resize-y rounded-md border border-violet-100 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                disabled={maskToolBusy}
                onChange={(event) => {
                  setAiDiagnosisInput(event.target.value);
                  clearAiDiagnosisReview();
                }}
                placeholder="例如：只修复左眼、去掉多余手指、重绘背景灯牌"
                value={aiDiagnosisInput}
              />
              {aiDiagnosisBusy ? (
                <p className="mt-2 rounded-md border border-violet-100 bg-white px-3 py-2 text-xs leading-relaxed text-violet-700">
                  <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                  正在分析图片并生成 inpaint 建议...
                </p>
              ) : null}
              {aiDiagnosisStatus === "error" && aiDiagnosisError ? (
                <p className="mt-2 rounded-md border border-rose-100 bg-white px-3 py-2 text-xs leading-relaxed text-rose-700">
                  {aiDiagnosisError}
                </p>
              ) : null}
              {aiDiagnosisResult ? (
                <div className="mt-3 space-y-3 rounded-md border border-violet-100 bg-white p-3 text-xs">
                  {aiDiagnosisResult.summary ? (
                    <p className="leading-relaxed text-slate-800">{aiDiagnosisResult.summary}</p>
                  ) : null}
                  {aiDiagnosisResult.reasoning ? (
                    <p className="leading-relaxed text-slate-600">{aiDiagnosisResult.reasoning}</p>
                  ) : null}
                  {aiDiagnosisResult.confidence !== null ? (
                    <p className="text-[11px] font-medium text-violet-700">confidence {aiDiagnosisResult.confidence}</p>
                  ) : null}
                  {aiDiagnosisResult.mask.note || aiDiagnosisResult.mask.shapes.length > 0 ? (
                    <p className="rounded-md bg-violet-50 px-3 py-2 text-[11px] leading-relaxed text-violet-800">
                      {aiDiagnosisResult.mask.note || `${aiDiagnosisResult.mask.shapes.length} mask shape(s) suggested.`}
                    </p>
                  ) : null}
                  {aiDiagnosisResult.warnings.length > 0 || aiDiagnosisResult.ignored.length > 0 ? (
                    <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                      {[...aiDiagnosisResult.warnings, ...aiDiagnosisResult.ignored].map((warning, index) => (
                        <p key={`${warning}-${index}`}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  {aiDiagnosisDiffRows.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">变更预览</p>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {aiDiagnosisDiffRows.map((row) => (
                          <div className="rounded-md bg-slate-50 px-2 py-1.5" key={`${row.label}-${row.current}-${row.next}`}>
                            <p className="font-medium text-slate-700">{row.label}</p>
                            <p className="mt-0.5 break-words text-[11px] text-slate-500">
                              {row.current || "空"} → <span className="text-violet-700">{row.next || "空"}</span>
                            </p>
                            {row.reason ? <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{row.reason}</p> : null}
                            {row.expectedEffect ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">预期：{row.expectedEffect}</p>
                            ) : null}
                            {row.risk ? <p className="mt-1 text-[11px] leading-relaxed text-amber-700">风险：{row.risk}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-emerald-700">
                      {aiDiagnosisApplied ? "已应用到当前 inpaint 弹窗，尚未提交 ComfyUI。" : ""}
                    </p>
                    <Button
                      className="h-8 rounded-md bg-slate-900 px-3 text-xs text-white hover:bg-slate-800 disabled:opacity-60"
                      disabled={aiDiagnosisApplied}
                      onClick={applyAiInpaintDiagnosis}
                      type="button"
                    >
                      应用建议
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <TextAreaInput
              label="prompt"
              onChange={(value) => {
                setPositivePrompt(value);
                clearAiDiagnosisReview();
              }}
              value={positivePrompt}
            />
            <TextAreaInput
              label="negative"
              onChange={(value) => {
                setNegativePrompt(value);
                clearAiDiagnosisReview();
              }}
              value={negativePrompt}
            />
            <SelectInput
              label="mode"
              onChange={(value) => {
                const nextMode = value as ComfyUiInpaintMode;
                setMode(nextMode);
                setDenoise((current) => normalizeComfyUiInpaintDenoiseForMode(current, nextMode));
                clearAiDiagnosisReview();
              }}
              options={COMFYUI_INPAINT_MODE_OPTIONS}
              value={mode}
            />
            <NumberInput
              label="denoise"
              max={1}
              min={mode === "vae-inpaint" ? MIN_COMFYUI_VAE_INPAINT_DENOISE : 0}
              onChange={(value) => {
                setDenoise(normalizeComfyUiInpaintDenoiseForMode(value, mode));
                clearAiDiagnosisReview();
              }}
              step={0.05}
              value={denoise}
            />
            <NumberInput
              label="seed"
              min={0}
              onChange={(value) => {
                setSeed(Math.max(0, Math.round(value)));
                clearAiDiagnosisReview();
              }}
              value={seed}
            />
            <NumberInput
              label="grow mask"
              max={512}
              min={0}
              onChange={(value) => {
                setGrowMaskBy(Math.max(0, Math.round(value)));
                clearAiDiagnosisReview();
              }}
              value={growMaskBy}
            />
            <BooleanInput
              checked={handDetailerEnabled}
              label="HandDetailer"
              onChange={(value) => {
                setHandDetailerEnabled(value);
                clearAiDiagnosisReview();
              }}
            />
            <BooleanInput
              checked={faceDetailerEnabled}
              label="FaceDetailer"
              onChange={(value) => {
                setFaceDetailerEnabled(value);
                clearAiDiagnosisReview();
              }}
            />
            {error ? (
              <p className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <Button
            className="h-10 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            disabled={maskToolBusy}
            onClick={onClose}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            className="h-10 rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60"
            disabled={maskToolBusy || !sourceSize}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Paintbrush className="size-4" />}
            Start inpaint
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function getControlNetOpenPoseUnavailableMessage(reason: ComfyUiControlNetOpenPosePreview["reason"]) {
  if (reason === "scene-not-3d") {
    return "Switch the canvas to 3D mode and add a 3D character to preview ControlNet maps.";
  }

  return "Add at least one visible 3D character skeleton to enable ControlNet previews.";
}

function SequencePreviousShotMaskDialog({
  fallbackSize,
  initialMaskDataUrl,
  onClose,
  onSave,
  open,
  source,
}: {
  fallbackSize: { height: number; width: number } | null;
  initialMaskDataUrl?: string;
  onClose: () => void;
  onSave: (mask: SequencePreviousShotMaskSession) => void;
  open: boolean;
  source: ComicSequencePreviousShotSource | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const rectangleStartRef = useRef<{ x: number; y: number } | null>(null);
  const rectangleCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(48);
  const [error, setError] = useState("");
  const [maskReady, setMaskReady] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SequencePreviousShotMaskRect | null>(null);
  const [sourceSize, setSourceSize] = useState<{ height: number; width: number } | null>(null);
  const [tool, setTool] = useState<SequencePreviousShotMaskTool>("brush");

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!source) {
      queueMicrotask(() => {
        setError("");
        setSelectionRect(null);
        setSourceSize(fallbackSize);
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setError("");
        setSelectionRect(null);
      }
    });

    void loadImageSize(source.image.url)
      .then((size) => {
        if (!cancelled) {
          setSourceSize(size);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load previous shot source.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackSize, open, source]);

  useEffect(() => {
    if (!open || !sourceSize) {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      queueMicrotask(() => {
        if (!cancelled) {
          setError("Mask canvas is not available.");
        }
      });
      return;
    }

    canvas.width = sourceSize.width;
    canvas.height = sourceSize.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    queueMicrotask(() => {
      if (!cancelled) {
        setMaskReady(false);
      }
    });

    if (!initialMaskDataUrl) {
      return;
    }

    void loadImage(initialMaskDataUrl)
      .then((maskImage) => {
        if (cancelled) {
          return;
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempContext = tempCanvas.getContext("2d");
        if (!tempContext) {
          throw new Error("Unable to restore saved mask.");
        }

        tempContext.drawImage(maskImage, 0, 0, tempCanvas.width, tempCanvas.height);
        const imageData = tempContext.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        let hasMask = false;
        for (let index = 0; index < imageData.data.length; index += 4) {
          const alpha = Math.max(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]);
          imageData.data[index] = 255;
          imageData.data[index + 1] = 255;
          imageData.data[index + 2] = 255;
          imageData.data[index + 3] = alpha;
          hasMask = hasMask || alpha > 0;
        }

        context.putImageData(imageData, 0, 0);
        setMaskReady(hasMask);
      })
      .catch((restoreError) => {
        if (!cancelled) {
          setError(restoreError instanceof Error ? restoreError.message : "Unable to restore saved mask.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialMaskDataUrl, open, sourceSize]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const sourceLabel = source
    ? `${source.previousShot.title} - ${source.image.filename}`
    : "Pending previous shot source";
  const sourceHelp = source
    ? "White mask areas will be regenerated from the selected previous-shot source."
    : "Draw a pending mask before the previous shot exists. It will be resized and applied once generation reaches this shot.";

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

    return {
      x: Math.min(canvas.width, Math.max(0, x)),
      y: Math.min(canvas.height, Math.max(0, y)),
    };
  }

  function createSelectionRect(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): SequencePreviousShotMaskRect {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    return {
      height: Math.abs(end.y - start.y),
      left,
      top,
      width: Math.abs(end.x - start.x),
    };
  }

  function getSelectionRectStyle(rect: SequencePreviousShotMaskRect) {
    if (!sourceSize || sourceSize.width <= 0 || sourceSize.height <= 0) {
      return undefined;
    }

    return {
      height: `${(rect.height / sourceSize.height) * 100}%`,
      left: `${(rect.left / sourceSize.width) * 100}%`,
      top: `${(rect.top / sourceSize.height) * 100}%`,
      width: `${(rect.width / sourceSize.width) * 100}%`,
    };
  }

  function fillSelectionRect(rect: SequencePreviousShotMaskRect) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || rect.width < 1 || rect.height < 1) {
      return;
    }

    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#fff";
    context.fillRect(rect.left, rect.top, rect.width, rect.height);
    context.restore();
    setMaskReady(true);
  }

  function drawTo(point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const lastPoint = lastPointRef.current ?? point;
    if (!canvas || !context || tool === "rectangle") {
      return;
    }

    context.save();
    context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = "#fff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
    lastPointRef.current = point;
    setMaskReady(true);
  }

  function beginStroke(event: PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;

    if (tool === "rectangle") {
      rectangleStartRef.current = point;
      rectangleCurrentRef.current = point;
      setSelectionRect(createSelectionRect(point, point));
      return;
    }

    lastPointRef.current = point;
    drawTo(point);
  }

  function moveStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    if (tool === "rectangle" && rectangleStartRef.current) {
      rectangleCurrentRef.current = point;
      setSelectionRect(createSelectionRect(rectangleStartRef.current, point));
      return;
    }

    drawTo(point);
  }

  function endStroke(event?: PointerEvent<HTMLCanvasElement>) {
    if (tool === "rectangle" && drawingRef.current && rectangleStartRef.current) {
      const point = event ? getCanvasPoint(event) : rectangleCurrentRef.current;
      if (point) {
        fillSelectionRect(createSelectionRect(rectangleStartRef.current, point));
      }
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    rectangleStartRef.current = null;
    rectangleCurrentRef.current = null;
    setSelectionRect(null);
  }

  function clearMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    setMaskReady(false);
    setSelectionRect(null);
    setError("");
  }

  function exportMaskDataUrl() {
    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas || !sourceSize) {
      throw new Error("Mask canvas is not ready.");
    }

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = sourceCanvas.width;
    maskCanvas.height = sourceCanvas.height;
    const context = maskCanvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to export mask.");
    }

    context.fillStyle = "#000";
    context.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    context.drawImage(sourceCanvas, 0, 0);

    return maskCanvas.toDataURL("image/png");
  }

  function saveMask() {
    if (!sourceSize) {
      setError("Previous shot source is not ready.");
      return;
    }

    if (!maskReady) {
      setError("Paint at least one mask area before saving.");
      return;
    }

    try {
      onSave({
        maskDataUrl: exportMaskDataUrl(),
        ...(source ? { sourceImage: source.image } : {}),
        sourceKey: source?.sourceKey ?? PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY,
        sourceSize,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save mask.");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">Configure previous-shot mask</h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{sourceLabel}</p>
          </div>
          <button
            aria-label="Close mask editor"
            className="grid size-8 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-950">
              <div
                className="relative"
                style={sourceSize && !source ? { aspectRatio: `${sourceSize.width} / ${sourceSize.height}` } : undefined}
              >
                {source ? (
                  <img alt="Previous shot source" className="block h-auto w-full select-none" draggable={false} src={source.image.url} />
                ) : (
                  <div className="grid h-full min-h-64 place-items-center bg-[linear-gradient(45deg,#0f172a_25%,transparent_25%),linear-gradient(-45deg,#0f172a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#0f172a_75%),linear-gradient(-45deg,transparent_75%,#0f172a_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] text-center text-xs text-slate-400">
                    Pending previous shot image
                  </div>
                )}
                {sourceSize ? (
                  <>
                    <canvas
                      className="absolute inset-0 h-full w-full cursor-crosshair touch-none opacity-70"
                      onPointerCancel={endStroke}
                      onPointerDown={beginStroke}
                      onPointerLeave={endStroke}
                      onPointerMove={moveStroke}
                      onPointerUp={endStroke}
                      ref={canvasRef}
                    />
                    {selectionRect ? (
                      <div
                        className="pointer-events-none absolute border border-white bg-white/25 shadow-[0_0_0_1px_rgba(14,165,233,0.9)]"
                        style={getSelectionRectStyle(selectionRect)}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            <aside className="grid content-start gap-3">
              <div className="grid grid-cols-3 gap-2">
                {([
                  { icon: Paintbrush, label: "Brush", value: "brush" },
                  { icon: Eraser, label: "Erase", value: "eraser" },
                  { icon: SquareDashedMousePointer, label: "Rect", value: "rectangle" },
                ] as const).map((toolOption) => {
                  const ToolIcon = toolOption.icon;
                  return (
                  <button
                    aria-pressed={tool === toolOption.value}
                    className={`h-9 rounded-md border px-2 text-xs font-semibold capitalize transition ${
                      tool === toolOption.value
                        ? "border-sky-300 bg-sky-50 text-sky-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    key={toolOption.value}
                    onClick={() => setTool(toolOption.value)}
                    title={toolOption.label}
                    type="button"
                  >
                    <ToolIcon className="mx-auto size-3.5" />
                  </button>
                  );
                })}
              </div>
              <NumberInput
                label="brush"
                max={256}
                min={1}
                onChange={(value) => setBrushSize(Math.max(1, Math.round(value)))}
                value={brushSize}
              />
              <Button
                className="h-9 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                onClick={clearMask}
                type="button"
                variant="secondary"
              >
                <Eraser className="size-3.5" />
                Clear
              </Button>
              {sourceSize ? (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {sourceHelp} Size: {sourceSize.width}x{sourceSize.height}.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-amber-700">
                  {source ? "Loading source image..." : "Previous shot size is not available."}
                </p>
              )}
              {error ? (
                <p className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                  {error}
                </p>
              ) : null}
            </aside>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <Button
            className="h-10 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            className="h-10 rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60"
            disabled={!sourceSize}
            onClick={saveMask}
            type="button"
          >
            <Save className="size-4" />
            Save mask
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = src;
  });
}

async function loadImageSize(src: string) {
  const image = await loadImage(src);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error("Unable to read image dimensions.");
  }

  return { height, width };
}

async function resizeMaskDataUrl(maskDataUrl: string, size: { height: number; width: number }) {
  const maskImage = await loadImage(maskDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to resize previous-shot mask.");
  }

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(maskImage, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Failed to encode ControlNet PNG."));
    }, "image/png");
  });
}

async function downloadControlNetSvgAsPng({
  filename,
  height,
  svg,
  width,
}: {
  filename: string;
  height: number;
  svg: string;
  width: number;
}) {
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas is not available for ControlNet PNG export.");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob = await canvasToPngBlob(canvas);
    const pngUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement("a");

    try {
      link.href = pngUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(pngUrl);
    }
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function downloadPngDataUrl({
  filename,
  imageDataUrl,
}: {
  filename: string;
  imageDataUrl: string;
}) {
  const link = document.createElement("a");
  link.href = imageDataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatDepthRange(range: ComfyUiControlNetOpenPosePreview["depth"]["depthRange"] | undefined) {
  if (!range) {
    return "depth n/a";
  }

  return `depth ${range.min.toFixed(2)}-${range.max.toFixed(2)}`;
}

function ControlNetUnitCard({
  description,
  helpText,
  height,
  label,
  modelOptions,
  onChange,
  preview,
  previewAvailable,
  unit,
  width,
}: {
  description: string;
  helpText: string;
  height: number;
  label: string;
  modelOptions: readonly ControlNetModelOption[];
  onChange: (patch: Partial<GenerationDraftControlNetUnit>) => void;
  preview: {
    depthRange?: ComfyUiControlNetOpenPosePreview["depth"]["depthRange"];
    error?: string;
    imageDataUrl?: string | null;
    loading?: boolean;
    reason?: string;
    svg: string | null;
    visibleJointCount: number;
    visibleSkeletonCount: number;
  };
  previewAvailable: boolean;
  unit: GenerationDraftControlNetUnit;
  width: number;
}) {
  const enabled = previewAvailable && unit.enabled;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const hasPreviewImage = Boolean(preview.svg || preview.imageDataUrl);

  async function savePng() {
    if (!previewAvailable || !hasPreviewImage || saveStatus === "saving") {
      return;
    }

    setSaveStatus("saving");
    setSaveError("");

    try {
      if (preview.imageDataUrl) {
        downloadPngDataUrl({
          filename: `sceneforge-${unit.type}-${width}x${height}.png`,
          imageDataUrl: preview.imageDataUrl,
        });
      } else if (preview.svg) {
        await downloadControlNetSvgAsPng({
          filename: `sceneforge-${unit.type}-${width}x${height}.png`,
          height,
          svg: preview.svg,
          width,
        });
      }
      setSaveStatus("success");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : `Failed to save ${label} PNG.`);
    }
  }

  return (
    <div className="grid gap-3 rounded-md border border-sky-100 bg-white p-3">
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input
          checked={enabled}
          className="mt-0.5 size-3.5 rounded border-slate-300 text-sky-600"
          disabled={!previewAvailable}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          type="checkbox"
        />
        <span>
          <span className="font-semibold text-slate-800">Use {label} ControlNet in this generation</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{description}</span>
        </span>
      </label>
      {enabled ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-4">
            <ControlNetModelField
              label={`${label.toLowerCase()} model`}
              modelOptions={modelOptions}
              onChange={(value) => onChange({ modelName: value })}
              value={unit.modelName}
            />
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{helpText}</p>
          </div>
          <NumberInput
            label="strength"
            max={2}
            min={0}
            onChange={(value) => onChange({ strength: value })}
            step={0.05}
            value={unit.strength}
          />
          <NumberInput
            label="start"
            max={1}
            min={0}
            onChange={(value) => onChange({ startPercent: value })}
            step={0.05}
            value={unit.startPercent}
          />
          <NumberInput
            label="end"
            max={1}
            min={0}
            onChange={(value) => onChange({ endPercent: value })}
            step={0.05}
            value={unit.endPercent}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-slate-500">Preview map can be saved locally as a PNG.</p>
        <Button
          className="h-8 shrink-0 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
          disabled={saveStatus === "saving" || !hasPreviewImage}
          onClick={() => void savePng()}
          type="button"
        >
          {saveStatus === "saving" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Save PNG
        </Button>
      </div>
      {preview.loading ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <Loader2 className="size-3.5 animate-spin" />
          Rendering {label} preview...
        </div>
      ) : null}
      {preview.error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          {preview.error}
        </p>
      ) : null}
      {preview.svg ? (
        <div
          className="flex w-full items-center justify-center overflow-hidden rounded-md border border-slate-900/10 bg-black [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: preview.svg }}
          style={{ aspectRatio: `${width} / ${height}` }}
        />
      ) : null}
      {preview.imageDataUrl ? (
        <div
          className="flex w-full items-center justify-center overflow-hidden rounded-md border border-slate-900/10 bg-black"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <img
            alt={`${label} ControlNet preview`}
            className="h-full w-full object-contain"
            src={preview.imageDataUrl}
          />
        </div>
      ) : null}
      <div className="grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
        <span className="rounded-md bg-slate-50 px-2 py-1.5">visible {preview.visibleSkeletonCount}</span>
        <span className="rounded-md bg-slate-50 px-2 py-1.5">joints {preview.visibleJointCount}</span>
        <span className="rounded-md bg-slate-50 px-2 py-1.5">
          size {width} x {height}
        </span>
        <span className="rounded-md bg-slate-50 px-2 py-1.5">
          {unit.type === "normal" ? "normal PNG" : formatDepthRange(preview.depthRange)}
        </span>
      </div>
      {saveStatus === "success" ? (
        <p className="text-[11px] leading-relaxed text-emerald-700">{label} PNG download started.</p>
      ) : null}
      {saveStatus === "error" && saveError ? (
        <p className="text-[11px] leading-relaxed text-rose-700">{saveError}</p>
      ) : null}
    </div>
  );
}

function ControlNetOpenPoseFoldout({
  controlNets,
  expanded,
  normalPreview,
  normalPreviewLoading,
  onChange,
  onToggle,
  preview,
}: {
  controlNets: GenerationDraft["controlNets"];
  expanded: boolean;
  normalPreview: ComfyUiNormalControlImagePreview | null;
  normalPreviewLoading: boolean;
  onChange: (
    type: GenerationDraftControlNetUnit["type"],
    patch: Partial<GenerationDraftControlNetUnit>,
  ) => void;
  onToggle: () => void;
  preview: ComfyUiControlNetOpenPosePreview | null;
}) {
  const available = Boolean(preview?.available);
  const controlNet = controlNets.openpose;
  const controlNetEnabled = available && controlNet.enabled;
  const message = preview
    ? getControlNetOpenPoseUnavailableMessage(preview.reason)
    : "ControlNet previews are not ready yet.";
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlNetModelPath, setControlNetModelPath] = useState("");
  const [controlNetModelOptions, setControlNetModelOptions] = useState<ControlNetModelOption[]>([]);
  const [controlNetModelLoadStatus, setControlNetModelLoadStatus] = useState<LoadStatus>("idle");
  const [controlNetModelLoadError, setControlNetModelLoadError] = useState("");

  async function loadControlNetModels() {
    setControlNetModelLoadStatus("loading");
    setControlNetModelLoadError("");

    try {
      const payload = await fetchJson<ControlNetModelsResponse>("/api/comfyui/controlnet-models");

      setControlNetModelPath(payload.modelPath);
      setControlNetModelOptions(payload.models);
      setControlNetModelLoadStatus(payload.modelPath ? "success" : "idle");
    } catch (error) {
      setControlNetModelPath("");
      setControlNetModelOptions([]);
      setControlNetModelLoadStatus("error");
      setControlNetModelLoadError(error instanceof Error ? error.message : "Unable to load ControlNet models.");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadControlNetModels();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  async function savePng() {
    if (!preview?.available || !preview.svg || saveStatus === "saving") {
      return;
    }

    setSaveStatus("saving");
    setSaveError("");

    try {
      await downloadControlNetSvgAsPng({
        filename: `sceneforge-openpose-${preview.width}x${preview.height}.png`,
        height: preview.height,
        svg: preview.svg,
        width: preview.width,
      });
      setSaveStatus("success");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Failed to save OpenPose PNG.");
    }
  }

  return (
    <div
      className={`grid gap-3 rounded-md border p-3 sm:col-span-2 lg:col-span-3 ${
        available ? "border-sky-200 bg-sky-50/60" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          aria-expanded={available ? expanded : false}
          className={`min-w-0 flex-1 text-left ${
            available ? "cursor-pointer" : "cursor-not-allowed opacity-70"
          }`}
          disabled={!available}
          onClick={onToggle}
          type="button"
        >
          <span className="block min-w-0">
            <span className="block text-xs font-semibold text-slate-800">ControlNet</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
              {available
                ? `OpenPose, Depth, and Normal previews from ${preview?.characterCount ?? 0} 3D character(s).`
                : message}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-sky-100 bg-white/90 p-0.5 shadow-sm shadow-sky-100/60">
          <button
            aria-label="ControlNet model settings"
            aria-pressed={settingsOpen}
            className={`grid size-7 place-items-center rounded text-sky-700 transition ${
              settingsOpen ? "bg-sky-600 text-white shadow-sm" : "hover:bg-sky-50"
            }`}
            onClick={() => setSettingsOpen((current) => !current)}
            title="ControlNet model settings"
            type="button"
          >
            <Settings className="size-3.5" />
          </button>
          <button
            aria-expanded={available ? expanded : false}
            aria-label={expanded ? "Collapse ControlNet" : "Expand ControlNet"}
            className="grid size-7 place-items-center rounded text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
            disabled={!available}
            onClick={onToggle}
            title={expanded ? "Collapse ControlNet" : "Expand ControlNet"}
            type="button"
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </div>
      </div>
      {settingsOpen ? (
        <div className="min-w-0 overflow-hidden rounded-md border border-sky-100 bg-white p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                ControlNet model path
              </p>
              {controlNetModelPath ? (
                <p className="mt-1 break-words text-[11px] leading-relaxed text-slate-700">{controlNetModelPath}</p>
              ) : (
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  未配置。请在 Civitai 收藏库右上角齿轮的“路径设置”里统一设置 ControlNet 模型路径。
                </p>
              )}
            </div>
            <Button
              className="h-9 shrink-0 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
              disabled={controlNetModelLoadStatus === "loading"}
              onClick={() => void loadControlNetModels()}
              type="button"
            >
              {controlNetModelLoadStatus === "loading" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Settings className="size-3.5" />
              )}
              刷新模型列表
            </Button>
          </div>
          {controlNetModelLoadStatus === "success" ? (
            <p className="mt-2 text-[11px] leading-relaxed text-emerald-700 [overflow-wrap:anywhere]">
              已从 {controlNetModelPath} 读取 {controlNetModelOptions.length} 个 ControlNet 模型。
            </p>
          ) : null}
          {controlNetModelLoadStatus === "error" && controlNetModelLoadError ? (
            <p className="mt-2 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
              {controlNetModelLoadError}
            </p>
          ) : null}
        </div>
      ) : null}
      {!available ? (
        <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          {message}
        </p>
      ) : null}
      {available && expanded && preview?.svg ? (
        <div className="grid gap-3">
          <div className="grid gap-3 rounded-md border border-sky-100 bg-white p-3">
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                checked={controlNetEnabled}
                className="mt-0.5 size-3.5 rounded border-slate-300 text-sky-600"
                onChange={(event) => onChange("openpose", { enabled: event.target.checked })}
                type="checkbox"
              />
              <span>
                <span className="font-semibold text-slate-800">Use OpenPose ControlNet in this generation</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                  When enabled, SceneForge uploads this OpenPose PNG to ComfyUI and inserts ControlNet nodes before KSampler.
                </span>
              </span>
            </label>
            {controlNetEnabled ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2 lg:col-span-4">
                  <ControlNetModelField
                    label="controlnet model"
                    modelOptions={controlNetModelOptions}
                    onChange={(value) => onChange("openpose", { modelName: value })}
                    value={controlNet.modelName}
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    Leave blank to auto-pick the first available OpenPose/DWPose ControlNet model from ComfyUI.
                  </p>
                </div>
                <NumberInput
                  label="strength"
                  max={2}
                  min={0}
                  onChange={(value) => onChange("openpose", { strength: value })}
                  step={0.05}
                  value={controlNet.strength}
                />
                <NumberInput
                  label="start"
                  max={1}
                  min={0}
                  onChange={(value) => onChange("openpose", { startPercent: value })}
                  step={0.05}
                  value={controlNet.startPercent}
                />
                <NumberInput
                  label="end"
                  max={1}
                  min={0}
                  onChange={(value) => onChange("openpose", { endPercent: value })}
                  step={0.05}
                  value={controlNet.endPercent}
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-relaxed text-slate-500">
              Preview only. Save this OpenPose map locally as a PNG when you need a ControlNet reference image.
            </p>
            <Button
              className="h-8 shrink-0 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
              disabled={saveStatus === "saving"}
              onClick={() => void savePng()}
              type="button"
            >
              {saveStatus === "saving" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              保存 PNG
            </Button>
          </div>
          <div
            className="flex w-full items-center justify-center overflow-hidden rounded-md border border-slate-900/10 bg-black [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: preview.svg }}
            style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
          />
          <div className="grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            <span className="rounded-md bg-white px-2 py-1.5">characters {preview.characterCount}</span>
            <span className="rounded-md bg-white px-2 py-1.5">visible {preview.visibleSkeletonCount}</span>
            <span className="rounded-md bg-white px-2 py-1.5">joints {preview.visibleJointCount}</span>
            <span className="rounded-md bg-white px-2 py-1.5">
              size {preview.width} x {preview.height}
            </span>
          </div>
          <ControlNetUnitCard
            description="Uploads the current 3D skeleton depth map and chains a Depth ControlNet after OpenPose when both are enabled."
            helpText="Leave blank to auto-pick a depth-like ControlNet model from ComfyUI."
            height={preview.height}
            label="Depth"
            modelOptions={controlNetModelOptions}
            onChange={(patch) => onChange("depth", patch)}
            preview={preview.depth}
            previewAvailable={available}
            unit={controlNets.depth}
            width={preview.width}
          />
          <ControlNetUnitCard
            description="Uploads a browser-rendered Three.js normal map from the current 3D mannequin meshes and chains Normal ControlNet after Depth."
            helpText="Leave blank to auto-pick a normal-like ControlNet model from ComfyUI."
            height={preview.height}
            label="Normal"
            modelOptions={controlNetModelOptions}
            onChange={(patch) => onChange("normal", patch)}
            preview={{
              error: normalPreview?.error,
              imageDataUrl: normalPreview?.imageDataUrl ?? null,
              loading: normalPreviewLoading,
              reason: normalPreview?.reason,
              svg: null,
              visibleJointCount: 0,
              visibleSkeletonCount: normalPreview?.available ? normalPreview.characterCount : 0,
            }}
            previewAvailable={Boolean(available && normalPreview?.available)}
            unit={controlNets.normal}
            width={preview.width}
          />
          {saveStatus === "success" ? (
            <p className="text-[11px] leading-relaxed text-emerald-700">OpenPose PNG 已开始保存。</p>
          ) : null}
          {saveStatus === "error" && saveError ? (
            <p className="text-[11px] leading-relaxed text-rose-700">{saveError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type ComfyUiGenerationDialogProps = {
  activePrompt: string;
  advice: CivitaiAiPromptResult | null;
  allowControlNet?: boolean;
  allowDiagnosis?: boolean;
  allowInpaint?: boolean;
  diagnosisScopes?: Partial<ComfyUiGenerationDiagnosisAdjustmentScopes>;
  baseNegativePrompt: string;
  description?: ReactNode;
  introContent?: ReactNode;
  negativePromptLocked?: boolean;
  onSaveParameters?: (parameters: SavedComfyUiGenerationParams) => void;
  onClose: () => void;
  open: boolean;
  positivePromptLocked?: boolean;
  /** Prompt fields are reset from active/base prompts only when this key changes. */
  promptRefreshKey?: string;
  savedParameters?: SavedComfyUiGenerationParams | null;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
  title?: string;
};

export function ComfyUiGenerationDialog({
  activePrompt,
  advice,
  allowControlNet = true,
  allowDiagnosis = true,
  allowInpaint = true,
  diagnosisScopes,
  baseNegativePrompt,
  description,
  introContent,
  negativePromptLocked = false,
  onSaveParameters,
  onClose,
  open,
  positivePromptLocked = false,
  promptRefreshKey,
  savedParameters = null,
  selectedCheckpointId,
  selectedLoraIds,
  title = "ComfyUI 生图",
}: ComfyUiGenerationDialogProps) {
  const scene = useEditorStore((state) => state.project.scene);
  const nsfwEnabled = useEditorStore((state) => state.project.settings.supportsNsfw === true);
  const comfyUiGeneratedImages = useEditorStore(
    (state) => state.project.settings.comfyUiGeneratedImages ?? [],
  );
  const appendComfyUiGeneratedImages = useEditorStore((state) => state.appendComfyUiGeneratedImages);
  const toggleComfyUiGeneratedImageFavorite = useEditorStore(
    (state) => state.toggleComfyUiGeneratedImageFavorite,
  );
  const deleteComfyUiGeneratedImage = useEditorStore((state) => state.deleteComfyUiGeneratedImage);
  const diagnosisPromptAllowed = diagnosisScopes?.prompt ?? true;
  const diagnosisParameterAllowed = diagnosisScopes?.parameters ?? true;
  const resolvedPromptRefreshKey = promptRefreshKey ?? `${activePrompt}\u0000${baseNegativePrompt}`;
  const previousPromptRefreshKeyRef = useRef<string | null>(null);
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_RESOURCES);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [controlNetExpanded, setControlNetExpanded] = useState(false);
  const [controlNetNormalPreview, setControlNetNormalPreview] = useState<ComfyUiNormalControlImagePreview | null>(null);
  const [controlNetNormalPreviewLoading, setControlNetNormalPreviewLoading] = useState(false);
  const [loraSettings, setLoraSettings] = useState<ComfyUiGenerationLoraSetting[]>([]);
  const [parameterSource, setParameterSource] = useState<ComfyUiGenerationParameterSource>("reference");
  const [downloadItems, setDownloadItems] = useState<ResourceDownloadItem[]>([]);
  const [downloadActionStatus, setDownloadActionStatus] = useState<DownloadActionStatus>("idle");
  const [downloadActionMessage, setDownloadActionMessage] = useState("");
  const [downloadActionError, setDownloadActionError] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [activeGenerationSubmitMode, setActiveGenerationSubmitMode] = useState<GenerationSubmitMode | null>(null);
  const [previewGenerationEnabled, setPreviewGenerationEnabled] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [waitMessage, setWaitMessage] = useState("");
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [selectedGeneratedImageKey, setSelectedGeneratedImageKey] = useState("");
  const [generatedImageFilter, setGeneratedImageFilter] = useState<GeneratedImageFilter>("all");
  const [sessionGeneratedImageKeys, setSessionGeneratedImageKeys] = useState<Set<string>>(() => new Set());
  const [historySaveStatus, setHistorySaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [historySaveMessage, setHistorySaveMessage] = useState("");
  const [inpaintImageItem, setInpaintImageItem] = useState<GeneratedImageItem | null>(null);
  const [diagnosisInput, setDiagnosisInput] = useState("");
  const [diagnosisParameterEnabled, setDiagnosisParameterEnabled] = useState(diagnosisParameterAllowed);
  const [diagnosisPromptEnabled, setDiagnosisPromptEnabled] = useState(diagnosisPromptAllowed);
  const [diagnosisWebEnabled, setDiagnosisWebEnabled] = useState(false);
  const [diagnosisWebContext, setDiagnosisWebContext] = useState<ComfyUiDiagnosisWebContext | null>(null);
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>("idle");
  const [diagnosisError, setDiagnosisError] = useState("");
  const [visualDiagnosisResult, setVisualDiagnosisResult] = useState<ComfyUiGenerationVisualDiagnosisResult | null>(null);
  const [diagnosisResult, setDiagnosisResult] = useState<ComfyUiGenerationDiagnosisResult | null>(null);
  const [diagnosisBaseConfig, setDiagnosisBaseConfig] = useState<ComfyUiGenerationDiagnosisConfig | null>(null);
  const [diagnosisApplied, setDiagnosisApplied] = useState(false);
  const { samplerOptions, schedulerOptions } = useComfyUiKSamplerOptions(open);
  const downloadItemById = useMemo(
    () => new Map(downloadItems.map((item) => [item.resource.id, item])),
    [downloadItems],
  );
  const missingDownloadItems = useMemo(
    () => downloadItems.filter((item) => !item.error && shouldDownloadComfyUiGenerationResource(item.status)),
    [downloadItems],
  );
  const blockedDownloadItems = useMemo(
    () => downloadItems.filter((item) => getResourceDownloadReadiness(item) === "blocked"),
    [downloadItems],
  );
  const allResourceDownloadsReady =
    downloadItems.length > 0 && downloadItems.every((item) => !item.error && isComfyUiGenerationResourceReady(item.status));
  const canSubmitGeneration =
    submitStatus !== "loading" &&
    downloadActionStatus !== "loading" &&
    loadStatus === "success" &&
    Boolean(draft) &&
    allResourceDownloadsReady;
  const draftWorkflowProfile = draft ? resolveComfyUiTextToImageWorkflowProfile(draft) : null;
  const controlNetOpenPosePreview = useMemo(
    () =>
      allowControlNet && draft
        ? buildComfyUiControlNetOpenPosePreview(scene, {
            width: draft.width,
            height: draft.height,
          })
        : null,
    [allowControlNet, draft, scene],
  );

  useEffect(() => {
    if (!open) {
      previousPromptRefreshKeyRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!allowControlNet || !draft || !open) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setControlNetNormalPreviewLoading(true);

      void renderComfyUiNormalControlImage(scene, {
        width: draft.width,
        height: draft.height,
      }).then((preview) => {
        if (cancelled) {
          return;
        }

        setControlNetNormalPreview(preview);
        setControlNetNormalPreviewLoading(false);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [allowControlNet, draft, open, scene]);

  function clearDiagnosisReview() {
    setDiagnosisStatus("idle");
    setDiagnosisError("");
    setDiagnosisWebContext(null);
    setVisualDiagnosisResult(null);
    setDiagnosisResult(null);
    setDiagnosisBaseConfig(null);
    setDiagnosisApplied(false);
  }

  function resetDiagnosisState() {
    setSelectedGeneratedImageKey("");
    setDiagnosisInput("");
    setDiagnosisParameterEnabled(diagnosisParameterAllowed);
    setDiagnosisPromptEnabled(diagnosisPromptAllowed);
    setDiagnosisWebEnabled(false);
    clearDiagnosisReview();
  }

  async function loadGenerationContext() {
    setLoadStatus("loading");
    setLoadError("");
    setDownloadItems([]);
    setDownloadActionStatus("idle");
    setDownloadActionMessage("");
    setDownloadActionError("");
    setSubmitStatus("idle");
    setActiveGenerationSubmitMode(null);
    setSubmitError("");
    setSaveMessage("");
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
    setGeneratedImageFilter("all");
    setSessionGeneratedImageKeys(new Set());
    setHistorySaveStatus("idle");
    setHistorySaveMessage("");
    setInpaintImageItem(null);
    setControlNetExpanded(false);
    setControlNetNormalPreview(null);
    setControlNetNormalPreviewLoading(false);
    resetDiagnosisState();

    try {
      const query = buildSelectedCivitaiResourcesQuery(selectedCheckpointId, selectedLoraIds);
      const resources = query
        ? await fetchJson<SelectedCivitaiResourcesPreview>(`/api/civitai-lora-library/selected-resources?${query}`)
        : EMPTY_SELECTED_RESOURCES;
      if (!resources.checkpoint) {
        throw new Error("请先选择一个 Civitai checkpoint。");
      }

      const settings = resolveComfyUiGenerationSettings({
        activePrompt,
        baseNegativePrompt,
        selectedResources: resources,
        aiAdvice: advice,
        savedParameters,
        supportsNsfw: nsfwEnabled,
      });

      setSelectedResources(resources);
      const nextDraft = toDraft(settings.request, settings.loras, savedParameters?.seedMode, savedParameters);
      const previousPromptRefreshKey = previousPromptRefreshKeyRef.current;
      setDraft((currentDraft) =>
        mergeDraftWithPromptRefresh({
          currentDraft,
          nextDraft,
          nextPromptRefreshKey: resolvedPromptRefreshKey,
          previousPromptRefreshKey,
        }),
      );
      previousPromptRefreshKeyRef.current = resolvedPromptRefreshKey;
      setLoraSettings(settings.loras);
      setParameterSource(settings.parameterSource);
      setDownloadItems(await loadResourceDownloadItems(resources));
      setLoadStatus("success");
    } catch (error) {
      setSelectedResources(EMPTY_SELECTED_RESOURCES);
      setDraft(null);
      setLoraSettings([]);
      setDownloadItems([]);
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "无法读取生图上下文。");
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadGenerationContext();
    }, 0);

    return () => window.clearTimeout(timeout);
    // Reload resource context whenever selections change; prompt fields refresh only when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCheckpointId, selectedLoraIdsKey, resolvedPromptRefreshKey, advice]);

  function closeModal() {
    if (submitStatus === "loading" || downloadActionStatus === "loading") {
      return;
    }

    onClose();
  }

  function patchDraft(patch: Partial<GenerationDraft>) {
    clearDiagnosisReview();
    setSaveMessage("");
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function patchPromptWrapper(patch: Partial<GenerationDraft["promptWrapper"]>) {
    clearDiagnosisReview();
    setSaveMessage("");
    setDraft((current) => (
      current
        ? {
            ...current,
            promptWrapper: {
              ...current.promptWrapper,
              ...patch,
            },
          }
        : current
    ));
  }

  function patchFaceDetailer(patch: Partial<GenerationDraft["faceDetailer"]>) {
    clearDiagnosisReview();
    setSaveMessage("");
    setDraft((current) => (
      current
        ? {
            ...current,
            faceDetailer: {
              ...current.faceDetailer,
              ...patch,
            },
          }
        : current
    ));
  }

  function patchHandDetailer(patch: Partial<GenerationDraft["handDetailer"]>) {
    clearDiagnosisReview();
    setSaveMessage("");
    setDraft((current) => (
      current
        ? {
            ...current,
            handDetailer: {
              ...current.handDetailer,
              ...patch,
            },
          }
        : current
    ));
  }

  function patchControlNet(
    type: GenerationDraftControlNetUnit["type"],
    patch: Partial<GenerationDraftControlNetUnit>,
  ) {
    setSaveMessage("");
    setDraft((current) => (
      current
        ? {
            ...current,
            controlNets: {
              ...current.controlNets,
              [type]: {
                ...current.controlNets[type],
                ...patch,
              },
            },
          }
        : current
    ));
  }

  function patchLora(index: number, patch: Partial<GenerationDraft["loras"][number]>) {
    clearDiagnosisReview();
    setSaveMessage("");
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        loras: current.loras.map((lora, loraIndex) => (loraIndex === index ? { ...lora, ...patch } : lora)),
      };
    });
  }

  function saveCurrentParameters() {
    if (!draft || !onSaveParameters) {
      return;
    }

    onSaveParameters(toSavedParameters(draft));
    setSaveMessage("当前参数已保存，后续风格调色板和 ComfyUI 生图都会优先使用。");
  }

  async function downloadMissingResources() {
    const targets = missingDownloadItems;
    if (targets.length === 0) {
      return;
    }

    setDownloadActionStatus("loading");
    setDownloadActionMessage("");
    setDownloadActionError("");
    setSubmitStatus("idle");
    setActiveGenerationSubmitMode(null);
    setSubmitError("");
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
    setHistorySaveStatus("idle");
    setHistorySaveMessage("");
    resetDiagnosisState();

    try {
      let bytesWritten = 0;
      for (const item of targets) {
        const result = await fetchJson<CivitaiResourceDownloadResult>(
          `/api/civitai-lora-library/resources/${encodeURIComponent(item.resource.id)}/download`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ action: "download" }),
          },
        );
        bytesWritten += result.bytesWritten;
      }

      const refreshedItems = await loadResourceDownloadItems(selectedResources);
      setDownloadItems(refreshedItems);
      const remaining = refreshedItems.filter((item) => getResourceDownloadReadiness(item) !== "ready");

      if (remaining.length > 0) {
        setDownloadActionStatus("error");
        setDownloadActionError("模型下载后仍有资源不可用，请检查下载路径、校验结果或 Civitai 连接。");
        return;
      }

      setDownloadActionStatus("success");
      setDownloadActionMessage(
        `${targets.length} 个模型文件已准备好${bytesWritten > 0 ? `，新增 ${Math.round(bytesWritten / 1024 / 1024)} MB` : ""}。`,
      );
    } catch (error) {
      setDownloadActionStatus("error");
      setDownloadActionError(error instanceof Error ? error.message : "模型下载失败。");
      setDownloadItems(await loadResourceDownloadItems(selectedResources));
    }
  }

  async function persistGeneratedImageHistory({
    images,
    result,
    savedImage,
  }: {
    images: ComfyUiGeneratedImage[];
    result: GenerationResult;
    savedImage: SavedGeneratedImageResponse;
  }) {
    const {
      draftSnapshot,
      negativePrompt,
      parentImageId,
      positivePrompt,
      selectedCheckpointId: checkpointId,
      selectedLoraIds: loraIds,
    } = result.historyContext;
    const records = createComfyUiGeneratedImageRecords({
      draft: draftSnapshot,
      images,
      negativePrompt,
      parentImageId,
      positivePrompt,
      result,
      savedImage,
      selectedCheckpointId: checkpointId,
      selectedLoraIds: loraIds,
    });

    if (records.length === 0) {
      return;
    }

    setSessionGeneratedImageKeys((current) => {
      const next = new Set(current);
      for (const image of images) {
        next.add(getGeneratedImageSessionKey(result.promptId, image));
      }
      return next;
    });
    appendComfyUiGeneratedImages(records);
    setHistorySaveStatus("saving");
    setHistorySaveMessage("正在保存到当前项目图片历史...");

    try {
      await saveProject(useEditorStore.getState().project);
      setHistorySaveStatus("success");
      const sourceDeletionMessage = formatSavedImageSourceDeletionMessage(savedImage);
      setHistorySaveMessage(
        `已保存 ${records.length} 张图到当前项目历史。${sourceDeletionMessage ? ` ${sourceDeletionMessage}` : ""}`,
      );
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(
        error instanceof Error
          ? `图片已生成，但保存到项目历史失败：${error.message}`
          : "图片已生成，但保存到项目历史失败。",
      );
    }
  }

  async function persistHistoryMutation(successMessage: string, failurePrefix: string) {
    setHistorySaveStatus("saving");
    setHistorySaveMessage("正在保存项目图片历史...");

    try {
      await saveProject(useEditorStore.getState().project);
      setHistorySaveStatus("success");
      setHistorySaveMessage(successMessage);
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(
        error instanceof Error
          ? `${failurePrefix}：${error.message}`
          : failurePrefix,
      );
    }
  }

  function handleToggleGeneratedImageFavorite(id: string) {
    toggleComfyUiGeneratedImageFavorite(id);
    void persistHistoryMutation("收藏状态已保存。", "收藏状态已更新，但保存项目失败");
  }

  function removeCurrentGeneratedImage(image: Pick<ComfyUiGeneratedImage, "filename" | "nodeId" | "subfolder" | "type">) {
    const targetKey = getGeneratedImageReferenceKey(image);
    setResults((current) =>
      current
        .map((result) => ({
          ...result,
          images: result.images.filter((candidate) => getGeneratedImageReferenceKey(candidate) !== targetKey),
        }))
        .filter((result) => result.images.length > 0 || submitStatus === "loading"),
    );
  }

  async function deleteComfyUiSourceImage(image: SavedComfyUiImageReference) {
    await fetchJson<{ deleted: boolean }>("/api/comfyui/files", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ image }),
    });
  }

  async function deletePersistedGeneratedImageFile(record: SavedComfyUiGeneratedImage) {
    if (record.storage === "sceneforge" && record.localFilename) {
      await fetchJson<{ deleted: boolean }>(
        `/api/comfyui/generated-images/${encodeURIComponent(record.localFilename)}`,
        { method: "DELETE" },
      );
      return true;
    }

    return false;
  }

  async function handleDeleteGeneratedImage(id: string) {
    const record = comfyUiGeneratedImages.find((image) => image.id === id);
    if (!record) {
      return;
    }

    setHistorySaveStatus("saving");
    setHistorySaveMessage("正在删除图片文件...");

    const previousProject = useEditorStore.getState().project;
    deleteComfyUiGeneratedImage(id);

    try {
      await saveProject(useEditorStore.getState().project);
    } catch (error) {
      useEditorStore.getState().setProject(previousProject);
      setHistorySaveStatus("error");
      setHistorySaveMessage(
        error instanceof Error
          ? `项目历史保存失败，未删除图片文件：${error.message}`
          : "项目历史保存失败，未删除图片文件。",
      );
      return;
    }

    try {
      const deletedSourceFile = await deletePersistedGeneratedImageFile(record);
      removeCurrentGeneratedImage({
        ...(record.sourceReference ?? record),
        nodeId: record.nodeId,
      });
      if (selectedGeneratedImageKey === `history:${id}`) {
        setSelectedGeneratedImageKey("");
        clearDiagnosisReview();
      }
      await saveProject(useEditorStore.getState().project);
      setHistorySaveStatus("success");
      setHistorySaveMessage(
        deletedSourceFile
          ? "图片文件已删除，并已从项目历史移除。"
          : "已从项目历史移除；旧 ComfyUI output 记录不再尝试删除源文件。",
      );
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(
        error instanceof Error
          ? `已从项目历史移除，但图片文件删除失败：${error.message}`
          : "已从项目历史移除，但图片文件删除失败。",
      );
    }
  }

  async function handleDeleteGeneratedImageItem(item: GeneratedImageItem) {
    if (item.persisted && item.historyId) {
      await handleDeleteGeneratedImage(item.historyId);
      return;
    }

    setHistorySaveStatus("saving");
    setHistorySaveMessage("正在删除 ComfyUI 临时图片...");

    try {
      await deleteComfyUiSourceImage(item.image);
      removeCurrentGeneratedImage(item.image);
      if (selectedGeneratedImageKey === getGeneratedImageItemKey(item)) {
        setSelectedGeneratedImageKey("");
        clearDiagnosisReview();
      }
      setHistorySaveStatus("success");
      setHistorySaveMessage("ComfyUI 临时图片已删除。");
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(error instanceof Error ? error.message : "删除 ComfyUI 临时图片失败。");
    }
  }

  async function handleSaveGeneratedImage(item: GeneratedImageItem) {
    if (item.persisted || !item.promptId) {
      return;
    }

    const result = results.find((candidate) => candidate.promptId === item.promptId);
    if (!result) {
      setHistorySaveStatus("error");
      setHistorySaveMessage("未找到这张图的生成记录，无法保存到项目历史。");
      return;
    }

    setHistorySaveStatus("saving");
    setHistorySaveMessage("正在复制图片到本地保存目录...");

    try {
      const savedImage = await fetchJson<SavedGeneratedImageResponse>("/api/comfyui/generated-images", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ image: item.image }),
      });

      await persistGeneratedImageHistory({
        images: [item.image],
        result,
        savedImage,
      });
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(error instanceof Error ? error.message : "保存图片到本地失败。");
    }
  }

  async function submitGeneration(mode: GenerationSubmitMode = "full") {
    if (!draft) {
      return;
    }

    const previewMode = mode === "preview";
    if (!allResourceDownloadsReady) {
      setWaitMessage("");
      setGenerationProgress(null);
      setSubmitStatus("error");
      setSubmitError("请先下载并确认当前 checkpoint / LoRA 文件可用，然后再开始生图。");
      return;
    }

    setSubmitStatus("loading");
    setActiveGenerationSubmitMode(mode);
    setSubmitError("");
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
    setHistorySaveStatus("idle");
    setHistorySaveMessage("");
    resetDiagnosisState();

    try {
      const imageCount = normalizeComfyUiGenerationImageCount(draft.imageCount);
      const seed = resolveComfyUiGenerationSeed({
        currentSeed: draft.seed,
        mode: draft.seedMode,
      });
      const clientId = createComfyUiClientId();

      if (!previewMode) {
        setDraft((current) => (current ? { ...current, imageCount, seed } : current));
      }
      setWaitMessage(`已准备生成 ${imageCount} 张图片，正在提交到 ComfyUI...`);

      const requestDraft = draft;
      const requestControlNetOpenPosePreview = allowControlNet
        ? controlNetOpenPosePreview
        : null;
      const requestControlNetNormalPreview = allowControlNet
        ? controlNetNormalPreview
        : null;

      const baseRequestPayload = toRequestPayload(
        { ...requestDraft, imageCount },
        seed,
        requestControlNetOpenPosePreview,
        requestControlNetNormalPreview,
      );
      const requestPayload = previewMode
        ? createComfyUiTextToImagePreviewRequest(baseRequestPayload)
        : baseRequestPayload;
      const submittedImageCount = normalizeComfyUiGenerationImageCount(requestPayload.batchSize ?? imageCount);
      const submittedDraftSnapshot: GenerationDraft = {
        ...draft,
        faceDetailer: {
          ...draft.faceDetailer,
          enabled: requestPayload.faceDetailer?.enabled ?? draft.faceDetailer.enabled,
        },
        handDetailer: {
          ...draft.handDetailer,
          enabled: requestPayload.handDetailer?.enabled ?? draft.handDetailer.enabled,
        },
        height: requestPayload.height ?? draft.height,
        imageCount: submittedImageCount,
        seed,
        steps: requestPayload.steps ?? draft.steps,
        width: requestPayload.width ?? draft.width,
      };
      if (previewMode) {
        setWaitMessage(`Submitting ${submittedDraftSnapshot.width}x${submittedDraftSnapshot.height} preview to ComfyUI...`);
      }
      const payload = await fetchJson<Omit<GenerationResult, "historyContext" | "imageCount" | "images" | "seed" | "source">>("/api/comfyui/generate-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestPayload, clientId }),
      });

      const queuedResult: GenerationResult = {
        historyContext: {
          draftSnapshot: submittedDraftSnapshot,
          negativePrompt: requestPayload.negativePrompt ?? draft.negativePrompt,
          positivePrompt: requestPayload.positivePrompt,
          selectedCheckpointId,
          selectedLoraIds: [...selectedLoraIds],
        },
        imageCount: submittedImageCount,
        images: [],
        promptId: payload.promptId,
        number: payload.number,
        outputNodeId: payload.outputNodeId,
        seed,
        source: "text-to-image",
      };

      setResults([queuedResult]);
      setWaitMessage(`已提交 batch_size ${imageCount} 到 ComfyUI，seed ${seed}。`);

      if (previewMode) {
        setWaitMessage(`Preview submitted to ComfyUI, seed ${seed}.`);
      }

      const history = await waitForComfyUiGeneratedImages(clientId, payload.promptId, submittedImageCount, (historyUpdate) => {
        const progress = readComfyUiProgress(historyUpdate.raw);
        if (progress) {
          setGenerationProgress(progress);
          setWaitMessage(`KSampler 采样进度 ${progress.value}/${progress.max}`);
        }

        if (historyUpdate.images.length > 0) {
          setResults([{ ...queuedResult, images: historyUpdate.images }]);
          if (previewMode) {
            setWaitMessage(`Received ${historyUpdate.images.length}/${submittedImageCount} preview image, seed ${seed}.`);
            return;
          }
          setWaitMessage(`已获取 ${historyUpdate.images.length}/${imageCount} 张图片，seed ${seed}。`);
        }
      });

      const finalResult = { ...queuedResult, images: history.images };
      setResults([finalResult]);
      setGenerationProgress({ value: 1, max: 1 });
      setWaitMessage("");
      setSubmitStatus("success");
      setHistorySaveStatus("idle");
      setHistorySaveMessage("图片已生成，默认不保存到项目历史；需要保留时请点击图片下方的保存按钮。");
      if (previewMode) {
        setHistorySaveMessage("Preview image generated. Save the candidate if you want to keep it.");
      }
    } catch (error) {
      setWaitMessage("");
      setGenerationProgress(null);
      setSubmitStatus("error");
      setSubmitError(error instanceof Error ? error.message : "ComfyUI 生图请求失败。");
    } finally {
      setActiveGenerationSubmitMode(null);
    }
  }

  async function submitInpaint(input: InpaintSubmitInput) {
    if (!draft) {
      throw new Error("Inpaint settings are not ready.");
    }

    if (!allResourceDownloadsReady) {
      const message = "Download the selected checkpoint / LoRA files before inpainting.";
      setSubmitStatus("error");
      setSubmitError(message);
      throw new Error(message);
    }

    setSubmitStatus("loading");
    setSubmitError("");
    setWaitMessage("");
    setGenerationProgress(null);
    setHistorySaveStatus("idle");
    setHistorySaveMessage("");
    clearDiagnosisReview();
    setDraft((current) => (
      current
        ? {
            ...current,
            inpaint: {
              ...current.inpaint,
              denoise: input.denoise,
              growMaskBy: input.growMaskBy,
              mode: input.mode,
            },
          }
        : current
    ));

    try {
      const clientId = createComfyUiClientId();
      const requestPayload = toInpaintRequestPayload(draft, input);

      setWaitMessage("Submitting inpaint job to ComfyUI...");

      const payload = await fetchJson<Omit<GenerationResult, "historyContext" | "imageCount" | "images" | "seed" | "source">>("/api/comfyui/inpaint-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestPayload, clientId }),
      });
      const parentImageId = inpaintImageItem?.historyId;
      const queuedResult: GenerationResult = {
        historyContext: {
          draftSnapshot: {
            ...draft,
            seed: input.seed,
            inpaint: {
              ...draft.inpaint,
              denoise: input.denoise,
              growMaskBy: input.growMaskBy,
              mode: input.mode,
            },
          },
          negativePrompt: input.negativePrompt,
          ...(parentImageId ? { parentImageId } : {}),
          positivePrompt: input.positivePrompt,
          selectedCheckpointId,
          selectedLoraIds: [...selectedLoraIds],
        },
        imageCount: 1,
        images: [],
        promptId: payload.promptId,
        number: payload.number,
        outputNodeId: payload.outputNodeId,
        seed: input.seed,
        source: "inpaint",
      };

      setResults((current) => [...current, queuedResult]);
      setWaitMessage(`Inpaint job submitted to ComfyUI, seed ${input.seed}.`);

      const history = await waitForComfyUiGeneratedImages(clientId, payload.promptId, 1, (historyUpdate) => {
        const progress = readComfyUiProgress(historyUpdate.raw);
        if (progress) {
          setGenerationProgress(progress);
          setWaitMessage(`KSampler progress ${progress.value}/${progress.max}`);
        }

        if (historyUpdate.images.length > 0) {
          setResults((current) =>
            current.map((result) => (
              result.promptId === payload.promptId
                ? { ...queuedResult, images: historyUpdate.images }
                : result
            )),
          );
          setWaitMessage(`Received ${historyUpdate.images.length}/1 inpaint image, seed ${input.seed}.`);
        }
      });

      const finalResult = { ...queuedResult, images: history.images };
      setResults((current) =>
        current.map((result) => (
          result.promptId === payload.promptId
            ? finalResult
            : result
        )),
      );
      setGenerationProgress({ value: 1, max: 1 });
      setWaitMessage("");
      setSubmitStatus("success");
      setHistorySaveStatus("idle");
      setHistorySaveMessage("Inpaint 图片已生成，默认不保存到项目历史；需要保留时请点击图片下方的保存按钮。");
      setInpaintImageItem(null);
    } catch (error) {
      setWaitMessage("");
      setGenerationProgress(null);
      setSubmitStatus("error");
      setSubmitError(error instanceof Error ? error.message : "ComfyUI inpaint request failed.");
      throw error;
    }
  }

  async function runDiagnosis() {
    if (!draft || !selectedGeneratedImage) {
      return;
    }

    const adjustmentScopes: ComfyUiGenerationDiagnosisAdjustmentScopes = {
      parameters: diagnosisParameterAllowed && diagnosisParameterEnabled,
      prompt: diagnosisPromptAllowed && diagnosisPromptEnabled,
    };
    if (!adjustmentScopes.prompt && !adjustmentScopes.parameters) {
      setDiagnosisStatus("error");
      setDiagnosisError("请至少启用 Prompt 诊断或模型参数诊断。");
      return;
    }

    setDiagnosisStatus("analyzing");
    setDiagnosisError("");
    setVisualDiagnosisResult(null);
    setDiagnosisResult(null);
    setDiagnosisBaseConfig(null);
    setDiagnosisApplied(false);

    try {
      const baseConfig = toDiagnosisConfig(draft, selectedResources, loraSettings);
      const imageDataUrl = await loadOriginalImageUrlToDataUrl(selectedGeneratedImage.url);
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          purpose: "comfyui-generation-diagnosis",
          messages: buildComfyUiGenerationVisualDiagnosisMessages({
            config: baseConfig,
            imageDataUrl,
            userInput: diagnosisInput,
          }),
          temperature: 0.15,
          maxTokens: 1000,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI 诊断返回格式不正确，请重试。");
      }

      const visualParsed = parseComfyUiGenerationVisualDiagnosisResponse(payload.content);
      if (!visualParsed) {
        throw new Error("AI 诊断没有返回可用 JSON，请重试。");
      }

      setVisualDiagnosisResult(visualParsed);
      setDiagnosisBaseConfig(baseConfig);
      let webContext: ComfyUiDiagnosisWebContext | null = null;
      if (diagnosisWebEnabled) {
        setDiagnosisStatus("searching");
        try {
          const webResponse = await fetch("/api/comfyui/diagnosis/web-context", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              config: baseConfig,
              userInput: diagnosisInput,
              visualDiagnosis: visualParsed,
            }),
          });
          const webPayload: unknown = await webResponse.json().catch(() => null);

          if (webResponse.ok && isComfyUiDiagnosisWebContextPayload(webPayload)) {
            webContext = webPayload;
          } else {
            webContext = {
              enabled: false,
              queries: [],
              sources: [],
              summary: "",
              warnings: [readErrorMessage(webPayload, "联网资料不可用，已使用本地上下文生成建议。")],
            };
          }
        } catch (error) {
          webContext = {
            enabled: false,
            queries: [],
            sources: [],
            summary: "",
            warnings: [error instanceof Error ? error.message : "联网资料不可用，已使用本地上下文生成建议。"],
          };
        }

        setDiagnosisWebContext(webContext);
      }
      setDiagnosisStatus("suggesting");

      const adjustmentResponse = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          purpose: "comfyui-generation-diagnosis",
          messages: buildComfyUiGenerationAdjustmentMessages({
            adjustmentScopes,
            config: baseConfig,
            userInput: diagnosisInput,
            visualDiagnosis: visualParsed,
            webContext,
          }),
          temperature: 0.15,
          maxTokens: 1400,
        }),
      });
      const adjustmentPayload: unknown = await adjustmentResponse.json().catch(() => null);

      if (!adjustmentResponse.ok) {
        throw new Error(getLlmProxyErrorMessage(adjustmentPayload));
      }

      if (!isLlmChatResponse(adjustmentPayload)) {
        throw new Error("AI 参数建议返回格式不正确，请重试。");
      }

      const parsed = parseComfyUiGenerationDiagnosisResponse(adjustmentPayload.content, baseConfig, adjustmentScopes);
      if (!parsed) {
        throw new Error("AI 参数建议没有返回可用 JSON，请重试。");
      }

      setDiagnosisResult(parsed);
      setDiagnosisStatus("success");
    } catch (error) {
      console.error("[SceneForge] [comfyui] AI diagnosis failed", { error });
      setDiagnosisStatus("error");
      setDiagnosisError(error instanceof Error ? error.message : "AI 诊断失败，请检查 LiteLLM 配置或稍后重试。");
    }
  }

  function applyDiagnosisResult() {
    if (!draft || !diagnosisResult) {
      return;
    }

    const currentConfig = toDiagnosisConfig(draft, selectedResources, loraSettings);
    const nextConfig = applyComfyUiGenerationDiagnosisAdjustments(currentConfig, diagnosisResult.adjustments);
    const nextLoraByName = new Map(nextConfig.loras.map((lora) => [lora.loraName, lora]));
    const adjustedLoraNames = new Set((diagnosisResult.adjustments.loras ?? []).map((lora) => lora.loraName));
    const hasParameterAdjustments = hasModelParameterDiagnosisAdjustments(diagnosisResult.adjustments);

    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        cfg: nextConfig.cfg,
        denoise: nextConfig.denoise,
        height: nextConfig.height,
        loras: current.loras.map((lora) => {
          const nextLora = nextLoraByName.get(lora.loraName);
          return nextLora
            ? {
                ...lora,
                enabled: nextLora.enabled,
                strengthClip: nextLora.strengthClip,
                strengthModel: nextLora.strengthModel,
              }
            : lora;
        }),
        negativePrompt: nextConfig.negativePrompt,
        positivePrompt: nextConfig.positivePrompt,
        samplerName: nextConfig.samplerName,
        scheduler: nextConfig.scheduler,
        seed: nextConfig.seed,
        seedMode: nextConfig.seedMode,
        steps: nextConfig.steps,
        width: nextConfig.width,
      };
    });
    if (adjustedLoraNames.size > 0) {
      setLoraSettings((current) =>
        current.map((setting) => (adjustedLoraNames.has(setting.loraName) ? { ...setting, source: "diagnosis" } : setting)),
      );
    }

    if (hasParameterAdjustments) {
      setParameterSource("diagnosis");
    }

    setDiagnosisApplied(true);
  }

  const workflowPreview = draft
    ? buildBasicTextToImageWorkflow(
        toRequestPayload(
          draft,
          draft.seed,
          allowControlNet ? controlNetOpenPosePreview : null,
          allowControlNet ? controlNetNormalPreview : null,
        ),
      )
    : null;
  const historyGeneratedImageItems = comfyUiGeneratedImages.map((record) => ({
    ...historyRecordToGeneratedImageItem(record),
    sessionGenerated: sessionGeneratedImageKeys.has(getGeneratedImageSessionKey(record.promptId, record)),
  }));
  const currentGeneratedImageItems = results.flatMap((result) =>
    result.images.map((image, index): GeneratedImageItem => ({
      favorited: false,
      id: `current:${result.promptId}:${getGeneratedImageReferenceKey(image)}:${index}`,
      image,
      persisted: false,
      promptId: result.promptId,
      resultSource: result.source,
      sessionGenerated: true,
      seed: result.seed,
    })),
  );
  const historyReferenceKeys = new Set(
    historyGeneratedImageItems.map(getGeneratedImageItemReferenceKey),
  );
  const generatedImageItems = [
    ...currentGeneratedImageItems.filter((item) => !historyReferenceKeys.has(getGeneratedImageItemReferenceKey(item))),
    ...historyGeneratedImageItems,
  ].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  const filteredGeneratedImageItems = generatedImageItems.filter((item) => {
    if (generatedImageFilter === "favorites") {
      return item.favorited;
    }

    if (generatedImageFilter === "session") {
      return item.sessionGenerated;
    }

    return true;
  });
  const generatedImages = generatedImageItems.map((item) => item.image);
  const selectedGeneratedImageItem =
    filteredGeneratedImageItems.find((item) => getGeneratedImageItemKey(item) === selectedGeneratedImageKey) ??
    generatedImageItems.find((item) => getGeneratedImageItemKey(item) === selectedGeneratedImageKey) ??
    filteredGeneratedImageItems[0] ??
    generatedImageItems[0] ??
    null;
  const selectedGeneratedImage = selectedGeneratedImageItem?.image ?? null;
  const diagnosisDiffRows = diagnosisResult && diagnosisBaseConfig
    ? buildDiagnosisDiffRows(diagnosisBaseConfig, diagnosisResult)
    : [];
  const diagnosisBusy = diagnosisStatus === "analyzing" || diagnosisStatus === "searching" || diagnosisStatus === "suggesting";
  const diagnosisHasEnabledScope =
    (diagnosisPromptAllowed && diagnosisPromptEnabled) ||
    (diagnosisParameterAllowed && diagnosisParameterEnabled);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
              role="dialog"
            >
              <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-start gap-3 border-b border-slate-100 bg-sky-50 p-5">
                  <div className="rounded-md bg-white p-2 text-sky-600">
                    <ImageIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold text-slate-900">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {description ?? <>参数来源：{formatSource(parameterSource)}。提交后会等待 ComfyUI 完成，并在这里显示生成图片。</>}
                    </p>
                  </div>
                  <button
                    aria-label="关闭 ComfyUI 生图弹窗"
                    className="rounded-full bg-white/80 p-1.5 text-slate-400 shadow-sm transition hover:bg-white hover:text-slate-700"
                    onClick={closeModal}
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {introContent ? <div className="mb-5">{introContent}</div> : null}
                  {loadStatus === "loading" ? (
                    <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-500">
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      正在读取当前生图上下文...
                    </div>
                  ) : null}

                  {loadStatus === "error" ? (
                    <div className="rounded-md border border-rose-100 bg-rose-50 p-4 text-sm leading-relaxed text-rose-700">
                      {loadError}
                    </div>
                  ) : null}

                  {loadStatus === "success" && draft && workflowPreview ? (
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                      <div className="space-y-5">
                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Active Prompt</p>
                          <textarea
                            className="min-h-[110px] w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            onChange={(event) => {
                              if (!positivePromptLocked) {
                                patchDraft({ positivePrompt: event.target.value });
                              }
                            }}
                            readOnly={positivePromptLocked}
                            value={draft.positivePrompt}
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Negative Prompt</p>
                          <textarea
                            className="min-h-[80px] w-full resize-y rounded-md border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                            onChange={(event) => {
                              if (!negativePromptLocked) {
                                patchDraft({ negativePrompt: event.target.value });
                              }
                            }}
                            readOnly={negativePromptLocked}
                            value={draft.negativePrompt}
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt Wrapper</p>
                          <div className="mb-3 flex flex-wrap gap-2">
                            {COMFYUI_PROMPT_WRAPPER_PRESETS.map((preset) => {
                              const selected = getPromptWrapperPresetId(draft.promptWrapper) === preset.id;
                              return (
                                <button
                                  className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                                    selected
                                      ? "border-sky-300 bg-sky-50 text-sky-700"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50"
                                  }`}
                                  key={preset.id}
                                  onClick={() =>
                                    patchPromptWrapper({
                                      negativePrefix: preset.negativePrefix,
                                      positivePrefix: preset.positivePrefix,
                                    })
                                  }
                                  type="button"
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <TextAreaInput
                              label="positive prefix"
                              onChange={(value) => patchPromptWrapper({ positivePrefix: value })}
                              value={draft.promptWrapper.positivePrefix}
                            />
                            <TextAreaInput
                              label="negative prefix"
                              onChange={(value) => patchPromptWrapper({ negativePrefix: value })}
                              value={draft.promptWrapper.negativePrefix}
                            />
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Checkpoint / LoRA</p>
                          <div className="space-y-2">
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                                <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{selectedResources.checkpoint?.name}</p>
                                {selectedResources.checkpoint ? (
                                  <ResourceDownloadBadge item={downloadItemById.get(selectedResources.checkpoint.id)} />
                                ) : null}
                              </div>
                              <p className="mt-1 break-all text-xs text-slate-500">{draft.checkpointName}</p>
                              <p className="mt-2 text-[11px] text-slate-400">
                                profile: {draftWorkflowProfile?.label ?? "Illustrious/default txt2img"} | base:{" "}
                                {draft.modelBaseModel ?? selectedResources.checkpoint?.baseModel ?? "unknown"} | storage:{" "}
                                {draft.modelStorageKind ?? selectedResources.checkpoint?.modelStorageKind ?? "checkpoint"}
                              </p>
                            </div>
                            {draft.loras.length > 0 ? (
                              draft.loras.map((lora, index) => (
                                <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_88px_88px]" key={`${lora.loraName}-${index}`}>
                                  <div className="min-w-0">
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                                      <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                                        {loraSettings[index]?.resource.name ?? lora.loraName}
                                      </p>
                                      {loraSettings[index]?.resource ? (
                                        <ResourceDownloadBadge item={downloadItemById.get(loraSettings[index].resource.id)} />
                                      ) : null}
                                    </div>
                                    <p className="mt-1 break-all text-xs text-slate-500">{lora.loraName}</p>
                                    <p className="mt-1 text-[11px] text-slate-400">
                                      weight source: {formatSource(loraSettings[index]?.source ?? "reference")}
                                    </p>
                                    <label className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                                      <input
                                        checked={lora.enabled}
                                        className="size-3.5 rounded border-slate-300 text-sky-600"
                                        onChange={(event) => patchLora(index, { enabled: event.target.checked })}
                                        type="checkbox"
                                      />
                                      本次生图使用
                                    </label>
                                  </div>
                                  <NumberInput
                                    label="model"
                                    onChange={(value) => patchLora(index, { strengthModel: value })}
                                    step={0.05}
                                    value={lora.strengthModel}
                                  />
                                  <NumberInput
                                    label="clip"
                                    onChange={(value) => patchLora(index, { strengthClip: value })}
                                    step={0.05}
                                    value={lora.strengthClip}
                                  />
                                </div>
                              ))
                            ) : (
                              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                                当前未选择 LoRA。
                              </p>
                            )}
                            {downloadItems.length > 0 ? (
                              <div
                                className={`rounded-md border p-3 ${
                                  allResourceDownloadsReady
                                    ? "border-emerald-100 bg-emerald-50"
                                    : blockedDownloadItems.length > 0
                                      ? "border-rose-100 bg-rose-50"
                                      : "border-amber-100 bg-amber-50"
                                }`}
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="flex min-w-0 gap-2">
                                    {allResourceDownloadsReady ? (
                                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                                    ) : blockedDownloadItems.length > 0 ? (
                                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
                                    ) : (
                                      <Download className="mt-0.5 size-4 shrink-0 text-amber-600" />
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-slate-800">
                                        {allResourceDownloadsReady
                                          ? "模型文件已准备好"
                                          : blockedDownloadItems.length > 0
                                            ? "模型下载路径需要先处理"
                                            : "开始生图前需要先下载模型"}
                                      </p>
                                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                                        {allResourceDownloadsReady
                                          ? "当前 checkpoint 与 LoRA 均可交给 ComfyUI 使用。"
                                          : blockedDownloadItems.length > 0
                                            ? "请先在 Civitai 资源库设置下载路径并确认目录存在。"
                                            : `${missingDownloadItems.length} 个模型文件尚未就绪，请先下载后再提交 ComfyUI。`}
                                      </p>
                                    </div>
                                  </div>
                                  {missingDownloadItems.length > 0 ? (
                                    <Button
                                      className="h-8 shrink-0 rounded-md bg-amber-600 px-3 text-xs text-white hover:bg-amber-700 disabled:opacity-60"
                                      disabled={downloadActionStatus === "loading" || blockedDownloadItems.length > 0}
                                      onClick={() => void downloadMissingResources()}
                                      type="button"
                                    >
                                      {downloadActionStatus === "loading" ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : (
                                        <Download className="size-3.5" />
                                      )}
                                      先下载模型
                                    </Button>
                                  ) : null}
                                </div>
                                <div className="mt-3 space-y-1.5">
                                  {downloadItems.map((item) => (
                                    <div className="rounded-md bg-white/70 px-2 py-1.5" key={item.resource.id}>
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="min-w-0 truncate text-[11px] font-medium text-slate-700">
                                          {item.label} · {item.resource.name}
                                        </p>
                                        <ResourceDownloadBadge item={item} />
                                      </div>
                                      {item.error || item.status?.message ? (
                                        <p className="mt-0.5 break-words text-[10px] leading-relaxed text-slate-500">
                                          {item.error ?? item.status?.message}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                                {downloadActionStatus === "success" && downloadActionMessage ? (
                                  <p className="mt-2 text-[11px] leading-relaxed text-emerald-700">{downloadActionMessage}</p>
                                ) : null}
                                {downloadActionStatus === "error" && downloadActionError ? (
                                  <p className="mt-2 text-[11px] leading-relaxed text-rose-700">{downloadActionError}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">KSampler / Latent 参数</p>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <NumberInput label="width" min={16} onChange={(value) => patchDraft({ width: Math.round(value / 8) * 8 })} step={8} value={draft.width} />
                            <NumberInput label="height" min={16} onChange={(value) => patchDraft({ height: Math.round(value / 8) * 8 })} step={8} value={draft.height} />
                            <div className="grid gap-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">seed</span>
                                <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                                  {(["random", "fixed"] as const).map((mode) => (
                                    <button
                                      className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                                        draft.seedMode === mode ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"
                                      }`}
                                      key={mode}
                                      onClick={() => patchDraft({ seedMode: mode })}
                                      title={mode === "random" ? "每次提交前随机生成 seed" : "使用当前 seed 重复生成"}
                                      type="button"
                                    >
                                      {mode === "random" ? "随机" : "固定"}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <input
                                className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                                min={0}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  if (Number.isFinite(parsed)) {
                                    patchDraft({ seed: Math.round(parsed), seedMode: "fixed" });
                                  }
                                }}
                                step={1}
                                type="number"
                                value={draft.seed}
                              />
                            </div>
                            <NumberInput label="steps" min={1} onChange={(value) => patchDraft({ steps: Math.round(value) })} value={draft.steps} />
                            <NumberInput label="cfg" min={0} onChange={(value) => patchDraft({ cfg: value })} step={0.5} value={draft.cfg} />
                            <NumberInput label="denoise" max={1} min={0} onChange={(value) => patchDraft({ denoise: value })} step={0.05} value={draft.denoise} />
                            <NumberInput
                              label="images"
                              max={MAX_COMFYUI_GENERATION_IMAGE_COUNT}
                              min={1}
                              onChange={(value) => patchDraft({ imageCount: normalizeComfyUiGenerationImageCount(value) })}
                              value={draft.imageCount}
                            />
                            <SelectInput
                              label="sampler"
                              onChange={(value) => patchDraft({ samplerName: value })}
                              options={samplerOptions}
                              value={draft.samplerName}
                            />
                            <SelectInput
                              label="scheduler"
                              onChange={(value) => patchDraft({ scheduler: value })}
                              options={schedulerOptions}
                              value={draft.scheduler}
                            />
                            <SelectInput
                              label="latent"
                              onChange={(value) => patchDraft({ latentImageNode: value as GenerationDraft["latentImageNode"] })}
                              options={COMFYUI_LATENT_IMAGE_NODE_OPTIONS}
                              value={draft.latentImageNode}
                            />
                            <TextInput label="output" onChange={(value) => patchDraft({ outputPrefix: value })} value={draft.outputPrefix} />
                            {allowControlNet ? (
                              <ControlNetOpenPoseFoldout
                                controlNets={draft.controlNets}
                                expanded={Boolean(controlNetOpenPosePreview?.available && controlNetExpanded)}
                                normalPreview={controlNetNormalPreview}
                                normalPreviewLoading={controlNetNormalPreviewLoading}
                                onChange={patchControlNet}
                                onToggle={() => setControlNetExpanded((value) => !value)}
                                preview={controlNetOpenPosePreview}
                              />
                            ) : null}
                            <DetailerFoldout
                              detailer={draft.handDetailer}
                              label="HandDetailer"
                              onChange={patchHandDetailer}
                              parameterLabel="hand"
                              samplerOptions={samplerOptions}
                              schedulerOptions={schedulerOptions}
                            />
                            <DetailerFoldout
                              detailer={draft.faceDetailer}
                              label="FaceDetailer"
                              onChange={patchFaceDetailer}
                              parameterLabel="face"
                              samplerOptions={samplerOptions}
                              schedulerOptions={schedulerOptions}
                            />
                          </div>
                          <div className="mt-5">
                            <GeneratedImageResults
                              allGeneratedImageItems={generatedImageItems}
                              filter={generatedImageFilter}
                              generatedImageItems={filteredGeneratedImageItems}
                              historySaveMessage={historySaveMessage}
                              historySaveStatus={historySaveStatus}
                              onDeleteImage={(item) => void handleDeleteGeneratedImageItem(item)}
                              onFilterChange={setGeneratedImageFilter}
                              onSaveImage={(item) => void handleSaveGeneratedImage(item)}
                              onSelectImage={(imageKey) => {
                                setSelectedGeneratedImageKey(imageKey);
                                clearDiagnosisReview();
                              }}
                              onToggleFavorite={handleToggleGeneratedImageFavorite}
                              progress={generationProgress}
                              resultsCount={results.length}
                              selectedImageKey={selectedGeneratedImageItem ? getGeneratedImageItemKey(selectedGeneratedImageItem) : selectedGeneratedImageKey}
                              submitStatus={submitStatus}
                              waitMessage={waitMessage}
                            />
                            {allowInpaint && selectedGeneratedImageItem ? (
                              <div className="mt-3 flex justify-end">
                                <Button
                                  className="h-9 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
                                  disabled={submitStatus === "loading" || downloadActionStatus === "loading" || !allResourceDownloadsReady}
                                  onClick={() => setInpaintImageItem(selectedGeneratedImageItem)}
                                  type="button"
                                >
                                  <Paintbrush className="size-3.5" />
                                  Inpaint selected image
                                </Button>
                              </div>
                            ) : null}
                          </div>
                          {allowDiagnosis && submitStatus === "success" && selectedGeneratedImage ? (
                            <div className="mt-5 rounded-md border border-violet-100 bg-violet-50/70 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">AI 诊断</p>
                                  <p className="mt-1 truncate text-[11px] text-violet-600">
                                    当前诊断图：{selectedGeneratedImage.filename}
                                  </p>
                                </div>
                                <Button
                                  className="h-8 shrink-0 rounded-md bg-violet-600 px-3 text-xs text-white hover:bg-violet-700 disabled:opacity-60"
                                  disabled={diagnosisBusy || !diagnosisHasEnabledScope}
                                  onClick={() => void runDiagnosis()}
                                  type="button"
                                >
                                  {diagnosisBusy ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="size-3.5" />
                                  )}
                                  AI 诊断
                                </Button>
                              </div>
                              <textarea
                                className="mt-3 min-h-[72px] w-full resize-y rounded-md border border-violet-100 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                                disabled={diagnosisBusy}
                                onChange={(event) => setDiagnosisInput(event.target.value)}
                                placeholder="例如：人物脸部不够清晰、画面太灰、LoRA 风格太重，帮我调整下一次生成参数。"
                                value={diagnosisInput}
                              />
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {diagnosisPromptAllowed ? (
                                <button
                                  aria-pressed={diagnosisPromptEnabled}
                                  className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                                    diagnosisPromptEnabled
                                      ? "border-violet-300 bg-violet-100 text-violet-900"
                                      : "border-violet-100 bg-white text-slate-600 hover:bg-violet-50"
                                  } disabled:cursor-not-allowed disabled:opacity-60`}
                                  disabled={diagnosisBusy}
                                  onClick={() => {
                                    clearDiagnosisReview();
                                    setDiagnosisPromptEnabled((value) => !value);
                                  }}
                                  type="button"
                                >
                                  <span className="block font-semibold">Prompt 诊断</span>
                                  <span className="mt-0.5 block text-[11px] leading-relaxed">
                                    启用后只允许 AI 修改 Positive / Negative Prompt。
                                  </span>
                                </button>
                                ) : null}
                                {diagnosisParameterAllowed ? (
                                <button
                                  aria-pressed={diagnosisParameterEnabled}
                                  className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                                    diagnosisParameterEnabled
                                      ? "border-violet-300 bg-violet-100 text-violet-900"
                                      : "border-violet-100 bg-white text-slate-600 hover:bg-violet-50"
                                  } disabled:cursor-not-allowed disabled:opacity-60`}
                                  disabled={diagnosisBusy}
                                  onClick={() => {
                                    clearDiagnosisReview();
                                    setDiagnosisParameterEnabled((value) => !value);
                                  }}
                                  type="button"
                                >
                                  <span className="block font-semibold">模型参数诊断</span>
                                  <span className="mt-0.5 block text-[11px] leading-relaxed">
                                    启用后只允许 AI 修改尺寸、采样、CFG、Seed 与 LoRA 权重。
                                  </span>
                                </button>
                                ) : null}
                              </div>
                              {!diagnosisHasEnabledScope ? (
                                <p className="mt-2 rounded-md border border-amber-100 bg-white px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                                  请至少启用 Prompt 诊断或模型参数诊断后再运行 AI 诊断。
                                </p>
                              ) : null}
                              <label className="mt-3 flex items-start gap-2 rounded-md border border-violet-100 bg-white px-3 py-2 text-xs text-slate-700">
                                <input
                                  checked={diagnosisWebEnabled}
                                  className="mt-0.5 size-3.5 rounded border-slate-300 text-violet-600"
                                  disabled={diagnosisBusy}
                                  onChange={(event) => {
                                    setDiagnosisWebEnabled(event.target.checked);
                                    setDiagnosisWebContext(null);
                                  }}
                                  type="checkbox"
                                />
                                <span>
                                  <span className="font-semibold text-slate-800">联网增强诊断</span>
                                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                                    使用 Tavily 检索当前模型、LoRA 和参数参考资料；未配置 Tavily 时会自动降级。
                                  </span>
                                </span>
                              </label>
                              {diagnosisStatus === "searching" ? (
                                <p className="mt-2 rounded-md border border-violet-100 bg-white px-3 py-2 text-xs leading-relaxed text-violet-700">
                                  <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                                  正在检索模型/参数参考资料...
                                </p>
                              ) : diagnosisBusy ? (
                                <p className="mt-2 rounded-md border border-violet-100 bg-white px-3 py-2 text-xs leading-relaxed text-violet-700">
                                  <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                                  {diagnosisStatus === "analyzing" ? "正在分析生成图的视觉问题..." : "正在根据视觉诊断生成参数建议..."}
                                </p>
                              ) : null}
                              {diagnosisStatus === "error" && diagnosisError ? (
                                <p className="mt-2 rounded-md border border-rose-100 bg-white px-3 py-2 text-xs leading-relaxed text-rose-700">
                                  {diagnosisError}
                                </p>
                              ) : null}
                              {diagnosisWebContext ? (
                                <div className="mt-3 space-y-2 rounded-md border border-sky-100 bg-white p-3 text-xs">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">联网参考来源</p>
                                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                      {diagnosisWebContext.sources.length} sources
                                    </span>
                                  </div>
                                  {diagnosisWebContext.warnings.length > 0 ? (
                                    <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                                      {diagnosisWebContext.warnings.map((warning, index) => (
                                        <p key={`${warning}-${index}`}>{warning}</p>
                                      ))}
                                    </div>
                                  ) : null}
                                  {diagnosisWebContext.sources.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {diagnosisWebContext.sources.map((source, index) => (
                                        <a
                                          className="block rounded-md bg-sky-50/70 px-2 py-1.5 transition hover:bg-sky-100"
                                          href={source.url}
                                          key={`${source.url}-${index}`}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          <p className="truncate font-medium text-slate-800">{source.title}</p>
                                          <p className="mt-0.5 truncate text-[10px] text-sky-700">{source.domain || source.url}</p>
                                          {source.relevance ? <p className="mt-0.5 text-[10px] text-slate-500">{source.relevance}</p> : null}
                                        </a>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {visualDiagnosisResult ? (
                                <div className="mt-3 space-y-2 rounded-md border border-violet-100 bg-white p-3 text-xs">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">视觉诊断</p>
                                    {visualDiagnosisResult.confidence !== null ? (
                                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                        confidence {visualDiagnosisResult.confidence}
                                      </span>
                                    ) : null}
                                  </div>
                                  {visualDiagnosisResult.summary ? (
                                    <p className="leading-relaxed text-slate-800">{visualDiagnosisResult.summary}</p>
                                  ) : null}
                                  {visualDiagnosisResult.promptAlignment ? (
                                    <p className="leading-relaxed text-slate-600">Prompt: {visualDiagnosisResult.promptAlignment}</p>
                                  ) : null}
                                  {visualDiagnosisResult.loraInfluence ? (
                                    <p className="leading-relaxed text-slate-600">LoRA: {visualDiagnosisResult.loraInfluence}</p>
                                  ) : null}
                                  {visualDiagnosisResult.observations.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {visualDiagnosisResult.observations.map((observation, index) => (
                                        <div className="rounded-md bg-violet-50/70 px-2 py-1.5" key={`${observation.category}-${index}`}>
                                          <p className="font-medium text-slate-700">
                                            {observation.category} · {observation.severity}
                                          </p>
                                          {observation.evidence ? <p className="mt-0.5 text-[11px] text-slate-600">{observation.evidence}</p> : null}
                                          {observation.likelyCause ? <p className="mt-0.5 text-[11px] text-slate-500">原因：{observation.likelyCause}</p> : null}
                                          {observation.fixDirection ? <p className="mt-0.5 text-[11px] text-violet-700">方向：{observation.fixDirection}</p> : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                  {visualDiagnosisResult.warnings.length > 0 ? (
                                    <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                                      {visualDiagnosisResult.warnings.map((warning, index) => (
                                        <p key={`${warning}-${index}`}>{warning}</p>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {diagnosisResult ? (
                                <div className="mt-3 space-y-3 rounded-md border border-violet-100 bg-white p-3 text-xs">
                                  {diagnosisResult.summary ? (
                                    <p className="leading-relaxed text-slate-800">{diagnosisResult.summary}</p>
                                  ) : null}
                                  {diagnosisResult.reasoning ? (
                                    <p className="leading-relaxed text-slate-600">{diagnosisResult.reasoning}</p>
                                  ) : null}
                                  {diagnosisResult.confidence !== null ? (
                                    <p className="text-[11px] font-medium text-violet-700">参数建议 confidence {diagnosisResult.confidence}</p>
                                  ) : null}
                                  {diagnosisResult.warnings.length > 0 || diagnosisResult.ignored.length > 0 ? (
                                    <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                                      {[...diagnosisResult.warnings, ...diagnosisResult.ignored].map((warning, index) => (
                                        <p key={`${warning}-${index}`}>{warning}</p>
                                      ))}
                                    </div>
                                  ) : null}
                                  {diagnosisDiffRows.length > 0 ? (
                                    <div className="space-y-1.5">
                                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">参数变更预览</p>
                                      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                                        {diagnosisDiffRows.map((row) => (
                                          <div className="rounded-md bg-slate-50 px-2 py-1.5" key={`${row.label}-${row.current}-${row.next}`}>
                                            <p className="font-medium text-slate-700">{row.label}</p>
                                            <p className="mt-0.5 break-words text-[11px] text-slate-500">
                                              {row.current || "空"} → <span className="text-violet-700">{row.next || "空"}</span>
                                            </p>
                                            {row.reason ? <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{row.reason}</p> : null}
                                            {row.expectedEffect ? (
                                              <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">预期：{row.expectedEffect}</p>
                                            ) : null}
                                            {row.risk ? <p className="mt-1 text-[11px] leading-relaxed text-amber-700">风险：{row.risk}</p> : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                                      AI 没有返回可应用的参数变更。
                                    </p>
                                  )}
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] text-emerald-700">
                                      {diagnosisApplied ? "已应用到当前弹窗参数，尚未重新提交 ComfyUI。" : ""}
                                    </p>
                                    <Button
                                      className="h-8 rounded-md bg-slate-900 px-3 text-xs text-white hover:bg-slate-800 disabled:opacity-60"
                                      disabled={diagnosisApplied || diagnosisDiffRows.length === 0}
                                      onClick={applyDiagnosisResult}
                                      type="button"
                                    >
                                      应用调整
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {false && generatedImages.length > 0 ? (
                          <div>
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">生成结果</p>
                            <div className="grid grid-cols-2 gap-2">
                              {generatedImages.map((image, index) => (
                                <a
                                  className="group block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                                  href={image.url}
                                  key={`${image.nodeId}-${image.filename}-${index}`}
                                  rel="noreferrer"
                                  target="_blank"
                                  title={image.filename}
                                >
                                  <span className="block aspect-square w-full bg-slate-100" />
                                  <span className="block truncate border-t border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                                    {image.filename}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        ) : false && results.length > 0 && submitStatus === "loading" ? (
                          <div className="rounded-md border border-sky-100 bg-sky-50 p-3 text-xs leading-relaxed text-sky-700">
                            <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                            {waitMessage || "正在等待 ComfyUI 生成完成..."}
                          </div>
                        ) : null}
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">ComfyUI 节点预览</p>
                        <div className="space-y-2">
                          {Object.entries(workflowPreview.workflow).map(([nodeId, node]) => (
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={nodeId}>
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-bold text-slate-900">
                                  {nodeId}. {node.class_type}
                                </p>
                                {node._meta?.title ? (
                                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500">
                                    {node._meta.title}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-2 grid gap-1.5">
                                {Object.entries(node.inputs).map(([key, value]) => {
                                  const formattedValue = formatNodeInput(value);

                                  return (
                                    <div
                                      className="grid grid-cols-[minmax(0,1fr)_minmax(76px,0.9fr)] gap-3 rounded border border-slate-200/70 bg-white/70 px-2 py-1.5 text-[11px] leading-snug"
                                      key={key}
                                    >
                                      <span
                                        className="min-w-0 font-semibold text-slate-500 [overflow-wrap:anywhere]"
                                        title={key}
                                      >
                                        {key}
                                      </span>
                                      <span
                                        className="min-w-0 text-right text-slate-700 [overflow-wrap:anywhere]"
                                        title={formattedValue}
                                      >
                                        {formattedValue}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-xs leading-relaxed">
                    {results.length > 0 ? (
                      <div className="space-y-1 text-emerald-700">
                        <p>已提交 {results.length} 个 batch 任务到 ComfyUI</p>
                        <div className="max-h-24 space-y-0.5 overflow-y-auto pr-2">
                          {results.map((item) => (
                            <p className="break-all text-[11px]" key={item.promptId}>
                              batch_size {item.imageCount} · seed {item.seed} · promptId {item.promptId}
                              {typeof item.number === "number" ? ` · 队列序号 ${item.number}` : ""} · 输出节点 {item.outputNodeId}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {saveMessage ? <p className="text-emerald-700">{saveMessage}</p> : null}
                    {submitStatus === "error" ? <p className="text-rose-600">{submitError}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-3">
                    {onSaveParameters ? (
                      <Button
                        className="h-10 rounded-md border-teal-200 bg-white text-teal-700 hover:bg-teal-50"
                        disabled={!draft || submitStatus === "loading" || downloadActionStatus === "loading"}
                        onClick={saveCurrentParameters}
                        type="button"
                        variant="secondary"
                      >
                        保存参数
                      </Button>
                    ) : null}
                    <Button
                      className="h-10 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      disabled={submitStatus === "loading" || downloadActionStatus === "loading"}
                      onClick={closeModal}
                      type="button"
                      variant="secondary"
                    >
                      关闭
                    </Button>
                    <BooleanInput
                      checked={previewGenerationEnabled}
                      label="Preview"
                      onChange={setPreviewGenerationEnabled}
                    />
                    <Button
                      className="h-10 rounded-md bg-sky-600 text-white hover:bg-sky-700"
                      disabled={!canSubmitGeneration}
                      onClick={() => void submitGeneration(previewGenerationEnabled ? "preview" : "full")}
                      type="button"
                    >
                      {submitStatus === "loading" && activeGenerationSubmitMode !== null ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Play className="size-4" />
                      )}
                      开始生图
                    </Button>
                  </div>
                </div>
              </div>
              {allowInpaint && draft && inpaintImageItem ? (
                <InpaintMaskDialog
                  busy={submitStatus === "loading"}
                  draft={draft}
                  imageItem={inpaintImageItem}
                  loraSettings={loraSettings}
                  onClose={() => setInpaintImageItem(null)}
                  onSubmit={submitInpaint}
                  open
                  selectedResources={selectedResources}
                />
              ) : null}
            </div>,
            document.body,
  );
}

type SequenceImageRouteResponse = {
  sequenceId: string;
  warnings: string[];
  shots: Array<{
    characterReferenceIds: string[];
    clientId?: string;
    imageCount: number;
    negativePrompt: string;
    number?: number;
    outputNodeId: string;
    positivePrompt: string;
    promptId: string;
    request?: ComfyUiTextToImageRequest;
    seed: number;
    shotId: string;
    title?: string;
    warnings: string[];
  }>;
};

type StoredSequenceReferenceResponse = {
  byteLength: number;
  contentType: string;
  filename: string;
  url: string;
};

type SequenceUploadedReference = {
  dataUrl: string;
  id: string;
  name: string;
};

type SequencePreviousShotReferenceMode = SavedComicSequencePreviousShotReference["mode"] | "off";

type SequencePreviousShotMaskSession = {
  maskDataUrl: string;
  sourceImage?: ComfyUiGeneratedImage;
  sourceKey: string;
  sourceSize: {
    height: number;
    width: number;
  };
};

type SequencePreviousShotMaskEditorTarget = {
  fallbackSize: {
    height: number;
    width: number;
  } | null;
  shotId: string;
  source: ComicSequencePreviousShotSource | null;
};

type SequencePreviousShotMaskTool = "brush" | "eraser" | "rectangle";
type SequencePreviousShotMaskRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const DEFAULT_SEQUENCE_REFERENCE_STRENGTH = 0.45;
const COMIC_SEQUENCE_BOUND_IMAGE_LIMIT = 12;
const COMIC_SEQUENCE_PREVIOUS_SHOT_MIN_DENOISE = 0.1;
const COMIC_SEQUENCE_PREVIOUS_REFERENCE_OPTIONS = [
  { label: "Off", value: "off" },
  { label: "Img2Img", value: "img2img" },
  { label: "Inpaint", value: "inpaint" },
] as const;
const SEQUENCE_REFERENCE_MODE_OPTIONS = [
  {
    description: "Best for portraits and close-ups. Requires ip-adapter-plus-face_sdxl_vit-h for Illustrious.",
    label: "Face",
    value: "face",
  },
  {
    description: "Best for outfit, silhouette, and full-body consistency.",
    label: "Character",
    value: "ipadapter",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  label: string;
  value: Extract<ComfyUiIpAdapterReferenceMode, "face" | "ipadapter">;
}>;

type ComicSequenceReferenceChannelKey = "face" | "character";

const SEQUENCE_REFERENCE_CHANNEL_CONFIGS = {
  face: {
    description: "Locks identity and facial details with face reference images.",
    label: "Face",
    mode: "face",
  },
  character: {
    description: "Locks outfit, body silhouette, palette, and full-character consistency.",
    label: "Character",
    mode: "ipadapter",
  },
} as const satisfies Record<ComicSequenceReferenceChannelKey, {
  description: string;
  label: string;
  mode: Extract<ComfyUiIpAdapterReferenceMode, "face" | "ipadapter">;
}>;

function parseSequenceShotsText(value: string) {
  return value
    .split(/\r?\n+/)
    .map((line) => line.trim().replace(/^[-*\d.、)\s]+/, "").trim())
    .filter(Boolean);
}

function clampUnitInput(value: string) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return 0;
  }

  return Math.min(1, Math.max(0, next));
}

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneSceneSnapshot(scene: Scene): Scene {
  if (typeof structuredClone === "function") {
    return structuredClone(scene);
  }

  return JSON.parse(JSON.stringify(scene)) as Scene;
}

function joinSequencePrompt(parts: Array<string | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(", ");
}

function buildComicSequencePositivePrompt({
  basePrompt,
  hasReferenceImages,
  modelFormat,
  reference,
  resources,
  shotPrompt,
  supportsNsfw,
  workflowProfile,
  modelBaseModel,
}: {
  basePrompt: string;
  hasReferenceImages: boolean;
  modelFormat: PromptModelFormat;
  reference: SavedComicSequenceReferenceParams;
  resources: SelectedCivitaiResourcesPreview;
  shotPrompt: string;
  supportsNsfw: boolean;
  workflowProfile?: GenerationDraft["workflowProfile"];
  modelBaseModel?: string;
}) {
  if (modelFormat !== "stable-diffusion") {
    const referencePrompt = hasReferenceImages
      ? reference.characterPrompt
        ? `${reference.characterName}: ${reference.characterPrompt}`
        : reference.characterName
      : undefined;

    return joinSequencePrompt([basePrompt, referencePrompt, shotPrompt]);
  }

  if (isAnimaPromptContext({ baseModel: modelBaseModel, resources, supportsNsfw, workflowProfile })) {
    return buildAnimaComicSequencePrompt({
      basePrompt,
      hasReferenceImages,
      reference: {
        characterName: reference.characterName,
        characterPrompt: reference.characterPrompt,
      },
      resources,
      shotPrompt,
      supportsNsfw,
    });
  }

  return buildIllustriousComicSequencePrompt({
    basePrompt,
    reference: hasReferenceImages
      ? {
          characterName: reference.characterName,
          characterPrompt: reference.characterPrompt,
        }
      : undefined,
    resources,
    shotPrompt,
  });
}

function buildComicSequenceNegativePrompt({
  baseNegativePrompt,
  modelBaseModel,
  resources,
  shotNegativePrompt,
  supportsNsfw,
  workflowProfile,
}: {
  baseNegativePrompt: string;
  modelBaseModel?: string;
  resources: SelectedCivitaiResourcesPreview;
  shotNegativePrompt: string;
  supportsNsfw: boolean;
  workflowProfile?: GenerationDraft["workflowProfile"];
}) {
  const parts = [baseNegativePrompt, shotNegativePrompt];

  return isAnimaPromptContext({ baseModel: modelBaseModel, resources, supportsNsfw, workflowProfile })
    ? mergeAnimaNegativePrompts(parts)
    : mergeNegativePrompts(parts);
}

function getComicSequenceShotPrompt(project: SceneForgeProject, scene: Scene) {
  return generatePrompt({
    ...project,
    scene,
  });
}

function createComicSequenceReferenceChannel(
  mode: Extract<ComfyUiIpAdapterReferenceMode, "face" | "ipadapter">,
): SavedComicSequenceReferenceChannelParams {
  return {
    enabled: false,
    mode,
    weight: DEFAULT_SEQUENCE_REFERENCE_STRENGTH,
    startAt: 0,
    endAt: 1,
    images: [],
  };
}

function createDefaultComicSequencePreviousShotReference(
  mode: Exclude<SequencePreviousShotReferenceMode, "off">,
): SavedComicSequencePreviousShotReference {
  return {
    mode,
    denoise: DEFAULT_COMFYUI_INPAINT_DENOISE,
    inpaintMode: DEFAULT_COMFYUI_INPAINT_MODE,
    growMaskBy: DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY,
  };
}

function normalizeComicSequencePreviousShotReference(
  reference: SavedComicSequencePreviousShotReference,
): SavedComicSequencePreviousShotReference {
  return {
    ...reference,
    denoise: Math.min(1, Math.max(COMIC_SEQUENCE_PREVIOUS_SHOT_MIN_DENOISE, reference.denoise)),
    growMaskBy: Math.max(0, Math.min(512, Math.round(reference.growMaskBy))),
  };
}

function getComicSequenceReferenceChannel(
  reference: SavedComicSequenceShot["reference"],
  key: ComicSequenceReferenceChannelKey,
): SavedComicSequenceReferenceChannelParams {
  return reference[key] ?? createComicSequenceReferenceChannel(SEQUENCE_REFERENCE_CHANNEL_CONFIGS[key].mode);
}

function cloneComicSequenceReferenceImage(image: SavedComicSequenceReferenceImage) {
  return {
    ...image,
    id: createLocalId(image.source),
  };
}

function getComicSequenceReferenceCount(reference: SavedComicSequenceShot["reference"]) {
  return (["face", "character"] as const).reduce((count, key) => (
    count + getComicSequenceReferenceChannel(reference, key).images.length
  ), 0);
}

function getComicSequenceControlNetParams(draft: GenerationDraft): SavedComicSequenceControlNetParams[] {
  return (["openpose", "depth", "normal"] as const).map((type) => {
    const unit = draft.controlNets[type];
    return {
      type,
      enabled: unit.enabled,
      modelName: unit.modelName,
      strength: unit.strength,
      startPercent: unit.startPercent,
      endPercent: unit.endPercent,
    };
  });
}

function applyComicSequenceControlNetParams(
  draft: GenerationDraft,
  controlNets: SavedComicSequenceControlNetParams[],
): GenerationDraft {
  const next = {
    ...draft,
    controlNets: {
      ...draft.controlNets,
    },
  };

  for (const controlNet of controlNets) {
    if (controlNet.type !== "openpose" && controlNet.type !== "depth" && controlNet.type !== "normal") {
      continue;
    }

    next.controlNets[controlNet.type] = {
      ...next.controlNets[controlNet.type],
      enabled: controlNet.enabled,
      modelName: controlNet.modelName,
      strength: controlNet.strength,
      startPercent: controlNet.startPercent,
      endPercent: controlNet.endPercent,
    };
  }

  return next;
}

function findSavedComicSequenceShot(sequence: SavedComicSequence | null, shotId: string | undefined) {
  return sequence?.shots.find((shot) => shot.id === shotId) ?? sequence?.shots[0] ?? null;
}

// Legacy text-only sequence dialog is kept until saved projects have fully moved to the shot workspace flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ComicSequenceDialog({
  activePrompt,
  baseNegativePrompt,
  onClose,
  open,
  savedParameters,
  selectedCheckpointId,
  selectedLoraIds,
}: {
  activePrompt: string;
  baseNegativePrompt: string;
  onClose: () => void;
  open: boolean;
  savedParameters?: SavedComfyUiGenerationParams | null;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
}) {
  const scene = useEditorStore((state) => state.project.scene);
  const nsfwEnabled = useEditorStore((state) => state.project.settings.supportsNsfw === true);
  const modelFormat = useEditorStore((state) => state.project.settings.modelFormat);
  const comfyUiGeneratedImages = useEditorStore(
    (state) => state.project.settings.comfyUiGeneratedImages ?? [],
  );
  const appendComfyUiGeneratedImages = useEditorStore((state) => state.appendComfyUiGeneratedImages);
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_RESOURCES);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [downloadItems, setDownloadItems] = useState<ResourceDownloadItem[]>([]);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState("");
  const [waitMessage, setWaitMessage] = useState("");
  const [historySaveStatus, setHistorySaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [historySaveMessage, setHistorySaveMessage] = useState("");
  const [shotsText, setShotsText] = useState(activePrompt);
  const [characterName, setCharacterName] = useState("Character 1");
  const [characterPrompt, setCharacterPrompt] = useState("");
  const [referenceMode, setReferenceMode] = useState<Extract<ComfyUiIpAdapterReferenceMode, "face" | "ipadapter">>("face");
  const [referenceStrength, setReferenceStrength] = useState(DEFAULT_SEQUENCE_REFERENCE_STRENGTH);
  const [referenceStartAt, setReferenceStartAt] = useState(0);
  const [referenceEndAt, setReferenceEndAt] = useState(1);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<Set<string>>(() => new Set());
  const [uploadedReferences, setUploadedReferences] = useState<SequenceUploadedReference[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [savedCurrentImageKeys, setSavedCurrentImageKeys] = useState<Set<string>>(() => new Set());
  const { samplerOptions, schedulerOptions } = useComfyUiKSamplerOptions(open);
  const referenceCandidates = comfyUiGeneratedImages.slice(0, 24);
  const allResourceDownloadsReady =
    downloadItems.length > 0 && downloadItems.every((item) => !item.error && isComfyUiGenerationResourceReady(item.status));
  const shotPrompts = parseSequenceShotsText(shotsText);
  const canSubmit =
    submitStatus !== "loading" &&
    loadStatus === "success" &&
    Boolean(draft) &&
    allResourceDownloadsReady &&
    shotPrompts.length > 0;
  const controlNetOpenPosePreview = useMemo(
    () =>
      draft
        ? buildComfyUiControlNetOpenPosePreview(scene, {
            width: draft.width,
            height: draft.height,
          })
        : null,
    [draft, scene],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShotsText(activePrompt);
      setReferenceMode("face");
      setReferenceStrength(DEFAULT_SEQUENCE_REFERENCE_STRENGTH);
      setReferenceStartAt(0);
      setReferenceEndAt(1);
      setSelectedReferenceIds(new Set());
      setUploadedReferences([]);
      setResults([]);
      setSavedCurrentImageKeys(new Set());
      setSubmitStatus("idle");
      setSubmitError("");
      setWaitMessage("");
      setHistorySaveStatus("idle");
      setHistorySaveMessage("");
      setLoadStatus("loading");
      setLoadError("");
      setDownloadItems([]);

      void (async () => {
        try {
          const query = buildSelectedCivitaiResourcesQuery(selectedCheckpointId, selectedLoraIds);
          const resources = query
            ? await fetchJson<SelectedCivitaiResourcesPreview>(`/api/civitai-lora-library/selected-resources?${query}`)
            : EMPTY_SELECTED_RESOURCES;
          if (!resources.checkpoint) {
            throw new Error("Select a Civitai checkpoint first.");
          }

          const settings = resolveComfyUiGenerationSettings({
            activePrompt,
            baseNegativePrompt,
            selectedResources: resources,
            aiAdvice: null,
            savedParameters,
            supportsNsfw: nsfwEnabled,
          });

          setSelectedResources(resources);
          setDraft(toDraft(settings.request, settings.loras, savedParameters?.seedMode, savedParameters));
          setDownloadItems(await loadResourceDownloadItems(resources));
          setLoadStatus("success");
        } catch (error) {
          setSelectedResources(EMPTY_SELECTED_RESOURCES);
          setDraft(null);
          setDownloadItems([]);
          setLoadStatus("error");
          setLoadError(error instanceof Error ? error.message : "Unable to load ComfyUI context.");
        }
      })();
    }, 0);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCheckpointId, selectedLoraIdsKey, activePrompt, baseNegativePrompt]);

  function closeModal() {
    if (submitStatus === "loading" || historySaveStatus === "saving") {
      return;
    }

    onClose();
  }

  function toggleReference(id: string) {
    setSelectedReferenceIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleUploadReferenceFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const nextReferences = await Promise.all(
      Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .slice(0, 4)
        .map(async (file) => ({
          dataUrl: await blobToDataUrl(file),
          id: `upload:${file.name}:${file.lastModified}`,
          name: file.name,
        })),
    );

    setUploadedReferences((current) => [...current, ...nextReferences].slice(0, 4));
  }

  async function buildSequenceReferences() {
    const selectedHistoryImages = referenceCandidates.filter((image) => selectedReferenceIds.has(image.id));
    const historyReferences = await Promise.all(
      selectedHistoryImages.map(async (image) => ({
        id: image.id,
        imageDataUrl: await loadOriginalImageUrlToDataUrl(image.url),
      })),
    );
    const uploaded = uploadedReferences.map((image) => ({
      id: image.id,
      imageDataUrl: image.dataUrl,
    }));

    return [...historyReferences, ...uploaded].slice(0, 4);
  }

  function patchDraft(patch: Partial<GenerationDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function submitSequence() {
    if (!draft) {
      return;
    }

    if (!allResourceDownloadsReady) {
      setSubmitStatus("error");
      setSubmitError("Download the selected checkpoint / LoRA files before generating.");
      return;
    }

    const shots = parseSequenceShotsText(shotsText);
    if (shots.length === 0) {
      setSubmitStatus("error");
      setSubmitError("Add at least one shot.");
      return;
    }

    setSubmitStatus("loading");
    setSubmitError("");
    setWaitMessage("Submitting sequence to ComfyUI...");
    setHistorySaveStatus("idle");
    setHistorySaveMessage("");
    setResults([]);
    setSavedCurrentImageKeys(new Set());

    try {
      const imageCount = normalizeComfyUiGenerationImageCount(draft.imageCount);
      const seed = resolveComfyUiGenerationSeed({
        currentSeed: draft.seed,
        mode: draft.seedMode,
      });
      const baseRequest = toRequestPayload(
        { ...draft, imageCount },
        seed,
        controlNetOpenPosePreview,
        null,
      );
      const references = await buildSequenceReferences();
      const clientId = createComfyUiClientId();
      const payload = await fetchJson<SequenceImageRouteResponse>("/api/comfyui/sequence-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          baseRequest,
          baseSeed: seed,
          characters: references.length > 0
            ? [
                {
                  id: "character-1",
                  mode: referenceMode,
                  name: characterName.trim() || "Character 1",
                  prompt: characterPrompt,
                  references,
                  startPercent: Math.min(referenceStartAt, referenceEndAt),
                  endPercent: Math.max(referenceStartAt, referenceEndAt),
                  weight: referenceStrength,
                },
              ]
            : [],
          clientId,
          globalPrompt: draft.positivePrompt,
          imageCount,
          negativePrompt: draft.negativePrompt,
          shots: shots.map((prompt, index) => ({
            id: `shot-${index + 1}`,
            prompt,
            request: {
              ...baseRequest,
              negativePrompt: buildComicSequenceNegativePrompt({
                baseNegativePrompt: draft.negativePrompt,
                modelBaseModel: draft.modelBaseModel,
                resources: selectedResources,
                shotNegativePrompt: "",
                supportsNsfw: nsfwEnabled,
                workflowProfile: draft.workflowProfile,
              }),
              positivePrompt: buildComicSequencePositivePrompt({
                basePrompt: draft.positivePrompt,
                hasReferenceImages: references.length > 0,
                modelBaseModel: draft.modelBaseModel,
                modelFormat,
                reference: {
                  characterName,
                  characterPrompt,
                  face: createComicSequenceReferenceChannel("face"),
                  character: createComicSequenceReferenceChannel("ipadapter"),
                  mode: referenceMode,
                  weight: referenceStrength,
                  startAt: referenceStartAt,
                  endAt: referenceEndAt,
                  images: [],
                },
                resources: selectedResources,
                shotPrompt: prompt,
                supportsNsfw: nsfwEnabled,
                workflowProfile: draft.workflowProfile,
              }),
            },
          })),
        }),
      });
      const queuedResults: GenerationResult[] = payload.shots.map((shot) => ({
        characterReferenceIds: shot.characterReferenceIds,
        historyContext: {
          draftSnapshot: { ...draft, imageCount, seed: shot.seed },
          negativePrompt: shot.negativePrompt,
          positivePrompt: shot.positivePrompt,
          selectedCheckpointId,
          selectedLoraIds: [...selectedLoraIds],
        },
        imageCount: shot.imageCount,
        images: [],
        number: shot.number,
        outputNodeId: shot.outputNodeId,
        promptId: shot.promptId,
        sequenceId: payload.sequenceId,
        seed: shot.seed,
        shotId: shot.shotId,
        source: "sequence",
      }));

      setResults(queuedResults);

      for (const shot of payload.shots) {
        setWaitMessage(`Waiting for ${shot.shotId} (${shot.imageCount} images)...`);
        const history = await waitForComfyUiGeneratedImages(shot.clientId ?? "", shot.promptId, shot.imageCount, (historyUpdate) => {
          if (historyUpdate.images.length > 0) {
            setResults((current) =>
              current.map((result) =>
                result.promptId === shot.promptId ? { ...result, images: historyUpdate.images } : result,
              ),
            );
          }
        });

        setResults((current) =>
          current.map((result) =>
            result.promptId === shot.promptId ? { ...result, images: history.images } : result,
          ),
        );
      }

      setWaitMessage("");
      setSubmitStatus("success");
      setHistorySaveMessage(
        payload.warnings.length > 0
          ? payload.warnings.join(" ")
          : "Sequence images generated. Save the candidates you want to keep.",
      );
      setHistorySaveStatus(payload.warnings.length > 0 ? "error" : "idle");
    } catch (error) {
      setWaitMessage("");
      setSubmitStatus("error");
      setSubmitError(error instanceof Error ? error.message : "ComfyUI sequence request failed.");
    }
  }

  async function saveSequenceImage(result: GenerationResult, image: ComfyUiGeneratedImage) {
    if (!draft) {
      return;
    }

    const imageKey = `${result.promptId}:${getGeneratedImageReferenceKey(image)}`;
    if (savedCurrentImageKeys.has(imageKey)) {
      return;
    }

    setHistorySaveStatus("saving");
    setHistorySaveMessage("Saving image to project history...");

    try {
      const savedImage = await fetchJson<SavedGeneratedImageResponse>("/api/comfyui/generated-images", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ image }),
      });
      const records = createComfyUiGeneratedImageRecords({
        draft,
        images: [image],
        negativePrompt: result.historyContext.negativePrompt,
        positivePrompt: result.historyContext.positivePrompt,
        result,
        savedImage,
        selectedCheckpointId,
        selectedLoraIds,
      });

      appendComfyUiGeneratedImages(records);
      await saveProject(useEditorStore.getState().project);
      setSavedCurrentImageKeys((current) => new Set(current).add(imageKey));
      setHistorySaveStatus("success");
      setHistorySaveMessage("Saved to project image history.");
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(error instanceof Error ? error.message : "Failed to save image.");
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 bg-sky-50 p-5">
          <div className="rounded-md bg-white p-2 text-sky-600">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">Comic Sequence</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {selectedResources.checkpoint ? selectedResources.checkpoint.name : "ComfyUI sequence generation"}
            </p>
          </div>
          <button
            aria-label="Close Comic Sequence"
            className="rounded-full bg-white/80 p-1.5 text-slate-400 shadow-sm transition hover:bg-white hover:text-slate-700"
            onClick={closeModal}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loadStatus === "loading" ? (
            <div className="rounded-md border border-sky-100 bg-sky-50 p-3 text-sm text-sky-700">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Loading ComfyUI context...
            </div>
          ) : null}
          {loadStatus === "error" ? (
            <div className="rounded-md border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{loadError}</div>
          ) : null}
          {loadStatus === "success" && draft ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-slate-700">Shot prompts</span>
                  <textarea
                    className="min-h-40 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                    onChange={(event) => setShotsText(event.target.value)}
                    placeholder={"One shot per line\nClose-up of the hero looking left\nWide shot of the alley confrontation"}
                    value={shotsText}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-slate-700">Character name</span>
                    <input
                      className={COMFYUI_TEXT_FIELD_CLASS}
                      onChange={(event) => setCharacterName(event.target.value)}
                      value={characterName}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-slate-700">Character prompt</span>
                    <input
                      className={COMFYUI_TEXT_FIELD_CLASS}
                      onChange={(event) => setCharacterPrompt(event.target.value)}
                      placeholder="hair, outfit, face notes"
                      value={characterPrompt}
                    />
                  </label>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                    <div className="grid gap-2">
                      <span className="text-xs font-semibold text-slate-700">Reference mode</span>
                      <div className="grid grid-cols-2 gap-2">
                        {SEQUENCE_REFERENCE_MODE_OPTIONS.map((option) => (
                          <button
                            className={
                              "min-h-24 rounded-md border bg-white px-3 py-2 text-left text-xs transition " +
                              (referenceMode === option.value
                                ? "border-sky-300 text-sky-800 ring-2 ring-sky-100"
                                : "border-slate-200 text-slate-600 hover:bg-slate-50")
                            }
                            key={option.value}
                            onClick={() => setReferenceMode(option.value)}
                            title={option.description}
                            type="button"
                          >
                            <span className="block font-semibold">{option.label}</span>
                            <span className="mt-1 block text-[10px] leading-snug text-slate-500">{option.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <div className="grid grid-cols-3 gap-2">
                        <label className="grid gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-600">weight</span>
                          <input
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            max={1}
                            min={0}
                            onChange={(event) => setReferenceStrength(clampUnitInput(event.target.value))}
                            step={0.01}
                            type="number"
                            value={referenceStrength}
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-600">start_at</span>
                          <input
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            max={1}
                            min={0}
                            onChange={(event) => setReferenceStartAt(clampUnitInput(event.target.value))}
                            step={0.01}
                            type="number"
                            value={referenceStartAt}
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-600">end_at</span>
                          <input
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            max={1}
                            min={0}
                            onChange={(event) => setReferenceEndAt(clampUnitInput(event.target.value))}
                            step={0.01}
                            type="number"
                            value={referenceEndAt}
                          />
                        </label>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[10px] leading-relaxed text-slate-500">
                        Effective range {Math.min(referenceStartAt, referenceEndAt).toFixed(2)}-{Math.max(referenceStartAt, referenceEndAt).toFixed(2)}. Lower weight or shorter end_at reduces color and glow over-transfer.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-700">Reference images</p>
                    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                      <Plus className="size-3.5" />
                      Upload
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        multiple
                        onChange={(event) => void handleUploadReferenceFiles(event.currentTarget.files)}
                        type="file"
                      />
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {referenceCandidates.map((image) => (
                      <button
                        className={
                          "overflow-hidden rounded-md border text-left transition " +
                          (selectedReferenceIds.has(image.id)
                            ? "border-sky-400 ring-2 ring-sky-100"
                            : "border-slate-200 hover:border-sky-200")
                        }
                        key={image.id}
                        onClick={() => toggleReference(image.id)}
                        title={image.filename}
                        type="button"
                      >
                        <img alt={image.filename} className="aspect-square w-full object-cover" src={image.url} />
                      </button>
                    ))}
                    {uploadedReferences.map((image) => (
                      <div className="overflow-hidden rounded-md border border-emerald-200" key={image.id}>
                        <img alt={image.name} className="aspect-square w-full object-cover" src={image.dataUrl} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-xs font-semibold text-slate-700">KSampler constants</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <NumberInput
                      label="steps"
                      min={1}
                      onChange={(value) => patchDraft({ steps: Math.round(value) })}
                      value={draft.steps}
                    />
                    <NumberInput
                      label="cfg"
                      min={0}
                      onChange={(value) => patchDraft({ cfg: value })}
                      step={0.5}
                      value={draft.cfg}
                    />
                    <NumberInput
                      label="denoise"
                      max={1}
                      min={0}
                      onChange={(value) => patchDraft({ denoise: value })}
                      step={0.05}
                      value={draft.denoise}
                    />
                    <NumberInput
                      label="images / shot"
                      max={MAX_COMFYUI_GENERATION_IMAGE_COUNT}
                      min={1}
                      onChange={(value) => patchDraft({ imageCount: normalizeComfyUiGenerationImageCount(value) })}
                      value={draft.imageCount}
                    />
                    <div className="col-span-2 grid gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">seed</span>
                        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                          {(["random", "fixed"] as const).map((mode) => (
                            <button
                              className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                                draft.seedMode === mode ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"
                              }`}
                              key={mode}
                              onClick={() => patchDraft({ seedMode: mode })}
                              title={mode === "random" ? "Generate a fresh seed when the sequence starts" : "Reuse the current seed"}
                              type="button"
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        min={0}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          if (Number.isFinite(parsed)) {
                            patchDraft({ seed: Math.round(parsed), seedMode: "fixed" });
                          }
                        }}
                        step={1}
                        type="number"
                        value={draft.seed}
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <SelectInput
                      label="sampler"
                      onChange={(value) => patchDraft({ samplerName: value })}
                      options={samplerOptions}
                      value={draft.samplerName}
                    />
                    <SelectInput
                      label="scheduler"
                      onChange={(value) => patchDraft({ scheduler: value })}
                      options={schedulerOptions}
                      value={draft.scheduler}
                    />
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
                  <div className="flex justify-between gap-3">
                    <span>Shots</span>
                    <strong className="text-slate-900">{shotPrompts.length}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Candidates per shot</span>
                    <strong className="text-slate-900">{normalizeComfyUiGenerationImageCount(draft.imageCount)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Reference images</span>
                    <strong className="text-slate-900">{selectedReferenceIds.size + uploadedReferences.length}</strong>
                  </div>
                </div>
                {waitMessage ? (
                  <div className="rounded-md border border-sky-100 bg-sky-50 p-3 text-xs text-sky-700">
                    {submitStatus === "loading" ? <Loader2 className="mr-1.5 inline size-3.5 animate-spin" /> : null}
                    {waitMessage}
                  </div>
                ) : null}
                {submitStatus === "error" ? (
                  <div className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs text-rose-700">{submitError}</div>
                ) : null}
                {historySaveMessage ? (
                  <div
                    className={
                      "rounded-md border p-3 text-xs " +
                      (historySaveStatus === "error"
                        ? "border-rose-100 bg-rose-50 text-rose-700"
                        : historySaveStatus === "success"
                          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                          : "border-sky-100 bg-sky-50 text-sky-700")
                    }
                  >
                    {historySaveStatus === "saving" ? <Loader2 className="mr-1.5 inline size-3.5 animate-spin" /> : null}
                    {historySaveMessage}
                  </div>
                ) : null}
                {!allResourceDownloadsReady ? (
                  <div className="rounded-md border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
                    Selected checkpoint / LoRA files are not ready.
                  </div>
                ) : null}
              </aside>
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="mt-5 space-y-4">
              {results.map((result, shotIndex) => (
                <section className="space-y-2" key={result.promptId}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Shot {shotIndex + 1}</p>
                      <p className="text-[11px] text-slate-500">seed {result.seed} - promptId {result.promptId}</p>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {result.images.length}/{result.imageCount}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {result.images.map((image, imageIndex) => {
                      const imageKey = `${result.promptId}:${getGeneratedImageReferenceKey(image)}`;
                      const saved = savedCurrentImageKeys.has(imageKey);

                      return (
                        <div className="overflow-hidden rounded-md border border-slate-200 bg-white" key={imageKey}>
                          <a href={image.url} rel="noreferrer" target="_blank">
                            <img
                              alt={`Shot ${shotIndex + 1} candidate ${imageIndex + 1}`}
                              className="aspect-square w-full object-cover"
                              src={image.url}
                            />
                          </a>
                          <div className="flex items-center gap-1 border-t border-slate-200 px-1.5 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{image.filename}</span>
                            <button
                              aria-label="Save sequence image"
                              className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                              disabled={saved || historySaveStatus === "saving"}
                              onClick={() => void saveSequenceImage(result, image)}
                              title={saved ? "Saved" : "Save"}
                              type="button"
                            >
                              {saved ? <CheckCircle2 className="size-3.5" /> : <Save className="size-3.5" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            base seed {draft?.seed ?? "-"} - {selectedLoraIds.length} LoRA
          </p>
          <div className="flex shrink-0 gap-3">
            <Button
              className="h-10 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              disabled={submitStatus === "loading" || historySaveStatus === "saving"}
              onClick={closeModal}
              type="button"
              variant="secondary"
            >
              Close
            </Button>
            <Button
              className="h-10 rounded-md bg-sky-600 text-white hover:bg-sky-700"
              disabled={!canSubmit}
              onClick={() => void submitSequence()}
              type="button"
            >
              {submitStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Generate sequence
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ComicSequenceWorkspaceDialog({
  activePrompt,
  aiGeneratedPrompt,
  baseNegativePrompt,
  onClose,
  open,
  savedParameters,
  selectedCheckpointId,
  selectedLoraIds,
}: {
  activePrompt: string;
  aiGeneratedPrompt: string;
  baseNegativePrompt: string;
  onClose: () => void;
  open: boolean;
  savedParameters?: SavedComfyUiGenerationParams | null;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
}) {
  const project = useEditorStore((state) => state.project);
  const updateProjectSettings = useEditorStore((state) => state.updateProjectSettings);
  const updateScene = useEditorStore((state) => state.updateScene);
  const appendComfyUiGeneratedImages = useEditorStore((state) => state.appendComfyUiGeneratedImages);
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_RESOURCES);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState("");
  const [sequence, setSequence] = useState<SavedComicSequence | null>(null);
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [downloadItems, setDownloadItems] = useState<ResourceDownloadItem[]>([]);
  const [controlNetExpanded, setControlNetExpanded] = useState(false);
  const [controlNetNormalPreview, setControlNetNormalPreview] = useState<ComfyUiNormalControlImagePreview | null>(null);
  const [controlNetNormalPreviewLoading, setControlNetNormalPreviewLoading] = useState(false);
  const [parameterSyncDownEnabled, setParameterSyncDownEnabled] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [activeSubmitMode, setActiveSubmitMode] = useState<ComicSequenceSubmitMode | null>(null);
  const [activeSubmitGenerationMode, setActiveSubmitGenerationMode] = useState<GenerationSubmitMode | null>(null);
  const [previewSequenceEnabled, setPreviewSequenceEnabled] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [waitMessage, setWaitMessage] = useState("");
  const [historySaveStatus, setHistorySaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [historySaveMessage, setHistorySaveMessage] = useState("");
  const [referenceUploadStatus, setReferenceUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [referenceUploadError, setReferenceUploadError] = useState("");
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [savedCurrentImageKeys, setSavedCurrentImageKeys] = useState<Set<string>>(() => new Set());
  const [previousShotMasks, setPreviousShotMasks] = useState<Record<string, SequencePreviousShotMaskSession>>({});
  const [maskEditorTarget, setMaskEditorTarget] = useState<SequencePreviousShotMaskEditorTarget | null>(null);
  const [storyboardInput, setStoryboardInput] = useState("");
  const [storyboardTargetCount, setStoryboardTargetCount] = useState("");
  const [storyboardStatus, setStoryboardStatus] = useState<SubmitStatus>("idle");
  const [storyboardError, setStoryboardError] = useState("");
  const [storyboardMessage, setStoryboardMessage] = useState("");
  const { samplerOptions, schedulerOptions } = useComfyUiKSamplerOptions(open);
  const savedImageById = useMemo(
    () => new Map((project.settings.comfyUiGeneratedImages ?? []).map((image) => [image.id, image])),
    [project.settings.comfyUiGeneratedImages],
  );
  const savedPreviousShotResults = useMemo(
    () => createComicSequenceSavedPreviousShotResults(project.settings.comfyUiGeneratedImages ?? [], sequence?.shots ?? []),
    [project.settings.comfyUiGeneratedImages, sequence?.shots],
  );
  const previousShotSourceResults = useMemo(
    () => [...results, ...savedPreviousShotResults],
    [results, savedPreviousShotResults],
  );
  const allResourceDownloadsReady =
    downloadItems.length > 0 && downloadItems.every((item) => !item.error && isComfyUiGenerationResourceReady(item.status));
  const nsfwEnabled = project.settings.supportsNsfw === true;
  const selectedShot = findSavedComicSequenceShot(sequence, sequence?.selectedShotId);
  const selectedBoundImageIds = new Set(
    (selectedShot?.boundImageIds ?? []).filter((imageId) => savedImageById.has(imageId)),
  );
  const selectedBoundImageCount = selectedBoundImageIds.size;
  const selectedShotIndex = sequence && selectedShot
    ? sequence.shots.findIndex((shot) => shot.id === selectedShot.id)
    : -1;
  const selectedShotHasPreviousShot = selectedShotIndex > 0;
  const selectedPreviousShotFallbackSize = sequence && selectedShotHasPreviousShot
    ? (() => {
        const previousShot = sequence.shots[selectedShotIndex - 1];
        const previousDraft = previousShot ? createDraftFromShot(previousShot, selectedResources) : null;
        return previousDraft
          ? { height: previousDraft.height, width: previousDraft.width }
          : null;
      })()
    : null;
  const selectedPreviousShotSource = sequence && selectedShot
    ? findComicSequencePreviousShotSource({
        currentShotId: selectedShot.id,
        results: previousShotSourceResults,
        shots: sequence.shots,
      })
    : null;
  const selectedPreviousShotMask = selectedShot
    ? previousShotMasks[selectedShot.id]
    : undefined;
  const selectedPreviousShotMaskReady =
    Boolean(
      selectedPreviousShotMask?.maskDataUrl &&
      (
        selectedPreviousShotMask.sourceKey === PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY ||
        selectedPreviousShotMask.sourceKey === selectedPreviousShotSource?.sourceKey
      ),
    );
  const trimmedAiPrompt = aiGeneratedPrompt.trim();
  const referenceCandidates = project.settings.comfyUiGeneratedImages.slice(0, 24);
  const bindingCandidates = project.settings.comfyUiGeneratedImages;
  const savedImagesByShot = useMemo(() => {
    const byShot = new Map<string, SavedComfyUiGeneratedImage[]>();
    const seenByShot = new Map<string, Set<string>>();

    function append(shotId: string, image: SavedComfyUiGeneratedImage) {
      const seen = seenByShot.get(shotId) ?? new Set<string>();
      if (seen.has(image.id)) {
        return;
      }

      seen.add(image.id);
      seenByShot.set(shotId, seen);
      const images = byShot.get(shotId) ?? [];
      images.push(image);
      byShot.set(shotId, images);
    }

    for (const shot of sequence?.shots ?? []) {
      for (const imageId of shot.boundImageIds ?? []) {
        const image = savedImageById.get(imageId);
        if (image) {
          append(shot.id, image);
        }
      }
    }

    for (const image of project.settings.comfyUiGeneratedImages ?? []) {
      if (image.source !== "sequence" || !image.shotId) {
        continue;
      }

      append(image.shotId, image);
    }

    return byShot;
  }, [project.settings.comfyUiGeneratedImages, savedImageById, sequence?.shots]);
  const selectedShotFaceReference = selectedShot
    ? getComicSequenceReferenceChannel(selectedShot.reference, "face")
    : createComicSequenceReferenceChannel("face");
  const selectedShotCharacterReference = selectedShot
    ? getComicSequenceReferenceChannel(selectedShot.reference, "character")
    : createComicSequenceReferenceChannel("ipadapter");
  const selectedShotScene = selectedShot?.scene;
  const draftWidth = draft?.width;
  const draftHeight = draft?.height;
  const shotOpenPosePreview =
    selectedShotScene && typeof draftWidth === "number" && typeof draftHeight === "number"
      ? buildComfyUiControlNetOpenPosePreview(selectedShotScene, {
          width: draftWidth,
          height: draftHeight,
        })
      : null;
  const maskEditorExistingMask = maskEditorTarget
    ? previousShotMasks[maskEditorTarget.shotId]
    : undefined;
  const maskEditorInitialMaskDataUrl = maskEditorExistingMask &&
    (
      maskEditorExistingMask.sourceKey === PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY ||
      maskEditorExistingMask.sourceKey === maskEditorTarget?.source?.sourceKey
    )
    ? maskEditorExistingMask.maskDataUrl
    : undefined;

  useEffect(() => {
    if (!open || !selectedShotScene || typeof draftWidth !== "number" || typeof draftHeight !== "number") {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setControlNetNormalPreviewLoading(true);

      void renderComfyUiNormalControlImage(selectedShotScene, {
        width: draftWidth,
        height: draftHeight,
      }).then((preview) => {
        if (cancelled) {
          return;
        }

        setControlNetNormalPreview(preview);
        setControlNetNormalPreviewLoading(false);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [draftHeight, draftWidth, open, selectedShotScene]);

  function createDefaultParameters(resources: SelectedCivitaiResourcesPreview) {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt,
      baseNegativePrompt,
      selectedResources: resources,
      aiAdvice: null,
      savedParameters,
      supportsNsfw: nsfwEnabled,
    });
    const draft = toDraft(settings.request, settings.loras, savedParameters?.seedMode, savedParameters);

    return {
      draft,
      parameters: toSavedParameters(draft),
    };
  }

  function createDraftFromShot(shot: SavedComicSequenceShot, resources: SelectedCivitaiResourcesPreview) {
    const settings = resolveComfyUiGenerationSettings({
      activePrompt: shot.positivePrompt || activePrompt,
      baseNegativePrompt: shot.negativePrompt || baseNegativePrompt,
      selectedResources: resources,
      aiAdvice: null,
      savedParameters: shot.parameters,
      supportsNsfw: nsfwEnabled,
    });

    return applyComicSequenceControlNetParams(
      toDraft(settings.request, settings.loras, shot.parameters.seedMode, shot.parameters),
      shot.controlNets,
    );
  }

  function resolveShotPositivePrompt(generatedPrompt: string, fallbackPrompt = "") {
    return trimmedAiPrompt || generatedPrompt || fallbackPrompt || activePrompt;
  }

  function persistSequence(nextSequence: SavedComicSequence) {
    setSequence(nextSequence);
    updateProjectSettings({ savedComicSequence: nextSequence });
  }

  function patchSequence(updater: (current: SavedComicSequence) => SavedComicSequence) {
    if (!sequence) {
      return;
    }

    persistSequence(updater(sequence));
  }

  function patchSelectedShot(patch: Partial<SavedComicSequenceShot>) {
    if (!selectedShot) {
      return;
    }

    patchSequence((current) => ({
      ...current,
      shots: current.shots.map((shot) =>
        shot.id === selectedShot.id
          ? {
              ...shot,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : shot,
      ),
    }));
  }

  function patchSelectedShotSettings(
    patch: ComicSequenceShotSettingsPatch,
    options: { defaults?: SavedComfyUiGenerationParams } = {},
  ) {
    if (!selectedShot) {
      return;
    }

    patchSequence((currentSequence) =>
      applyComicSequenceShotSettingsPatchToSequence(currentSequence, patch, {
        defaults: options.defaults,
        selectedShotId: selectedShot.id,
        syncDown: parameterSyncDownEnabled,
      }),
    );
  }

  function patchSelectedReference(patch: Partial<SavedComicSequenceShot["reference"]>) {
    if (!selectedShot) {
      return;
    }

    patchSelectedShotSettings({
      reference: {
        ...selectedShot.reference,
        ...patch,
      },
    });
  }

  function patchSelectedReferenceChannel(
    channelKey: ComicSequenceReferenceChannelKey,
    patch: Partial<SavedComicSequenceReferenceChannelParams>,
  ) {
    if (!selectedShot) {
      return;
    }

    const currentChannel = getComicSequenceReferenceChannel(selectedShot.reference, channelKey);
    patchSelectedReference({
      [channelKey]: {
        ...currentChannel,
        ...patch,
      },
    });
  }

  function patchSelectedPreviousShotReference(
    mode: SequencePreviousShotReferenceMode,
    patch: Partial<Omit<SavedComicSequencePreviousShotReference, "mode">> = {},
  ) {
    if (!selectedShot) {
      return;
    }

    if (mode === "off") {
      patchSelectedShotSettings({ previousShotReference: undefined });
      return;
    }

    const current =
      selectedShot.previousShotReference?.mode === mode
        ? selectedShot.previousShotReference
        : createDefaultComicSequencePreviousShotReference(mode);
    const inpaintMode = patch.inpaintMode ?? current.inpaintMode;
    const next = normalizeComicSequencePreviousShotReference({
      ...current,
      ...patch,
      inpaintMode,
      mode,
    });

    patchSelectedShotSettings({ previousShotReference: next });
  }

  function savePreviousShotMask(shotId: string, mask: SequencePreviousShotMaskSession) {
    const syncStartIndex = parameterSyncDownEnabled && sequence
      ? sequence.shots.findIndex((shot) => shot.id === shotId)
      : -1;
    const syncedShotIds = syncStartIndex >= 0 && sequence
      ? sequence.shots.slice(syncStartIndex).map((shot) => shot.id)
      : [shotId];

    setPreviousShotMasks((current) => {
      const next = {
        ...current,
        [shotId]: mask,
      };

      for (const syncedShotId of syncedShotIds) {
        if (syncedShotId === shotId) {
          continue;
        }

        next[syncedShotId] = {
          ...mask,
          sourceImage: undefined,
          sourceKey: PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY,
        };
      }

      return next;
    });
    setMaskEditorTarget(null);
    setHistorySaveStatus("success");
    setHistorySaveMessage(
      syncedShotIds.length > 1
        ? `Previous-shot inpaint mask synced to ${syncedShotIds.length} shots for this session.`
        : mask.sourceKey === PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY
          ? "Pending previous-shot inpaint mask is ready for this session."
          : "Previous-shot inpaint mask is ready for this session.",
    );
  }

  function persistDraftForSelectedShot(nextDraft: GenerationDraft, options: { updateDefaults?: boolean } = {}) {
    if (!selectedShot) {
      return;
    }

    const nextParameters = toSavedParameters(nextDraft);
    const nextControlNets = getComicSequenceControlNetParams(nextDraft);

    patchSelectedShotSettings(
      {
        controlNets: nextControlNets,
        parameters: nextParameters,
      },
      options.updateDefaults ? { defaults: nextParameters } : {},
    );
  }

  function patchDraft(patch: Partial<GenerationDraft>) {
    if (!draft || !selectedShot) {
      return;
    }

    const nextDraft = { ...draft, ...patch };
    setDraft(nextDraft);
    persistDraftForSelectedShot(nextDraft, { updateDefaults: true });
  }

  function patchFaceDetailer(patch: Partial<GenerationDraft["faceDetailer"]>) {
    if (!draft || !selectedShot) {
      return;
    }

    const nextDraft = {
      ...draft,
      faceDetailer: {
        ...draft.faceDetailer,
        ...patch,
      },
    };
    setDraft(nextDraft);
    persistDraftForSelectedShot(nextDraft);
  }

  function patchHandDetailer(patch: Partial<GenerationDraft["handDetailer"]>) {
    if (!draft || !selectedShot) {
      return;
    }

    const nextDraft = {
      ...draft,
      handDetailer: {
        ...draft.handDetailer,
        ...patch,
      },
    };
    setDraft(nextDraft);
    persistDraftForSelectedShot(nextDraft);
  }

  function patchControlNet(
    type: GenerationDraftControlNetUnit["type"],
    patch: Partial<GenerationDraftControlNetUnit>,
  ) {
    if (!draft || !selectedShot) {
      return;
    }

    const nextDraft = {
      ...draft,
      controlNets: {
        ...draft.controlNets,
        [type]: {
          ...draft.controlNets[type],
          ...patch,
        },
      },
    };
    setDraft(nextDraft);
    persistDraftForSelectedShot(nextDraft);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setLoadStatus("loading");
      setLoadError("");
      setDownloadItems([]);
      setSubmitStatus("idle");
      setActiveSubmitMode(null);
      setActiveSubmitGenerationMode(null);
      setSubmitError("");
      setWaitMessage("");
      setHistorySaveStatus("idle");
      setHistorySaveMessage("");
      setResults([]);
      setSavedCurrentImageKeys(new Set());
      setPreviousShotMasks({});
      setMaskEditorTarget(null);
      setParameterSyncDownEnabled(false);
      setStoryboardInput("");
      setStoryboardTargetCount("");
      setStoryboardStatus("idle");
      setStoryboardError("");
      setStoryboardMessage("");
      setControlNetNormalPreview(null);
      setControlNetNormalPreviewLoading(false);

      void (async () => {
        try {
          const query = buildSelectedCivitaiResourcesQuery(selectedCheckpointId, selectedLoraIds);
          const resources = query
            ? await fetchJson<SelectedCivitaiResourcesPreview>(`/api/civitai-lora-library/selected-resources?${query}`)
            : EMPTY_SELECTED_RESOURCES;
          if (!resources.checkpoint) {
            throw new Error("Select a Civitai checkpoint first.");
          }

          const { parameters } = createDefaultParameters(resources);
          const existing = project.settings.savedComicSequence;
          const nextSequence: SavedComicSequence = existing
            ? {
                ...existing,
                defaults: existing.defaults ?? parameters,
                selectedShotId: existing.selectedShotId ?? existing.shots[0]?.id,
              }
            : {
                version: 1,
                defaults: parameters,
                shots: [],
              };

          setSelectedResources(resources);
          setSequence(nextSequence);
          updateProjectSettings({ savedComicSequence: nextSequence });
          setDownloadItems(await loadResourceDownloadItems(resources));
          setLoadStatus("success");
          const shot = findSavedComicSequenceShot(nextSequence, nextSequence.selectedShotId);
          setDraft(shot ? createDraftFromShot(shot, resources) : null);
        } catch (error) {
          setSelectedResources(EMPTY_SELECTED_RESOURCES);
          setSequence(null);
          setDraft(null);
          setDownloadItems([]);
          setLoadStatus("error");
          setLoadError(error instanceof Error ? error.message : "Unable to load Comic Sequence context.");
        }
      })();
    }, 0);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCheckpointId, selectedLoraIdsKey]);

  function selectShot(shotId: string) {
    if (!sequence) {
      return;
    }

    const nextSequence = {
      ...sequence,
      selectedShotId: shotId,
    };
    const shot = findSavedComicSequenceShot(nextSequence, shotId);
    persistSequence(nextSequence);
    setDraft(shot ? createDraftFromShot(shot, selectedResources) : null);
    setControlNetExpanded(false);
    setControlNetNormalPreview(null);
    setControlNetNormalPreviewLoading(false);
    setParameterSyncDownEnabled(false);
  }

  function createShotFromScene(
    scene: Scene,
    sourceShot?: SavedComicSequenceShot | null,
    options: { shotNumber?: number; shotPrompt?: string; title?: string } = {},
  ): SavedComicSequenceShot | null {
    if (!sequence) {
      return null;
    }

    const generated = getComicSequenceShotPrompt(project, scene);
    const now = new Date().toISOString();
    const defaultParameters = sourceShot?.parameters ?? sequence.defaults;
    if (!defaultParameters) {
      return null;
    }
    const sourceReference = sourceShot?.reference;
    const sourceFaceReference = sourceReference
      ? getComicSequenceReferenceChannel(sourceReference, "face")
      : createComicSequenceReferenceChannel("face");
    const sourceCharacterReference = sourceReference
      ? getComicSequenceReferenceChannel(sourceReference, "character")
      : createComicSequenceReferenceChannel("ipadapter");
    const sourceDraft = draft ?? (sourceShot ? createDraftFromShot(sourceShot, selectedResources) : null);

    return {
      id: createLocalId("shot"),
      title: options.title?.trim() || `Shot ${options.shotNumber ?? sequence.shots.length + 1}`,
      scene: cloneSceneSnapshot(scene),
      positivePrompt: resolveShotPositivePrompt(generated.prompt),
      negativePrompt: generated.negativePrompt || baseNegativePrompt,
      shotPrompt: options.shotPrompt?.trim() ?? "",
      parameters: defaultParameters,
      controlNets: sourceDraft ? getComicSequenceControlNetParams(sourceDraft) : sourceShot?.controlNets ?? [],
      reference: {
        characterName: sourceReference?.characterName ?? "Character 1",
        characterPrompt: sourceReference?.characterPrompt ?? "",
        mode: sourceReference?.mode ?? "face",
        weight: sourceReference?.weight ?? DEFAULT_SEQUENCE_REFERENCE_STRENGTH,
        startAt: sourceReference?.startAt ?? 0,
        endAt: sourceReference?.endAt ?? 1,
        images: sourceReference?.images.map(cloneComicSequenceReferenceImage) ?? [],
        face: {
          ...sourceFaceReference,
          images: sourceFaceReference.images.map(cloneComicSequenceReferenceImage),
        },
        character: {
          ...sourceCharacterReference,
          images: sourceCharacterReference.images.map(cloneComicSequenceReferenceImage),
        },
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  function addShotFromCurrentCanvas() {
    const shot = createShotFromScene(project.scene, selectedShot);
    if (!sequence || !shot) {
      return;
    }

    const nextSequence = {
      ...sequence,
      selectedShotId: shot.id,
      shots: [...sequence.shots, shot],
    };
    persistSequence(nextSequence);
    setDraft(createDraftFromShot(shot, selectedResources));
    setControlNetExpanded(false);
  }

  async function generateAiStoryboardShots() {
    if (!sequence) {
      return;
    }

    const story = storyboardInput.trim();
    if (!story) {
      setStoryboardStatus("error");
      setStoryboardError("Enter an action paragraph before generating storyboard shots.");
      setStoryboardMessage("");
      return;
    }

    const targetCountText = storyboardTargetCount.trim();
    let targetShotCount: number | undefined;
    if (targetCountText) {
      const parsed = Number(targetCountText);
      if (!Number.isFinite(parsed)) {
        setStoryboardStatus("error");
        setStoryboardError(`Target shots must be between ${COMIC_SEQUENCE_STORYBOARD_MIN_SHOTS} and ${COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS}.`);
        setStoryboardMessage("");
        return;
      }
      targetShotCount = normalizeComicSequenceStoryboardTargetCount(parsed);
    }

    setStoryboardStatus("loading");
    setStoryboardError("");
    setStoryboardMessage("");

    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          purpose: "comic-sequence-storyboard",
          nsfw: nsfwEnabled,
          messages: buildComicSequenceStoryboardMessages({
            existingShotCount: sequence.shots.length,
            globalPrompt: activePrompt,
            negativePrompt: baseNegativePrompt,
            promptProfile: isAnimaPromptContext({
              baseModel: draft?.modelBaseModel,
              resources: selectedResources,
              supportsNsfw: nsfwEnabled,
              workflowProfile: draft?.workflowProfile,
            })
              ? "anima"
              : "default",
            story,
            targetShotCount,
          }),
          temperature: 0.25,
          maxTokens: 1800,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI storyboard returned an invalid response.");
      }

      const parsed = parseComicSequenceStoryboardResponse(payload.content, {
        existingShotCount: sequence.shots.length,
        maxShots: targetShotCount ?? COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS,
      });

      if (parsed.shots.length === 0) {
        throw new Error("AI storyboard did not return any usable shots.");
      }

      const firstShotNumber = sequence.shots.length + 1;
      const newShots = parsed.shots
        .map((shot, index) =>
          createShotFromScene(project.scene, selectedShot, {
            shotNumber: firstShotNumber + index,
            shotPrompt: shot.prompt,
            title: shot.title,
          }),
        )
        .filter((shot): shot is SavedComicSequenceShot => shot !== null);

      if (newShots.length === 0) {
        throw new Error("Unable to create storyboard shots from the current sequence defaults.");
      }

      const nextSequence: SavedComicSequence = {
        ...sequence,
        selectedShotId: newShots[0].id,
        shots: [...sequence.shots, ...newShots],
      };
      persistSequence(nextSequence);
      setDraft(createDraftFromShot(newShots[0], selectedResources));
      setControlNetExpanded(false);
      setControlNetNormalPreview(null);
      setControlNetNormalPreviewLoading(false);
      setStoryboardStatus("success");
      setStoryboardMessage(`Created ${newShots.length} storyboard shot${newShots.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setStoryboardStatus("error");
      setStoryboardError(error instanceof Error ? error.message : "AI storyboard failed. Check LiteLLM configuration and retry.");
    }
  }

  function updateSelectedShotFromCurrentCanvas() {
    if (!selectedShot) {
      return;
    }

    const generated = getComicSequenceShotPrompt(project, project.scene);
    patchSelectedShotSettings({
      scene: cloneSceneSnapshot(project.scene),
      positivePrompt: resolveShotPositivePrompt(generated.prompt, selectedShot.positivePrompt),
      negativePrompt: generated.negativePrompt || selectedShot.negativePrompt,
    });
    setControlNetNormalPreview(null);
    setControlNetNormalPreviewLoading(false);
  }

  function duplicateSelectedShot() {
    if (!sequence || !selectedShot) {
      return;
    }

    const now = new Date().toISOString();
    const faceReference = getComicSequenceReferenceChannel(selectedShot.reference, "face");
    const characterReference = getComicSequenceReferenceChannel(selectedShot.reference, "character");
    const duplicate: SavedComicSequenceShot = {
      ...selectedShot,
      id: createLocalId("shot"),
      title: `${selectedShot.title} Copy`,
      scene: cloneSceneSnapshot(selectedShot.scene),
      boundImageIds: selectedShot.boundImageIds ? [...selectedShot.boundImageIds] : undefined,
      reference: {
        ...selectedShot.reference,
        images: selectedShot.reference.images.map(cloneComicSequenceReferenceImage),
        face: {
          ...faceReference,
          images: faceReference.images.map(cloneComicSequenceReferenceImage),
        },
        character: {
          ...characterReference,
          images: characterReference.images.map(cloneComicSequenceReferenceImage),
        },
      },
      createdAt: now,
      updatedAt: now,
    };
    const nextSequence = {
      ...sequence,
      selectedShotId: duplicate.id,
      shots: [...sequence.shots, duplicate],
    };
    persistSequence(nextSequence);
    setDraft(createDraftFromShot(duplicate, selectedResources));
  }

  function deleteSelectedShot() {
    if (!sequence || !selectedShot) {
      return;
    }

    const nextShots = sequence.shots.filter((shot) => shot.id !== selectedShot.id);
    const nextSelectedShotId = nextShots[0]?.id;
    const nextSequence = {
      ...sequence,
      ...(nextSelectedShotId ? { selectedShotId: nextSelectedShotId } : { selectedShotId: undefined }),
      shots: nextShots,
    };
    persistSequence(nextSequence);
    const nextShot = findSavedComicSequenceShot(nextSequence, nextSelectedShotId);
    setDraft(nextShot ? createDraftFromShot(nextShot, selectedResources) : null);
  }

  function loadSelectedShotToCanvas() {
    if (!sequence || !selectedShot) {
      return;
    }

    persistSequence({
      ...sequence,
      selectedShotId: selectedShot.id,
    });
    updateScene(cloneSceneSnapshot(selectedShot.scene));
    onClose();
  }

  function toggleHistoryReference(channelKey: ComicSequenceReferenceChannelKey, image: SavedComfyUiGeneratedImage) {
    if (!selectedShot) {
      return;
    }

    const currentChannel = getComicSequenceReferenceChannel(selectedShot.reference, channelKey);
    const exists = currentChannel.images.some((reference) =>
      reference.source === "history" && reference.imageId === image.id,
    );
    const nextImages: SavedComicSequenceReferenceImage[] = exists
      ? currentChannel.images.filter((reference) =>
          !(reference.source === "history" && reference.imageId === image.id),
        )
      : [
          ...currentChannel.images,
          {
            id: createLocalId("history-ref"),
            source: "history" as const,
            imageId: image.id,
          },
        ].slice(0, 4);

    patchSelectedReferenceChannel(channelKey, {
      enabled: nextImages.length > 0 ? true : currentChannel.enabled,
      images: nextImages,
    });
  }

  function toggleShotBoundImage(shotId: string, image: SavedComfyUiGeneratedImage) {
    const targetShot = sequence?.shots.find((shot) => shot.id === shotId);
    if (!targetShot) {
      return;
    }

    const availableImageIds = new Set(project.settings.comfyUiGeneratedImages.map((candidate) => candidate.id));
    const currentIds = (targetShot.boundImageIds ?? []).filter((imageId) => availableImageIds.has(imageId));
    const exists = currentIds.includes(image.id);
    if (!exists && currentIds.length >= COMIC_SEQUENCE_BOUND_IMAGE_LIMIT) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(`Each shot can bind up to ${COMIC_SEQUENCE_BOUND_IMAGE_LIMIT} project images.`);
      return;
    }

    const nextIds = exists
      ? currentIds.filter((imageId) => imageId !== image.id)
      : [image.id, ...currentIds.filter((imageId) => imageId !== image.id)];

    patchSequence((current) => ({
      ...current,
      shots: current.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              boundImageIds: nextIds.length > 0 ? nextIds : undefined,
              updatedAt: new Date().toISOString(),
            }
          : shot,
      ),
    }));
    setHistorySaveStatus("success");
    setHistorySaveMessage(
      exists
        ? `Unbound ${image.filename} from ${targetShot.title}.`
        : `Bound ${image.filename} to ${targetShot.title}.`,
    );
  }

  async function handleUploadReferenceFiles(channelKey: ComicSequenceReferenceChannelKey, files: FileList | null) {
    if (!selectedShot || !files || files.length === 0) {
      return;
    }

    setReferenceUploadStatus("uploading");
    setReferenceUploadError("");

    try {
      const uploaded = await Promise.all(
        Array.from(files)
          .filter((file) => file.type.startsWith("image/"))
          .slice(0, 4)
          .map(async (file) => {
            const dataUrl = await blobToDataUrl(file);
            const stored = await fetchJson<StoredSequenceReferenceResponse>("/api/comfyui/sequence-references", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({ dataUrl }),
            });

            return {
              id: createLocalId("upload-ref"),
              source: "upload" as const,
              filename: stored.filename,
              name: file.name,
              url: stored.url,
            };
          }),
      );

      const currentChannel = getComicSequenceReferenceChannel(selectedShot.reference, channelKey);
      patchSelectedReferenceChannel(channelKey, {
        enabled: true,
        images: [...currentChannel.images, ...uploaded].slice(0, 4),
      });
      setReferenceUploadStatus("idle");
    } catch (error) {
      setReferenceUploadStatus("error");
      setReferenceUploadError(error instanceof Error ? error.message : "Failed to upload reference image.");
    }
  }

  function removeReferenceImage(channelKey: ComicSequenceReferenceChannelKey, referenceId: string) {
    if (!selectedShot) {
      return;
    }

    const currentChannel = getComicSequenceReferenceChannel(selectedShot.reference, channelKey);
    patchSelectedReferenceChannel(channelKey, {
      images: currentChannel.images.filter((image) => image.id !== referenceId),
    });
  }

  async function buildShotReferenceImages(images: SavedComicSequenceReferenceImage[]) {
    const references = await Promise.all(
      images.map(async (reference) => {
        if (reference.source === "upload") {
          return {
            id: reference.id,
            storedFilename: reference.filename,
          };
        }

        const image = project.settings.comfyUiGeneratedImages.find((candidate) => candidate.id === reference.imageId);
        if (!image) {
          return null;
        }

        return {
          id: reference.id,
          imageDataUrl: await loadOriginalImageUrlToDataUrl(image.url),
        };
      }),
    );

    return references.filter((reference): reference is NonNullable<(typeof references)[number]> => reference !== null);
  }

  async function submitSequence(
    mode: ComicSequenceSubmitMode = "sequence",
    generationMode: GenerationSubmitMode = "full",
  ) {
    if (!sequence || sequence.shots.length === 0) {
      setSubmitStatus("error");
      setSubmitError("Add at least one shot from the current canvas.");
      return;
    }

    const previewMode = generationMode === "preview";
    if (!allResourceDownloadsReady) {
      setSubmitStatus("error");
      setSubmitError("Download the selected checkpoint / LoRA files before generating.");
      return;
    }

    const generationPlan = planComicSequenceGeneration({
      mode,
      results,
      selectedShotId: sequence.selectedShotId,
      shots: sequence.shots,
    });
    const sequenceStartIndex = generationPlan.selectedShotIndex;
    const shotsToGenerate = generationPlan.shotsToGenerate;
    const generateSingleShot = mode === "shot";

    if (shotsToGenerate.length === 0) {
      setSubmitStatus("error");
      setSubmitError("Select a shot before generating.");
      return;
    }

    setSubmitStatus("loading");
    setActiveSubmitMode(mode);
    setActiveSubmitGenerationMode(generationMode);
    setSubmitError("");
    setWaitMessage(
      generateSingleShot
        ? `Preparing ${previewMode ? "preview for " : ""}Shot ${sequenceStartIndex + 1}...`
        : `Preparing ${previewMode ? "previews for " : ""}shots ${sequenceStartIndex + 1}-${sequence.shots.length}...`,
    );
    setHistorySaveStatus("idle");
    setHistorySaveMessage("");
    if (!generateSingleShot) {
      setSavedCurrentImageKeys(new Set());
    }

    try {
      const clientId = createComfyUiClientId();
      const sequenceId = createLocalId("sequence");
      const shotIndexById = new Map(sequence.shots.map((shot, index) => [shot.id, index]));
      const retainedResults = generationPlan.retainedResults;
      const workingResults = [...retainedResults];
      const allWarnings: string[] = [];
      const setOrderedWorkingResults = () => {
        setResults(
          [...workingResults].sort((left, right) => {
            const leftIndex = left.shotId ? shotIndexById.get(left.shotId) : undefined;
            const rightIndex = right.shotId ? shotIndexById.get(right.shotId) : undefined;

            return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
          }),
        );
      };

      setOrderedWorkingResults();

      const updateWorkingResult = (promptId: string, images: ComfyUiGeneratedImage[]) => {
        const resultIndex = workingResults.findIndex((result) => result.promptId === promptId);
        if (resultIndex < 0) {
          return;
        }

        workingResults[resultIndex] = {
          ...workingResults[resultIndex],
          images,
        };
        setOrderedWorkingResults();
      };

      const buildTextToImageShot = async (shot: SavedComicSequenceShot, shotNumber: number) => {
        const shotDraft = createDraftFromShot(shot, selectedResources);
        const imageCount = normalizeComfyUiGenerationImageCount(shotDraft.imageCount);
        const seed = resolveComfyUiGenerationSeed({
          currentSeed: shotDraft.seed,
          mode: shotDraft.seedMode,
        });
        const faceReference = getComicSequenceReferenceChannel(shot.reference, "face");
        const characterReference = getComicSequenceReferenceChannel(shot.reference, "character");
        const faceReferences = faceReference.enabled ? await buildShotReferenceImages(faceReference.images) : [];
        const characterReferences = characterReference.enabled ? await buildShotReferenceImages(characterReference.images) : [];
        const hasReferenceImages = faceReferences.length > 0 || characterReferences.length > 0;
        const positivePrompt = buildComicSequencePositivePrompt({
          basePrompt: shot.positivePrompt,
          hasReferenceImages,
          modelBaseModel: shotDraft.modelBaseModel,
          modelFormat: project.settings.modelFormat,
          reference: shot.reference,
          resources: selectedResources,
          shotPrompt: shot.shotPrompt,
          supportsNsfw: nsfwEnabled,
          workflowProfile: shotDraft.workflowProfile,
        });
        const negativePrompt = buildComicSequenceNegativePrompt({
          baseNegativePrompt,
          modelBaseModel: shotDraft.modelBaseModel,
          resources: selectedResources,
          shotNegativePrompt: shot.negativePrompt,
          supportsNsfw: nsfwEnabled,
          workflowProfile: shotDraft.workflowProfile,
        });
        const requestShotDraft = shotDraft;
        const shotPreview = buildComfyUiControlNetOpenPosePreview(shot.scene, {
          width: requestShotDraft.width,
          height: requestShotDraft.height,
        });
        const shotNormalPreview = requestShotDraft.controlNets.normal.enabled
          ? await renderComfyUiNormalControlImage(shot.scene, {
              width: requestShotDraft.width,
              height: requestShotDraft.height,
            })
          : null;
        const fullRequest = toRequestPayload(
          { ...requestShotDraft, positivePrompt, negativePrompt, imageCount },
          seed,
          shotPreview,
          shotNormalPreview,
        );
        const request = previewMode
          ? createComfyUiTextToImagePreviewRequest(fullRequest)
          : fullRequest;
        const submittedImageCount = normalizeComfyUiGenerationImageCount(request.batchSize ?? imageCount);
        const draftSnapshot = {
          ...requestShotDraft,
          faceDetailer: {
            ...requestShotDraft.faceDetailer,
            enabled: request.faceDetailer?.enabled ?? requestShotDraft.faceDetailer.enabled,
          },
          handDetailer: {
            ...requestShotDraft.handDetailer,
            enabled: request.handDetailer?.enabled ?? requestShotDraft.handDetailer.enabled,
          },
          height: request.height ?? requestShotDraft.height,
          imageCount: submittedImageCount,
          negativePrompt,
          positivePrompt,
          seed,
          steps: request.steps ?? requestShotDraft.steps,
          width: request.width ?? requestShotDraft.width,
        };

        return {
          baseRequest: toRequestPayload(draftSnapshot, seed, null, null),
          draftSnapshot,
          payloadShot: {
            id: shot.id,
            title: shot.title,
            prompt: shot.shotPrompt || shot.title || `Shot ${shotNumber}`,
            request,
            characters: [
              ...(faceReferences.length > 0
                ? [
                    {
                      id: `${shot.id}-face`,
                      mode: faceReference.mode,
                      name: `${shot.reference.characterName.trim() || "Character 1"} face`,
                      prompt: shot.reference.characterPrompt,
                      references: faceReferences,
                      startPercent: Math.min(faceReference.startAt, faceReference.endAt),
                      endPercent: Math.max(faceReference.startAt, faceReference.endAt),
                      weight: faceReference.weight,
                    },
                  ]
                : []),
              ...(characterReferences.length > 0
                ? [
                    {
                      id: `${shot.id}-character`,
                      mode: characterReference.mode,
                      name: `${shot.reference.characterName.trim() || "Character 1"} character`,
                      prompt: shot.reference.characterPrompt,
                      references: characterReferences,
                      startPercent: Math.min(characterReference.startAt, characterReference.endAt),
                      endPercent: Math.max(characterReference.startAt, characterReference.endAt),
                      weight: characterReference.weight,
                    },
                  ]
                : []),
            ],
          },
        };
      };

      const buildPreviousReferenceInpaintRequest = async ({
        maskDataUrl,
        reference,
        shot,
        sourceImage,
      }: {
        maskDataUrl: string;
        reference: SavedComicSequencePreviousShotReference;
        shot: SavedComicSequenceShot;
        sourceImage: ComfyUiGeneratedImage;
      }) => {
        const shotDraft = createDraftFromShot(shot, selectedResources);
        const seed = resolveComfyUiGenerationSeed({
          currentSeed: shotDraft.seed,
          mode: shotDraft.seedMode,
        });
        const faceReference = getComicSequenceReferenceChannel(shot.reference, "face");
        const characterReference = getComicSequenceReferenceChannel(shot.reference, "character");
        const hasReferenceImages =
          (faceReference.enabled && faceReference.images.length > 0) ||
          (characterReference.enabled && characterReference.images.length > 0);
        const positivePrompt = buildComicSequencePositivePrompt({
          basePrompt: shot.positivePrompt,
          hasReferenceImages,
          modelBaseModel: shotDraft.modelBaseModel,
          modelFormat: project.settings.modelFormat,
          reference: shot.reference,
          resources: selectedResources,
          shotPrompt: shot.shotPrompt,
          supportsNsfw: nsfwEnabled,
          workflowProfile: shotDraft.workflowProfile,
        });
        const negativePrompt = buildComicSequenceNegativePrompt({
          baseNegativePrompt,
          modelBaseModel: shotDraft.modelBaseModel,
          resources: selectedResources,
          shotNegativePrompt: shot.negativePrompt,
          supportsNsfw: nsfwEnabled,
          workflowProfile: shotDraft.workflowProfile,
        });
        const faceDetailer = previewMode
          ? { ...shotDraft.faceDetailer, enabled: false }
          : shotDraft.faceDetailer;
        const handDetailer = previewMode
          ? { ...shotDraft.handDetailer, enabled: false }
          : shotDraft.handDetailer;
        const steps = previewMode ? getComfyUiPreviewSteps(shotDraft.steps) : shotDraft.steps;
        const draftSnapshot: GenerationDraft = {
          ...shotDraft,
          faceDetailer,
          handDetailer,
          imageCount: 1,
          positivePrompt,
          negativePrompt,
          seed,
          inpaint: {
            ...shotDraft.inpaint,
            denoise: reference.denoise,
            growMaskBy: reference.growMaskBy,
            mode: reference.inpaintMode,
          },
          steps,
        };
        const baseRequest = toInpaintRequestPayload(draftSnapshot, {
          denoise: reference.denoise,
          faceDetailer,
          growMaskBy: reference.growMaskBy,
          handDetailer,
          image: sourceImage,
          maskDataUrl,
          mode: reference.inpaintMode,
          negativePrompt,
          positivePrompt,
          seed,
          sourceImageDataUrl: await loadOriginalImageUrlToDataUrl(sourceImage.url),
          upscaleBeforeInpaint: {
            enabled: false,
            mode: "lanczos",
            scaleBy: 2,
          },
        });
        const request = previewMode
          ? createComfyUiInpaintPreviewRequest(baseRequest)
          : baseRequest;

        return {
          draftSnapshot,
          request,
          seed,
        };
      };

      const preparePreviousShotMaskForSource = async (
        mask: SequencePreviousShotMaskSession | undefined,
        source: ComicSequencePreviousShotSource,
      ) => {
        if (!mask?.maskDataUrl) {
          return null;
        }

        if (
          mask.sourceKey !== source.sourceKey &&
          mask.sourceKey !== PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY
        ) {
          return null;
        }

        const sourceSize = await loadImageSize(source.image.url);
        const maskDataUrl =
          mask.sourceSize.width === sourceSize.width && mask.sourceSize.height === sourceSize.height
            ? mask.maskDataUrl
            : await resizeMaskDataUrl(mask.maskDataUrl, sourceSize);

        return {
          maskDataUrl,
          sourceSize,
        };
      };

      for (const [relativeShotIndex, shot] of shotsToGenerate.entries()) {
        const shotNumber = sequenceStartIndex + relativeShotIndex + 1;
        const source = findComicSequencePreviousShotSource({
          currentShotId: shot.id,
          results: [...workingResults, ...savedPreviousShotResults],
          shots: sequence.shots,
        });
        const mask = previousShotMasks[shot.id];
        const previousAction = resolveComicSequencePreviousShotAction({
          mask,
          reference: shot.previousShotReference,
          source,
        });

        if (previousAction === "pause-for-mask" && source) {
          selectShot(shot.id);
          setWaitMessage("");
          setSubmitStatus("error");
          setSubmitError(`Configure an inpaint mask for Shot ${shotNumber} before continuing.`);
          setHistorySaveStatus("idle");
          setHistorySaveMessage("");
          return;
        }

        if ((previousAction === "img2img" || previousAction === "inpaint") && shot.previousShotReference && source) {
          const preparedMask = previousAction === "inpaint"
            ? await preparePreviousShotMaskForSource(mask, source)
            : null;
          const maskDataUrl = previousAction === "img2img"
            ? createFullImageMaskDataUrl(
                ...(await loadImageSize(source.image.url).then((size) => [size.width, size.height] as const)),
              )
            : preparedMask?.maskDataUrl;
          if (!maskDataUrl) {
            throw new Error(`Shot ${shotNumber} is missing an inpaint mask.`);
          }
          if (previousAction === "inpaint" && preparedMask && mask?.sourceKey === PENDING_COMIC_SEQUENCE_PREVIOUS_SHOT_SOURCE_KEY) {
            setPreviousShotMasks((current) => ({
              ...current,
              [shot.id]: {
                ...mask,
                maskDataUrl: preparedMask.maskDataUrl,
                sourceImage: source.image,
                sourceKey: source.sourceKey,
                sourceSize: preparedMask.sourceSize,
              },
            }));
          }

          setWaitMessage(`Submitting ${previousAction} for Shot ${shotNumber}...`);
          const { draftSnapshot, request, seed } = await buildPreviousReferenceInpaintRequest({
            maskDataUrl,
            reference: shot.previousShotReference,
            shot,
            sourceImage: source.image,
          });
          const shotClientId = `${clientId}:${shot.id}:previous`;
          const payload = await fetchJson<Omit<GenerationResult, "historyContext" | "imageCount" | "images" | "seed" | "source">>("/api/comfyui/inpaint-image", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ ...request, clientId: shotClientId }),
          });
          const queuedResult: GenerationResult = {
            historyContext: {
              draftSnapshot,
              negativePrompt: request.negativePrompt ?? "",
              positivePrompt: request.positivePrompt,
              selectedCheckpointId,
              selectedLoraIds: [...selectedLoraIds],
            },
            imageCount: 1,
            images: [],
            number: payload.number,
            outputNodeId: payload.outputNodeId,
            promptId: payload.promptId,
            seed,
            sequenceId,
            shotId: shot.id,
            shotNumber,
            shotTitle: shot.title,
            source: "sequence",
          };

          workingResults.push(queuedResult);
          setOrderedWorkingResults();
          setWaitMessage(`Waiting for ${shot.title} (${previousAction})...`);
          const history = await waitForComfyUiGeneratedImages(shotClientId, payload.promptId, 1, (historyUpdate) => {
            if (historyUpdate.images.length > 0) {
              updateWorkingResult(payload.promptId, historyUpdate.images);
            }
          });
          updateWorkingResult(payload.promptId, history.images);
          continue;
        }

        setWaitMessage(`Submitting Shot ${shotNumber} to ComfyUI...`);
        const textShot = await buildTextToImageShot(shot, shotNumber);
        const payload = await fetchJson<SequenceImageRouteResponse>("/api/comfyui/sequence-image", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            baseRequest: textShot.baseRequest,
            characters: [],
            clientId,
            preview: previewMode || undefined,
            sequenceId,
            shots: [textShot.payloadShot],
          }),
        });
        const queuedShot = payload.shots[0];
        if (!queuedShot) {
          throw new Error(`Shot ${shotNumber} was not queued.`);
        }
        allWarnings.push(...payload.warnings);
        const queuedResult: GenerationResult = {
          characterReferenceIds: queuedShot.characterReferenceIds,
          historyContext: {
            draftSnapshot: textShot.draftSnapshot,
            negativePrompt: queuedShot.negativePrompt,
            positivePrompt: queuedShot.positivePrompt,
            selectedCheckpointId,
            selectedLoraIds: [...selectedLoraIds],
          },
          imageCount: queuedShot.imageCount,
          images: [],
          number: queuedShot.number,
          outputNodeId: queuedShot.outputNodeId,
          promptId: queuedShot.promptId,
          sequenceId: payload.sequenceId,
          seed: queuedShot.seed,
          shotId: queuedShot.shotId,
          shotNumber,
          shotTitle: queuedShot.title,
          source: "sequence",
        };

        workingResults.push(queuedResult);
        setOrderedWorkingResults();
        setWaitMessage(`Waiting for ${queuedShot.title ?? queuedShot.shotId} (${queuedShot.imageCount} images)...`);
        const history = await waitForComfyUiGeneratedImages(queuedShot.clientId ?? "", queuedShot.promptId, queuedShot.imageCount, (historyUpdate) => {
          if (historyUpdate.images.length > 0) {
            updateWorkingResult(queuedShot.promptId, historyUpdate.images);
          }
        });
        updateWorkingResult(queuedShot.promptId, history.images);
      }

      const warnings = Array.from(new Set(allWarnings));
      setWaitMessage("");
      setSubmitStatus("success");
      setHistorySaveMessage(
        warnings.length > 0
          ? warnings.join(" ")
          : generateSingleShot
            ? "Shot images generated. Save the candidates you want to keep."
            : "Sequence images generated. Save the candidates you want to keep.",
      );
      setHistorySaveStatus(warnings.length > 0 ? "error" : "idle");
    } catch (error) {
      setWaitMessage("");
      setSubmitStatus("error");
      setSubmitError(error instanceof Error ? error.message : "ComfyUI sequence request failed.");
    } finally {
      setActiveSubmitMode(null);
      setActiveSubmitGenerationMode(null);
    }
  }

  async function saveSequenceImage(result: GenerationResult, image: ComfyUiGeneratedImage) {
    const imageKey = `${result.promptId}:${getGeneratedImageReferenceKey(image)}`;
    if (savedCurrentImageKeys.has(imageKey)) {
      return;
    }

    setHistorySaveStatus("saving");
    setHistorySaveMessage("Saving image to project history...");

    try {
      const savedImage = await fetchJson<SavedGeneratedImageResponse>("/api/comfyui/generated-images", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ image }),
      });
      const records = createComfyUiGeneratedImageRecords({
        draft: result.historyContext.draftSnapshot,
        images: [image],
        negativePrompt: result.historyContext.negativePrompt,
        positivePrompt: result.historyContext.positivePrompt,
        result,
        savedImage,
        selectedCheckpointId,
        selectedLoraIds,
      });

      appendComfyUiGeneratedImages(records);
      const savedResultImage = records[0]
        ? createComicSequenceImageFromSavedImage(records[0])
        : null;
      if (savedResultImage) {
        setResults((current) => promoteComicSequenceResultImage(current, result.promptId, savedResultImage));
      }
      if (result.shotId && sequence) {
        const currentProject = useEditorStore.getState().project;
        const savedImageIds = findSavedGeneratedImageIdsForImages(
          currentProject.settings.comfyUiGeneratedImages ?? [],
          result.promptId,
          [image],
        );
        const currentSequence = currentProject.settings.savedComicSequence ?? sequence;
        const nextSequence = bindComicSequenceShotImageIds(
          currentSequence,
          result.shotId,
          savedImageIds,
          { limit: COMIC_SEQUENCE_BOUND_IMAGE_LIMIT },
        );

        if (nextSequence !== currentSequence) {
          setSequence(nextSequence);
          updateProjectSettings({ savedComicSequence: nextSequence });
        }
      }
      await saveProject(useEditorStore.getState().project);
      setSavedCurrentImageKeys((current) => new Set(current).add(imageKey));
      setHistorySaveStatus("success");
      setHistorySaveMessage("Saved to project image history.");
    } catch (error) {
      setHistorySaveStatus("error");
      setHistorySaveMessage(error instanceof Error ? error.message : "Failed to save image.");
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 bg-sky-50 p-5">
          <div className="rounded-md bg-white p-2 text-sky-600">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">Comic Sequence</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {selectedResources.checkpoint ? selectedResources.checkpoint.name : "Independent shot workspace"}
            </p>
          </div>
          <button
            aria-label="Close Comic Sequence"
            className="rounded-full bg-white/80 p-1.5 text-slate-400 shadow-sm transition hover:bg-white hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loadStatus === "loading" ? (
            <div className="rounded-md border border-sky-100 bg-sky-50 p-3 text-sm text-sky-700">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Loading Comic Sequence context...
            </div>
          ) : null}
          {loadStatus === "error" ? (
            <div className="rounded-md border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{loadError}</div>
          ) : null}
          {loadStatus === "success" ? (
            <div className="space-y-5">
              {sequence?.shots.length ? (
                <section className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800">Saved shot images</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">Generated or bound project images by shot</p>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {sequence.shots.reduce((count, shot) => count + (savedImagesByShot.get(shot.id)?.length ?? 0), 0)} saved
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sequence.shots.map((shot, index) => {
                      const savedImages = savedImagesByShot.get(shot.id) ?? [];
                      const previewImages = savedImages.slice(0, 3);
                      const boundCount = (shot.boundImageIds ?? []).filter((imageId) => savedImageById.has(imageId)).length;
                      const selected = selectedShot?.id === shot.id;

                      return (
                        <button
                          className={
                            "min-w-0 rounded-md border p-2 text-left transition " +
                            (selected
                              ? "border-sky-300 bg-sky-50 ring-2 ring-sky-100"
                              : "border-slate-200 bg-white hover:bg-slate-50")
                          }
                          key={shot.id}
                          onClick={() => selectShot(shot.id)}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] font-bold text-slate-800">
                              {index + 1}. {shot.title}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                              {savedImages.length}{boundCount > 0 ? ` / ${boundCount} bound` : ""}
                            </span>
                          </div>
                          {savedImages.length > 0 ? (
                            <div className="mt-2 grid grid-cols-3 gap-1">
                              {previewImages.map((image) => (
                                <img
                                  alt={`${shot.title} saved result`}
                                  className="aspect-square min-w-0 rounded border border-slate-100 object-cover"
                                  key={image.id}
                                  src={image.url}
                                />
                              ))}
                              {savedImages.length > previewImages.length ? (
                                <div className="grid aspect-square place-items-center rounded border border-slate-100 bg-slate-100 text-[10px] font-semibold text-slate-500">
                                  +{savedImages.length - previewImages.length}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-2 grid h-14 place-items-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-400">
                              No saved image
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {selectedShot ? (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800">Bind project images to {selectedShot.title}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            Bound images count as saved results for this shot, so the next shot can use them as previous-shot img2img or inpaint sources.
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-semibold text-slate-500">
                          {selectedBoundImageCount}/{COMIC_SEQUENCE_BOUND_IMAGE_LIMIT} bound
                        </span>
                      </div>
                      {bindingCandidates.length > 0 ? (
                        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
                          {bindingCandidates.map((image) => {
                            const bound = selectedBoundImageIds.has(image.id);
                            const naturalShotImage = image.source === "sequence" && image.shotId === selectedShot.id;
                            const limitReached = !bound && selectedBoundImageCount >= COMIC_SEQUENCE_BOUND_IMAGE_LIMIT;

                            return (
                              <button
                                className={
                                  "group relative overflow-hidden rounded-md border text-left transition disabled:cursor-not-allowed disabled:opacity-50 " +
                                  (bound
                                    ? "border-sky-400 ring-2 ring-sky-100"
                                    : naturalShotImage
                                      ? "border-emerald-200 hover:border-sky-300"
                                      : "border-slate-200 hover:border-sky-300")
                                }
                                disabled={limitReached}
                                key={image.id}
                                onClick={() => toggleShotBoundImage(selectedShot.id, image)}
                                title={
                                  bound
                                    ? `Unbind ${image.filename}`
                                    : limitReached
                                      ? "Binding limit reached"
                                      : `Bind ${image.filename}`
                                }
                                type="button"
                              >
                                <img alt={image.filename} className="aspect-square w-full object-cover" src={image.url} />
                                <span
                                  className={
                                    "absolute left-1 top-1 rounded px-1 text-[10px] font-semibold shadow-sm " +
                                    (bound
                                      ? "bg-sky-600 text-white"
                                      : naturalShotImage
                                        ? "bg-emerald-600 text-white"
                                        : "bg-white/90 text-slate-600")
                                  }
                                >
                                  {bound ? "bound" : naturalShotImage ? "saved" : "bind"}
                                </span>
                                {bound ? (
                                  <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-white/95 text-sky-600 shadow-sm">
                                    <Link2 className="size-3" />
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-500">
                          No saved project images yet. Save a generated image first, then bind it here.
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-3">
                <Button
                  className="h-10 w-full rounded-md bg-sky-600 text-white hover:bg-sky-700"
                  disabled={!allResourceDownloadsReady}
                  onClick={addShotFromCurrentCanvas}
                  type="button"
                >
                  <Plus className="size-4" />
                  Add shot from current canvas
                </Button>
                <div className="rounded-md border border-sky-100 bg-sky-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800">AI storyboard</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">Split an action paragraph into manual shot prompts.</p>
                    </div>
                    {nsfwEnabled ? (
                      <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">NSFW</span>
                    ) : null}
                  </div>
                  <textarea
                    className="mt-3 min-h-28 w-full rounded-md border border-sky-100 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                    disabled={storyboardStatus === "loading"}
                    onChange={(event) => {
                      setStoryboardInput(event.target.value);
                      if (storyboardStatus !== "loading") {
                        setStoryboardStatus("idle");
                        setStoryboardError("");
                        setStoryboardMessage("");
                      }
                    }}
                    placeholder="The hero dodges left, slides under the attack, then counterattacks from a low angle..."
                    value={storyboardInput}
                  />
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">target shots</span>
                      <input
                        className="h-9 min-w-0 rounded-md border border-sky-100 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        disabled={storyboardStatus === "loading"}
                        max={COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS}
                        min={COMIC_SEQUENCE_STORYBOARD_MIN_SHOTS}
                        onChange={(event) => {
                          setStoryboardTargetCount(event.target.value);
                          if (storyboardStatus !== "loading") {
                            setStoryboardStatus("idle");
                            setStoryboardError("");
                            setStoryboardMessage("");
                          }
                        }}
                        placeholder="auto"
                        type="number"
                        value={storyboardTargetCount}
                      />
                    </label>
                    <Button
                      className="mt-5 h-9 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700"
                      disabled={storyboardStatus === "loading" || loadStatus !== "success" || !sequence}
                      onClick={() => void generateAiStoryboardShots()}
                      type="button"
                    >
                      {storyboardStatus === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      Generate
                    </Button>
                  </div>
                  {storyboardStatus === "error" && storyboardError ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-rose-700">{storyboardError}</p>
                  ) : null}
                  {storyboardStatus === "success" && storyboardMessage ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-700">{storyboardMessage}</p>
                  ) : null}
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  {sequence?.shots.length ? (
                    <div className="space-y-2">
                      {sequence.shots.map((shot, index) => (
                        <button
                          className={
                            "w-full rounded-md border p-3 text-left transition " +
                            (selectedShot?.id === shot.id
                              ? "border-sky-300 bg-sky-50 text-sky-900 ring-2 ring-sky-100"
                              : "border-slate-200 text-slate-700 hover:bg-slate-50")
                          }
                          key={shot.id}
                          onClick={() => selectShot(shot.id)}
                          type="button"
                        >
                          <span className="block text-xs font-semibold">
                            {index + 1}. {shot.title}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-slate-500">
                            {shot.shotPrompt || shot.positivePrompt || "No prompt"}
                          </span>
                          <span className="mt-2 block text-[10px] text-slate-400">
                            {getComicSequenceReferenceCount(shot.reference)} refs · {shot.controlNets.filter((unit) => unit.enabled).length} control
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-200 p-4 text-xs leading-relaxed text-slate-500">
                      No shots yet. Add the current canvas to start an independent sequence.
                    </div>
                  )}
                </div>
                {selectedShot ? (
                  <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <Button className="h-9 rounded-md bg-white text-slate-700" onClick={updateSelectedShotFromCurrentCanvas} type="button" variant="secondary">
                      <Save className="size-3.5" />
                      Update from canvas
                    </Button>
                    <Button className="h-9 rounded-md bg-white text-slate-700" onClick={loadSelectedShotToCanvas} type="button" variant="secondary">
                      <Undo2 className="size-3.5" />
                      Load to canvas
                    </Button>
                    <Button className="h-9 rounded-md bg-white text-slate-700" onClick={duplicateSelectedShot} type="button" variant="secondary">
                      <Plus className="size-3.5" />
                      Duplicate
                    </Button>
                    <Button className="h-9 rounded-md border-rose-200 bg-white text-rose-700 hover:bg-rose-50" onClick={deleteSelectedShot} type="button" variant="secondary">
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                ) : null}
                <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
                  <div className="flex justify-between gap-3">
                    <span>Shots</span>
                    <strong className="text-slate-900">{sequence?.shots.length ?? 0}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>LoRA</span>
                    <strong className="text-slate-900">{selectedLoraIds.length}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Ready</span>
                    <strong className={allResourceDownloadsReady ? "text-emerald-700" : "text-amber-700"}>
                      {allResourceDownloadsReady ? "yes" : "no"}
                    </strong>
                  </div>
                </div>
              </aside>

              <div className="min-w-0 space-y-4">
                {selectedShot && draft ? (
                  <>
                    <div
                      className={`flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${
                        parameterSyncDownEnabled
                          ? "border-sky-200 bg-sky-50 text-sky-900"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">Shot setting chain</p>
                        <p className={`mt-0.5 text-[11px] leading-relaxed ${parameterSyncDownEnabled ? "text-sky-700" : "text-slate-500"}`}>
                          {parameterSyncDownEnabled
                            ? "Setting edits sync to this shot and every shot below it, except title and manual shot prompt."
                            : "Setting edits apply to the selected shot only."}
                        </p>
                      </div>
                      <button
                        aria-pressed={parameterSyncDownEnabled}
                        className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium transition ${
                          parameterSyncDownEnabled
                            ? "border-sky-300 bg-white text-sky-700 hover:bg-sky-100"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                        onClick={() => setParameterSyncDownEnabled((value) => !value)}
                        title="Sync shot setting edits to following shots"
                        type="button"
                      >
                        <Link2 className="size-3.5" />
                        {parameterSyncDownEnabled ? "Sync down on" : "Sync down"}
                      </button>
                    </div>

                    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-2">
                      <label className="grid gap-1.5">
                        <span className="text-xs font-semibold text-slate-700">Shot title</span>
                        <input
                          className={COMFYUI_TEXT_FIELD_CLASS}
                          onChange={(event) => patchSelectedShot({ title: event.target.value })}
                          value={selectedShot.title}
                        />
                      </label>
                      <label className="grid gap-1.5 sm:col-span-2">
                        <span className="text-xs font-semibold text-slate-700">Manual shot prompt</span>
                        <textarea
                          className="min-h-28 resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                          onChange={(event) => patchSelectedShot({ shotPrompt: event.target.value })}
                          placeholder={"camera move, emotion, local action\nclose-up, worried expression, hand reaching for the door"}
                          value={selectedShot.shotPrompt}
                        />
                      </label>
                      <label className="grid gap-1.5 sm:col-span-2">
                        <span className="text-xs font-semibold text-slate-700">Canvas prompt</span>
                        <textarea
                          className="min-h-24 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                          onChange={(event) => patchSelectedShotSettings({ positivePrompt: event.target.value })}
                          value={selectedShot.positivePrompt}
                        />
                      </label>
                      <label className="grid gap-1.5 sm:col-span-2">
                        <span className="text-xs font-semibold text-slate-700">Negative prompt</span>
                        <textarea
                          className="min-h-20 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                          onChange={(event) => patchSelectedShotSettings({ negativePrompt: event.target.value })}
                          value={selectedShot.negativePrompt}
                        />
                      </label>
                    </div>

                    <div className="rounded-md border border-sky-100 bg-sky-50/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-700">Previous shot source</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            Use the first candidate from the previous shot as an img2img or local inpaint source.
                          </p>
                        </div>
                        {selectedPreviousShotSource ? (
                          <img
                            alt="Previous shot source"
                            className="size-12 shrink-0 rounded-md border border-sky-100 object-cover"
                            src={selectedPreviousShotSource.image.url}
                          />
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <SelectInput
                          label="mode"
                          onChange={(value) => patchSelectedPreviousShotReference(value as SequencePreviousShotReferenceMode)}
                          options={COMIC_SEQUENCE_PREVIOUS_REFERENCE_OPTIONS}
                          value={selectedShot.previousShotReference?.mode ?? "off"}
                        />
                        {selectedShot.previousShotReference ? (
                          <>
                            <NumberInput
                              label="denoise"
                              max={1}
                              min={COMIC_SEQUENCE_PREVIOUS_SHOT_MIN_DENOISE}
                              onChange={(value) => patchSelectedPreviousShotReference(selectedShot.previousShotReference?.mode ?? "img2img", { denoise: value })}
                              step={0.05}
                              value={selectedShot.previousShotReference.denoise}
                            />
                            <SelectInput
                              label="inpaint mode"
                              onChange={(value) =>
                                patchSelectedPreviousShotReference(selectedShot.previousShotReference?.mode ?? "img2img", {
                                  inpaintMode: value as ComfyUiInpaintMode,
                                })}
                              options={COMFYUI_INPAINT_MODE_OPTIONS}
                              value={selectedShot.previousShotReference.inpaintMode}
                            />
                            <NumberInput
                              label="grow mask"
                              max={512}
                              min={0}
                              onChange={(value) =>
                                patchSelectedPreviousShotReference(selectedShot.previousShotReference?.mode ?? "img2img", {
                                  growMaskBy: value,
                                })}
                              value={selectedShot.previousShotReference.growMaskBy}
                            />
                          </>
                        ) : null}
                      </div>
                      {selectedShot.previousShotReference ? (
                        <div className="mt-3 flex flex-col gap-2 rounded-md border border-sky-100 bg-white/70 p-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[11px] leading-relaxed text-sky-800">
                            {selectedPreviousShotSource
                              ? `Source: ${selectedPreviousShotSource.previousShot.title} / ${selectedPreviousShotSource.image.filename}`
                              : selectedShotHasPreviousShot
                                ? "No previous shot result yet. You can configure a pending mask before generating from an earlier shot."
                                : "This is the first shot, so no previous-shot source can be used."}
                            {selectedShot.previousShotReference.mode === "inpaint"
                              ? selectedPreviousShotMaskReady
                                ? " Mask ready."
                                : selectedShotHasPreviousShot
                                  ? " Mask required before local inpaint can run."
                                  : ""
                              : ""}
                          </p>
                          {selectedShot.previousShotReference.mode === "inpaint" && selectedShotHasPreviousShot ? (
                            <Button
                              className="h-8 shrink-0 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700"
                              onClick={() =>
                                setMaskEditorTarget({
                                  fallbackSize: selectedPreviousShotFallbackSize,
                                  shotId: selectedShot.id,
                                  source: selectedPreviousShotSource,
                                })}
                              type="button"
                            >
                              <Paintbrush className="size-3.5" />
                              Configure mask
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-700">Reference / IPAdapter</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            Face and Character references can both be enabled with separate images.
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <TextInput
                          label="character"
                          onChange={(value) => patchSelectedReference({ characterName: value })}
                          value={selectedShot.reference.characterName}
                        />
                        <TextInput
                          label="character prompt"
                          onChange={(value) => patchSelectedReference({ characterPrompt: value })}
                          placeholder="hair, outfit, face notes"
                          value={selectedShot.reference.characterPrompt}
                        />
                      </div>
                      {referenceUploadStatus === "error" && referenceUploadError ? (
                        <p className="mt-3 text-[11px] leading-relaxed text-rose-700">{referenceUploadError}</p>
                      ) : null}
                      <div className="mt-4 grid gap-3 xl:grid-cols-2">
                        {(["face", "character"] as const).map((channelKey) => {
                          const config = SEQUENCE_REFERENCE_CHANNEL_CONFIGS[channelKey];
                          const channel = channelKey === "face" ? selectedShotFaceReference : selectedShotCharacterReference;
                          const historyIds = new Set(
                            channel.images
                              .filter((image): image is Extract<SavedComicSequenceReferenceImage, { source: "history" }> => image.source === "history")
                              .map((image) => image.imageId),
                          );
                          const uploadedReferences = channel.images.filter(
                            (image): image is Extract<SavedComicSequenceReferenceImage, { source: "upload" }> => image.source === "upload",
                          );

                          return (
                            <div className="rounded-md border border-slate-200 bg-white p-3" key={channelKey}>
                              <div className="flex items-start justify-between gap-3">
                                <label className="flex min-w-0 items-start gap-2 text-xs text-slate-700">
                                  <input
                                    checked={channel.enabled}
                                    className="mt-0.5 size-3.5 rounded border-slate-300 text-sky-600"
                                    onChange={(event) => patchSelectedReferenceChannel(channelKey, { enabled: event.target.checked })}
                                    type="checkbox"
                                  />
                                  <span>
                                    <span className="block font-semibold text-slate-800">{config.label} reference</span>
                                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{config.description}</span>
                                  </span>
                                </label>
                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                  {channel.mode}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-3 gap-2">
                                <NumberInput
                                  label="weight"
                                  max={1}
                                  min={0}
                                  onChange={(value) => patchSelectedReferenceChannel(channelKey, { weight: value })}
                                  step={0.01}
                                  value={channel.weight}
                                />
                                <NumberInput
                                  label="start_at"
                                  max={1}
                                  min={0}
                                  onChange={(value) => patchSelectedReferenceChannel(channelKey, { startAt: value })}
                                  step={0.01}
                                  value={channel.startAt}
                                />
                                <NumberInput
                                  label="end_at"
                                  max={1}
                                  min={0}
                                  onChange={(value) => patchSelectedReferenceChannel(channelKey, { endAt: value })}
                                  step={0.01}
                                  value={channel.endAt}
                                />
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3">
                                <p className="text-[11px] text-slate-500">
                                  {channel.images.length}/4 images · {Math.min(channel.startAt, channel.endAt).toFixed(2)}-{Math.max(channel.startAt, channel.endAt).toFixed(2)}
                                </p>
                                <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                                  {referenceUploadStatus === "uploading" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                                  Upload
                                  <input
                                    accept="image/png,image/jpeg,image/webp"
                                    className="sr-only"
                                    disabled={referenceUploadStatus === "uploading"}
                                    multiple
                                    onChange={(event) => void handleUploadReferenceFiles(channelKey, event.currentTarget.files)}
                                    type="file"
                                  />
                                </label>
                              </div>
                              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                                {referenceCandidates.map((image) => (
                                  <button
                                    className={
                                      "overflow-hidden rounded-md border text-left transition " +
                                      (historyIds.has(image.id)
                                        ? "border-sky-400 ring-2 ring-sky-100"
                                        : "border-slate-200 hover:border-sky-200")
                                    }
                                    key={image.id}
                                    onClick={() => toggleHistoryReference(channelKey, image)}
                                    title={image.filename}
                                    type="button"
                                  >
                                    <img alt={image.filename} className="aspect-square w-full object-cover" src={image.url} />
                                  </button>
                                ))}
                                {uploadedReferences.map((image) => (
                                  <button
                                    className="relative overflow-hidden rounded-md border border-emerald-200 text-left"
                                    key={image.id}
                                    onClick={() => removeReferenceImage(channelKey, image.id)}
                                    title={`Remove ${image.name}`}
                                    type="button"
                                  >
                                    <img alt={image.name} className="aspect-square w-full object-cover" src={image.url} />
                                    <span className="absolute right-1 top-1 rounded bg-white/90 px-1 text-[10px] text-emerald-700">upload</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-xs font-semibold text-slate-700">Generation parameters</p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <NumberInput label="width" min={16} onChange={(value) => patchDraft({ width: Math.round(value / 8) * 8 })} step={8} value={draft.width} />
                        <NumberInput label="height" min={16} onChange={(value) => patchDraft({ height: Math.round(value / 8) * 8 })} step={8} value={draft.height} />
                        <NumberInput label="steps" min={1} onChange={(value) => patchDraft({ steps: Math.round(value) })} value={draft.steps} />
                        <NumberInput label="cfg" min={0} onChange={(value) => patchDraft({ cfg: value })} step={0.5} value={draft.cfg} />
                        <NumberInput label="denoise" max={1} min={0} onChange={(value) => patchDraft({ denoise: value })} step={0.05} value={draft.denoise} />
                        <NumberInput
                          label="images / shot"
                          max={MAX_COMFYUI_GENERATION_IMAGE_COUNT}
                          min={1}
                          onChange={(value) => patchDraft({ imageCount: normalizeComfyUiGenerationImageCount(value) })}
                          value={draft.imageCount}
                        />
                        <SelectInput label="sampler" onChange={(value) => patchDraft({ samplerName: value })} options={samplerOptions} value={draft.samplerName} />
                        <SelectInput label="scheduler" onChange={(value) => patchDraft({ scheduler: value })} options={schedulerOptions} value={draft.scheduler} />
                        <SelectInput
                          label="latent"
                          onChange={(value) => patchDraft({ latentImageNode: value as GenerationDraft["latentImageNode"] })}
                          options={COMFYUI_LATENT_IMAGE_NODE_OPTIONS}
                          value={draft.latentImageNode}
                        />
                        <TextInput label="output" onChange={(value) => patchDraft({ outputPrefix: value })} value={draft.outputPrefix} />
                        <div className="grid gap-1 lg:col-span-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">seed</span>
                            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                              {(["random", "fixed"] as const).map((mode) => (
                                <button
                                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                                    draft.seedMode === mode ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"
                                  }`}
                                  key={mode}
                                  onClick={() => patchDraft({ seedMode: mode })}
                                  type="button"
                                >
                                  {mode}
                                </button>
                              ))}
                            </div>
                          </div>
                          <input
                            className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            min={0}
                            onChange={(event) => {
                              const parsed = Number(event.target.value);
                              if (Number.isFinite(parsed)) {
                                patchDraft({ seed: Math.round(parsed), seedMode: "fixed" });
                              }
                            }}
                            step={1}
                            type="number"
                            value={draft.seed}
                          />
                        </div>
                      </div>
                    </div>

                    <ControlNetOpenPoseFoldout
                      controlNets={draft.controlNets}
                      expanded={Boolean(shotOpenPosePreview?.available && controlNetExpanded)}
                      normalPreview={controlNetNormalPreview}
                      normalPreviewLoading={controlNetNormalPreviewLoading}
                      onChange={patchControlNet}
                      onToggle={() => setControlNetExpanded((value) => !value)}
                      preview={shotOpenPosePreview}
                    />
                    <DetailerFoldout
                      detailer={draft.handDetailer}
                      label="HandDetailer"
                      onChange={patchHandDetailer}
                      parameterLabel="hand"
                      samplerOptions={samplerOptions}
                      schedulerOptions={schedulerOptions}
                    />
                    <DetailerFoldout
                      detailer={draft.faceDetailer}
                      label="FaceDetailer"
                      onChange={patchFaceDetailer}
                      parameterLabel="face"
                      samplerOptions={samplerOptions}
                      schedulerOptions={schedulerOptions}
                    />
                  </>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 p-6 text-sm leading-relaxed text-slate-500">
                    Add a shot from the current canvas to configure independent prompt, reference, OpenPose, KSampler, and detailer nodes.
                  </div>
                )}
              </div>
              </div>
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="mt-5 space-y-4">
              {results.map((result, shotIndex) => {
                const shotLabel = result.shotNumber ? `Shot ${result.shotNumber}` : `Shot ${shotIndex + 1}`;
                const shotTitle = result.shotTitle ? ` - ${result.shotTitle}` : "";

                return (
                  <section className="space-y-2" key={result.promptId}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-800">{shotLabel}{shotTitle}</p>
                        <p className="text-[11px] text-slate-500">seed {result.seed} - promptId {result.promptId}</p>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {result.images.length}/{result.imageCount}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {result.images.map((image, imageIndex) => {
                        const imageKey = `${result.promptId}:${getGeneratedImageReferenceKey(image)}`;
                        const saved = savedCurrentImageKeys.has(imageKey);

                        return (
                          <div className="overflow-hidden rounded-md border border-slate-200 bg-white" key={imageKey}>
                            <a href={image.url} rel="noreferrer" target="_blank">
                              <img
                                alt={`${shotLabel} candidate ${imageIndex + 1}`}
                                className="aspect-square w-full object-cover"
                                src={image.url}
                              />
                            </a>
                            <div className="flex items-center gap-1 border-t border-slate-200 px-1.5 py-1.5">
                              <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{image.filename}</span>
                              <button
                                aria-label="Save sequence image"
                                className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                                disabled={saved || historySaveStatus === "saving"}
                                onClick={() => void saveSequenceImage(result, image)}
                                title={saved ? "Saved" : "Save"}
                                type="button"
                              >
                                {saved ? <CheckCircle2 className="size-3.5" /> : <Save className="size-3.5" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            {waitMessage ? (
              <span>{submitStatus === "loading" ? <Loader2 className="mr-1.5 inline size-3.5 animate-spin" /> : null}{waitMessage}</span>
            ) : historySaveMessage ? (
              <span className={historySaveStatus === "error" ? "text-rose-700" : historySaveStatus === "success" ? "text-emerald-700" : "text-sky-700"}>
                {historySaveMessage}
              </span>
            ) : submitStatus === "error" ? (
              <span className="text-rose-700">{submitError}</span>
            ) : (
              <span>{sequence?.shots.length ?? 0} independent shots</span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-3">
            <Button
              className="h-10 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              disabled={submitStatus === "loading" || historySaveStatus === "saving"}
              onClick={onClose}
              type="button"
              variant="secondary"
            >
              Close
            </Button>
            <BooleanInput
              checked={previewSequenceEnabled}
              label="Preview"
              onChange={setPreviewSequenceEnabled}
            />
            <Button
              className="h-10 rounded-md border-sky-200 bg-white text-sky-700 hover:bg-sky-50"
              disabled={submitStatus === "loading" || !selectedShot || !allResourceDownloadsReady}
              onClick={() => void submitSequence("shot", previewSequenceEnabled ? "preview" : "full")}
              type="button"
              variant="secondary"
            >
              {submitStatus === "loading" && activeSubmitMode === "shot" && activeSubmitGenerationMode !== null ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {previewSequenceEnabled ? "Generate shot preview" : "Generate shot"}
            </Button>
            <Button
              className="h-10 rounded-md bg-sky-600 text-white hover:bg-sky-700"
              disabled={submitStatus === "loading" || !sequence?.shots.length || !allResourceDownloadsReady}
              onClick={() => void submitSequence("sequence", previewSequenceEnabled ? "preview" : "full")}
              type="button"
            >
              {submitStatus === "loading" && activeSubmitMode === "sequence" && activeSubmitGenerationMode !== null ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {previewSequenceEnabled ? "Generate sequence preview" : "Generate sequence"}
            </Button>
          </div>
        </div>
        <SequencePreviousShotMaskDialog
          fallbackSize={maskEditorTarget?.fallbackSize ?? null}
          initialMaskDataUrl={maskEditorInitialMaskDataUrl}
          key={maskEditorTarget ? `${maskEditorTarget.shotId}:${maskEditorTarget.source?.sourceKey ?? "pending"}` : "closed"}
          onClose={() => setMaskEditorTarget(null)}
          onSave={(mask) => {
            if (maskEditorTarget) {
              savePreviousShotMask(maskEditorTarget.shotId, mask);
            }
          }}
          open={Boolean(maskEditorTarget)}
          source={maskEditorTarget?.source ?? null}
        />
      </div>
    </div>,
    document.body,
  );
}

export function ImageGenerationPanel() {
  const project = useEditorStore((state) => state.project);
  const aiGeneratedPrompt = useEditorStore((state) => state.aiGeneratedPrompt);
  const generatedPrompt = useMemo(() => generatePrompt(project), [project]);
  const activePrompt = aiGeneratedPrompt.trim() || generatedPrompt.prompt;
  const selectedCheckpointId = project.settings.selectedCivitaiCheckpointId;
  const selectedLoraIds = project.settings.selectedCivitaiLoraIds ?? [];
  const savedParameters = project.settings.savedComfyUiGenerationParams ?? null;
  const hasCheckpoint = Boolean(selectedCheckpointId);
  const [open, setOpen] = useState(false);
  const [sequenceOpen, setSequenceOpen] = useState(false);

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="rounded-md bg-sky-50 p-1.5 text-sky-600">
            <ImageIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-800">运行生图</h2>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">ComfyUI text-to-image</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            className="h-8 rounded-md border-sky-200 bg-white px-3 text-xs text-sky-700 hover:bg-sky-50 disabled:opacity-60"
            disabled={!hasCheckpoint}
            onClick={() => setSequenceOpen(true)}
            size="sm"
            title={!hasCheckpoint ? "Select a checkpoint first" : "Comic Sequence"}
            type="button"
            variant="secondary"
          >
            <Sparkles className="size-3.5" />
            Sequence
          </Button>
          <Button
            className="h-8 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
            disabled={!hasCheckpoint || !activePrompt.trim()}
            onClick={() => setOpen(true)}
            size="sm"
            title={!hasCheckpoint ? "Select a checkpoint first" : "Open ComfyUI generation settings"}
            type="button"
          >
            <Play className="size-3.5" />
            ComfyUI
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        {!hasCheckpoint
          ? "请先选择一个 Civitai checkpoint；LoRA 会随当前选择一起进入 ComfyUI 工作流。"
          : `当前已选择 ${selectedLoraIds.length} 个 LoRA，参数将使用 Civitai 推荐或观测权重。`}
      </p>
      <ComfyUiGenerationDialog
        activePrompt={activePrompt}
        advice={null}
        baseNegativePrompt={generatedPrompt.negativePrompt}
        onClose={() => setOpen(false)}
        open={open}
        savedParameters={savedParameters}
        selectedCheckpointId={selectedCheckpointId}
        selectedLoraIds={selectedLoraIds}
        title="ComfyUI 生图"
      />
      <ComicSequenceWorkspaceDialog
        activePrompt={activePrompt}
        aiGeneratedPrompt={aiGeneratedPrompt}
        baseNegativePrompt={generatedPrompt.negativePrompt}
        onClose={() => setSequenceOpen(false)}
        open={sequenceOpen}
        savedParameters={savedParameters}
        selectedCheckpointId={selectedCheckpointId}
        selectedLoraIds={selectedLoraIds}
      />
    </section>
  );
}
