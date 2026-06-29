"use client";

import { Check, Eye, EyeOff, Loader2, Palette, Plus, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  ArtistStringCategoryCount,
  ArtistStringItemRecord,
  ArtistStringPlatformRecord,
} from "@/features/artist-string-library";
import { formatArtistStringForPlatform } from "@/features/artist-string-library/novelai-artist-string";
import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import {
  STYLE_PALETTE_PROMPT_PRESETS,
  buildStylePaletteActivePrompt,
  buildStylePalettePositivePrompt,
  buildStylePaletteSubjectDanbooruMessages,
  getStylePalettePromptPreset,
  normalizeStylePaletteSubjectPrompt,
} from "@/features/editor/ai-prompt/style-palette-prompts";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import type { ArtistStringPromptRenderMode, PromptTag, SceneForgeProject } from "@/shared/types";

import { ComfyUiGenerationDialog } from "./ImageGenerationPanel";
import {
  EMPTY_STYLE_PALETTE_ADVICE,
  StylePaletteAiAdvicePanel,
  type StylePaletteAdviceState,
} from "./StylePaletteAiAdvicePanel";
import { StylePaletteCivitaiResourceSelector } from "./StylePaletteCivitaiResourceSelector";

type LoadStatus = "idle" | "loading" | "success" | "error";

type SelectedArtistStringsResponse = {
  items: ArtistStringItemRecord[];
};

type ArtistStringItemsResponse = {
  categories: ArtistStringCategoryCount[];
  items: ArtistStringItemRecord[];
  platforms: ArtistStringPlatformRecord[];
};

const EMPTY_SELECTED_CIVITAI_RESOURCES: SelectedCivitaiResourcesPreview = {
  checkpoint: null,
  loras: [],
};

const ARTIST_STRING_PROMPT_RENDER_MODE_OPTIONS: Array<{
  value: ArtistStringPromptRenderMode;
  label: string;
}> = [
  { value: "artist-weight", label: "(artist:name:weight)" },
  { value: "anima", label: "@artist (:weight)" },
  { value: "by-weight", label: "by name:weight" },
  { value: "novelai", label: "NovelAI" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  return fallback;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.statusText || "Request failed."));
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

function formatArtistPrompt(item: ArtistStringItemRecord, renderMode: ArtistStringPromptRenderMode) {
  return formatArtistStringForPlatform(item.structuredArtistString, item.promptFormat, { renderMode });
}

function isAnimaStylePaletteBaseModel(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() === "anima";
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

function makeSelectedArtistPromptTag(item: ArtistStringItemRecord, prompt: string): PromptTag {
  return {
    id: createPromptTagId("artist-string"),
    label: `NAI ${formatSequence(item.sourceSequence)} / ${item.categoryName}`,
    prompt,
    category: "style",
    subcategory: "style-rendering",
    weight: { enabled: false, value: 1 },
  };
}

function findSceneArtistPromptTagIds(tags: SceneForgeProject["scene"]["promptTags"], prompt: string) {
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

function compact(value: string, max = 180) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function ArtistStringCard({
  item,
  onRemove,
  prompt,
}: {
  item: ArtistStringItemRecord;
  onRemove: () => void;
  prompt: string;
}) {
  const previewImage = item.referenceImages.find((image) => image.localUrl)?.localUrl ?? null;

  return (
    <div className="grid gap-3 rounded-md border border-fuchsia-100 bg-white p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
      <div className="flex h-16 w-16 overflow-hidden rounded-md bg-slate-100">
        {previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`NAI ${formatSequence(item.sourceSequence)} reference`} className="h-full w-full object-cover" src={previewImage} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">NAI</div>
        )}
      </div>
      <div className="min-w-0">
        <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700">
          NAI {formatSequence(item.sourceSequence)} / {item.categoryName}
        </span>
        <p className="mt-2 text-xs leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
          {compact(prompt, 150)}
        </p>
      </div>
      <Button
        aria-label={`Remove artist string NAI ${formatSequence(item.sourceSequence)}`}
        className="h-8 justify-self-end rounded-md border border-rose-100 bg-white px-2 text-[11px] text-rose-700 hover:bg-rose-50"
        onClick={onRemove}
        size="sm"
        title="Remove selected artist string"
        type="button"
        variant="secondary"
      >
        <X className="size-3.5" />
        Remove
      </Button>
    </div>
  );
}

export function StylePalettePanel() {
  const project = useEditorStore((state) => state.project);
  const updateProjectSettings = useEditorStore((state) => state.updateProjectSettings);
  const addPromptTag = useEditorStore((state) => state.addPromptTag);
  const removePromptTag = useEditorStore((state) => state.removePromptTag);
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState<string>(STYLE_PALETTE_PROMPT_PRESETS[0].id);
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_CIVITAI_RESOURCES);
  const [selectedArtistStrings, setSelectedArtistStrings] = useState<ArtistStringItemRecord[]>([]);
  const [selectedCivitaiStatus, setSelectedCivitaiStatus] = useState<LoadStatus>("idle");
  const [selectedArtistStatus, setSelectedArtistStatus] = useState<LoadStatus>("idle");
  const [selectedArtistError, setSelectedArtistError] = useState("");
  const [advice, setAdvice] = useState<StylePaletteAdviceState>(EMPTY_STYLE_PALETTE_ADVICE);
  const [artistPickerOpen, setArtistPickerOpen] = useState(false);
  const [artistPickerCategory, setArtistPickerCategory] = useState("all");
  const [artistPickerQuery, setArtistPickerQuery] = useState("");
  const [artistPickerItems, setArtistPickerItems] = useState<ArtistStringItemRecord[]>([]);
  const [artistPickerCategories, setArtistPickerCategories] = useState<ArtistStringCategoryCount[]>([]);
  const [artistPickerStatus, setArtistPickerStatus] = useState<LoadStatus>("idle");
  const [artistPickerError, setArtistPickerError] = useState("");
  const [artistStringsMasked, setArtistStringsMasked] = useState(false);
  const [lorasMasked, setLorasMasked] = useState(false);
  const [subjectInput, setSubjectInput] = useState("");
  const [subjectConversionStatus, setSubjectConversionStatus] = useState<LoadStatus>("idle");
  const [subjectConversionError, setSubjectConversionError] = useState("");
  const subjectConversionRequestIdRef = useRef(0);
  const subjectInputRef = useRef("");
  const selectedCheckpointId = project.settings.selectedCivitaiCheckpointId;
  const selectedLoraIds = useMemo(
    () => project.settings.selectedCivitaiLoraIds ?? [],
    [project.settings.selectedCivitaiLoraIds],
  );
  const selectedArtistStringIds = useMemo(
    () => project.settings.selectedArtistStringIds ?? [],
    [project.settings.selectedArtistStringIds],
  );
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const selectedArtistStringIdsKey = selectedArtistStringIds.join(",");
  const artistRenderMode = project.settings.artistStringPromptRenderMode ?? "artist-weight";
  const savedParameters = project.settings.savedComfyUiGenerationParams ?? null;
  const preset = getStylePalettePromptPreset(presetId);
  const selectedArtistStringIdSet = useMemo(() => new Set(selectedArtistStringIds), [selectedArtistStringIds]);
  const selectedCheckpointBaseModel =
    selectedResources.checkpoint?.id === selectedCheckpointId ? (selectedResources.checkpoint.baseModel ?? null) : null;
  const animaPromptContext = isAnimaStylePaletteBaseModel(selectedCheckpointBaseModel);
  const effectiveArtistRenderMode: ArtistStringPromptRenderMode = animaPromptContext
    ? "anima"
    : artistRenderMode === "anima"
      ? "artist-weight"
      : artistRenderMode;
  const visibleArtistRenderModeOptions = animaPromptContext
    ? ARTIST_STRING_PROMPT_RENDER_MODE_OPTIONS.filter((option) => option.value === "anima")
    : ARTIST_STRING_PROMPT_RENDER_MODE_OPTIONS.filter((option) => option.value !== "anima");
  const storedArtistPrompts = project.settings.selectedArtistStringPrompts ?? [];
  const artistPrompts = selectedArtistStringIds.map((id, index) => {
    const item = selectedArtistStrings.find((entry) => entry.id === id);
    return artistRenderMode === effectiveArtistRenderMode
      ? storedArtistPrompts[index] ?? (item ? formatArtistPrompt(item, effectiveArtistRenderMode) : "")
      : item
        ? formatArtistPrompt(item, effectiveArtistRenderMode)
        : "";
  }).filter((prompt) => prompt.trim());
  const effectiveArtistPrompts = artistStringsMasked ? [] : artistPrompts;
  const effectiveSelectedResources = useMemo<SelectedCivitaiResourcesPreview>(
    () => ({
      checkpoint: selectedResources.checkpoint,
      loras: lorasMasked ? [] : selectedResources.loras,
    }),
    [lorasMasked, selectedResources],
  );
  const effectiveSelectedLoraIds = lorasMasked ? [] : selectedLoraIds;
  const positivePrompt = buildStylePalettePositivePrompt({
    artistPrompts: effectiveArtistPrompts,
    preset,
    resources: effectiveSelectedResources,
  });
  const stylePaletteActivePrompt = buildStylePaletteActivePrompt({
    stylePrompt: positivePrompt,
    subjectPrompt: subjectInput,
  });
  const stylePalettePromptRefreshKey = [
    preset.id,
    preset.negative,
    stylePaletteActivePrompt,
    selectedCheckpointId ?? "",
    selectedLoraIdsKey,
    selectedArtistStringIdsKey,
    artistStringsMasked ? "artist-strings-masked" : "artist-strings-visible",
    lorasMasked ? "loras-masked" : "loras-visible",
    advice.result ? JSON.stringify(advice.result) : "",
  ].join("\u0000");

  const removeSceneArtistPrompt = useCallback((prompt: string | null) => {
    if (!prompt) {
      return;
    }

    for (const tagId of findSceneArtistPromptTagIds(project.scene.promptTags, prompt)) {
      removePromptTag({ kind: "scene" }, tagId);
    }
  }, [project.scene.promptTags, removePromptTag]);

  const handleArtistStringPromptRenderModeChange = useCallback((nextMode: ArtistStringPromptRenderMode) => {
    if (nextMode === artistRenderMode) {
      return;
    }

    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const selectedPrompts = project.settings.selectedArtistStringPrompts ?? [];
    const itemById = new Map(selectedArtistStrings.map((item) => [item.id, item]));
    const currentPrompts = selectedIds.map((id, index) => {
      const item = itemById.get(id);
      return selectedPrompts[index] ?? (item ? formatArtistPrompt(item, artistRenderMode) : "");
    });
    const nextPrompts = selectedIds.map((id, index) => {
      const item = itemById.get(id);
      return item ? formatArtistPrompt(item, nextMode) : (selectedPrompts[index] ?? "");
    });

    for (const prompt of new Set(currentPrompts.filter((prompt) => prompt.trim()))) {
      removeSceneArtistPrompt(prompt);
    }

    for (const id of selectedIds) {
      const item = itemById.get(id);
      if (!item) {
        continue;
      }

      const prompt = formatArtistPrompt(item, nextMode);
      if (prompt.trim()) {
        addPromptTag({ kind: "scene" }, makeSelectedArtistPromptTag(item, prompt));
      }
    }

    updateProjectSettings({
      artistStringPromptRenderMode: nextMode,
      selectedArtistStringPrompts: nextPrompts,
    });
    setAdvice({ error: "", result: null, status: "idle" });
  }, [
    addPromptTag,
    artistRenderMode,
    project.settings.selectedArtistStringIds,
    project.settings.selectedArtistStringPrompts,
    removeSceneArtistPrompt,
    selectedArtistStrings,
    updateProjectSettings,
  ]);

  useEffect(() => {
    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const loadedSelectedArtistIds = new Set(selectedArtistStrings.map((item) => item.id));
    const loadedSelectedArtists = selectedIds.every((id) => loadedSelectedArtistIds.has(id));
    if (effectiveArtistRenderMode !== artistRenderMode && loadedSelectedArtists) {
      const timeoutId = window.setTimeout(() => {
        handleArtistStringPromptRenderModeChange(effectiveArtistRenderMode);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [
    artistRenderMode,
    effectiveArtistRenderMode,
    handleArtistStringPromptRenderModeChange,
    project.settings.selectedArtistStringIds,
    selectedArtistStrings,
  ]);

  function removeArtistStringSelection(item: ArtistStringItemRecord) {
    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const selectedPrompts = project.settings.selectedArtistStringPrompts ?? [];
    const removedIndex = selectedIds.indexOf(item.id);

    if (removedIndex === -1) {
      return;
    }

    const existingPrompt = selectedPrompts[removedIndex] ?? formatArtistPrompt(item, artistRenderMode);
    const nextIds = selectedIds.filter((id) => id !== item.id);
    const nextPrompts = selectedPrompts.filter((_, index) => index !== removedIndex);

    if (!nextPrompts.some((prompt) => prompt.trim() === existingPrompt.trim())) {
      removeSceneArtistPrompt(existingPrompt);
    }

    updateProjectSettings({
      selectedArtistStringIds: nextIds,
      selectedArtistStringPrompts: nextPrompts,
    });
    setSelectedArtistStrings((current) => current.filter((entry) => entry.id !== item.id));
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function handleToggleArtistStringSelection(item: ArtistStringItemRecord) {
    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const selectedPrompts = project.settings.selectedArtistStringPrompts ?? [];

    if (selectedIds.includes(item.id)) {
      removeArtistStringSelection(item);
      return;
    }

    const formattedPrompt = formatArtistPrompt(item, effectiveArtistRenderMode);
    if (!formattedPrompt.trim()) {
      return;
    }

    addPromptTag({ kind: "scene" }, makeSelectedArtistPromptTag(item, formattedPrompt));
    updateProjectSettings({
      selectedArtistStringIds: [...selectedIds, item.id],
      selectedArtistStringPrompts: [...selectedPrompts, formattedPrompt],
    });
    setSelectedArtistStrings((current) => (current.some((entry) => entry.id === item.id) ? current : [...current, item]));
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function toggleArtistStringsMask() {
    setArtistStringsMasked((current) => !current);
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function toggleLorasMask() {
    setLorasMasked((current) => !current);
    setAdvice({ error: "", result: null, status: "idle" });
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();

    async function loadSelectedCivitaiResources() {
      const loraIds = selectedLoraIdsKey ? selectedLoraIdsKey.split(",").filter(Boolean) : [];
      const civitaiQuery = buildSelectedCivitaiResourcesQuery(selectedCheckpointId, loraIds);

      if (!civitaiQuery) {
        setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
        setSelectedCivitaiStatus("success");
        return;
      }

      setSelectedCivitaiStatus("loading");

      try {
        const payload = await fetchJson<SelectedCivitaiResourcesPreview>(
          `/api/civitai-lora-library/selected-resources?${civitaiQuery}`,
          { signal: controller.signal },
        );
        const compatibleLoraIds = payload.loras.map((lora) => lora.id);
        if (
          compatibleLoraIds.length !== loraIds.length ||
          compatibleLoraIds.some((id, index) => id !== loraIds[index])
        ) {
          updateProjectSettings({ selectedCivitaiLoraIds: compatibleLoraIds });
        }
        setSelectedResources(payload);
        setSelectedCivitaiStatus("success");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
        setSelectedCivitaiStatus("error");
      }
    }

    const timeout = window.setTimeout(() => {
      void loadSelectedCivitaiResources();
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, selectedCheckpointId, selectedLoraIdsKey, updateProjectSettings]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();

    async function loadSelectedArtistStrings() {
      const artistStringIds = selectedArtistStringIdsKey ? selectedArtistStringIdsKey.split(",").filter(Boolean) : [];

      if (artistStringIds.length === 0) {
        setSelectedArtistStrings([]);
        setSelectedArtistStatus("success");
        setSelectedArtistError("");
        return;
      }

      setSelectedArtistStatus("loading");
      setSelectedArtistError("");

      try {
        const payload = await fetchJson<SelectedArtistStringsResponse>(
          `/api/artist-string-library/selected-resources?ids=${encodeURIComponent(artistStringIds.join(","))}`,
          { signal: controller.signal },
        );
        setSelectedArtistStrings(payload.items);
        setSelectedArtistStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setSelectedArtistStatus("error");
        setSelectedArtistError(error instanceof Error ? error.message : "Unable to load selected artist strings.");
      }
    }

    const timeout = window.setTimeout(() => {
      void loadSelectedArtistStrings();
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, selectedArtistStringIdsKey]);

  useEffect(() => {
    if (!open || !artistPickerOpen) {
      return;
    }

    const controller = new AbortController();

    async function loadArtistPickerItems() {
      setArtistPickerStatus("loading");
      setArtistPickerError("");

      try {
        const params = new URLSearchParams();
        params.set("platformId", "nai_bot_artists_gallery");
        params.set("category", artistPickerCategory);
        if (artistPickerQuery.trim()) {
          params.set("query", artistPickerQuery.trim());
        }

        const payload = await fetchJson<ArtistStringItemsResponse>(`/api/artist-string-library/items?${params.toString()}`, {
          signal: controller.signal,
        });
        setArtistPickerCategories(payload.categories);
        setArtistPickerItems(payload.items);
        setArtistPickerStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setArtistPickerItems([]);
        setArtistPickerStatus("error");
        setArtistPickerError(error instanceof Error ? error.message : "Unable to load artist strings.");
      }
    }

    const timeout = window.setTimeout(() => {
      void loadArtistPickerItems();
    }, 160);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [artistPickerCategory, artistPickerOpen, artistPickerQuery, open]);

  function handleSubjectInputChange(value: string) {
    subjectInputRef.current = value;
    setSubjectInput(value);
    setSubjectConversionError("");
    if (subjectConversionStatus !== "loading") {
      setSubjectConversionStatus("idle");
    }
  }

  async function convertSubjectToDanbooru() {
    const subject = subjectInput.trim();
    if (!subject || subjectConversionStatus === "loading") {
      return;
    }

    setSubjectConversionStatus("loading");
    setSubjectConversionError("");
    const requestId = subjectConversionRequestIdRef.current + 1;
    subjectConversionRequestIdRef.current = requestId;

    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "stable-diffusion-prompt-generation",
          messages: buildStylePaletteSubjectDanbooruMessages({ subject }),
          temperature: 0.1,
          maxTokens: 120,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI subject conversion returned an invalid response.");
      }

      const convertedSubject = normalizeStylePaletteSubjectPrompt(payload.content);
      if (!convertedSubject) {
        throw new Error("AI subject conversion did not return usable Danbooru tags.");
      }

      if (subjectConversionRequestIdRef.current !== requestId || subjectInputRef.current.trim() !== subject) {
        setSubjectConversionStatus("idle");
        return;
      }

      subjectInputRef.current = convertedSubject;
      setSubjectInput(convertedSubject);
      setSubjectConversionStatus("success");
    } catch (error) {
      if (subjectConversionRequestIdRef.current !== requestId || subjectInputRef.current.trim() !== subject) {
        setSubjectConversionStatus("idle");
        return;
      }

      setSubjectConversionStatus("error");
      setSubjectConversionError(error instanceof Error ? error.message : "AI subject conversion failed.");
    }
  }

  const introContent = (
    <div className="space-y-5">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_270px] md:items-start">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Style Prompt Preset</p>
              <p className="mt-1 max-w-[64ch] text-xs leading-relaxed text-slate-500">{preset.description}</p>
            </div>
            <select
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 md:justify-self-end"
              onChange={(event) => setPresetId(event.target.value)}
              value={presetId}
            >
              {STYLE_PALETTE_PROMPT_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-teal-100 bg-teal-50/70 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-teal-700">Locked Positive</p>
              <p className="text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{positivePrompt}</p>
            </div>
            <div className="rounded-md border border-rose-100 bg-rose-50/70 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-rose-700">Locked Negative</p>
              <p className="text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{preset.negative}</p>
            </div>
          </div>
        </div>
        <StylePaletteAiAdvicePanel
          advice={advice}
          artistPrompts={effectiveArtistPrompts}
          disabled={selectedCivitaiStatus === "loading" && !selectedResources.checkpoint}
          onAdviceChange={setAdvice}
          preset={preset}
          resources={effectiveSelectedResources}
        />
      </div>
      <div className="rounded-md border border-sky-100 bg-sky-50/70 p-3">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Subject Input</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Object or subject slot prepended to the generated style palette prompt.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            aria-label="Subject Input"
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            onChange={(event) => handleSubjectInputChange(event.target.value)}
            placeholder="e.g. hatsune_miku, mechanical_dragon, ornate_sword"
            value={subjectInput}
          />
          <Button
            aria-label="Convert subject to Danbooru tags"
            className="h-9 rounded-md bg-sky-600 px-3 text-xs text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!subjectInput.trim() || subjectConversionStatus === "loading"}
            onClick={() => void convertSubjectToDanbooru()}
            size="sm"
            type="button"
          >
            {subjectConversionStatus === "loading" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Danbooru
          </Button>
        </div>
        {subjectConversionStatus === "error" && subjectConversionError ? (
          <p className="mt-2 rounded-md border border-rose-100 bg-white px-3 py-2 text-xs leading-relaxed text-rose-700">
            {subjectConversionError}
          </p>
        ) : null}
        {subjectConversionStatus === "success" ? (
          <p className="mt-2 text-xs leading-relaxed text-sky-700">Subject tags updated.</p>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected Artist Strings</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-8 rounded-md border-fuchsia-100 bg-white px-2 text-[11px] font-medium text-fuchsia-700 hover:bg-fuchsia-50"
                onClick={() => setArtistPickerOpen((current) => !current)}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Search className="size-3.5" />
                Quick Select
              </Button>
              <Button
                className={`h-8 rounded-md px-2 text-[11px] font-medium ${
                  artistStringsMasked
                    ? "border border-fuchsia-200 bg-fuchsia-600 text-white hover:bg-fuchsia-700"
                    : "border-fuchsia-100 bg-white text-fuchsia-700 hover:bg-fuchsia-50"
                }`}
                onClick={toggleArtistStringsMask}
                size="sm"
                type="button"
                variant={artistStringsMasked ? "primary" : "secondary"}
              >
                {artistStringsMasked ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                {artistStringsMasked ? "Restore Artist Strings" : "Mask Artist Strings"}
              </Button>
              <select
                aria-label="Select artist string prompt format"
                className="h-8 max-w-[190px] rounded-md border border-fuchsia-100 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  selectedArtistStatus === "error" ||
                  selectedArtistStrings.length !== selectedArtistStringIds.length
                }
                onChange={(event) =>
                  handleArtistStringPromptRenderModeChange(event.target.value as ArtistStringPromptRenderMode)
                }
                title="Select the artist string format added to prompts"
                value={effectiveArtistRenderMode}
              >
                {visibleArtistRenderModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {artistStringsMasked ? (
            <p className="mb-2 rounded-md border border-fuchsia-100 bg-fuchsia-50 px-3 py-2 text-xs leading-relaxed text-fuchsia-700">
              Artist strings are temporarily masked from the locked positive prompt, AI advice, and ComfyUI style test.
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
          {artistPickerOpen ? (
            <div className="rounded-md border border-fuchsia-100 bg-white p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100"
                    onChange={(event) => setArtistPickerQuery(event.target.value)}
                    placeholder="Search sequence, artist, category, or prompt"
                    value={artistPickerQuery}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100"
                  onChange={(event) => setArtistPickerCategory(event.target.value)}
                  value={artistPickerCategory}
                >
                  <option value="all">All categories</option>
                  {artistPickerCategories.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name} ({entry.count})
                    </option>
                  ))}
                </select>
              </div>
              {artistPickerStatus === "success" ? (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Showing {artistPickerItems.length} available artist strings.
                </p>
              ) : null}
              <div className="mt-3 grid max-h-[min(45vh,560px)] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto overscroll-contain pr-1">
                {artistPickerStatus === "loading" ? (
                  <p className="col-span-full rounded-md bg-fuchsia-50 px-3 py-2 text-xs leading-relaxed text-fuchsia-700">
                    <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                    Loading artist strings...
                  </p>
                ) : null}
                {artistPickerStatus === "error" && artistPickerError ? (
                  <p className="col-span-full rounded-md bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
                    {artistPickerError}
                  </p>
                ) : null}
                {artistPickerItems.map((item) => {
                  const active = selectedArtistStringIdSet.has(item.id);
                  const previewImage = item.referenceImages.find((image) => image.localUrl)?.localUrl ?? null;

                  return (
                    <div
                      className={`overflow-hidden rounded-md border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        active ? "border-fuchsia-300 bg-fuchsia-50" : "border-slate-200 bg-white"
                      }`}
                      key={item.id}
                    >
                      <div className="relative aspect-[4/5] bg-slate-50">
                        {previewImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`NAI ${formatSequence(item.sourceSequence)} reference`}
                            className="h-full w-full object-contain p-1"
                            loading="lazy"
                            src={previewImage}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">NAI</div>
                        )}
                        {active ? (
                          <span className="absolute right-2 top-2 rounded-full bg-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-2 border-t border-slate-100 p-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700">
                            NAI {formatSequence(item.sourceSequence)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {item.categoryName}
                          </span>
                        </div>
                        <Button
                          className={`h-8 w-full rounded-md px-2 text-[11px] ${
                            active
                              ? "border border-fuchsia-200 bg-white text-fuchsia-700 hover:bg-fuchsia-50"
                              : "bg-fuchsia-600 text-white hover:bg-fuchsia-700"
                          }`}
                          onClick={() => handleToggleArtistStringSelection(item)}
                          size="sm"
                          type="button"
                        >
                          {active ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                          {active ? "Remove" : "Add"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {artistPickerStatus === "success" && artistPickerItems.length === 0 ? (
                  <p className="col-span-full rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                    No artist strings match the current filters.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className={`space-y-2 rounded-md border border-fuchsia-100 bg-fuchsia-50/50 p-3 ${artistStringsMasked ? "opacity-60" : ""}`}>
            {selectedArtistStatus === "error" && selectedArtistError ? (
              <p className="text-xs leading-relaxed text-rose-700">{selectedArtistError}</p>
            ) : null}
            {selectedArtistStrings.length > 0 ? (
              selectedArtistStrings.map((item) => {
                const index = selectedArtistStringIds.indexOf(item.id);
                const prompt = artistRenderMode === effectiveArtistRenderMode
                  ? storedArtistPrompts[index] ?? formatArtistPrompt(item, effectiveArtistRenderMode)
                  : formatArtistPrompt(item, effectiveArtistRenderMode);
                return (
                  <ArtistStringCard
                    item={item}
                    key={item.id}
                    onRemove={() => removeArtistStringSelection(item)}
                    prompt={prompt}
                  />
                );
              })
            ) : (
              <p className="text-xs leading-relaxed text-slate-500">No artist strings selected.</p>
            )}
          </div>
          </div>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            <Button
              className={`h-8 rounded-md px-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                lorasMasked
                  ? "border border-indigo-200 bg-indigo-600 text-white hover:bg-indigo-700"
                  : "border-indigo-100 bg-white text-indigo-700 hover:bg-indigo-50"
              }`}
              disabled={selectedLoraIds.length === 0}
              onClick={toggleLorasMask}
              size="sm"
              type="button"
              variant={lorasMasked ? "primary" : "secondary"}
            >
              {lorasMasked ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {lorasMasked ? "Restore LoRA" : "Mask LoRA"}
            </Button>
          </div>
          {lorasMasked ? (
            <p className="mb-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700">
              LoRAs are temporarily masked from the locked positive prompt, AI advice, and ComfyUI style test.
            </p>
          ) : null}
          <div className={lorasMasked ? "opacity-60" : ""}>
            <StylePaletteCivitaiResourceSelector
              onSelectionChange={(selection) => {
                updateProjectSettings({
                  selectedCivitaiCheckpointId: selection.checkpointId,
                  selectedCivitaiLoraIds: selection.loraIds,
                });
                setAdvice({ error: "", result: null, status: "idle" });
              }}
              selectedCheckpointId={selectedCheckpointId}
              selectedLoraIds={selectedLoraIds}
            />
          </div>
      </div>
    </div>
    </div>
  );

  return (
    <section className="space-y-3 rounded-md border border-teal-100 bg-teal-50/70 p-3">
      <div className="flex items-start gap-2.5">
        <div className="rounded-md bg-white p-1.5 text-teal-600 shadow-sm">
          <Palette className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-slate-900">Style Palette</h2>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            Test the current artist strings, checkpoint, and LoRAs with a fixed style prompt.
          </p>
        </div>
      </div>
      <Button
        className="h-9 w-full rounded-md bg-teal-600 text-xs text-white hover:bg-teal-700"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
      >
        <Sparkles className="size-4" />
        Open Style Palette
      </Button>
      <ComfyUiGenerationDialog
        activePrompt={stylePaletteActivePrompt}
        advice={advice.result}
        allowDiagnosis
        allowControlNet={false}
        allowInpaint={false}
        baseNegativePrompt={preset.negative}
        diagnosisScopes={{ parameters: true, prompt: false }}
        description="Initialize style tests with a fixed preset prompt. Active Prompt can be edited temporarily; Locked Positive is not rewritten."
        introContent={introContent}
        onSaveParameters={(parameters) => updateProjectSettings({ savedComfyUiGenerationParams: parameters })}
        onClose={() => setOpen(false)}
        open={open}
        promptRefreshKey={stylePalettePromptRefreshKey}
        savedParameters={savedParameters}
        selectedCheckpointId={selectedCheckpointId}
        selectedLoraIds={effectiveSelectedLoraIds}
        title="Style Palette"
      />
    </section>
  );
}
