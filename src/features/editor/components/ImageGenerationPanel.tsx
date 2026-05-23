"use client";

import { AlertTriangle, CheckCircle2, Download, Image as ImageIcon, Loader2, Play, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  type ComfyUiGeneratedImage,
  type ComfyUiInputValue,
  type ComfyUiPromptHistoryResponse,
  type ComfyUiTextToImageRequest,
} from "@/features/comfyui";
import {
  applyComfyUiGenerationDiagnosisAdjustments,
  buildComfyUiGenerationAdjustmentMessages,
  buildComfyUiGenerationVisualDiagnosisMessages,
  type ComfyUiDiagnosisWebContext,
  parseComfyUiGenerationDiagnosisResponse,
  parseComfyUiGenerationVisualDiagnosisResponse,
  type ComfyUiGenerationDiagnosisConfig,
  type ComfyUiGenerationDiagnosisChangeRationale,
  type ComfyUiGenerationDiagnosisResult,
  type ComfyUiGenerationDiagnosisLoraConfig,
  type ComfyUiGenerationVisualDiagnosisResult,
} from "@/features/editor/ai-prompt/comfyui-generation-diagnosis";
import {
  resolveComfyUiGenerationSettings,
  type ComfyUiGenerationLoraSetting,
  type ComfyUiGenerationParameterSource,
} from "@/features/editor/ai-prompt/comfyui-generation-params";
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

type LoadStatus = "idle" | "loading" | "success" | "error";
type SubmitStatus = "idle" | "loading" | "success" | "error";
type DownloadActionStatus = "idle" | "loading" | "success" | "error";
type DiagnosisStatus = "idle" | "analyzing" | "searching" | "suggesting" | "success" | "error";

type GenerationResult = {
  imageCount: number;
  images: ComfyUiGeneratedImage[];
  promptId: string;
  number?: number;
  outputNodeId: string;
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

type GenerationDraft = Required<Omit<ComfyUiTextToImageRequest, "loras">> & {
  loras: GenerationDraftLora[];
  imageCount: number;
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
const COMFYUI_HISTORY_POLL_INTERVAL_MS = 2000;
const COMFYUI_HISTORY_POLL_TIMEOUT_MS = 180000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">检查中</span>;
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getResourceDownloadStatusClass(item)}`}>
      {getResourceDownloadStatusLabel(item)}
    </span>
  );
}

function toDraft(request: ComfyUiTextToImageRequest): GenerationDraft {
  return {
    checkpointName: request.checkpointName,
    positivePrompt: request.positivePrompt,
    negativePrompt: request.negativePrompt ?? "",
    loras: (request.loras ?? []).map((lora) => ({
      enabled: true,
      loraName: lora.loraName,
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip ?? lora.strengthModel,
    })),
    imageCount: 1,
    width: request.width ?? 1024,
    height: request.height ?? 1024,
    seed: request.seed ?? createComfyUiGenerationSeed(),
    seedMode: getInitialComfyUiGenerationSeedMode(request),
    steps: request.steps ?? 30,
    cfg: request.cfg ?? 7,
    samplerName: request.samplerName ?? "euler",
    scheduler: request.scheduler ?? "normal",
    denoise: request.denoise ?? 1,
    batchSize: request.batchSize ?? 1,
    outputPrefix: request.outputPrefix ?? "SceneForge",
  };
}

function toRequestPayload(draft: GenerationDraft, seed: number): ComfyUiTextToImageRequest {
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
    outputPrefix: draft.outputPrefix,
  };
}

function formatSource(source: ComfyUiGenerationParameterSource) {
  if (source === "ai") {
    return "AI 参数";
  }

  if (source === "diagnosis") {
    return "AI 诊断";
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

function GeneratedImageResults({
  generatedImages,
  onSelectImage,
  progress,
  resultsCount,
  selectedImageKey,
  submitStatus,
  waitMessage,
}: {
  generatedImages: ComfyUiGeneratedImage[];
  onSelectImage: (imageKey: string) => void;
  progress: GenerationProgress | null;
  resultsCount: number;
  selectedImageKey: string;
  submitStatus: SubmitStatus;
  waitMessage: string;
}) {
  if (generatedImages.length > 0) {
    return (
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">生成结果</p>
        <div className="grid grid-cols-2 gap-2">
          {generatedImages.map((image, index) => {
            const imageKey = getGeneratedImageKey(image, index);
            const selected = selectedImageKey ? selectedImageKey === imageKey : index === 0;

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
                <img
                  alt={`ComfyUI generated image ${index + 1}`}
                  className="aspect-square w-full object-cover transition group-hover:scale-[1.02]"
                  src={image.url}
                />
                <span className="block truncate border-t border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                  {selected ? "诊断图 · " : ""}
                  {image.filename}
                </span>
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

export function ImageGenerationPanel() {
  const project = useEditorStore((state) => state.project);
  const aiGeneratedPrompt = useEditorStore((state) => state.aiGeneratedPrompt);
  const aiCivitaiAdvice = useEditorStore((state) => state.aiCivitaiAdvice);
  const generatedPrompt = useMemo(() => generatePrompt(project), [project]);
  const activePrompt = aiGeneratedPrompt.trim() || generatedPrompt.prompt;
  const selectedCheckpointId = project.settings.selectedCivitaiCheckpointId;
  const selectedLoraIds = project.settings.selectedCivitaiLoraIds ?? [];
  const hasCheckpoint = Boolean(selectedCheckpointId);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_RESOURCES);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [loraSettings, setLoraSettings] = useState<ComfyUiGenerationLoraSetting[]>([]);
  const [parameterSource, setParameterSource] = useState<ComfyUiGenerationParameterSource>("reference");
  const [downloadItems, setDownloadItems] = useState<ResourceDownloadItem[]>([]);
  const [downloadActionStatus, setDownloadActionStatus] = useState<DownloadActionStatus>("idle");
  const [downloadActionMessage, setDownloadActionMessage] = useState("");
  const [downloadActionError, setDownloadActionError] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState("");
  const [waitMessage, setWaitMessage] = useState("");
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [selectedGeneratedImageKey, setSelectedGeneratedImageKey] = useState("");
  const [diagnosisInput, setDiagnosisInput] = useState("");
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
    setWaitMessage("");
    setGenerationProgress(null);
    setResults([]);
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
        baseNegativePrompt: generatedPrompt.negativePrompt,
        selectedResources: resources,
        aiAdvice: aiCivitaiAdvice,
      });

      setSelectedResources(resources);
      setDraft(toDraft(settings.request));
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

  function openModal() {
    setModalOpen(true);
    void loadGenerationContext();
  }

  function closeModal() {
    if (submitStatus === "loading" || downloadActionStatus === "loading") {
      return;
    }

    setModalOpen(false);
  }

  function patchDraft(patch: Partial<GenerationDraft>) {
    clearDiagnosisReview();
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function patchLora(index: number, patch: Partial<GenerationDraft["loras"][number]>) {
    clearDiagnosisReview();
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
      const requestPayload = toRequestPayload({ ...draft, imageCount }, seed);

      setDraft((current) => (current ? { ...current, imageCount, seed } : current));

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
      setWaitMessage(`已加入 ComfyUI 队列，正在等待生成 ${imageCount} 张图片...`);

      const history = await waitForComfyUiGeneratedImages(clientId, payload.promptId, imageCount, (historyUpdate) => {
        const progress = readComfyUiProgress(historyUpdate.raw);
        if (progress) {
          setGenerationProgress(progress);
          setWaitMessage(`KSampler 采样进度 ${progress.value}/${progress.max}`);
        }

        if (historyUpdate.images.length > 0) {
          setResults([{ ...queuedResult, images: historyUpdate.images }]);
          setWaitMessage(`已获取 ${historyUpdate.images.length}/${imageCount} 张图片，等待 ComfyUI 完成...`);
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

  async function runDiagnosis() {
    if (!draft || !selectedGeneratedImage) {
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

      const parsed = parseComfyUiGenerationDiagnosisResponse(adjustmentPayload.content, baseConfig);
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
    setLoraSettings((current) =>
      current.map((setting) => (adjustedLoraNames.has(setting.loraName) ? { ...setting, source: "diagnosis" } : setting)),
    );
    setParameterSource("diagnosis");
    setDiagnosisApplied(true);
  }

  const workflowPreview = draft ? buildBasicTextToImageWorkflow(toRequestPayload(draft, draft.seed)) : null;
  const generatedImages = results.flatMap((result) => result.images);
  const selectedGeneratedImage =
    generatedImages.find((image, index) => getGeneratedImageKey(image, index) === selectedGeneratedImageKey) ??
    generatedImages[0] ??
    null;
  const diagnosisDiffRows = diagnosisResult && diagnosisBaseConfig
    ? buildDiagnosisDiffRows(diagnosisBaseConfig, diagnosisResult)
    : [];
  const diagnosisBusy = diagnosisStatus === "analyzing" || diagnosisStatus === "searching" || diagnosisStatus === "suggesting";

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
          onClick={openModal}
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
          : `当前已选择 ${selectedLoraIds.length} 个 LoRA，参数将优先使用 AI 生成建议。`}
      </p>

      {modalOpen && typeof document !== "undefined"
        ? createPortal(
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
                    <h3 className="text-base font-bold text-slate-900">ComfyUI 生图</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      参数来源：{formatSource(parameterSource)}。提交后会等待 ComfyUI 完成，并在这里显示生成图片。
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
                            onChange={(event) => patchDraft({ positivePrompt: event.target.value })}
                            value={draft.positivePrompt}
                          />
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Negative Prompt</p>
                          <textarea
                            className="min-h-[80px] w-full resize-y rounded-md border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                            onChange={(event) => patchDraft({ negativePrompt: event.target.value })}
                            value={draft.negativePrompt}
                          />
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Checkpoint / LoRA</p>
                          <div className="space-y-2">
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-2">
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
                                    <div className="flex items-center gap-2">
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
                            <TextInput label="sampler" onChange={(value) => patchDraft({ samplerName: value })} value={draft.samplerName} />
                            <TextInput label="scheduler" onChange={(value) => patchDraft({ scheduler: value })} value={draft.scheduler} />
                            <TextInput label="output" onChange={(value) => patchDraft({ outputPrefix: value })} value={draft.outputPrefix} />
                          </div>
                          <div className="mt-5">
                            <GeneratedImageResults
                              generatedImages={generatedImages}
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
                          </div>
                          {submitStatus === "success" && selectedGeneratedImage ? (
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
                                  disabled={diagnosisBusy}
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
                              <div className="mt-2 space-y-1">
                                {Object.entries(node.inputs).map(([key, value]) => (
                                  <p className="grid grid-cols-[96px_1fr] gap-2 text-[11px] leading-relaxed" key={key}>
                                    <span className="font-semibold text-slate-500">{key}</span>
                                    <span className="min-w-0 break-words text-slate-700">{formatNodeInput(value)}</span>
                                  </p>
                                ))}
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
                        <p>
                          已提交 {results[0]?.imageCount ?? results.length} 张到 ComfyUI
                          {results[0]?.imageCount && results[0].imageCount > 1 ? " batch" : ""}
                        </p>
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
                    {submitStatus === "error" ? <p className="text-rose-600">{submitError}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-3">
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
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
