"use client";

import { ChevronDown, Database, ExternalLink, Loader2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type {
  CivitaiAiNsfwLevel,
  CivitaiImportResult,
  CivitaiLoraCategory,
  CivitaiParsePreview,
  CivitaiResourceRecommendation,
  CivitaiResourceDetail,
  CivitaiResourceListItem,
  CivitaiResolveStatus,
} from "@/features/civitai-lora-library";

type LoadStatus = "idle" | "loading" | "success" | "error";
type LibraryResourceTab = "lora" | "model";
type CacheRepairResult = {
  checked: number;
  repaired: number;
  failed: number;
  skipped: number;
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

export function CivitaiLoraLibraryPanel() {
  const [open, setOpen] = useState(false);
  const [resources, setResources] = useState<CivitaiResourceListItem[]>([]);
  const [resourceStatus, setResourceStatus] = useState<LoadStatus>("idle");
  const [resourceError, setResourceError] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CivitaiResourceDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<LoadStatus>("idle");
  const [detailError, setDetailError] = useState("");
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
  const [importPanelCollapsed, setImportPanelCollapsed] = useState(false);
  const [resourceTab, setResourceTab] = useState<LibraryResourceTab>("lora");
  const [category, setCategory] = useState<CivitaiLoraCategory | "all">("all");
  const [nsfw, setNsfw] = useState<"all" | "sfw" | "nsfw">("all");
  const [importedCount, setImportedCount] = useState<"all" | "one" | "multiple">("all");
  const [query, setQuery] = useState("");
  const [baseModels, setBaseModels] = useState<string[]>([]);
  const [baseModel, setBaseModel] = useState("");

  async function loadResources() {
    setResourceStatus("loading");
    setResourceError("");

    try {
      const params = new URLSearchParams();
      params.set("resourceType", resourceTab);
      if (resourceTab === "lora") {
        params.set("category", category);
      }
      params.set("nsfw", nsfw);
      params.set("importedCount", importedCount);
      if (query.trim()) {
        params.set("query", query.trim());
      }
      if (baseModel) {
        params.set("baseModel", baseModel);
      }

      const payload = await fetchJson<{ items: CivitaiResourceListItem[] }>(
        `/api/civitai-lora-library/resources?${params.toString()}`,
      );
      setResources(payload.items);
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
      setResourceStatus("error");
      setResourceError(error instanceof Error ? error.message : "无法读取 LoRA Library。");
    }
  }

  async function loadDetail(resourceId: string) {
    setDetailStatus("loading");
    setDetailError("");
    setDetail(null);

    try {
      const payload = await fetchJson<CivitaiResourceDetail>(
        `/api/civitai-lora-library/resources/${encodeURIComponent(resourceId)}`,
      );
      setDetail(payload);
      setDetailStatus("success");
    } catch (error) {
      setDetailStatus("error");
      setDetailError(error instanceof Error ? error.message : "无法读取 LoRA 详情。");
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
    if (selectedImportResourceKeys.size === 0) {
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

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadResources();
    }, 0);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceTab, category, nsfw, importedCount, baseModel]);

  useEffect(() => {
    if (!open || !selectedResourceId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadDetail(selectedResourceId);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [open, selectedResourceId]);

  const importedLoras = importResult?.resources.filter((entry) => entry.resource.resourceType === "lora") ?? [];
  const importedModels = importResult?.resources.filter((entry) => entry.resource.resourceType === "model") ?? [];
  const previewLoras = parsePreview?.resources.filter((entry) => entry.resourceType === "lora") ?? [];
  const previewModels = parsePreview?.resources.filter((entry) => entry.resourceType === "model") ?? [];
  const previewResources = parsePreview?.resources ?? [];
  const previewIgnored = parsePreview?.ignoredResources ?? [];
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
  const isCheckpointTab = resourceTab === "model";
  const activeResourceLabel = isCheckpointTab ? "Checkpoint" : "LoRA";
  const detailIsCheckpoint = detail?.resourceType === "model";
  const detailResourceLabel = detailIsCheckpoint ? "Checkpoint" : "LoRA";

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
                    aria-label="关闭 Civitai LoRA Library"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setOpen(false)}
                    type="button"
                  >
                    <X className="size-5" />
                  </button>
                </header>

                <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-hidden">
                  <div className="border-b border-slate-100 bg-slate-50 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
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
                          selectedImportResourceKeys.size === 0 ||
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
                      <div className="mt-4 grid max-h-[42vh] min-h-0 gap-5 overflow-y-auto rounded-md border border-slate-200 bg-white p-4 pr-3 [scrollbar-gutter:stable] lg:grid-cols-[280px_minmax(0,1fr)]">
                        <div className="flex h-[360px] max-h-full overflow-hidden rounded-md bg-slate-100">
                          {parsePreview.image.imageUrl ? (
                            <img
                              alt="Imported Civitai source"
                              className="h-full w-full object-cover"
                              src={parsePreview.image.imageUrl}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                              No image URL
                            </div>
                          )}
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1 [scrollbar-gutter:stable] lg:min-h-[360px]">
                          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2 py-1">
                              Image #{parsePreview.image.civitaiImageId}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">
                              Checkpoints: {previewModels.map((entry) => entry.name).join(", ") || "-"}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">
                              LoRA: {previewLoras.length}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">
                              Filtered: {previewIgnored.length}
                            </span>
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                              仅解析预览，尚未写入本地库
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-600">
                            {parsePreview.message || METADATA_NOTICE}
                          </p>
                          {importResult ? (
                            <p className="rounded-md bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-700">
                              已确认导入到本地库：{importedLoras.length} 个 LoRA，{importedModels.length} 个 checkpoint/model。
                            </p>
                          ) : null}
                          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-2">
                            <div className="flex min-h-0 flex-col overflow-hidden">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt</p>
                              <p className="mt-1 max-h-[520px] min-h-[180px] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 [scrollbar-gutter:stable]">
                                {snippet(parsePreview.image.prompt, 1600)}
                              </p>
                            </div>
                            <div className="flex min-h-0 flex-col overflow-hidden">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">资源结果</p>
                              <div className="mt-1 max-h-[520px] min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md bg-slate-50 p-3 pr-2 [scrollbar-gutter:stable]">
                                {previewResources.length > 0 ? (
                                  previewResources.map((entry, index) => {
                                    const importSelected = selectedImportResourceKeys.has(entry.importResourceKey);
                                    return (
                                    <div
                                      className={`rounded-md border p-3 text-xs leading-relaxed shadow-sm transition ${
                                        importSelected
                                          ? "border-slate-200 bg-white text-slate-700"
                                          : "border-slate-200 bg-slate-50 text-slate-500 opacity-75"
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
                                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                                              importSelected
                                                ? "bg-emerald-50 text-emerald-700 hover:bg-rose-50 hover:text-rose-700"
                                                : "bg-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                                            }`}
                                            onClick={() => toggleImportResourceSelection(entry.importResourceKey)}
                                            type="button"
                                          >
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
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Safety signal</p>
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
                                      {entry.officialImageUrls.length > 0 ? (
                                        <div className="mt-2">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                              Official reference images
                                            </p>
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                              {entry.resourceType === "model" ? "Checkpoint" : "LoRA"} ·{" "}
                                              {entry.existingResourceId ? "已入库，可覆盖选择" : "待导入，可选择"}
                                            </span>
                                          </div>
                                          {!importSelected ? (
                                            <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] leading-relaxed text-slate-500">
                                              该资源不导入，图片选择不会生效。
                                            </p>
                                          ) : null}
                                          <div className="mt-1 grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
                                            {entry.officialImageUrls.map((url) => {
                                              const selectionId = makeOfficialImageSelectionId(entry.officialImageResourceKey, url);
                                              const selected = selectedOfficialImageUrls.has(selectionId);
                                              const selectable = entry.officialImagesSelectable && importSelected;
                                              const existing = entry.officialImageExistingUrls.includes(url);
                                              return (
                                                <div
                                                  className={`group relative aspect-square overflow-hidden rounded-md border ${
                                                    !selectable
                                                      ? "border-slate-200 bg-slate-100 opacity-50"
                                                      : selected
                                                        ? "border-slate-200 bg-slate-100"
                                                        : "border-slate-200 bg-slate-100 opacity-45"
                                                  }`}
                                                    key={selectionId}
                                                >
                                                  <img
                                                    alt="Official Civitai reference"
                                                    className="h-full w-full object-cover"
                                                    src={url}
                                                  />
                                                  <button
                                                    aria-label={selected ? "排除此参考图" : "重新选择此参考图"}
                                                    className={`${selectable ? "" : "hidden"} absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-[11px] shadow-sm transition ${
                                                      selected
                                                        ? "bg-slate-950/70 text-white hover:bg-rose-600"
                                                        : "bg-white/90 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                                                    }`}
                                                    onClick={() => toggleOfficialImageSelection(selectionId)}
                                                    disabled={!selectable}
                                                    type="button"
                                                  >
                                                    {selected ? <X className="size-3" /> : "✓"}
                                                  </button>
                                                  {existing ? (
                                                    <span className="absolute left-1 top-1 rounded-full bg-slate-950/70 px-1.5 py-0.5 text-[9px] text-white">
                                                      existing
                                                    </span>
                                                  ) : null}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ) : null}
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
                            <div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
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
                              <div className="mt-2 grid max-h-44 grid-cols-6 gap-2 overflow-y-auto rounded-md bg-slate-50 p-2 [scrollbar-gutter:stable]">
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
                                      <img
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
                                        {selected ? <X className="size-3" /> : "✓"}
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
                              <div className="mt-1 flex max-h-24 flex-wrap content-start gap-2 overflow-y-auto rounded-md bg-slate-50 p-3">
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
                        <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                          {(
                            [
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
                                setDetail(null);
                                setCategory("all");
                                setBaseModel("");
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
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                void loadResources();
                              }
                            }}
                            placeholder="Search name / tags / trained words"
                            value={query}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {!isCheckpointTab ? (
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
                              isCheckpointTab ? "col-span-2" : ""
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
                            onChange={(event) => setImportedCount(event.target.value as "all" | "one" | "multiple")}
                            value={importedCount}
                          >
                            <option value="all">Any imports</option>
                            <option value="one">1 imported image</option>
                            <option value="multiple">2+ imported images</option>
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
                        {resourceStatus !== "loading" && resources.length === 0 ? (
                          <p className="rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                            暂无已导入 {activeResourceLabel}。先粘贴一个 Civitai image URL 解析并确认导入。
                          </p>
                        ) : null}
                        <div className="space-y-2">
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

                    <section className="min-h-0 overflow-y-auto p-5">
                      {detailStatus === "loading" ? (
                        <div className="flex h-full min-h-72 items-center justify-center text-sm text-slate-500">
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Loading detail...
                        </div>
                      ) : null}
                      {detailStatus === "error" ? (
                        <p className="rounded-md bg-rose-50 p-4 text-sm text-rose-600">{detailError}</p>
                      ) : null}
                      {detail ? (
                        <div className="space-y-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h4 className="break-words text-xl font-bold text-slate-950">{detail.name}</h4>
                              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                                {detailIsCheckpoint ? "checkpoint" : (detail.category ?? "other")} ·{" "}
                                {detail.baseModel ?? "unknown base model"} · source: Civitai
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

                          <div className="grid gap-3 md:grid-cols-4">
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Images</p>
                              <p className="mt-1 text-lg font-bold text-slate-900">{detail.importedImageCount}</p>
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
                                        <img
                                          alt={`Civitai image ${usage.importedImage.civitaiImageId}`}
                                          className="h-24 w-24 rounded-md object-cover"
                                          src={usage.importedImage.imageUrl}
                                        />
                                      ) : (
                                        <div className="flex h-24 w-24 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-400">
                                          Image
                                        </div>
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
                      ) : detailStatus !== "loading" ? (
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
