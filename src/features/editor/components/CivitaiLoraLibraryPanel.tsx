"use client";

import { Check, ChevronDown, Database, Download, ExternalLink, ImageIcon, Loader2, Pencil, Save, Search, Settings, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { type ImgHTMLAttributes, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  CivitaiAiRecommendationResponse,
  CivitaiAiNsfwLevel,
  CivitaiImportResult,
  CivitaiLibrarySettings,
  CivitaiLoraCategory,
  CivitaiParsePreview,
  CivitaiResourceDownloadResult,
  CivitaiResourceDownloadStatus,
  CivitaiResourceRecommendation,
  CivitaiResourceDetail,
  CivitaiResourceListItem,
  CivitaiResolveStatus,
  ImportedImageDetail,
  ImportedImageListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { isAnimaCivitaiBaseModel, isSameCivitaiBaseModel } from "@/features/civitai-lora-library/base-model";
import { getCivitaiImageVariantUrl } from "@/features/civitai-lora-library/image-url";
import {
  isOpenCivitaiLibraryResourceDetailEvent,
  OPEN_CIVITAI_LIBRARY_RESOURCE_DETAIL_EVENT,
} from "@/features/civitai-lora-library/ui-events";

type LoadStatus = "idle" | "loading" | "success" | "error";
type LibraryResourceTab = "image" | "lora" | "model";
type CacheRepairResult = {
  checked: number;
  repaired: number;
  failed: number;
  skipped: number;
};

const EMPTY_CIVITAI_LIBRARY_SETTINGS: CivitaiLibrarySettings = {
  loraDownloadPath: "",
  checkpointDownloadPath: "",
  diffusionModelPath: "",
  controlNetModelPath: "",
};

const CATEGORY_OPTIONS: Array<{ value: CivitaiLoraCategory | "all"; label: string }> = [
  { value: "all", label: "全部分类" },
  { value: "character", label: "Character" },
  { value: "style", label: "Style" },
  { value: "clothing", label: "Clothing" },
  { value: "pose", label: "Pose" },
  { value: "scene", label: "Scene" },
  { value: "lighting", label: "Lighting" },
  { value: "detail", label: "Detail" },
  { value: "other", label: "Other" },
];

const CATEGORY_LABELS = new Map(CATEGORY_OPTIONS.map((option) => [option.value, option.label]));

const RESOLVE_STATUS_LABELS: Record<CivitaiResolveStatus, string> = {
  resolved_by_hash: "hash resolved",
  resolved_by_model_version_id: "version resolved",
  resolved_by_name_search: "name resolved",
  metadata_only: "metadata only",
  unresolved: "unresolved",
};

const AI_NSFW_LABELS: Record<CivitaiAiNsfwLevel, string> = {
  sfw: "SFW",
  suggestive: "Suggestive",
  mature: "Mature",
  explicit: "Explicit",
  unknown: "Unknown",
};

const METADATA_NOTICE =
  "粘贴一张 Civitai 图片链接，即可整理其中使用到的 LoRA 与模型，方便收藏和复用。";
const CIVITAI_PREVIEW_IMAGE_SIZE = 512;

function readErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "object" &&
    (payload as { error?: { message?: unknown } }).error &&
    typeof (payload as { error: { message?: unknown } }).error.message === "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }

  return fallback;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.statusText || "请求失败。"));
  }

  return payload as T;
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

function formatBaseModelLabel(value: string | null | undefined) {
  return value?.trim() || "unknown";
}

function formatWeight(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(2).replace(/\.?0+$/, "") : "-";
}

function formatRange(resource: CivitaiResourceListItem | CivitaiResourceDetail) {
  if (resource.minWeight === null && resource.maxWeight === null) {
    return "-";
  }

  if (resource.minWeight === resource.maxWeight) {
    return formatWeight(resource.minWeight);
  }

  return `${formatWeight(resource.minWeight)} - ${formatWeight(resource.maxWeight)}`;
}

function formatResourceVersion(resource: Pick<CivitaiResourceListItem, "versionName" | "civitaiModelVersionId">) {
  if (resource.versionName) {
    return resource.versionName;
  }

  if (resource.civitaiModelVersionId !== null) {
    return `Version ${resource.civitaiModelVersionId}`;
  }

  return "Unknown version";
}

function formatCivitaiNsfw(value: boolean | null | undefined) {
  return value ? "NSFW" : "No/unknown";
}

function formatAiNsfwConfidence(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "-";
}

function makeOfficialImageSelectionId(resourceKey: string, url: string) {
  return `${resourceKey}\n${url}`;
}

function getCategoryLabel(category: CivitaiLoraCategory) {
  return CATEGORY_LABELS.get(category) ?? category;
}

function getResourceCategories(resource: { categories: CivitaiLoraCategory[]; category: CivitaiLoraCategory | null }) {
  return resource.categories.length > 0 ? resource.categories : resource.category ? [resource.category] : ["other" as const];
}

function formatRecommendationWeight(recommendation: CivitaiResourceRecommendation) {
  if (recommendation.loraWeight !== null) {
    return formatWeight(recommendation.loraWeight);
  }

  if (recommendation.loraWeightMin !== null || recommendation.loraWeightMax !== null) {
    return `${formatWeight(recommendation.loraWeightMin)} - ${formatWeight(recommendation.loraWeightMax)}`;
  }

  return null;
}

function formatRecommendationTitle(recommendation: CivitaiResourceRecommendation) {
  return recommendation.condition || recommendation.sampler || recommendation.checkpoint || recommendation.baseModel || "通用建议";
}

function hasRecommendationDetails(recommendation: CivitaiResourceRecommendation) {
  return Boolean(
    recommendation.baseModel ||
      recommendation.checkpoint ||
      recommendation.sampler ||
      recommendation.notes ||
      formatRecommendationWeight(recommendation) ||
      recommendation.hdRedrawRate !== null,
  );
}

function snippet(value: string | null | undefined, max = 180) {
  if (!value) {
    return "No prompt metadata.";
  }

  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function isVideoReference(entry: Record<string, unknown>, url: string) {
  const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  const mimeType =
    typeof entry.mimeType === "string"
      ? entry.mimeType.toLowerCase()
      : typeof entry.mime === "string"
        ? entry.mime.toLowerCase()
        : "";
  const urlWithoutQuery = url.split("?")[0]?.toLowerCase() ?? url.toLowerCase();

  return (
    type === "video" ||
    type === "animated" ||
    mimeType.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(urlWithoutQuery)
  );
}

function extractImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || !("url" in entry)) {
        return null;
      }

      const url = (entry as { url?: unknown }).url;
      if (typeof url !== "string" || isVideoReference(entry as Record<string, unknown>, url)) {
        return null;
      }

      return url;
    })
    .filter((url): url is string => Boolean(url));
}

function resourceVersionUrl(resource: CivitaiResourceDetail) {
  if (!resource.civitaiModelId) {
    return null;
  }

  const params = resource.civitaiModelVersionId
    ? `?modelVersionId=${encodeURIComponent(String(resource.civitaiModelVersionId))}`
    : "";
  return `https://civitai.com/models/${resource.civitaiModelId}${params}`;
}

function getDownloadStatusLabel(status: CivitaiResourceDownloadStatus | null) {
  if (!status) {
    return "检查中";
  }

  switch (status.status) {
    case "verified":
      return "已校验";
    case "checksum_mismatch":
      return "校验不一致";
    case "unverified":
      return "未校验";
    case "path_missing":
      return "路径未设置";
    case "directory_missing":
      return "目录不存在";
    case "not_downloaded":
      return "未下载";
  }
}

function getDownloadStatusClass(status: CivitaiResourceDownloadStatus | null) {
  if (!status) {
    return "bg-slate-100 text-slate-500";
  }

  switch (status.status) {
    case "verified":
      return "bg-emerald-50 text-emerald-700";
    case "checksum_mismatch":
      return "bg-rose-50 text-rose-700";
    case "unverified":
      return "bg-amber-50 text-amber-700";
    case "path_missing":
    case "directory_missing":
      return "bg-rose-50 text-rose-700";
    case "not_downloaded":
      return "bg-slate-100 text-slate-600";
  }
}

function getDownloadButtonLabel(status: CivitaiResourceDownloadStatus | null, label: string) {
  if (status?.fileExists) {
    return "重新下载";
  }

  return `下载 ${label}`;
}

function shouldShowDownloadStatusBadge(status: CivitaiResourceDownloadStatus | null, loadStatus: LoadStatus) {
  return loadStatus === "loading" || (status !== null && status.status !== "unverified");
}

function shouldShowDownloadStatusMessage(
  status: CivitaiResourceDownloadStatus | null,
): status is CivitaiResourceDownloadStatus {
  return status !== null && status.status !== "unverified";
}

type CivitaiPreviewImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "onError" | "src"> & {
  alt: string;
  src: string;
};

function CivitaiPreviewImage({ alt, src, loading = "lazy", decoding = "async", ...props }: CivitaiPreviewImageProps) {
  const optimizedSrc = getCivitaiImageVariantUrl(src, CIVITAI_PREVIEW_IMAGE_SIZE) ?? src;
  const [failedOptimizedSrc, setFailedOptimizedSrc] = useState<string | null>(null);
  const displaySrc = failedOptimizedSrc === optimizedSrc ? src : optimizedSrc;

  return (
    <img
      {...props}
      alt={alt}
      decoding={decoding}
      loading={loading}
      onError={() => {
        if (displaySrc !== src) {
          setFailedOptimizedSrc(displaySrc);
        }
      }}
      src={displaySrc}
    />
  );
}

function AiRecommendationResourceCard({
  label,
  onOpenDetail,
  reason,
  resource,
  suggestedWeight,
}: {
  label: string;
  onOpenDetail: () => void;
  reason: string;
  resource: SelectedCivitaiResourcePreview;
  suggestedWeight?: number | null;
}) {
  return (
    <button
      aria-label={`打开 ${resource.name} 的 Civitai 详情`}
      className="grid w-full gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:grid-cols-[56px_1fr]"
      onClick={onOpenDetail}
      type="button"
    >
      <div className="flex h-14 w-14 overflow-hidden rounded-md bg-white">
        {resource.previewImage ? (
          <CivitaiPreviewImage
            alt={`${resource.name} preview`}
            className="h-full w-full object-cover"
            src={resource.previewImage}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            {label}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
            {label}
          </span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500">
            {resource.versionName ?? "Unknown version"}
          </span>
          {suggestedWeight !== undefined ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              weight {formatWeight(suggestedWeight)}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-slate-900">{resource.name}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{resource.baseModel ?? "unknown base model"}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{reason}</p>
      </div>
    </button>
  );
}

export function CivitaiLoraLibraryPanel() {
  const selectedCivitaiCheckpointId = useEditorStore((state) => state.project.settings.selectedCivitaiCheckpointId);
  const selectedCivitaiLoraIds = useEditorStore((state) => state.project.settings.selectedCivitaiLoraIds);
  const toggleCivitaiLora = useEditorStore((state) => state.toggleCivitaiLora);
  const setSelectedCivitaiResources = useEditorStore((state) => state.setSelectedCivitaiResources);
  const [open, setOpen] = useState(false);
  const [resources, setResources] = useState<CivitaiResourceListItem[]>([]);
  const [images, setImages] = useState<ImportedImageListItem[]>([]);
  const [resourceStatus, setResourceStatus] = useState<LoadStatus>("idle");
  const [resourceError, setResourceError] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CivitaiResourceDetail | null>(null);
  const [imageDetail, setImageDetail] = useState<ImportedImageDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<LoadStatus>("idle");
  const [detailError, setDetailError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [loraWeightEditing, setLoraWeightEditing] = useState(false);
  const [loraWeightDrafts, setLoraWeightDrafts] = useState<Record<string, string>>({});
  const [loraWeightSaveStatus, setLoraWeightSaveStatus] = useState<LoadStatus>("idle");
  const [loraWeightSaveError, setLoraWeightSaveError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [parseStatus, setParseStatus] = useState<LoadStatus>("idle");
  const [parseError, setParseError] = useState("");
  const [parsePreview, setParsePreview] = useState<CivitaiParsePreview | null>(null);
  const [selectedImportResourceKeys, setSelectedImportResourceKeys] = useState<Set<string>>(new Set());
  const [selectedOfficialImageUrls, setSelectedOfficialImageUrls] = useState<Set<string>>(new Set());
  const [importStatus, setImportStatus] = useState<LoadStatus>("idle");
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<CivitaiImportResult | null>(null);
  const [repairStatus, setRepairStatus] = useState<LoadStatus>("idle");
  const [repairError, setRepairError] = useState("");
  const [repairResult, setRepairResult] = useState<CacheRepairResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<CivitaiLibrarySettings>(EMPTY_CIVITAI_LIBRARY_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<CivitaiLibrarySettings>(EMPTY_CIVITAI_LIBRARY_SETTINGS);
  const [settingsLoadStatus, setSettingsLoadStatus] = useState<LoadStatus>("idle");
  const [settingsLoadError, setSettingsLoadError] = useState("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<LoadStatus>("idle");
  const [settingsSaveError, setSettingsSaveError] = useState("");
  const [downloadStatus, setDownloadStatus] = useState<CivitaiResourceDownloadStatus | null>(null);
  const [downloadStatusLoadStatus, setDownloadStatusLoadStatus] = useState<LoadStatus>("idle");
  const [downloadActionStatus, setDownloadActionStatus] = useState<LoadStatus>("idle");
  const [downloadActionMessage, setDownloadActionMessage] = useState("");
  const [downloadActionError, setDownloadActionError] = useState("");
  const [aiRecommendationInput, setAiRecommendationInput] = useState("");
  const [aiRecommendationStatus, setAiRecommendationStatus] = useState<LoadStatus>("idle");
  const [aiRecommendationError, setAiRecommendationError] = useState("");
  const [aiRecommendationResult, setAiRecommendationResult] = useState<CivitaiAiRecommendationResponse | null>(null);
  const [aiRecommendationPanelCollapsed, setAiRecommendationPanelCollapsed] = useState(false);
  const [importPanelCollapsed, setImportPanelCollapsed] = useState(false);
  const [resourceTab, setResourceTab] = useState<LibraryResourceTab>("lora");
  const [category, setCategory] = useState<CivitaiLoraCategory | "all">("all");
  const [nsfw, setNsfw] = useState<"all" | "sfw" | "nsfw">("all");
  const [importedCount, setImportedCount] = useState<"all" | "one" | "multiple" | "none" | "with">("all");
  const [query, setQuery] = useState("");
  const [baseModels, setBaseModels] = useState<string[]>([]);
  const [baseModel, setBaseModel] = useState("");
  const detailPaneRef = useRef<HTMLElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const resourceLoadRequestIdRef = useRef(0);

  async function loadResources() {
    const requestId = resourceLoadRequestIdRef.current + 1;
    resourceLoadRequestIdRef.current = requestId;
    setResourceStatus("loading");
    setResourceError("");

    try {
      const params = new URLSearchParams();
      if (resourceTab === "image") {
        params.set("nsfw", nsfw);
        params.set("resourceCount", importedCount === "one" || importedCount === "multiple" ? "with" : importedCount);
        if (query.trim()) {
          params.set("query", query.trim());
        }
        if (baseModel) {
          params.set("baseModel", baseModel);
        }

        const payload = await fetchJson<{ items: ImportedImageListItem[] }>(
          `/api/civitai-lora-library/imported-images?${params.toString()}`,
        );
        if (resourceLoadRequestIdRef.current !== requestId) {
          return;
        }
        setImages(payload.items);
        setResources([]);
        if (!baseModel) {
          setBaseModels(
            Array.from(
              new Set(payload.items.map((image) => image.baseModel).filter((model): model is string => Boolean(model))),
            ).sort(),
          );
        }
        setResourceStatus("success");
        setSelectedImageId((current) =>
          current && payload.items.some((image) => image.id === current) ? current : (payload.items[0]?.id ?? null),
        );
        return;
      }

      params.set("resourceType", resourceTab);
      if (resourceTab === "lora") {
        params.set("category", category);
      }
      params.set("nsfw", nsfw);
      params.set("importedCount", importedCount === "one" || importedCount === "multiple" ? importedCount : "all");
      if (query.trim()) {
        params.set("query", query.trim());
      }
      if (baseModel) {
        params.set("baseModel", baseModel);
      }

      const payload = await fetchJson<{ items: CivitaiResourceListItem[] }>(
        `/api/civitai-lora-library/resources?${params.toString()}`,
      );
      if (resourceLoadRequestIdRef.current !== requestId) {
        return;
      }
      setResources(payload.items);
      setImages([]);
      if (!baseModel) {
        setBaseModels(
          Array.from(
            new Set(payload.items.map((resource) => resource.baseModel).filter((model): model is string => Boolean(model))),
          ).sort(),
        );
      }
      setResourceStatus("success");
      setSelectedResourceId((current) =>
        current && payload.items.some((resource) => resource.id === current) ? current : (payload.items[0]?.id ?? null),
      );
    } catch (error) {
      if (resourceLoadRequestIdRef.current !== requestId) {
        return;
      }
      setResourceStatus("error");
      setResourceError(error instanceof Error ? error.message : "无法读取 LoRA Library。");
    }
  }

  function resetDownloadState() {
    setDownloadStatus(null);
    setDownloadStatusLoadStatus("idle");
    setDownloadActionStatus("idle");
    setDownloadActionMessage("");
    setDownloadActionError("");
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  async function loadDownloadStatus(resourceId: string, options: { verifyChecksum?: boolean } = {}) {
    setDownloadStatusLoadStatus("loading");
    setDownloadActionError("");

    try {
      const verifyQuery = options.verifyChecksum ? "?verify=1" : "";
      const payload = await fetchJson<CivitaiResourceDownloadStatus>(
        `/api/civitai-lora-library/resources/${encodeURIComponent(resourceId)}/download${verifyQuery}`,
      );
      setDownloadStatus(payload);
      setDownloadStatusLoadStatus("success");
      return payload;
    } catch (error) {
      setDownloadStatusLoadStatus("error");
      setDownloadActionError(error instanceof Error ? error.message : "无法读取资源下载状态。");
    }
  }

  async function loadDetail(resourceId: string) {
    setDetailStatus("loading");
    setDetailError("");
    setSelectionError("");
    setDetail(null);
    setImageDetail(null);
    setLoraWeightEditing(false);
    setLoraWeightDrafts({});
    setLoraWeightSaveStatus("idle");
    setLoraWeightSaveError("");
    resetDownloadState();

    try {
      const payload = await fetchJson<CivitaiResourceDetail>(
        `/api/civitai-lora-library/resources/${encodeURIComponent(resourceId)}`,
      );
      setDetail(payload);
      setDetailStatus("success");
      if (payload.resourceType === "lora" || payload.resourceType === "model") {
        void loadDownloadStatus(payload.id);
      }
    } catch (error) {
      setDetailStatus("error");
      setDetailError(error instanceof Error ? error.message : "无法读取 LoRA 详情。");
    }
  }

  async function loadImageDetail(importedImageId: string) {
    setDetailStatus("loading");
    setDetailError("");
    setSelectionError("");
    setDetail(null);
    setImageDetail(null);
    setLoraWeightEditing(false);
    setLoraWeightDrafts({});
    setLoraWeightSaveStatus("idle");
    setLoraWeightSaveError("");
    resetDownloadState();

    try {
      const payload = await fetchJson<ImportedImageDetail>(
        `/api/civitai-lora-library/imported-images/${encodeURIComponent(importedImageId)}`,
      );
      setImageDetail(payload);
      setDetailStatus("success");
    } catch (error) {
      setDetailStatus("error");
      setDetailError(error instanceof Error ? error.message : "Unable to read imported image detail.");
    }
  }

  async function handleLoraWeightEditToggle() {
    if (!imageDetail) {
      return;
    }

    const loraUsages = imageDetail.usages.filter((usage) => usage.resource.resourceType === "lora");
    if (!loraWeightEditing) {
      setLoraWeightDrafts(
        Object.fromEntries(
          loraUsages.map((usage) => [usage.id, usage.weight === null ? "" : String(usage.weight)]),
        ),
      );
      setLoraWeightSaveError("");
      setLoraWeightSaveStatus("idle");
      setLoraWeightEditing(true);
      return;
    }

    const weights: Array<{ usageId: string; weight: number | null }> = [];
    for (const usage of loraUsages) {
      const value = loraWeightDrafts[usage.id]?.trim() ?? "";
      if (!value) {
        weights.push({ usageId: usage.id, weight: null });
        continue;
      }

      const weight = Number(value);
      if (!Number.isFinite(weight)) {
        setLoraWeightSaveStatus("error");
        setLoraWeightSaveError("Please enter a valid number for each LoRA weight.");
        return;
      }
      weights.push({ usageId: usage.id, weight });
    }

    setLoraWeightSaveStatus("loading");
    setLoraWeightSaveError("");
    try {
      const updated = await fetchJson<ImportedImageDetail>(
        `/api/civitai-lora-library/imported-images/${encodeURIComponent(imageDetail.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weights }),
        },
      );
      setImageDetail(updated);
      setLoraWeightEditing(false);
      setLoraWeightDrafts({});
      setLoraWeightSaveStatus("success");
    } catch (error) {
      setLoraWeightSaveStatus("error");
      setLoraWeightSaveError(error instanceof Error ? error.message : "Unable to save LoRA weights.");
    }
  }

  async function handleParse() {
    const trimmed = imageUrl.trim();
    if (!trimmed) {
      setParseStatus("error");
      setParseError("请粘贴 Civitai image URL。");
      return;
    }

    setParseStatus("loading");
    setParseError("");
    setParsePreview(null);
    setSelectedImportResourceKeys(new Set());
    setSelectedOfficialImageUrls(new Set());
    setImportStatus("idle");
    setImportError("");
    setImportResult(null);

    try {
      const result = await fetchJson<CivitaiParsePreview>("/api/civitai-lora-library/parse-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: trimmed }),
      });
      setParsePreview(result);
      setSelectedImportResourceKeys(
        new Set(result.resources.filter((entry) => !entry.existingResourceId).map((entry) => entry.importResourceKey)),
      );
      setSelectedOfficialImageUrls(
        new Set(
          result.resources.flatMap((entry) =>
            entry.officialImageUrls.map((url) => makeOfficialImageSelectionId(entry.officialImageResourceKey, url)),
          ),
        ),
      );
      setImportPanelCollapsed(false);
      setParseStatus("success");
    } catch (error) {
      setParseStatus("error");
      setParseError(error instanceof Error ? error.message : "解析失败。");
    }
  }

  async function handleImport() {
    const trimmed = imageUrl.trim();
    if (!trimmed || !parsePreview) {
      setImportStatus("error");
      setImportError("请先解析并确认结果。");
      return;
    }
    const hasExistingImportResources = parsePreview.resources.some((entry) => entry.existingResourceId);
    if (selectedImportResourceKeys.size === 0 && !hasExistingImportResources) {
      setImportStatus("error");
      setImportError("请至少选择一个 LoRA 或 checkpoint/model 再导入。");
      return;
    }

    setImportStatus("loading");
    setImportError("");

    try {
      const result = await fetchJson<CivitaiImportResult>("/api/civitai-lora-library/import-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: trimmed,
          selectedImportResourceKeys: [...selectedImportResourceKeys],
          selectedOfficialImages: previewResources.flatMap((entry) =>
            selectedImportResourceKeys.has(entry.importResourceKey)
              ? entry.officialImageUrls
                  .filter((url) => selectedOfficialImageUrls.has(makeOfficialImageSelectionId(entry.officialImageResourceKey, url)))
                  .map((url) => ({ resourceKey: entry.officialImageResourceKey, url }))
              : [],
          ),
        }),
      });
      setImportResult(result);
      setImportStatus("success");
      await loadResources();
      if (resourceTab === "image") {
        setSelectedImageId(result.importedImage.id);
        return;
      }
      const firstMatchingResource = result.resources.find((entry) => entry.resource.resourceType === resourceTab);
      if (firstMatchingResource) {
        setSelectedResourceId(firstMatchingResource.resource.id);
      }
    } catch (error) {
      setImportStatus("error");
      setImportError(error instanceof Error ? error.message : "导入失败。");
    }
  }

  async function handleRepairCache() {
    setRepairStatus("loading");
    setRepairError("");
    setRepairResult(null);

    try {
      const result = await fetchJson<CacheRepairResult>("/api/civitai-lora-library/repair-cache", {
        method: "POST",
      });
      setRepairResult(result);
      setRepairStatus("success");
      await loadResources();
      if (selectedResourceId) {
        await loadDetail(selectedResourceId);
      }
    } catch (error) {
      setRepairStatus("error");
      setRepairError(error instanceof Error ? error.message : "修复缓存失败。");
    }
  }

  async function loadSettings() {
    setSettingsLoadStatus("loading");
    setSettingsLoadError("");

    try {
      const payload = await fetchJson<CivitaiLibrarySettings>("/api/civitai-lora-library/settings");
      setSettings(payload);
      setSettingsDraft(payload);
      setSettingsLoadStatus("success");
    } catch (error) {
      setSettingsLoadStatus("error");
      setSettingsLoadError(error instanceof Error ? error.message : "无法读取路径设置。");
    }
  }

  function handleOpenSettings() {
    setSettingsDraft(settings);
    setSettingsSaveStatus("idle");
    setSettingsSaveError("");
    setSettingsOpen(true);
  }

  function handleCancelSettings() {
    setSettingsDraft(settings);
    setSettingsSaveStatus("idle");
    setSettingsSaveError("");
    setSettingsOpen(false);
  }

  async function handleSaveSettings() {
    const nextSettings: CivitaiLibrarySettings = {
      loraDownloadPath: settingsDraft.loraDownloadPath.trim(),
      checkpointDownloadPath: settingsDraft.checkpointDownloadPath.trim(),
      diffusionModelPath: settingsDraft.diffusionModelPath.trim(),
      controlNetModelPath: settingsDraft.controlNetModelPath.trim(),
    };

    setSettingsSaveStatus("loading");
    setSettingsSaveError("");

    try {
      await fetchJson<{ ok: true }>("/api/civitai-lora-library/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setSettingsLoadStatus("success");
      setSettingsLoadError("");
      setSettingsSaveStatus("success");
      if (detail?.resourceType === "lora" || detail?.resourceType === "model") {
        void loadDownloadStatus(detail.id);
      }
    } catch (error) {
      setSettingsSaveStatus("error");
      setSettingsSaveError(error instanceof Error ? error.message : "无法保存路径设置。");
    }
  }

  async function handleDownloadResource() {
    if (!detail || (detail.resourceType !== "lora" && detail.resourceType !== "model")) {
      return;
    }

    const label = detail.resourceType === "model" ? "Checkpoint" : "LoRA";
    if (downloadStatus?.status === "path_missing") {
      setDownloadActionStatus("error");
      setDownloadActionError(`${label} 下载路径未设置，请先在设置中填写 ${label} 下载路径。`);
      return;
    }

    setDownloadActionStatus("loading");
    setDownloadActionError("");
    setDownloadActionMessage("");

    try {
      const result = await fetchJson<CivitaiResourceDownloadResult>(
        `/api/civitai-lora-library/resources/${encodeURIComponent(detail.id)}/download`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "download" }),
        },
      );
      setDownloadStatus(result);
      setDownloadActionStatus("success");
      setDownloadActionMessage(result.message);
    } catch (error) {
      setDownloadActionStatus("error");
      setDownloadActionError(error instanceof Error ? error.message : `${label} 下载失败。`);
      void loadDownloadStatus(detail.id);
    }
  }

  async function handleUploadResourceFile(file: File | null | undefined) {
    if (!detail || (detail.resourceType !== "lora" && detail.resourceType !== "model") || !file) {
      return;
    }

    const label = detail.resourceType === "model" ? "Checkpoint" : "LoRA";
    if (downloadStatus?.status === "path_missing") {
      setDownloadActionStatus("error");
      setDownloadActionError(`${label} 下载路径未设置，请先在设置中填写 ${label} 下载路径。`);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      return;
    }

    setDownloadActionStatus("loading");
    setDownloadActionError("");
    setDownloadActionMessage("");

    try {
      const result = await fetchJson<CivitaiResourceDownloadResult>(
        `/api/civitai-lora-library/resources/${encodeURIComponent(detail.id)}/download`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-SceneForge-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        },
      );
      setDownloadStatus(result);
      setDownloadActionStatus("success");
      setDownloadActionMessage(result.message);
    } catch (error) {
      setDownloadActionStatus("error");
      setDownloadActionError(error instanceof Error ? error.message : `${label} 上传失败。`);
      void loadDownloadStatus(detail.id);
    } finally {
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  }

  async function handleVerifyResourceFile() {
    if (!detail || (detail.resourceType !== "lora" && detail.resourceType !== "model")) {
      return;
    }

    setDownloadActionStatus("loading");
    setDownloadActionError("");
    setDownloadActionMessage("");

    const result = await loadDownloadStatus(detail.id, { verifyChecksum: true });
    if (!result) {
      setDownloadActionStatus("error");
      return;
    }

    setDownloadActionStatus("success");
    setDownloadActionMessage(result.message);
  }

  async function handleRecommendCivitaiCombination() {
    const desiredEffect = aiRecommendationInput.trim();
    if (!desiredEffect) {
      setAiRecommendationStatus("error");
      setAiRecommendationError("请先输入想要的画面效果。");
      setAiRecommendationResult(null);
      return;
    }

    setAiRecommendationStatus("loading");
    setAiRecommendationError("");

    try {
      const result = await fetchJson<CivitaiAiRecommendationResponse>(
        "/api/civitai-lora-library/ai-recommendation",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            desiredEffect,
            maxLoras: 3,
          }),
        },
      );

      setAiRecommendationResult(result);
      setSelectedCivitaiResources(
        result.checkpoint.resource.id,
        result.loras.map((entry) => entry.resource.id),
      );
      setAiRecommendationStatus("success");
    } catch (error) {
      setAiRecommendationStatus("error");
      setAiRecommendationError(error instanceof Error ? error.message : "AI 推荐失败，请稍后重试。");
      setAiRecommendationResult(null);
    }
  }

  async function handleToggleSelectedResource() {
    if (!detail || (detail.resourceType !== "lora" && detail.resourceType !== "model")) {
      return;
    }

    setSelectionError("");

    if (detail.resourceType === "model") {
      if (selectedCivitaiCheckpointId === detail.id) {
        setSelectedCivitaiResources(null, []);
        return;
      }

      try {
        const query = buildSelectedCivitaiResourcesQuery(detail.id, selectedCivitaiLoraIds);
        const resources = await fetchJson<SelectedCivitaiResourcesPreview>(
          `/api/civitai-lora-library/selected-resources?${query}`,
        );
        const compatibleLoraIds = resources.loras.map((lora) => lora.id);

        setSelectedCivitaiResources(detail.id, compatibleLoraIds);
        if (compatibleLoraIds.length < selectedCivitaiLoraIds.length) {
          setSelectionError("Some selected LoRAs were removed because their baseModel does not match this checkpoint.");
        }
      } catch (error) {
        setSelectionError(error instanceof Error ? error.message : "Unable to validate selected LoRAs.");
      }
      return;
    }

    if (detailIsSelected) {
      toggleCivitaiLora(detail.id);
      return;
    }

    if (!selectedCivitaiCheckpointId) {
      if (isAnimaCivitaiBaseModel(detail.baseModel)) {
        setSelectionError("Select an Anima checkpoint before selecting this Anima LoRA.");
        return;
      }

      toggleCivitaiLora(detail.id);
      return;
    }

    try {
      const query = buildSelectedCivitaiResourcesQuery(selectedCivitaiCheckpointId, []);
      const resources = await fetchJson<SelectedCivitaiResourcesPreview>(
        `/api/civitai-lora-library/selected-resources?${query}`,
      );
      const checkpointBaseModel = resources.checkpoint?.baseModel;

      if (!isSameCivitaiBaseModel(detail.baseModel, checkpointBaseModel)) {
        setSelectionError(
          `This LoRA baseModel (${formatBaseModelLabel(detail.baseModel)}) does not match the selected checkpoint baseModel (${formatBaseModelLabel(checkpointBaseModel)}).`,
        );
        return;
      }
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Unable to validate selected checkpoint.");
      return;
    }

    toggleCivitaiLora(detail.id);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadSettings();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadResources();
    }, 0);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceTab, category, nsfw, importedCount, baseModel, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (resourceTab === "image") {
      if (!selectedImageId) {
        return;
      }

      const timeout = window.setTimeout(() => {
        void loadImageDetail(selectedImageId);
      }, 0);

      return () => window.clearTimeout(timeout);
    }

    if (!selectedResourceId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadDetail(selectedResourceId);
    }, 0);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceTab, selectedImageId, selectedResourceId]);

  const importedLoras = importResult?.resources.filter((entry) => entry.resource.resourceType === "lora") ?? [];
  const importedModels = importResult?.resources.filter((entry) => entry.resource.resourceType === "model") ?? [];
  const previewLoras = parsePreview?.resources.filter((entry) => entry.resourceType === "lora") ?? [];
  const previewModels = parsePreview?.resources.filter((entry) => entry.resourceType === "model") ?? [];
  const previewResources = parsePreview?.resources ?? [];
  const previewIgnored = parsePreview?.ignoredResources ?? [];
  const hasExistingImportResources = previewResources.some((entry) => entry.existingResourceId);
  const previewOfficialImageEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: Array<{
      url: string;
      resourceName: string;
      resourceType: "lora" | "model";
      importResourceKey: string;
      selectionId: string;
      selectable: boolean;
      existing: boolean;
    }> = [];
    for (const entry of parsePreview?.resources ?? []) {
      for (const url of entry.officialImageUrls) {
        const selectionId = makeOfficialImageSelectionId(entry.officialImageResourceKey, url);
        if (seen.has(selectionId)) {
          continue;
        }
        seen.add(selectionId);
        entries.push({
          url,
          resourceName: entry.name,
          resourceType: entry.resourceType === "model" ? "model" : "lora",
          importResourceKey: entry.importResourceKey,
          selectionId,
          selectable: entry.officialImagesSelectable,
          existing: entry.officialImageExistingUrls.includes(url),
        });
      }
    }
    return entries;
  }, [parsePreview]);
  const officialImages = detail ? extractImageUrls(detail.officialImagesJson) : [];
  const detailUrl = detail ? resourceVersionUrl(detail) : null;
  const isImageTab = resourceTab === "image";
  const isCheckpointTab = resourceTab === "model";
  const activeResourceLabel = isImageTab ? "Image" : isCheckpointTab ? "Checkpoint" : "LoRA";
  const detailIsCheckpoint = detail?.resourceType === "model";
  const detailResourceLabel = detailIsCheckpoint ? "Checkpoint" : "LoRA";
  const detailIsSelected = detail
    ? detailIsCheckpoint
      ? selectedCivitaiCheckpointId === detail.id
      : selectedCivitaiLoraIds.includes(detail.id)
    : false;
  const imageDetailLoras = imageDetail?.usages.filter((usage) => usage.resource.resourceType === "lora") ?? [];
  const imageDetailCheckpoints = imageDetail?.usages.filter((usage) => usage.resource.resourceType === "model") ?? [];

  function toggleOfficialImageSelection(selectionId: string) {
    setSelectedOfficialImageUrls((current) => {
      const next = new Set(current);
      if (next.has(selectionId)) {
        next.delete(selectionId);
      } else {
        next.add(selectionId);
      }
      return next;
    });
  }

  function toggleImportResourceSelection(resourceKey: string) {
    setSelectedImportResourceKeys((current) => {
      const next = new Set(current);
      if (next.has(resourceKey)) {
        next.delete(resourceKey);
      } else {
        next.add(resourceKey);
      }
      return next;
    });
  }

  function resetDetailNavigationState() {
    setDetail(null);
    setImageDetail(null);
    setCategory("all");
    setBaseModel("");
    setImportedCount("all");
    setQuery("");
    setNsfw("all");
    window.requestAnimationFrame(() => detailPaneRef.current?.scrollTo({ top: 0 }));
  }

  function openResourceDetail(resource: Pick<CivitaiResourceDetail, "id" | "resourceType">) {
    setResourceTab(resource.resourceType === "model" ? "model" : "lora");
    setSelectedResourceId(resource.id);
    setSelectedImageId(null);
    resetDetailNavigationState();
  }

  function openImportedImageDetail(image: { id: string }) {
    setResourceTab("image");
    setSelectedImageId(image.id);
    setSelectedResourceId(null);
    resetDetailNavigationState();
  }

  useEffect(() => {
    function handleOpenResourceDetail(event: Event) {
      if (!isOpenCivitaiLibraryResourceDetailEvent(event)) {
        return;
      }

      setOpen(true);
      setResourceTab(event.detail.resourceType === "model" ? "model" : "lora");
      setSelectedResourceId(event.detail.id);
      setSelectedImageId(null);
      setDetail(null);
      setImageDetail(null);
      setCategory("all");
      setBaseModel("");
      setImportedCount("all");
      setQuery("");
      setNsfw("all");
      window.requestAnimationFrame(() => detailPaneRef.current?.scrollTo({ top: 0 }));
    }

    window.addEventListener(OPEN_CIVITAI_LIBRARY_RESOURCE_DETAIL_EVENT, handleOpenResourceDetail);
    return () => {
      window.removeEventListener(OPEN_CIVITAI_LIBRARY_RESOURCE_DETAIL_EVENT, handleOpenResourceDetail);
    };
  }, []);

  return (
    <section className="space-y-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3">
      <div className="flex items-start gap-2.5">
        <div className="rounded-md bg-white p-1.5 text-indigo-600 shadow-sm">
          <Database className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-slate-900">Civitai LoRA 收藏库</h2>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            从喜欢的作品里整理可复用的 LoRA 与模型。
          </p>
        </div>
      </div>
      <Button
        className="h-9 w-full rounded-md bg-indigo-600 text-xs text-white hover:bg-indigo-700"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
      >
        <Sparkles className="size-4" />
        打开收藏库
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
              role="dialog"
            >
              <div className="flex h-[96vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
                <header className="flex shrink-0 items-start gap-4 border-b border-slate-100 bg-white p-5">
                  <div className="rounded-md bg-indigo-50 p-2 text-indigo-600">
                    <Database className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-slate-950">Civitai LoRA 收藏库</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{METADATA_NOTICE}</p>
                  </div>
                  <button
                    aria-label={settingsOpen ? "关闭路径设置" : "打开路径设置"}
                    className={`rounded-full p-2 transition ${
                      settingsOpen
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    }`}
                    onClick={settingsOpen ? handleCancelSettings : handleOpenSettings}
                    title="路径设置"
                    type="button"
                  >
                    <Settings className="size-5" />
                  </button>
                  <button
                    aria-label="关闭 Civitai LoRA Library"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setOpen(false)}
                    type="button"
                  >
                    <X className="size-5" />
                  </button>
                </header>

                {settingsOpen ? (
                  <div className="shrink-0 border-b border-slate-100 bg-slate-50 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">路径设置</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          LoRA、Checkpoint 下载目录与 ControlNet 模型扫描目录在这里统一配置。
                        </p>
                      </div>
                      {settingsLoadStatus === "loading" ? (
                        <span className="inline-flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-500">
                          <Loader2 className="size-3.5 animate-spin" />
                          正在读取设置
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="block text-xs font-medium text-slate-600">
                        <span>LoRA 下载路径</span>
                        <input
                          className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                          disabled={settingsLoadStatus === "loading" || settingsSaveStatus === "loading"}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({ ...current, loraDownloadPath: event.target.value }))
                          }
                          placeholder="D:/StableDiffusion/models/Lora"
                          value={settingsDraft.loraDownloadPath}
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-600">
                        <span>Checkpoint 下载路径</span>
                        <input
                          className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                          disabled={settingsLoadStatus === "loading" || settingsSaveStatus === "loading"}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({ ...current, checkpointDownloadPath: event.target.value }))
                          }
                          placeholder="D:/StableDiffusion/models/Stable-diffusion"
                          value={settingsDraft.checkpointDownloadPath}
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-600">
                        <span>Diffusion 模型下载路径</span>
                        <input
                          className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                          disabled={settingsLoadStatus === "loading" || settingsSaveStatus === "loading"}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({ ...current, diffusionModelPath: event.target.value }))
                          }
                          placeholder="D:/ComfyUI/models/diffusion_models"
                          value={settingsDraft.diffusionModelPath}
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-600">
                        <span>ControlNet 模型路径</span>
                        <input
                          className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                          disabled={settingsLoadStatus === "loading" || settingsSaveStatus === "loading"}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({ ...current, controlNetModelPath: event.target.value }))
                          }
                          placeholder="D:/ComfyUI/models/controlnet"
                          value={settingsDraft.controlNetModelPath}
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-h-5 text-xs">
                        {settingsLoadStatus === "error" ? (
                          <span className="text-rose-600">{settingsLoadError}</span>
                        ) : null}
                        {settingsSaveStatus === "success" ? (
                          <span className="text-emerald-700">设置已保存。</span>
                        ) : null}
                        {settingsSaveStatus === "error" ? (
                          <span className="text-rose-600">{settingsSaveError}</span>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          className="h-9 rounded-md border-slate-200 bg-white px-4 text-xs text-slate-700 hover:bg-slate-50"
                          disabled={settingsSaveStatus === "loading"}
                          onClick={handleCancelSettings}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          <X className="size-4" />
                          取消
                        </Button>
                        <Button
                          className="h-9 rounded-md bg-indigo-600 px-4 text-xs text-white hover:bg-indigo-700"
                          disabled={settingsLoadStatus === "loading" || settingsSaveStatus === "loading"}
                          onClick={() => void handleSaveSettings()}
                          size="sm"
                          type="button"
                        >
                          {settingsSaveStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                          保存设置
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-hidden">
                  <div className="border-b border-slate-100 bg-slate-50 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
                      <input
                        className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                        disabled={parseStatus === "loading" || importStatus === "loading"}
                        onChange={(event) => {
                          setImageUrl(event.target.value);
                          setParsePreview(null);
                          setSelectedOfficialImageUrls(new Set());
                          setImportResult(null);
                          setParseStatus("idle");
                          setImportStatus("idle");
                          setRepairStatus("idle");
                          setParseError("");
                          setImportError("");
                          setRepairError("");
                          setRepairResult(null);
                        }}
                        placeholder="https://civitai.com/images/29900440"
                        value={imageUrl}
                      />
                      <Button
                        className="h-10 rounded-md bg-indigo-600 px-5 text-white hover:bg-indigo-700"
                        disabled={parseStatus === "loading" || importStatus === "loading"}
                        onClick={() => void handleParse()}
                        type="button"
                      >
                        {parseStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        解析预览
                      </Button>
                      <Button
                        className="h-10 rounded-md border-slate-200 bg-white px-5 text-slate-700 hover:bg-slate-50"
                        disabled={repairStatus === "loading" || importStatus === "loading" || parseStatus === "loading"}
                        onClick={() => void handleRepairCache()}
                        type="button"
                        variant="secondary"
                      >
                        {repairStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                        修复缓存
                      </Button>
                      <Button
                        className="h-10 rounded-md border-emerald-200 bg-white px-5 text-emerald-700 hover:bg-emerald-50"
                        disabled={
                          !parsePreview ||
                          (selectedImportResourceKeys.size === 0 && !hasExistingImportResources) ||
                          importStatus === "loading" ||
                          parseStatus === "loading"
                        }
                        onClick={() => void handleImport()}
                        type="button"
                        variant="secondary"
                      >
                        {importStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                        确认导入
                      </Button>
                    </div>
                    {parseStatus === "error" ? (
                      <p className="mt-2 text-xs leading-relaxed text-rose-600">{parseError}</p>
                    ) : null}
                    {importStatus === "error" ? (
                      <p className="mt-2 text-xs leading-relaxed text-rose-600">{importError}</p>
                    ) : null}
                    {repairStatus === "error" ? (
                      <p className="mt-2 text-xs leading-relaxed text-rose-600">{repairError}</p>
                    ) : null}
                    {repairStatus === "success" && repairResult ? (
                      <p className="mt-2 text-xs leading-relaxed text-emerald-700">
                        缓存修复完成：检查 {repairResult.checked} 张，补回 {repairResult.repaired} 张，已存在{" "}
                        {repairResult.skipped} 张，失败 {repairResult.failed} 张。
                      </p>
                    ) : null}
                    <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">AI 推荐组合</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            输入想要的效果，AI 会从本地收藏库里推荐 checkpoint + LoRA，并自动覆盖当前选择。
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {aiRecommendationStatus === "success" ? (
                            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                              已自动选中
                            </span>
                          ) : null}
                          <button
                            aria-expanded={!aiRecommendationPanelCollapsed}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                            onClick={() => setAiRecommendationPanelCollapsed((current) => !current)}
                            type="button"
                          >
                            {aiRecommendationPanelCollapsed ? "展开" : "收起"}
                            <ChevronDown
                              className={`size-3.5 transition-transform ${
                                aiRecommendationPanelCollapsed ? "" : "rotate-180"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                      {!aiRecommendationPanelCollapsed ? (
                        <div className="mt-3 space-y-3">
                          <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
                            <input
                              className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                              disabled={aiRecommendationStatus === "loading"}
                              onChange={(event) => {
                                setAiRecommendationInput(event.target.value);
                                if (aiRecommendationStatus === "error") {
                                  setAiRecommendationStatus("idle");
                                  setAiRecommendationError("");
                                }
                              }}
                              placeholder="例如：赛博朋克霓虹雨夜、柔和写实人像、动漫厚涂光影"
                              value={aiRecommendationInput}
                            />
                            <Button
                              className="h-10 rounded-md bg-purple-600 px-5 text-white hover:bg-purple-700"
                              disabled={aiRecommendationStatus === "loading"}
                              onClick={() => void handleRecommendCivitaiCombination()}
                              type="button"
                            >
                              {aiRecommendationStatus === "loading" ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Sparkles className="size-4" />
                              )}
                              {aiRecommendationStatus === "loading" ? "推荐中..." : "AI 推荐"}
                            </Button>
                          </div>
                          {aiRecommendationStatus === "error" && aiRecommendationError ? (
                            <p className="text-xs leading-relaxed text-rose-600">{aiRecommendationError}</p>
                          ) : null}
                          {aiRecommendationResult ? (
                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                              <div className="space-y-2 rounded-md border border-purple-100 bg-purple-50/60 p-3">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-purple-700">
                                  推荐理由
                                </p>
                                <p className="text-xs leading-relaxed text-slate-700">
                                  {aiRecommendationResult.recommendationReason}
                                </p>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-purple-700">
                                  组合效果
                                </p>
                                <p className="text-xs leading-relaxed text-slate-700">
                                  {aiRecommendationResult.overallEffect}
                                </p>
                                {aiRecommendationResult.warnings.length > 0 ? (
                                  <div className="space-y-1">
                                    {aiRecommendationResult.warnings.map((warning) => (
                                      <p className="text-[11px] leading-relaxed text-amber-700" key={warning}>
                                        {warning}
                                      </p>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className="space-y-2">
                                <AiRecommendationResourceCard
                                  label="Checkpoint"
                                  onOpenDetail={() => openResourceDetail(aiRecommendationResult.checkpoint.resource)}
                                  reason={aiRecommendationResult.checkpoint.reason}
                                  resource={aiRecommendationResult.checkpoint.resource}
                                />
                                {aiRecommendationResult.loras.map((entry) => (
                                  <AiRecommendationResourceCard
                                    key={entry.resource.id}
                                    label="LoRA"
                                    onOpenDetail={() => openResourceDetail(entry.resource)}
                                    reason={entry.reason}
                                    resource={entry.resource}
                                    suggestedWeight={entry.suggestedWeight}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {parsePreview ? (
                      <button
                        aria-expanded={!importPanelCollapsed}
                        className="mt-3 flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        onClick={() => setImportPanelCollapsed((current) => !current)}
                        type="button"
                      >
                        <span>
                          解析预览 · Image #{parsePreview.image.civitaiImageId} · LoRA {previewLoras.length} ·
                          Checkpoint {previewModels.length} · Filtered {previewIgnored.length}
                        </span>
                        <span className="inline-flex items-center gap-1 text-indigo-600">
                          {importPanelCollapsed ? "展开" : "折叠"}
                          <ChevronDown
                            className={`size-4 transition-transform ${importPanelCollapsed ? "" : "rotate-180"}`}
                          />
                        </span>
                      </button>
                    ) : null}
                    {parsePreview && !importPanelCollapsed ? (
                      <div className="mt-4 grid max-h-[58vh] gap-5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm [scrollbar-gutter:stable] lg:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="sticky top-0 flex h-[420px] max-h-[52vh] overflow-hidden rounded-lg bg-slate-100">
                          {parsePreview.image.imageUrl ? (
                            <CivitaiPreviewImage
                              alt="Imported Civitai source"
                              className="h-full w-full object-cover"
                              loading="eager"
                              src={parsePreview.image.imageUrl}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                              No image URL
                            </div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-4">
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Image</p>
                              <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                                #{parsePreview.image.civitaiImageId}
                              </p>
                            </div>
                            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">LoRA</p>
                              <p className="mt-0.5 text-sm font-semibold text-indigo-950">{previewLoras.length} 个</p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Checkpoint</p>
                              <p className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={previewModels.map((entry) => entry.name).join(", ")}>
                                {previewModels.length ? previewModels.map((entry) => entry.name).join(", ") : "-"}
                              </p>
                            </div>
                            <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Filtered</p>
                              <p className="mt-0.5 text-sm font-semibold text-amber-800">{previewIgnored.length} 项</p>
                            </div>
                          </div>
                          <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                            仅解析预览，尚未写入本地库。可在资源卡片中决定导入哪些 LoRA / checkpoint，并在下方统一挑选官方参考图。
                          </p>
                          <p className="text-xs leading-relaxed text-slate-600">
                            {parsePreview.message || METADATA_NOTICE}
                          </p>
                          {importResult ? (
                            <p className="rounded-md bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-700">
                              已确认导入到本地库：{importedLoras.length} 个 LoRA，{importedModels.length} 个 checkpoint/model。
                            </p>
                          ) : null}
                          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                            <div className="flex min-w-0 flex-col">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt</p>
                              <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-slate-100 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
                                {snippet(parsePreview.image.prompt, 1600)}
                              </p>
                            </div>
                            <div className="flex min-w-0 flex-col">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">资源结果</p>
                              <div className="mt-1 space-y-3 rounded-md bg-slate-50 p-3">
                                {previewResources.length > 0 ? (
                                  previewResources.map((entry, index) => {
                                    const importSelected = selectedImportResourceKeys.has(entry.importResourceKey);
                                    return (
                                    <div
                                      className={`rounded-md border p-3 text-xs leading-relaxed shadow-sm transition ${
                                        importSelected
                                          ? "border-indigo-100 bg-white text-slate-700"
                                          : "border-slate-200 bg-slate-100/80 text-slate-500 opacity-75"
                                      }`}
                                      key={`${entry.importResourceKey}:${index}`}
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-semibold text-slate-950">{entry.name}</p>
                                          <p className="mt-0.5 text-[11px] text-slate-500">
                                            {entry.versionName ?? `Version ${entry.modelVersionId ?? "-"}`}
                                          </p>
                                        </div>
                                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                          <button
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                                              importSelected
                                                ? "bg-emerald-50 text-emerald-700 hover:bg-rose-50 hover:text-rose-700"
                                                : "bg-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                                            }`}
                                            onClick={() => toggleImportResourceSelection(entry.importResourceKey)}
                                            type="button"
                                          >
                                            {importSelected ? <Check className="size-3" /> : null}
                                            {importSelected ? "导入" : "不导入"}
                                          </button>
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                            {entry.resourceType === "model" ? "checkpoint" : "lora"}
                                          </span>
                                          {entry.resourceType === "lora" ? (
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                              used {formatWeight(entry.weight)}
                                            </span>
                                          ) : null}
                                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                                            {entry.existingResourceId ? "existing" : "new"}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {getResourceCategories(entry).map((entryCategory) => (
                                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700" key={entryCategory}>
                                            {getCategoryLabel(entryCategory)}
                                          </span>
                                        ))}
                                        {entry.enrichmentStatus === "ai_failed" ? (
                                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700" title={entry.enrichmentError ?? undefined}>
                                            AI fallback
                                          </span>
                                        ) : null}
                                      </div>
                                      {entry.usageGuide ? (
                                        <p className="mt-2 rounded-md bg-slate-50 p-2 text-[12px] leading-relaxed text-slate-600">
                                          {entry.usageGuide}
                                        </p>
                                      ) : null}
                                      <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current image usage</p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                            sampler {parsePreview.image.sampler ?? "-"}
                                          </span>
                                          {entry.resourceType === "lora" ? (
                                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                              weight {formatWeight(entry.weight)}
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2">
                                        <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                          <ShieldCheck className="size-3" />
                                          Safety signal
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                            Civitai {formatCivitaiNsfw(entry.nsfw)}
                                          </span>
                                          <span
                                            className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600"
                                            title={entry.aiNsfwReason ?? undefined}
                                          >
                                            AI {AI_NSFW_LABELS[entry.aiNsfwLevel]} {formatAiNsfwConfidence(entry.aiNsfwConfidence)}
                                          </span>
                                        </div>
                                      </div>
                                      {entry.recommendations.length > 0 ? (
                                        <div className="mt-2 space-y-1.5">
                                          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                            Model recommendations
                                          </p>
                                          {entry.recommendations.slice(0, 3).map((recommendation, recommendationIndex) => (
                                            <div
                                              className="rounded-md border border-emerald-100 bg-emerald-50/70 px-2.5 py-2 text-emerald-800"
                                              key={`${formatRecommendationTitle(recommendation)}:${recommendationIndex}`}
                                            >
                                              <p className="font-semibold">{formatRecommendationTitle(recommendation)}</p>
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {recommendation.sampler ? (
                                                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px]">sampler {recommendation.sampler}</span>
                                                ) : null}
                                                {formatRecommendationWeight(recommendation) ? (
                                                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px]">
                                                    weight {formatRecommendationWeight(recommendation)}
                                                  </span>
                                                ) : null}
                                                {recommendation.hdRedrawRate !== null ? (
                                                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px]">
                                                    HD {formatWeight(recommendation.hdRedrawRate)}
                                                  </span>
                                                ) : null}
                                              </div>
                                              {!hasRecommendationDetails(recommendation) ? (
                                                <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">
                                                  模型说明只提供了通用适用方向，未给出明确的 sampler、LoRA weight 或 HD redraw 参数。
                                                </p>
                                              ) : null}
                                              {recommendation.notes ? (
                                                <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">{recommendation.notes}</p>
                                              ) : null}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2">
                                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                            Model recommendations
                                          </p>
                                          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                                            模型说明中没有明确的通用生成参数；上方仅展示当前图片实际使用的 sampler 与 LoRA weight。
                                          </p>
                                        </div>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                                          base {entry.baseModel ?? "unknown"}
                                        </span>
                                        {entry.hash ? (
                                          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                                            hash {entry.hash}
                                          </span>
                                        ) : null}
                                        {entry.trainedWords.slice(0, 4).map((word) => (
                                          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500" key={word}>
                                            {word}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    );
                                  })
                                ) : (
                                  <span className="text-xs text-slate-400">未识别到 LoRA。</span>
                                )}
                              </div>
                            </div>
                          </div>
                          {previewOfficialImageEntries.length > 0 ? (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                  <ImageIcon className="size-4 text-indigo-500" />
                                  Official reference images
                                </p>
                                <span className="text-[11px] text-slate-400">
                                  selected{" "}
                                  {
                                    previewOfficialImageEntries.filter(
                                      (entry) =>
                                        entry.selectable &&
                                        selectedImportResourceKeys.has(entry.importResourceKey) &&
                                        selectedOfficialImageUrls.has(entry.selectionId),
                                    ).length
                                  }{" "}
                                  /{" "}
                                  {
                                    previewOfficialImageEntries.filter(
                                      (entry) => entry.selectable && selectedImportResourceKeys.has(entry.importResourceKey),
                                    ).length
                                  }{" "}
                                  · existing{" "}
                                  {previewOfficialImageEntries.filter((entry) => entry.existing).length}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                                {previewOfficialImageEntries.map((entry) => {
                                  const selected = selectedOfficialImageUrls.has(entry.selectionId);
                                  const importSelected = selectedImportResourceKeys.has(entry.importResourceKey);
                                  const selectable = entry.selectable && importSelected;
                                  return (
                                    <div
                                      className={`group relative aspect-square overflow-hidden rounded-md border ${
                                        !selectable
                                          ? "border-slate-200 bg-slate-100 opacity-50"
                                          : selected
                                          ? "border-slate-200 bg-white"
                                          : "border-slate-200 bg-slate-100 opacity-45"
                                      }`}
                                      key={entry.selectionId}
                                      title={entry.resourceName}
                                    >
                                      <CivitaiPreviewImage
                                        alt={`Official Civitai reference for ${entry.resourceName}`}
                                        className="h-full w-full object-cover"
                                        src={entry.url}
                                      />
                                      <button
                                        aria-label={selected ? "排除此参考图" : "重新选择此参考图"}
                                        className={`${selectable ? "" : "hidden"} absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-[11px] shadow-sm transition ${
                                          selected
                                            ? "bg-slate-950/70 text-white hover:bg-rose-600"
                                            : "bg-white/90 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                                        }`}
                                        onClick={() => toggleOfficialImageSelection(entry.selectionId)}
                                        disabled={!selectable}
                                        type="button"
                                      >
                                        {selected ? <X className="size-3" /> : <Check className="size-3" />}
                                      </button>
                                      {!selectable ? (
                                        <span className="absolute left-1 top-1 rounded-full bg-slate-950/70 px-1.5 py-0.5 text-[9px] text-white">
                                          {importSelected ? "existing" : "不导入"}
                                        </span>
                                      ) : null}
                                      <div className="absolute inset-x-0 bottom-0 truncate bg-slate-950/55 px-1.5 py-0.5 text-[9px] text-white">
                                        {entry.resourceType === "model" ? "Checkpoint" : "LoRA"} · {entry.resourceName}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                          {previewIgnored.length > 0 ? (
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                已解析但未进入 LoRA/Checkpoint 库
                              </p>
                              <div className="mt-1 flex flex-wrap content-start gap-2 rounded-md bg-slate-50 p-3">
                                {previewIgnored.map((entry, index) => (
                                  <span
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-600"
                                    key={`${entry.modelVersionId ?? "no-version"}:${entry.resourceType}:${entry.name}:${index}`}
                                    title={entry.reason}
                                  >
                                    {entry.name} · {entry.resourceType} ·{" "}
                                    {entry.modelVersionId ? `#${entry.modelVersionId}` : "no version id"}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid min-h-0 grid-cols-[360px_1fr] overflow-hidden">
                    <aside className="flex min-h-0 flex-col border-r border-slate-100 bg-white">
                      <div className="shrink-0 space-y-2 border-b border-slate-100 p-3">
                        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
                          {(
                            [
                              ["image", "Image"],
                              ["lora", "LoRA"],
                              ["model", "Checkpoint"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              className={`h-8 rounded text-xs font-semibold transition ${
                                resourceTab === value
                                  ? "bg-white text-indigo-700 shadow-sm"
                                  : "text-slate-500 hover:text-slate-800"
                              }`}
                              key={value}
                              onClick={() => {
                                setResourceTab(value);
                                setSelectedResourceId(null);
                                setSelectedImageId(null);
                                setDetail(null);
                                setImageDetail(null);
                                setCategory("all");
                                setBaseModel("");
                                setImportedCount("all");
                              }}
                              type="button"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                          <input
                            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search name / tags / trained words"
                            value={query}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {resourceTab === "lora" ? (
                            <select
                              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none"
                              onChange={(event) => setCategory(event.target.value as CivitaiLoraCategory | "all")}
                              value={category}
                            >
                              {CATEGORY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <select
                            className={`h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none ${
                              resourceTab !== "lora" ? "col-span-2" : ""
                            }`}
                            onChange={(event) => setBaseModel(event.target.value)}
                            value={baseModel}
                          >
                            <option value="">All base models</option>
                            {baseModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                          <select
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none"
                            onChange={(event) => setNsfw(event.target.value as "all" | "sfw" | "nsfw")}
                            value={nsfw}
                          >
                            <option value="all">All NSFW</option>
                            <option value="sfw">SFW / unknown</option>
                            <option value="nsfw">NSFW</option>
                          </select>
                          <select
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none"
                            onChange={(event) => setImportedCount(event.target.value as "all" | "one" | "multiple" | "none" | "with")}
                            value={importedCount}
                          >
                            {isImageTab ? (
                              <>
                                <option value="all">Any resources</option>
                                <option value="with">With resources</option>
                                <option value="none">No resources</option>
                              </>
                            ) : (
                              <>
                                <option value="all">Any imports</option>
                                <option value="one">1 imported image</option>
                                <option value="multiple">2+ imported images</option>
                              </>
                            )}
                          </select>
                        </div>
                        <Button className="h-8 w-full text-xs" onClick={() => void loadResources()} size="sm" type="button" variant="secondary">
                          刷新筛选
                        </Button>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {resourceStatus === "loading" ? (
                          <div className="flex h-40 items-center justify-center text-xs text-slate-500">
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Loading {activeResourceLabel}s...
                          </div>
                        ) : null}
                        {resourceStatus === "error" ? (
                          <p className="rounded-md bg-rose-50 p-3 text-xs leading-relaxed text-rose-600">{resourceError}</p>
                        ) : null}
                        {resourceStatus !== "loading" && (isImageTab ? images.length === 0 : resources.length === 0) ? (
                          <p className="rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                            暂无已导入 {activeResourceLabel}。先粘贴一个 Civitai image URL 解析并确认导入。
                          </p>
                        ) : null}
                        <div className="space-y-2">
                          {isImageTab
                            ? images.map((image) => (
                                <button
                                  className={`grid w-full grid-cols-[64px_1fr] gap-3 rounded-md border p-2 text-left transition ${
                                    selectedImageId === image.id
                                      ? "border-indigo-300 bg-indigo-50"
                                      : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
                                  }`}
                                  key={image.id}
                                  onClick={() => setSelectedImageId(image.id)}
                                  type="button"
                                >
                                  {image.imageUrl ? (
                                    <img
                                      alt={`Civitai image ${image.civitaiImageId}`}
                                      className="h-16 w-16 rounded-md object-cover"
                                      src={image.imageUrl}
                                    />
                                  ) : (
                                    <div className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-400">
                                      Image
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-slate-900">Image #{image.civitaiImageId}</p>
                                    <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                                      {image.baseModel ?? "unknown base model"} · {image.username ?? "unknown user"}
                                    </p>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                                        {image.loraCount} LoRA
                                      </span>
                                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                        {image.checkpointCount} checkpoint
                                      </span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-slate-500">{snippet(image.prompt, 72)}</p>
                                  </div>
                                </button>
                              ))
                            : null}
                          {resources.map((resource) => (
                            <button
                              className={`grid w-full grid-cols-[64px_1fr] gap-3 rounded-md border p-2 text-left transition ${
                                selectedResourceId === resource.id
                                  ? "border-indigo-300 bg-indigo-50"
                                  : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
                              }`}
                              key={resource.id}
                              onClick={() => setSelectedResourceId(resource.id)}
                              type="button"
                            >
                              {resource.previewImage ? (
                                <img
                                  alt={resource.name}
                                  className="h-16 w-16 rounded-md object-cover"
                                  src={resource.previewImage}
                                />
                              ) : (
                                <div className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-400">
                                  {activeResourceLabel}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-slate-900">{resource.name}</p>
                                <p
                                  className="mt-0.5 truncate text-[11px] font-medium text-slate-500"
                                  title={formatResourceVersion(resource)}
                                >
                                  Model version: {formatResourceVersion(resource)}
                                </p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {isCheckpointTab ? (
                                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                      checkpoint
                                    </span>
                                  ) : (
                                    getResourceCategories(resource).map((resourceCategory) => (
                                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700" key={resourceCategory}>
                                        {getCategoryLabel(resourceCategory)}
                                      </span>
                                    ))
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">{resource.baseModel ?? "unknown"}</p>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {resource.importedImageCount} images · avg {formatWeight(resource.averageWeight)}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </aside>

                    <section className="min-h-0 overflow-y-auto p-5" ref={detailPaneRef}>
                      {detailStatus === "loading" ? (
                        <div className="flex h-full min-h-72 items-center justify-center text-sm text-slate-500">
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Loading detail...
                        </div>
                      ) : null}
                      {detailStatus === "error" ? (
                        <p className="rounded-md bg-rose-50 p-4 text-sm text-rose-600">{detailError}</p>
                      ) : null}
                      {imageDetail ? (
                        <div className="space-y-5">
                          <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
                            <div className="space-y-3">
                              <div className="overflow-hidden rounded-md bg-slate-100">
                                {imageDetail.imageUrl ? (
                                  <img
                                    alt={`Civitai image ${imageDetail.civitaiImageId}`}
                                    className="max-h-[560px] w-full object-contain"
                                    src={imageDetail.imageUrl}
                                  />
                                ) : (
                                  <div className="flex h-80 items-center justify-center text-xs text-slate-400">
                                    Image
                                  </div>
                                )}
                              </div>
                              <a
                                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                href={imageDetail.civitaiImagePageUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <ExternalLink className="size-4" />
                                Open source image
                              </a>
                            </div>
                            <div className="min-w-0 space-y-5">
                              <div>
                                <h4 className="break-words text-xl font-bold text-slate-950">
                                  Image #{imageDetail.civitaiImageId}
                                </h4>
                                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                                  {imageDetail.baseModel ?? "unknown base model"} · {imageDetail.username ?? "unknown user"} ·{" "}
                                  {imageDetail.width ?? "-"}x{imageDetail.height ?? "-"}
                                </p>
                              </div>

                              <div className="grid gap-3 md:grid-cols-4">
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Resources</p>
                                  <p className="mt-1 text-lg font-bold text-slate-900">{imageDetail.resourceCount}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">LoRA</p>
                                  <p className="mt-1 text-lg font-bold text-slate-900">{imageDetail.loraCount}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Checkpoint</p>
                                  <p className="mt-1 text-lg font-bold text-slate-900">{imageDetail.checkpointCount}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sampler</p>
                                  <p className="mt-1 truncate text-lg font-bold text-slate-900" title={imageDetail.sampler ?? undefined}>
                                    {imageDetail.sampler ?? "-"}
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt</p>
                                <p className="rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
                                  {imageDetail.prompt ?? "No prompt metadata."}
                                </p>
                              </div>

                              <div className="grid gap-4 xl:grid-cols-2">
                                <div>
                                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Checkpoint</p>
                                  <div className="space-y-2">
                                    {imageDetailCheckpoints.length > 0 ? (
                                      imageDetailCheckpoints.map((usage) => (
                                        <button
                                          aria-label={`Open checkpoint detail for ${usage.resource.name}`}
                                          className="w-full rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                          key={usage.id}
                                          onClick={() => openResourceDetail(usage.resource)}
                                          type="button"
                                        >
                                          <p className="text-sm font-semibold text-slate-900">{usage.resource.name}</p>
                                          <p className="mt-1 text-xs text-slate-500">
                                            {formatResourceVersion(usage.resource)} · {usage.resource.baseModel ?? "unknown base model"}
                                          </p>
                                        </button>
                                      ))
                                    ) : (
                                      <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">No checkpoint metadata.</p>
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <div className="mb-2 flex items-center justify-between gap-3">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">LoRA Stack</p>
                                    {imageDetailLoras.length > 0 ? (
                                      <button
                                        aria-label={loraWeightEditing ? "Save LoRA weights" : "Edit LoRA weights"}
                                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={loraWeightSaveStatus === "loading"}
                                        onClick={() => void handleLoraWeightEditToggle()}
                                        type="button"
                                      >
                                        {loraWeightSaveStatus === "loading" ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : loraWeightEditing ? (
                                          <Save className="size-3" />
                                        ) : (
                                          <Pencil className="size-3" />
                                        )}
                                        {loraWeightEditing ? "Save" : "Edit"}
                                      </button>
                                    ) : null}
                                  </div>
                                  {loraWeightSaveStatus === "error" ? (
                                    <p className="mb-2 rounded-md bg-rose-50 p-2 text-xs text-rose-600">{loraWeightSaveError}</p>
                                  ) : null}
                                  <div className="space-y-2">
                                    {imageDetailLoras.length > 0 ? (
                                      imageDetailLoras.map((usage) => (
                                        <div
                                          aria-label={loraWeightEditing ? undefined : `Open LoRA detail for ${usage.resource.name}`}
                                          className={`rounded-md border border-slate-200 bg-white p-3 ${
                                            loraWeightEditing
                                              ? ""
                                              : "cursor-pointer transition hover:border-indigo-200 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                          }`}
                                          key={usage.id}
                                          onClick={() => {
                                            if (!loraWeightEditing) {
                                              openResourceDetail(usage.resource);
                                            }
                                          }}
                                          onKeyDown={(event) => {
                                            if (loraWeightEditing || (event.key !== "Enter" && event.key !== " ")) {
                                              return;
                                            }
                                            event.preventDefault();
                                            openResourceDetail(usage.resource);
                                          }}
                                          role={loraWeightEditing ? undefined : "button"}
                                          tabIndex={loraWeightEditing ? undefined : 0}
                                        >
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <p className="truncate text-sm font-semibold text-slate-900">{usage.resource.name}</p>
                                              <p className="mt-1 text-xs text-slate-500">
                                                {formatResourceVersion(usage.resource)} · {usage.resource.baseModel ?? "unknown base model"}
                                              </p>
                                            </div>
                                            {loraWeightEditing ? (
                                              <input
                                                aria-label={`Weight for ${usage.resource.name}`}
                                                className="h-8 w-20 shrink-0 rounded-md border border-indigo-200 bg-white px-2 text-right text-xs font-medium text-indigo-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                                inputMode="decimal"
                                                onChange={(event) =>
                                                  setLoraWeightDrafts((current) => ({
                                                    ...current,
                                                    [usage.id]: event.target.value,
                                                  }))
                                                }
                                                placeholder="-"
                                                type="number"
                                                value={loraWeightDrafts[usage.id] ?? ""}
                                              />
                                            ) : (
                                              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700">
                                                {formatWeight(usage.weight)}
                                              </span>
                                            )}
                                          </div>
                                          {usage.triggerWordsUsed.length > 0 ? (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                              {usage.triggerWordsUsed.map((word) => (
                                                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600" key={word}>
                                                  {word}
                                                </span>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      ))
                                    ) : (
                                      <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">No LoRA metadata.</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {!imageDetail && detail ? (
                        <div className="space-y-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h4 className="break-words text-xl font-bold text-slate-950">{detail.name}</h4>
                              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                                {detailIsCheckpoint ? "checkpoint" : (detail.category ?? "other")} ·{" "}
                                {formatResourceVersion(detail)} · {detail.baseModel ?? "unknown base model"} · source: Civitai
                              </p>
                              <div className="mt-3">
                                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                  分类标签
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {detailIsCheckpoint ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                                      checkpoint
                                    </span>
                                  ) : (
                                    getResourceCategories(detail).map((detailCategory) => (
                                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700" key={detailCategory}>
                                        {getCategoryLabel(detailCategory)}
                                      </span>
                                    ))
                                  )}
                                  {detail.enrichmentStatus === "ai_failed" ? (
                                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] text-amber-700" title={detail.enrichmentError ?? undefined}>
                                      AI fallback
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              {!detailIsCheckpoint || detail.trainedWords.length > 0 ? (
                                <div className="mt-3">
                                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    触发词
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {detail.trainedWords.length > 0 ? (
                                      detail.trainedWords.map((word) => (
                                        <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700" key={word}>
                                          {word}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-xs text-slate-400">No trained words metadata.</span>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-2">
                              {detail.resourceType === "lora" || detail.resourceType === "model" ? (
                                <div className="flex flex-col items-end gap-2">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    {shouldShowDownloadStatusBadge(downloadStatus, downloadStatusLoadStatus) ? (
                                      <span
                                        className={`inline-flex h-9 items-center rounded-md px-3 text-xs font-medium ${getDownloadStatusClass(downloadStatus)}`}
                                        title={downloadStatus?.message}
                                      >
                                        {downloadStatusLoadStatus === "loading" ? "检查中" : getDownloadStatusLabel(downloadStatus)}
                                      </span>
                                    ) : null}
                                    <Button
                                      className={`h-9 rounded-md px-3 text-xs ${
                                        detailIsSelected
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                      }`}
                                      onClick={() => void handleToggleSelectedResource()}
                                      size="sm"
                                      type="button"
                                      variant="secondary"
                                    >
                                      <Check className="size-4" />
                                      {detailIsSelected ? "已选中" : `选中 ${detailResourceLabel}`}
                                    </Button>
                                    {downloadStatus?.fileExists && downloadStatus.checksumType === "SHA256" ? (
                                      <Button
                                        className="h-9 rounded-md border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
                                        disabled={downloadActionStatus === "loading" || downloadStatusLoadStatus === "loading"}
                                        onClick={() => void handleVerifyResourceFile()}
                                        size="sm"
                                        type="button"
                                        variant="secondary"
                                      >
                                        {downloadActionStatus === "loading" && downloadStatusLoadStatus === "loading" ? (
                                          <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                          <ShieldCheck className="size-4" />
                                        )}
                                        {downloadStatus.status === "verified" ? "重新校验" : "校验"}
                                      </Button>
                                    ) : null}
                                    <Button
                                      className="h-9 rounded-md bg-indigo-600 px-3 text-xs text-white hover:bg-indigo-700"
                                      disabled={
                                        downloadActionStatus === "loading" ||
                                        downloadStatusLoadStatus === "loading" ||
                                        downloadStatus?.status === "path_missing" ||
                                        downloadStatus?.status === "directory_missing"
                                      }
                                      onClick={() => void handleDownloadResource()}
                                      size="sm"
                                      type="button"
                                    >
                                      {downloadActionStatus === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                                      {getDownloadButtonLabel(downloadStatus, detailResourceLabel)}
                                    </Button>
                                    <Button
                                      className="h-9 rounded-md border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
                                      disabled={
                                        downloadActionStatus === "loading" ||
                                        downloadStatusLoadStatus === "loading" ||
                                        downloadStatus?.status === "path_missing" ||
                                        downloadStatus?.status === "directory_missing"
                                      }
                                      onClick={() => uploadInputRef.current?.click()}
                                      size="sm"
                                      type="button"
                                      variant="secondary"
                                    >
                                      <Upload className="size-4" />
                                      上传文件
                                    </Button>
                                    <input
                                      accept=".safetensors,.ckpt,.pt,.bin"
                                      className="hidden"
                                      onChange={(event) => void handleUploadResourceFile(event.target.files?.[0])}
                                      ref={uploadInputRef}
                                      type="file"
                                    />
                                  </div>
                                  {downloadStatus?.targetFileName ? (
                                    <p className="max-w-[360px] truncate text-right text-[11px] text-slate-500" title={downloadStatus.targetPath ?? undefined}>
                                      {downloadStatus.targetFileName}
                                    </p>
                                  ) : null}
                                  {selectionError ? (
                                    <p className="max-w-[360px] text-right text-[11px] leading-relaxed text-rose-600">{selectionError}</p>
                                  ) : null}
                                  {downloadActionStatus === "success" && downloadActionMessage ? (
                                    <p className="max-w-[360px] text-right text-[11px] leading-relaxed text-emerald-700">{downloadActionMessage}</p>
                                  ) : null}
                                  {downloadActionStatus === "error" && downloadActionError ? (
                                    <p className="max-w-[360px] text-right text-[11px] leading-relaxed text-rose-600">{downloadActionError}</p>
                                  ) : null}
                                  {downloadActionStatus !== "success" && downloadActionStatus !== "error" && shouldShowDownloadStatusMessage(downloadStatus) ? (
                                    <p className="max-w-[360px] text-right text-[11px] leading-relaxed text-slate-500">{downloadStatus.message}</p>
                                  ) : null}
                                </div>
                              ) : null}
                              {detailUrl ? (
                                <a
                                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                  href={detailUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <ExternalLink className="size-4" />
                                  Civitai
                                </a>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-4">
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Images</p>
                              <p className="mt-1 text-lg font-bold text-slate-900">{detail.importedImageCount}</p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Model version</p>
                              <p className="mt-1 truncate text-lg font-bold text-slate-900" title={formatResourceVersion(detail)}>
                                {formatResourceVersion(detail)}
                              </p>
                            </div>
                            {!detailIsCheckpoint ? (
                              <>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Avg weight</p>
                                  <p className="mt-1 text-lg font-bold text-slate-900">{formatWeight(detail.averageWeight)}</p>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Range</p>
                                  <p className="mt-1 text-lg font-bold text-slate-900">{formatRange(detail)}</p>
                                </div>
                              </>
                            ) : null}
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">NSFW</p>
                              <p className="mt-1 text-lg font-bold text-slate-900">{formatCivitaiNsfw(detail.nsfw)}</p>
                              <p className="mt-1 text-[11px] text-slate-500" title={detail.aiNsfwReason ?? undefined}>
                                AI {AI_NSFW_LABELS[detail.aiNsfwLevel]} · {formatAiNsfwConfidence(detail.aiNsfwConfidence)}
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
                            <div className="space-y-5">
                              {detail.usageGuide ? (
                                <div>
                                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">适用场景</p>
                                  <p className="rounded-md bg-indigo-50 p-3 text-sm leading-relaxed text-slate-700">
                                    {detail.usageGuide}
                                  </p>
                                </div>
                              ) : null}

                              <div>
                                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">推荐参数</p>
                                {detail.recommendations.length > 0 ? (
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {detail.recommendations.map((recommendation, recommendationIndex) => (
                                      <div
                                        className="rounded-md border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-relaxed text-slate-700"
                                        key={`${formatRecommendationTitle(recommendation)}:${recommendationIndex}`}
                                      >
                                        <p className="font-semibold text-slate-900">{formatRecommendationTitle(recommendation)}</p>
                                        {hasRecommendationDetails(recommendation) ? (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {recommendation.baseModel ? (
                                              <span className="rounded-full bg-white px-2 py-0.5">base {recommendation.baseModel}</span>
                                            ) : null}
                                            {recommendation.checkpoint ? (
                                              <span className="rounded-full bg-white px-2 py-0.5">checkpoint {recommendation.checkpoint}</span>
                                            ) : null}
                                            {recommendation.sampler ? (
                                              <span className="rounded-full bg-white px-2 py-0.5">sampler {recommendation.sampler}</span>
                                            ) : null}
                                            {formatRecommendationWeight(recommendation) ? (
                                              <span className="rounded-full bg-white px-2 py-0.5">
                                                LoRA weight {formatRecommendationWeight(recommendation)}
                                              </span>
                                            ) : null}
                                            {recommendation.hdRedrawRate !== null ? (
                                              <span className="rounded-full bg-white px-2 py-0.5">
                                                HD redraw {formatWeight(recommendation.hdRedrawRate)}
                                              </span>
                                            ) : null}
                                          </div>
                                        ) : null}
                                        {recommendation.notes ? <p className="mt-2 text-slate-600">{recommendation.notes}</p> : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-500">
                                    模型说明中没有明确的通用生成参数；可参考下方导入图片里的实际 sampler 与 LoRA weight。
                                  </div>
                                )}
                              </div>

                              <div>
                                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Resource metadata</p>
                                <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                                  <p className="rounded-md bg-slate-50 p-2">Model ID: {detail.civitaiModelId ?? "-"}</p>
                                  <p className="rounded-md bg-slate-50 p-2">Version name: {detail.versionName ?? "-"}</p>
                                  <p className="rounded-md bg-slate-50 p-2">Version ID: {detail.civitaiModelVersionId ?? "-"}</p>
                                  <p className="rounded-md bg-slate-50 p-2">Hash: {detail.hash ?? "-"}</p>
                                  <p className="rounded-md bg-slate-50 p-2">Creator: {detail.creator ?? "-"}</p>
                                  <p className="rounded-md bg-slate-50 p-2 md:col-span-2">
                                    Download URL: {detail.downloadUrl ?? "-"}
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                  Imported images using this {detailResourceLabel}
                                </p>
                                <div className="space-y-3">
                                  {detail.usages.map((usage) => (
                                    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 md:grid-cols-[96px_1fr]" key={usage.id}>
                                      {usage.importedImage.imageUrl ? (
                                        <button
                                          aria-label={`Open image detail for Civitai image ${usage.importedImage.civitaiImageId}`}
                                          className="h-24 w-24 rounded-md text-left transition hover:ring-2 hover:ring-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                          onClick={() => openImportedImageDetail(usage.importedImage)}
                                          type="button"
                                        >
                                          <img
                                            alt={`Civitai image ${usage.importedImage.civitaiImageId}`}
                                            className="h-24 w-24 rounded-md object-cover"
                                            src={usage.importedImage.imageUrl}
                                          />
                                        </button>
                                      ) : (
                                        <button
                                          aria-label={`Open image detail for Civitai image ${usage.importedImage.civitaiImageId}`}
                                          className="flex h-24 w-24 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-400 transition hover:ring-2 hover:ring-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                          onClick={() => openImportedImageDetail(usage.importedImage)}
                                          type="button"
                                        >
                                          Image
                                        </button>
                                      )}
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                                          {!detailIsCheckpoint ? (
                                            <span className="rounded-full bg-slate-100 px-2 py-1">weight {formatWeight(usage.weight)}</span>
                                          ) : null}
                                          <span className="rounded-full bg-slate-100 px-2 py-1">
                                            base model {usage.importedImage.baseModel ?? "-"}
                                          </span>
                                          <span className="rounded-full bg-slate-100 px-2 py-1">
                                            {RESOLVE_STATUS_LABELS[usage.resolveStatus]}
                                          </span>
                                        </div>
                                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                                          {snippet(usage.importedImage.prompt)}
                                        </p>
                                        <a
                                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:text-indigo-900"
                                          href={usage.importedImage.civitaiImagePageUrl}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          Open source image
                                          <ExternalLink className="size-3" />
                                        </a>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <aside className="space-y-5">
                              <div>
                                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Official reference images</p>
                                <div className="max-h-[460px] overflow-y-auto pr-1 [scrollbar-gutter:stable]">
                                  <div className="grid grid-cols-2 gap-2">
                                  {officialImages.length > 0 ? (
                                    officialImages.map((url) => (
                                      <img
                                        alt="Official Civitai reference"
                                        className="aspect-square w-full rounded-md object-cover"
                                        key={url}
                                        src={url}
                                      />
                                    ))
                                  ) : (
                                    <p className="col-span-2 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
                                      No official image metadata.
                                    </p>
                                  )}
                                  </div>
                                </div>
                              </div>

                              {!detailIsCheckpoint ? (
                                <div>
                                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Common checkpoints</p>
                                  <div className="space-y-1.5">
                                    {detail.commonCheckpoints.length > 0 ? (
                                      detail.commonCheckpoints.map((item) => (
                                        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600" key={item.resourceId}>
                                          {item.name} · {item.count}
                                        </p>
                                      ))
                                    ) : (
                                      <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-400">No pairings yet.</p>
                                    )}
                                  </div>
                                </div>
                              ) : null}

                              <div>
                                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Common LoRA pairings</p>
                                <div className="space-y-1.5">
                                  {detail.commonLoras.length > 0 ? (
                                    detail.commonLoras.map((item) => (
                                      <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600" key={item.resourceId}>
                                        {item.name} · {item.count}
                                      </p>
                                    ))
                                  ) : (
                                    <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-400">No pairings yet.</p>
                                  )}
                                </div>
                              </div>
                            </aside>
                          </div>
                        </div>
                      ) : !imageDetail && detailStatus !== "loading" ? (
                        <div className="flex h-full min-h-72 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-500">
                          Select a {activeResourceLabel} to inspect metadata and imported image usage.
                        </div>
                      ) : null}
                    </section>
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
