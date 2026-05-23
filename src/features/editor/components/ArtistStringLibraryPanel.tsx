"use client";

import {
  Check,
  Copy,
  Database,
  ExternalLink,
  ImageIcon,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type {
  ArtistStringCategoryCount,
  ArtistStringItemRecord,
  ArtistStringPlatformRecord,
  ArtistStringSyncResult,
} from "@/features/artist-string-library";
import { formatArtistStringForPlatform } from "@/features/artist-string-library/novelai-artist-string";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { ArtistStringPromptRenderMode, PromptTag } from "@/shared/types";

type LoadStatus = "idle" | "loading" | "success" | "error";

type ArtistStringItemsResponse = {
  platforms: ArtistStringPlatformRecord[];
  categories: ArtistStringCategoryCount[];
  items: ArtistStringItemRecord[];
};

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

function createPromptTagId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSequence(value: number) {
  return String(value).padStart(3, "0");
}

function formatArtistPrompt(item: ArtistStringItemRecord, renderMode: ArtistStringPromptRenderMode) {
  return formatArtistStringForPlatform(item.structuredArtistString, item.promptFormat, { renderMode });
}

function makePromptTag(item: ArtistStringItemRecord, renderMode: ArtistStringPromptRenderMode): PromptTag {
  return {
    id: createPromptTagId("artist-string"),
    label: `NAI ${formatSequence(item.sourceSequence)} / ${item.categoryName}`,
    prompt: formatArtistPrompt(item, renderMode),
    category: "style",
    subcategory: "style-rendering",
    weight: { enabled: false, value: 1 },
  };
}

function findSceneArtistPromptTagIds(tags: PromptTag[], prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return [];
  }

  return tags
    .filter(
      (tag) =>
        /^NAI \d{3} \//.test(tag.label) &&
        tag.category === "style" &&
        tag.subcategory === "style-rendering" &&
        !tag.negative &&
        tag.prompt.trim() === normalizedPrompt,
    )
    .map((tag) => tag.id);
}

function snippet(value: string, max = 180) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function formatSyncTime(value: string) {
  if (!value) {
    return "未同步";
  }

  return new Date(value).toLocaleString();
}

export function ArtistStringLibraryPanel() {
  const project = useEditorStore((state) => state.project);
  const addPromptTag = useEditorStore((state) => state.addPromptTag);
  const removePromptTag = useEditorStore((state) => state.removePromptTag);
  const updateProjectSettings = useEditorStore((state) => state.updateProjectSettings);
  const [open, setOpen] = useState(false);
  const [platforms, setPlatforms] = useState<ArtistStringPlatformRecord[]>([]);
  const [categories, setCategories] = useState<ArtistStringCategoryCount[]>([]);
  const [items, setItems] = useState<ArtistStringItemRecord[]>([]);
  const [platformId, setPlatformId] = useState("nai_bot_artists_gallery");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState("");
  const [syncStatus, setSyncStatus] = useState<LoadStatus>("idle");
  const [syncError, setSyncError] = useState("");
  const [syncResult, setSyncResult] = useState<ArtistStringSyncResult | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);

  const selectedPlatform = useMemo(
    () => platforms.find((platform) => platform.id === platformId) ?? null,
    [platformId, platforms],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null,
    [items, selectedItemId],
  );
  const artistPromptRenderMode = project.settings.artistStringPromptRenderMode ?? "artist-weight";
  const selectedFormattedPrompt = selectedItem ? formatArtistPrompt(selectedItem, artistPromptRenderMode) : "";
  const selectedByPrompt = selectedItem ? formatArtistPrompt(selectedItem, "by-weight") : "";
  const activeArtistStringIdSet = useMemo(
    () => new Set(project.settings.selectedArtistStringIds ?? []),
    [project.settings.selectedArtistStringIds],
  );
  const syncedCount = categories.reduce((sum, entry) => sum + entry.count, 0);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoadStatus("loading");
    setLoadError("");
    const params = new URLSearchParams();
    params.set("platformId", platformId);
    params.set("category", category);
    if (query.trim()) {
      params.set("query", query.trim());
    }

    try {
      const payload = await fetchJson<ArtistStringItemsResponse>(
        `/api/artist-string-library/items?${params.toString()}`,
        { signal },
      );
      setPlatforms(payload.platforms);
      setCategories(payload.categories);
      setItems(payload.items);
      setSelectedItemId((current) =>
        current && payload.items.some((item) => item.id === current) ? current : (payload.items[0]?.id ?? null),
      );
      setLoadStatus("success");
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "无法读取画师串库。");
    }
  }, [category, platformId, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadItems(controller.signal), 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadItems, open]);

  async function handleSync() {
    setSyncStatus("loading");
    setSyncError("");
    setSyncResult(null);
    try {
      const result = await fetchJson<ArtistStringSyncResult>("/api/artist-string-library/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformId }),
      });
      setSyncResult(result);
      setSyncStatus("success");
      await loadItems();
    } catch (error) {
      setSyncStatus("error");
      setSyncError(error instanceof Error ? error.message : "同步画师串库失败。");
    }
  }

  function removeSceneArtistPrompt(prompt: string | null) {
    if (!prompt) {
      return;
    }

    for (const tagId of findSceneArtistPromptTagIds(project.scene.promptTags, prompt)) {
      removePromptTag({ kind: "scene" }, tagId);
    }
  }

  function removeArtistStringSelection(itemId: string, prompt: string) {
    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const selectedPrompts = project.settings.selectedArtistStringPrompts ?? [];
    const removedIndex = selectedIds.indexOf(itemId);
    const nextIds = selectedIds.filter((id) => id !== itemId);
    const nextPrompts =
      removedIndex >= 0
        ? selectedPrompts.filter((_, index) => index !== removedIndex)
        : selectedPrompts.filter((entry) => entry.trim() !== prompt.trim());

    updateProjectSettings({
      selectedArtistStringIds: nextIds,
      selectedArtistStringPrompts: nextPrompts,
    });
  }

  function handleToggleSceneSelection(item: ArtistStringItemRecord) {
    const formattedPrompt = formatArtistPrompt(item, artistPromptRenderMode);
    if (!formattedPrompt) {
      return;
    }

    if (activeArtistStringIdSet.has(item.id)) {
      const selectedIds = project.settings.selectedArtistStringIds ?? [];
      const existingPrompt = project.settings.selectedArtistStringPrompts?.[selectedIds.indexOf(item.id)] ?? formattedPrompt;
      removeSceneArtistPrompt(existingPrompt);
      removeArtistStringSelection(item.id, existingPrompt);
      setLastAddedId(null);
      return;
    }

    addPromptTag({ kind: "scene" }, makePromptTag(item, artistPromptRenderMode));
    updateProjectSettings({
      selectedArtistStringIds: [...(project.settings.selectedArtistStringIds ?? []), item.id],
      selectedArtistStringPrompts: [...(project.settings.selectedArtistStringPrompts ?? []), formattedPrompt],
    });
    setLastAddedId(item.id);
    window.setTimeout(() => setLastAddedId((current) => (current === item.id ? null : current)), 1200);
  }

  async function handleCopy(item: ArtistStringItemRecord) {
    await navigator.clipboard?.writeText(
      formatArtistPrompt(item, artistPromptRenderMode),
    );
    setLastCopiedId(item.id);
    window.setTimeout(() => setLastCopiedId((current) => (current === item.id ? null : current)), 1200);
  }

  return (
    <section className="space-y-3 rounded-md border border-fuchsia-100 bg-fuchsia-50/70 p-3">
      <div className="flex items-start gap-2.5">
        <div className="rounded-md bg-white p-1.5 text-fuchsia-600 shadow-sm">
          <Palette className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-slate-900">画师串库</h2>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            按平台收藏结构化画师串，并缓存降分辨率参考图。
          </p>
        </div>
      </div>
      <Button
        className="h-9 w-full rounded-md bg-fuchsia-600 text-xs text-white hover:bg-fuchsia-700"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
      >
        <Database className="size-4" />
        打开画师串库
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-2 backdrop-blur-sm sm:p-4"
              role="dialog"
            >
              <div className="flex h-[96vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
                <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-slate-100 bg-white p-4 sm:gap-4 sm:p-5">
                  <div className="rounded-md bg-fuchsia-50 p-2 text-fuchsia-600">
                    <Palette className="size-5" />
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <h3 className="text-lg font-bold text-slate-950">画师串库</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      画师串先按平台格式解析成结构化数据，添加到 Prompt 时再由对应 formatter 渲染。参考图仅保存本地降分辨率 WebP。
                    </p>
                  </div>
                  {selectedPlatform?.sourceUrl ? (
                    <a
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      href={selectedPlatform.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink className="size-4" />
                      来源
                    </a>
                  ) : null}
                  <button
                    aria-label="关闭画师串库"
                    className="ml-auto shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 sm:ml-0"
                    onClick={() => setOpen(false)}
                    type="button"
                  >
                    <X className="size-5" />
                  </button>
                </header>

                <div className="shrink-0 border-b border-slate-100 bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[220px_220px_minmax(280px,1fr)_auto]">
                    <select
                      className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100"
                      onChange={(event) => {
                        setPlatformId(event.target.value);
                        setCategory("all");
                        setSelectedItemId(null);
                      }}
                      value={platformId}
                    >
                      {(platforms.length > 0
                        ? platforms
                        : [{ id: "nai_bot_artists_gallery", name: "nai-bot 300 artists gallery" }]
                      ).map((platform) => (
                        <option key={platform.id} value={platform.id}>
                          {platform.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100"
                      onChange={(event) => {
                        setCategory(event.target.value);
                        setSelectedItemId(null);
                      }}
                      value={category}
                    >
                      <option value="all">全部分类</option>
                      {categories.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.name} ({entry.count})
                        </option>
                      ))}
                    </select>
                    <div className="relative min-w-0 sm:col-span-2 xl:col-span-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <input
                        className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100"
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索序号、画师、分类或格式化 Prompt"
                        value={query}
                      />
                    </div>
                    <Button
                      className="h-10 rounded-md bg-fuchsia-600 px-4 text-xs text-white hover:bg-fuchsia-700 disabled:opacity-60 sm:col-span-2 xl:col-span-1"
                      disabled={syncStatus === "loading"}
                      onClick={() => void handleSync()}
                      size="sm"
                      type="button"
                    >
                      {syncStatus === "loading" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      同步平台
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                    <p>
                      已同步 {syncedCount} 条 · 最近同步 {formatSyncTime(selectedPlatform?.syncedAt ?? "")}
                      {selectedPlatform?.sourceUpdatedAtText ? ` · 来源更新时间 ${selectedPlatform.sourceUpdatedAtText}` : ""}
                    </p>
                    {syncStatus === "success" && syncResult ? (
                      <p className="text-emerald-700">
                        同步 {syncResult.itemCount} 条，图片 {syncResult.cachedImageCount}/{syncResult.imageCount}
                      </p>
                    ) : null}
                    {syncStatus === "error" ? <p className="text-rose-600">{syncError}</p> : null}
                    {loadStatus === "error" ? <p className="text-rose-600">{loadError}</p> : null}
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-rows-[minmax(260px,42vh)_minmax(0,1fr)] overflow-hidden xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] xl:grid-rows-none">
                  <aside className="min-h-0 border-b border-slate-100 bg-slate-50 xl:border-b-0 xl:border-r">
                    <div className="flex h-full flex-col">
                      <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          画师串列表
                        </p>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
                        {loadStatus === "loading" ? (
                          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                            <Loader2 className="size-3.5 animate-spin" />
                            正在读取画师串...
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          {items.map((item) => {
                            const formattedPrompt = formatArtistPrompt(item, artistPromptRenderMode);
                            const previewImage = item.referenceImages.find((image) => image.localUrl)?.localUrl;
                            const selected = selectedItem?.id === item.id;
                            const active = activeArtistStringIdSet.has(item.id);

                            return (
                              <button
                                className={`grid w-full grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-md border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 sm:grid-cols-[64px_minmax(0,1fr)] ${
                                  selected || active
                                    ? "border-fuchsia-200 bg-fuchsia-50"
                                    : "border-slate-200 bg-white hover:border-fuchsia-200 hover:bg-fuchsia-50/60"
                                }`}
                                key={item.id}
                                onClick={() => setSelectedItemId(item.id)}
                                type="button"
                              >
                                <div className="flex h-14 w-14 overflow-hidden rounded-md bg-slate-100 sm:h-16 sm:w-16">
                                  {previewImage ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      alt={`${formatSequence(item.sourceSequence)} reference`}
                                      className="h-full w-full object-cover"
                                      decoding="async"
                                      loading="lazy"
                                      src={previewImage}
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                                      <ImageIcon className="size-4" />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700">
                                      NAI {formatSequence(item.sourceSequence)}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                      {item.categoryName}
                                    </span>
                                    {active ? (
                                      <span className="rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700">
                                        已选
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">
                                    {snippet(formattedPrompt, 96)}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {loadStatus === "success" && items.length === 0 ? (
                          <p className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs leading-relaxed text-slate-500">
                            当前筛选没有匹配的画师串。若尚未同步，请点击“同步平台”。
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </aside>

                  <section className="min-h-0 min-w-0 overflow-y-auto p-4 [scrollbar-gutter:stable] sm:p-5">
                    {selectedItem ? (
                      <div className="space-y-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-fuchsia-50 px-2 py-1 text-xs font-semibold text-fuchsia-700">
                                NAI {formatSequence(selectedItem.sourceSequence)}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                                {selectedItem.categoryName}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                                {selectedItem.promptFormat}
                              </span>
                              {selectedItem.parseStatus !== "parsed" ? (
                                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">
                                  {selectedItem.parseStatus}
                                </span>
                              ) : null}
                            </div>
                            <h4 className="mt-2 text-base font-bold text-slate-950">
                              画师串 {formatSequence(selectedItem.sourceSequence)}
                            </h4>
                            {selectedItem.parseError ? (
                              <p className="mt-1 text-xs leading-relaxed text-amber-700">{selectedItem.parseError}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="h-9 rounded-md border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
                              onClick={() => void handleCopy(selectedItem)}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              {lastCopiedId === selectedItem.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                              复制
                            </Button>
                            <Button
                              className={`h-9 rounded-md px-3 text-xs ${
                                activeArtistStringIdSet.has(selectedItem.id)
                                  ? "border border-fuchsia-200 bg-white text-fuchsia-700 hover:bg-fuchsia-50"
                                  : "bg-fuchsia-600 text-white hover:bg-fuchsia-700"
                              }`}
                              disabled={!selectedFormattedPrompt}
                              onClick={() => handleToggleSceneSelection(selectedItem)}
                              size="sm"
                              type="button"
                            >
                              {activeArtistStringIdSet.has(selectedItem.id) || lastAddedId === selectedItem.id ? (
                                <Check className="size-4" />
                              ) : (
                                <Plus className="size-4" />
                              )}
                              {activeArtistStringIdSet.has(selectedItem.id) ? "取消选中" : "添加到场景 Prompt"}
                            </Button>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Reference Images
                          </p>
                          <div className="grid gap-3 md:grid-cols-3">
                            {selectedItem.referenceImages.length > 0 ? (
                              selectedItem.referenceImages.map((image) => (
                                <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50" key={image.id}>
                                  <div className="aspect-square bg-slate-100">
                                    {image.localUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        alt={image.alt ?? image.role}
                                        className="h-full w-full object-cover"
                                        decoding="async"
                                        loading="lazy"
                                        src={image.localUrl}
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                                        <ImageIcon className="size-5" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="px-3 py-2 text-xs text-slate-600">{image.role}</div>
                                </div>
                              ))
                            ) : (
                              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                                暂无参考图。
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-3">
                          <div>
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                              Artist Prompt
                            </p>
                            <textarea
                              className="min-h-44 w-full resize-y rounded-md border border-fuchsia-100 bg-fuchsia-50/60 p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none"
                              readOnly
                              value={selectedFormattedPrompt}
                            />
                          </div>
                          <div>
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                              By Prompt
                            </p>
                            <textarea
                              className="min-h-44 w-full resize-y rounded-md border border-fuchsia-100 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none"
                              readOnly
                              value={selectedByPrompt}
                            />
                          </div>
                          <div>
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                              Raw Source
                            </p>
                            <textarea
                              className="min-h-44 w-full resize-y rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700 outline-none"
                              readOnly
                              value={selectedItem.rawArtistString}
                            />
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Structured AST
                          </p>
                          <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                            {JSON.stringify(selectedItem.structuredArtistString, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-96 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-500">
                        选择一个画师串查看结构化数据与参考图。
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
