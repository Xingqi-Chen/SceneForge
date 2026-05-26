"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eraser,
  Image as ImageIcon,
  Loader2,
  Minus,
  Paintbrush,
  Play,
  Plus,
  Settings,
  Sparkles,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
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
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_INPAINT_DENOISE,
  DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY,
  DEFAULT_COMFYUI_INPAINT_MODE,
  MIN_COMFYUI_VAE_INPAINT_DENOISE,
  COMFYUI_LATENT_IMAGE_NODE_OPTIONS,
  normalizeComfyUiInpaintDenoiseForMode,
  type ComfyUiGeneratedImage,
  type ComfyUiGenerateSam2MaskResponse,
  type ComfyUiInpaintMode,
  type ComfyUiInpaintLocalRegionConfig,
  type ComfyUiInpaintRequest,
  type ComfyUiInpaintUpscaleModelPresetMode,
  type ComfyUiInpaintUpscaleMode,
  type ComfyUiInpaintUpscaleStrategy,
  type ComfyUiInputValue,
  type ComfyUiPromptHistoryResponse,
  type ComfyUiSam2Bbox,
  type ComfyUiSam2Point,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
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
import {
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
  normalizeComfyUiSamplerSettings,
} from "@/features/editor/ai-prompt/comfyui-generation-options";
import type { CivitaiAiPromptResult } from "@/features/editor/ai-prompt/civitai-ai-context";
import {
  findMaskAlphaBounds,
  padAndAlignLocalRegion,
  resolveInpaintLocalRegion,
  type InpaintLocalRegionRect,
} from "@/features/editor/inpaint-local-region";
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
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import { generatePrompt } from "@/features/prompt-engine";
import type { SavedComfyUiGenerationParams } from "@/shared/types";

type LoadStatus = "idle" | "loading" | "success" | "error";
type SubmitStatus = "idle" | "loading" | "success" | "error";
type DownloadActionStatus = "idle" | "loading" | "success" | "error";
type DiagnosisStatus = "idle" | "analyzing" | "searching" | "suggesting" | "success" | "error";
type InpaintMaskTool = "brush" | "eraser" | "sam-positive" | "sam-negative" | "sam-box";
type SamMaskStatus = "idle" | "generating" | "success" | "error";

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

type GenerationResult = {
  imageCount: number;
  images: ComfyUiGeneratedImage[];
  promptId: string;
  number?: number;
  outputNodeId: string;
  seed: number;
};

type GeneratedImageItem = {
  image: ComfyUiGeneratedImage;
  seed: number;
};

type GenerationProgress = {
  value: number;
  max: number;
  node?: string;
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

type GenerationDraft = Required<Omit<ComfyUiTextToImageRequest, "loras" | "promptWrapper" | "faceDetailer" | "handDetailer" | "controlNet" | "controlNets">> & {
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

const EMPTY_SELECTED_RESOURCES: SelectedCivitaiResourcesPreview = {
  checkpoint: null,
  loras: [],
};
const CONTROLNET_MODEL_PATH_STORAGE_KEY = "sceneforge.controlNetModelPath";
const COMFYUI_HISTORY_POLL_INTERVAL_MS = 2000;
const COMFYUI_HISTORY_POLL_TIMEOUT_MS = 180000;
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

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getStoredControlNetModelPath() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(CONTROLNET_MODEL_PATH_STORAGE_KEY)?.trim() ?? "";
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

function getGeneratedImageKey(image: ComfyUiGeneratedImage, index: number) {
  return [image.nodeId, image.filename, image.subfolder ?? "", image.type ?? "", index].join("|");
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

      events.addEventListener("comfyui-error", (event) => {
        const payload = parseEventData<{ message?: string }>(event as MessageEvent<string>);
        finish(() => reject(new Error(payload.message ?? "ComfyUI WebSocket 监听失败。")));
      });

      events.onerror = () => {
        finish(() => reject(new Error("ComfyUI WebSocket 监听连接中断。")));
      };
    });
  }

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
      throw new Error("ComfyUI 生成已完成，但 history 中没有找到 SaveImage 输出。");
    }

    await delay(COMFYUI_HISTORY_POLL_INTERVAL_MS);
  }

  throw new Error("等待 ComfyUI 生成结果超时，请稍后在 ComfyUI history 中查看该 prompt。");
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

function toSavedParameters(draft: GenerationDraft): SavedComfyUiGenerationParams {
  return {
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

function toRequestPayload(
  draft: GenerationDraft,
  seed: number,
  controlNetPreview?: ComfyUiControlNetOpenPosePreview | null,
  normalPreview?: ComfyUiNormalControlImagePreview | null,
): ComfyUiTextToImageRequest {
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
  return {
    checkpointName: draft.checkpointName,
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
        className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
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
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
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
      <select
        className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
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

function DetailerFoldout({
  detailer,
  label,
  onChange,
  parameterLabel,
}: {
  detailer: GenerationDraft["faceDetailer"];
  label: string;
  onChange: (patch: Partial<GenerationDraft["faceDetailer"]>) => void;
  parameterLabel: string;
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
            options={COMFYUI_SAMPLER_OPTIONS}
            value={detailer.samplerName}
          />
          <SelectInput
            label={`${parameterLabel} scheduler`}
            onChange={(value) => onChange({ scheduler: value })}
            options={COMFYUI_SCHEDULER_OPTIONS}
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
  if (modelOptions.length === 0) {
    return <TextInput label={label} onChange={onChange} value={value} />;
  }

  const hasCurrentValue = value && !modelOptions.some((option) => option.value === value);
  const options = [
    { label: "Auto pick from ComfyUI", value: "" },
    ...(hasCurrentValue ? [{ label: `Current: ${value}`, value }] : []),
    ...modelOptions,
  ];

  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <select
        className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value || "__auto"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function GeneratedImageResults({
  generatedImageItems,
  imageClickMode,
  onSelectImage,
  progress,
  resultsCount,
  selectedImageKey,
  submitStatus,
  waitMessage,
}: {
  generatedImageItems: GeneratedImageItem[];
  imageClickMode: "open" | "select";
  onSelectImage: (imageKey: string) => void;
  progress: GenerationProgress | null;
  resultsCount: number;
  selectedImageKey: string;
  submitStatus: SubmitStatus;
  waitMessage: string;
}) {
  if (generatedImageItems.length > 0) {
    return (
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">生成结果</p>
        <div className="grid grid-cols-2 gap-2">
          {generatedImageItems.map((item, index) => {
            const { image } = item;
            const imageKey = getGeneratedImageKey(image, index);
            const selected = imageClickMode === "select" && (selectedImageKey ? selectedImageKey === imageKey : index === 0);
            const imageContent = (
              <>
                <img
                  alt={`ComfyUI generated image ${index + 1}`}
                  className="aspect-square w-full object-cover transition group-hover:scale-[1.02]"
                  src={image.url}
                />
                <div className="border-t border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                  <span className="block truncate">
                    {selected ? "诊断图 · " : ""}
                    {image.filename}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-600">seed {item.seed}</span>
                </div>
              </>
            );

            if (imageClickMode === "open") {
              return (
                <a
                  className="group block overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-left transition hover:border-sky-200"
                  href={image.url}
                  key={imageKey}
                  rel="noreferrer"
                  target="_blank"
                  title={`打开原图：${image.filename}`}
                >
                  {imageContent}
                </a>
              );
            }

            return (
              <button
                className={`group block overflow-hidden rounded-md border bg-slate-50 text-left transition ${
                  selected ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200 hover:border-sky-200"
                }`}
                key={imageKey}
                onClick={() => onSelectImage(imageKey)}
                title={image.filename}
                type="button"
              >
                {imageContent}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (resultsCount > 0 && submitStatus === "loading") {
    const progressPercent = getProgressPercent(progress);

    return (
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
            style={{ width: `${progress ? progressPercent : 8}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] font-medium text-sky-600">
          <span>{progress ? `${progress.value}/${progress.max}${progress.node ? ` · node ${progress.node}` : ""}` : "等待进度事件"}</span>
          <span>{progress ? `${progressPercent}%` : ""}</span>
        </div>
      </div>
    );
  }

  return null;
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to render ControlNet SVG."));
    image.src = src;
  });
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
  const [controlNetModelPath, setControlNetModelPath] = useState(getStoredControlNetModelPath);
  const [controlNetModelPathDraft, setControlNetModelPathDraft] = useState(getStoredControlNetModelPath);
  const [controlNetModelOptions, setControlNetModelOptions] = useState<ControlNetModelOption[]>([]);
  const [controlNetModelLoadStatus, setControlNetModelLoadStatus] = useState<LoadStatus>("idle");
  const [controlNetModelLoadError, setControlNetModelLoadError] = useState("");

  async function loadControlNetModels(modelPath: string) {
    const trimmedPath = modelPath.trim();

    if (!trimmedPath) {
      window.localStorage.removeItem(CONTROLNET_MODEL_PATH_STORAGE_KEY);
      setControlNetModelPath("");
      setControlNetModelPathDraft("");
      setControlNetModelOptions([]);
      setControlNetModelLoadStatus("idle");
      setControlNetModelLoadError("");
      return;
    }

    setControlNetModelLoadStatus("loading");
    setControlNetModelLoadError("");

    try {
      const params = new URLSearchParams({ path: trimmedPath });
      const payload = await fetchJson<ControlNetModelsResponse>(`/api/comfyui/controlnet-models?${params.toString()}`);
      const resolvedPath = payload.modelPath || trimmedPath;

      window.localStorage.setItem(CONTROLNET_MODEL_PATH_STORAGE_KEY, resolvedPath);
      setControlNetModelPath(resolvedPath);
      setControlNetModelPathDraft(resolvedPath);
      setControlNetModelOptions(payload.models);
      setControlNetModelLoadStatus("success");
    } catch (error) {
      setControlNetModelOptions([]);
      setControlNetModelLoadStatus("error");
      setControlNetModelLoadError(error instanceof Error ? error.message : "Unable to load ControlNet models.");
    }
  }

  useEffect(() => {
    const storedPath = getStoredControlNetModelPath();
    if (!storedPath) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadControlNetModels(storedPath);
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
          <div className="grid min-w-0 gap-2">
            <label className="grid min-w-0 gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                ControlNet model path
              </span>
              <input
                className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                onChange={(event) => setControlNetModelPathDraft(event.target.value)}
                placeholder="例如：D:\\ComfyUI\\models\\controlnet"
                type="text"
                value={controlNetModelPathDraft}
              />
            </label>
            <div className="flex min-w-0 justify-end">
              <Button
                className="h-9 w-full rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60 sm:w-auto sm:min-w-[116px]"
                disabled={controlNetModelLoadStatus === "loading"}
                onClick={() => void loadControlNetModels(controlNetModelPathDraft)}
                type="button"
              >
                {controlNetModelLoadStatus === "loading" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Settings className="size-3.5" />
                )}
                保存并扫描
              </Button>
            </div>
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
  savedParameters = null,
  selectedCheckpointId,
  selectedLoraIds,
  title = "ComfyUI 生图",
}: ComfyUiGenerationDialogProps) {
  const scene = useEditorStore((state) => state.project.scene);
  const diagnosisPromptAllowed = diagnosisScopes?.prompt ?? true;
  const diagnosisParameterAllowed = diagnosisScopes?.parameters ?? true;
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
  const [submitError, setSubmitError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [waitMessage, setWaitMessage] = useState("");
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [selectedGeneratedImageKey, setSelectedGeneratedImageKey] = useState("");
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
    setSubmitError("");
    setSaveMessage("");
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
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
      });

      setSelectedResources(resources);
      setDraft(toDraft(settings.request, settings.loras, savedParameters?.seedMode, savedParameters));
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
    // Reload the draft whenever the caller changes the selected resources or locked prompts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCheckpointId, selectedLoraIdsKey, activePrompt, baseNegativePrompt, advice]);

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
    setSubmitError("");
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
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

  async function submitGeneration() {
    if (!draft) {
      return;
    }

    if (!allResourceDownloadsReady) {
      setWaitMessage("");
      setGenerationProgress(null);
      setSubmitStatus("error");
      setSubmitError("请先下载并确认当前 checkpoint / LoRA 文件可用，然后再开始生图。");
      return;
    }

    setSubmitStatus("loading");
    setSubmitError("");
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
    resetDiagnosisState();

    try {
      const imageCount = normalizeComfyUiGenerationImageCount(draft.imageCount);
      const seed = resolveComfyUiGenerationSeed({
        currentSeed: draft.seed,
        mode: draft.seedMode,
      });
      const clientId = createComfyUiClientId();

      setDraft((current) => (current ? { ...current, imageCount, seed } : current));
      setWaitMessage(`已准备生成 ${imageCount} 张图片，正在提交到 ComfyUI...`);

      const requestPayload = toRequestPayload(
        { ...draft, imageCount },
        seed,
        allowControlNet ? controlNetOpenPosePreview : null,
        allowControlNet ? controlNetNormalPreview : null,
      );
      const payload = await fetchJson<Omit<GenerationResult, "imageCount" | "images" | "seed">>("/api/comfyui/generate-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestPayload, clientId }),
      });

      const queuedResult: GenerationResult = {
        imageCount,
        images: [],
        promptId: payload.promptId,
        number: payload.number,
        outputNodeId: payload.outputNodeId,
        seed,
      };

      setResults([queuedResult]);
      setWaitMessage(`已提交 batch_size ${imageCount} 到 ComfyUI，seed ${seed}。`);

      const history = await waitForComfyUiGeneratedImages(clientId, payload.promptId, imageCount, (historyUpdate) => {
        const progress = readComfyUiProgress(historyUpdate.raw);
        if (progress) {
          setGenerationProgress(progress);
          setWaitMessage(`KSampler 采样进度 ${progress.value}/${progress.max}`);
        }

        if (historyUpdate.images.length > 0) {
          setResults([{ ...queuedResult, images: historyUpdate.images }]);
          setWaitMessage(`已获取 ${historyUpdate.images.length}/${imageCount} 张图片，seed ${seed}。`);
        }
      });

      setResults([{ ...queuedResult, images: history.images }]);
      setGenerationProgress({ value: 1, max: 1 });
      setWaitMessage("");
      setSubmitStatus("success");
    } catch (error) {
      setWaitMessage("");
      setGenerationProgress(null);
      setSubmitStatus("error");
      setSubmitError(error instanceof Error ? error.message : "ComfyUI 生图请求失败。");
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

      const payload = await fetchJson<Omit<GenerationResult, "imageCount" | "images" | "seed">>("/api/comfyui/inpaint-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestPayload, clientId }),
      });
      const queuedResult: GenerationResult = {
        imageCount: 1,
        images: [],
        promptId: payload.promptId,
        number: payload.number,
        outputNodeId: payload.outputNodeId,
        seed: input.seed,
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

      setResults((current) =>
        current.map((result) => (
          result.promptId === payload.promptId
            ? { ...queuedResult, images: history.images }
            : result
        )),
      );
      setGenerationProgress({ value: 1, max: 1 });
      setWaitMessage("");
      setSubmitStatus("success");
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
  const generatedImageItems = results.flatMap((result) =>
    result.images.map((image): GeneratedImageItem => ({
      image,
      seed: result.seed,
    })),
  );
  const generatedImages = generatedImageItems.map((item) => item.image);
  const selectedGeneratedImageItem =
    generatedImageItems.find((item, index) => getGeneratedImageKey(item.image, index) === selectedGeneratedImageKey) ??
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
                              options={COMFYUI_SAMPLER_OPTIONS}
                              value={draft.samplerName}
                            />
                            <SelectInput
                              label="scheduler"
                              onChange={(value) => patchDraft({ scheduler: value })}
                              options={COMFYUI_SCHEDULER_OPTIONS}
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
                            />
                            <DetailerFoldout
                              detailer={draft.faceDetailer}
                              label="FaceDetailer"
                              onChange={patchFaceDetailer}
                              parameterLabel="face"
                            />
                          </div>
                          <div className="mt-5">
                            <GeneratedImageResults
                              generatedImageItems={generatedImageItems}
                              imageClickMode={allowDiagnosis ? "select" : "open"}
                              onSelectImage={(imageKey) => {
                                setSelectedGeneratedImageKey(imageKey);
                                clearDiagnosisReview();
                              }}
                              progress={generationProgress}
                              resultsCount={results.length}
                              selectedImageKey={selectedGeneratedImageKey}
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
                  <div className="flex shrink-0 gap-3">
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
                    <Button
                      className="h-10 rounded-md bg-sky-600 text-white hover:bg-sky-700"
                      disabled={!canSubmitGeneration}
                      onClick={() => void submitGeneration()}
                      type="button"
                    >
                      {submitStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
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
        <Button
          className="h-8 shrink-0 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
          disabled={!hasCheckpoint || !activePrompt.trim()}
          onClick={() => setOpen(true)}
          size="sm"
          title={!hasCheckpoint ? "请先在 Civitai 资源库中选择 checkpoint" : "打开 ComfyUI 生图参数"}
          type="button"
        >
          <Play className="size-3.5" />
          ComfyUI 生图
        </Button>
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
    </section>
  );
}
