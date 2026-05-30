"use client";

import { Check, Eye, EyeOff, Loader2, Palette, Plus, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  ArtistStringCategoryCount,
  ArtistStringItemRecord,
  ArtistStringPlatformRecord,
} from "@/features/artist-string-library";
import { formatArtistStringForPlatform } from "@/features/artist-string-library/novelai-artist-string";
import type {
  CivitaiResourceListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { getCivitaiImageVariantUrl } from "@/features/civitai-lora-library/image-url";
import {
  parseCivitaiAiPromptResponse,
  selectedCivitaiResourceCards,
  type CivitaiAiPromptResult,
} from "@/features/editor/ai-prompt/civitai-ai-context";
import {
  STYLE_PALETTE_PROMPT_PRESETS,
  buildStylePaletteAdviceMessages,
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

type LoadStatus = "idle" | "loading" | "success" | "error";

type SelectedArtistStringsResponse = {
  items: ArtistStringItemRecord[];
};

type ArtistStringItemsResponse = {
  categories: ArtistStringCategoryCount[];
  items: ArtistStringItemRecord[];
  platforms: ArtistStringPlatformRecord[];
};

type CivitaiResourcesResponse = {
  items: CivitaiResourceListItem[];
};

type CivitaiPickerKind = "checkpoint" | "lora";

type StylePaletteAdviceState = {
  error: string;
  result: CivitaiAiPromptResult | null;
  status: LoadStatus;
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

function weightLabel(resource: SelectedCivitaiResourcePreview) {
  const recommendation = resource.recommendations.find((item) => item.loraWeight !== null);
  if (recommendation?.loraWeight !== null && recommendation?.loraWeight !== undefined) {
    return `recommended ${recommendation.loraWeight}`;
  }

  if (resource.averageWeight !== null) {
    return `average ${resource.averageWeight}`;
  }

  if (resource.minWeight !== null || resource.maxWeight !== null) {
    return `range ${resource.minWeight ?? "-"}-${resource.maxWeight ?? "-"}`;
  }

  return "reference weight";
}

function previewFromCivitaiListItem(resource: CivitaiResourceListItem): SelectedCivitaiResourcePreview | null {
  if (resource.resourceType !== "model" && resource.resourceType !== "lora") {
    return null;
  }

  return {
    id: resource.id,
    resourceType: resource.resourceType,
    name: resource.name,
    versionName: resource.versionName,
    baseModel: resource.baseModel,
    creator: resource.creator,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    descriptionSnippet: resource.description ? compact(resource.description, 240) : null,
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    recommendations: resource.recommendations,
    previewImage: resource.previewImage,
    modelFileName: resource.name,
  };
}

function normalizeBaseModel(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function sameBaseModel(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeBaseModel(left);
  const normalizedRight = normalizeBaseModel(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function AdviceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-400">none</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div className="rounded-md bg-white/70 px-2 py-1" key={index}>
            <AdviceValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    return (
      <div className="grid gap-2">
        {Object.entries(value)
          .filter(([, item]) => item !== null && item !== undefined && item !== "")
          .map(([key, item]) => (
            <div className="rounded-md bg-white/70 px-2 py-1" key={key}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{key}</p>
              <div className="mt-0.5 text-xs leading-relaxed text-slate-700">
                <AdviceValue value={item} />
              </div>
            </div>
          ))}
      </div>
    );
  }

  return <span>{typeof value === "number" ? Number(value.toFixed(3)).toString() : String(value)}</span>;
}

function CivitaiPickerResourceCard({
  active,
  onToggle,
  resource,
}: {
  active: boolean;
  onToggle: () => void;
  resource: CivitaiResourceListItem;
}) {
  const previewImage = resource.previewImage
    ? (getCivitaiImageVariantUrl(resource.previewImage, 256) ?? resource.previewImage)
    : null;
  const resourceLabel = resource.resourceType === "model" ? "Checkpoint" : "LoRA";

  return (
    <div
      className={`grid gap-2 rounded-md border p-2 sm:grid-cols-[52px_minmax(0,1fr)_auto] ${
        active ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex h-[52px] w-[52px] overflow-hidden rounded-md bg-slate-100">
        {previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${resource.name} preview`}
            className="h-full w-full object-cover"
            loading="lazy"
            src={previewImage}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            {resource.resourceType === "model" ? "CKPT" : "LoRA"}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
            {resourceLabel}
          </span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            {resource.baseModel ?? "unknown base"}
          </span>
          {resource.importedImageCount > 0 ? (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
              refs {resource.importedImageCount}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere]">
          {resource.name}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">
          {resource.versionName ?? "Unknown version"}
        </p>
        {resource.trainedWords.length > 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">
            {compact(resource.trainedWords.join(", "), 120)}
          </p>
        ) : null}
      </div>
      <Button
        className={`h-8 self-center rounded-md px-2 text-[11px] ${
          active
            ? "border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
        onClick={onToggle}
        size="sm"
        type="button"
      >
        {active ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
        {active ? "取消" : resource.resourceType === "model" ? "选择" : "添加"}
      </Button>
    </div>
  );
}

function ResourceCard({
  onRemove,
  resource,
}: {
  onRemove: () => void;
  resource: SelectedCivitaiResourcePreview;
}) {
  const previewImage = resource.previewImage
    ? (getCivitaiImageVariantUrl(resource.previewImage, 256) ?? resource.previewImage)
    : null;

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
      <div className="flex h-16 w-16 overflow-hidden rounded-md bg-slate-100">
        {previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`${resource.name} preview`} className="h-full w-full object-cover" src={previewImage} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            {resource.resourceType === "model" ? "CKPT" : "LoRA"}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
            {resource.resourceType === "model" ? "Checkpoint" : "LoRA"}
          </span>
          {resource.resourceType === "lora" ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              {weightLabel(resource)}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={resource.name}>
          {resource.name}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">{resource.versionName ?? resource.baseModel ?? "unknown version"}</p>
        {resource.trainedWords.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {resource.trainedWords.map((word) => (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600" key={word}>
                {word}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <Button
        aria-label={`Remove ${resource.resourceType === "model" ? "checkpoint" : "LoRA"} ${resource.name}`}
        className="h-8 justify-self-end rounded-md border border-rose-100 bg-white px-2 text-[11px] text-rose-700 hover:bg-rose-50"
        onClick={onRemove}
        size="sm"
        title="Remove selected resource"
        type="button"
        variant="secondary"
      >
        <X className="size-3.5" />
        Remove
      </Button>
    </div>
  );
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
  const [selectedCivitaiError, setSelectedCivitaiError] = useState("");
  const [selectedArtistStatus, setSelectedArtistStatus] = useState<LoadStatus>("idle");
  const [selectedArtistError, setSelectedArtistError] = useState("");
  const [advice, setAdvice] = useState<StylePaletteAdviceState>({
    error: "",
    result: null,
    status: "idle",
  });
  const [artistPickerOpen, setArtistPickerOpen] = useState(false);
  const [artistPickerCategory, setArtistPickerCategory] = useState("all");
  const [artistPickerQuery, setArtistPickerQuery] = useState("");
  const [artistPickerItems, setArtistPickerItems] = useState<ArtistStringItemRecord[]>([]);
  const [artistPickerCategories, setArtistPickerCategories] = useState<ArtistStringCategoryCount[]>([]);
  const [artistPickerStatus, setArtistPickerStatus] = useState<LoadStatus>("idle");
  const [artistPickerError, setArtistPickerError] = useState("");
  const [civitaiPickerOpen, setCivitaiPickerOpen] = useState(false);
  const [civitaiPickerKind, setCivitaiPickerKind] = useState<CivitaiPickerKind>("checkpoint");
  const [civitaiPickerQuery, setCivitaiPickerQuery] = useState("");
  const [civitaiPickerItems, setCivitaiPickerItems] = useState<CivitaiResourceListItem[]>([]);
  const [civitaiPickerStatus, setCivitaiPickerStatus] = useState<LoadStatus>("idle");
  const [civitaiPickerError, setCivitaiPickerError] = useState("");
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
  const selectedLoraIdSet = useMemo(() => new Set(selectedLoraIds), [selectedLoraIds]);
  const selectedResourceCards = useMemo(() => selectedCivitaiResourceCards(selectedResources), [selectedResources]);
  const selectedCheckpointBaseModel =
    selectedResources.checkpoint?.id === selectedCheckpointId ? (selectedResources.checkpoint.baseModel ?? null) : null;
  const storedArtistPrompts = project.settings.selectedArtistStringPrompts ?? [];
  const artistPrompts = selectedArtistStringIds.map((id, index) => {
    const item = selectedArtistStrings.find((entry) => entry.id === id);
    return storedArtistPrompts[index] ?? (item ? formatArtistPrompt(item, artistRenderMode) : "");
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
  const loraPickerMissingBaseModel =
    civitaiPickerKind === "lora" && Boolean(selectedCheckpointId) && !selectedCheckpointBaseModel;
  const visibleCivitaiPickerItems = civitaiPickerItems.filter((resource) => {
    if (civitaiPickerKind === "checkpoint") {
      return resource.resourceType === "model";
    }

    return (
      resource.resourceType === "lora" &&
      Boolean(selectedCheckpointBaseModel) &&
      sameBaseModel(resource.baseModel, selectedCheckpointBaseModel)
    );
  });

  function removeSceneArtistPrompt(prompt: string | null) {
    if (!prompt) {
      return;
    }

    for (const tagId of findSceneArtistPromptTagIds(project.scene.promptTags, prompt)) {
      removePromptTag({ kind: "scene" }, tagId);
    }
  }

  function handleArtistStringPromptRenderModeChange(nextMode: ArtistStringPromptRenderMode) {
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
  }

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

    const formattedPrompt = formatArtistPrompt(item, artistRenderMode);
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

  function openCivitaiPicker(kind: CivitaiPickerKind) {
    setCivitaiPickerKind(kind);
    setCivitaiPickerQuery("");
    setCivitaiPickerOpen((current) => (current && civitaiPickerKind === kind ? false : true));
  }

  function toggleArtistStringsMask() {
    setArtistStringsMasked((current) => !current);
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function toggleLorasMask() {
    setLorasMasked((current) => !current);
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function handleToggleCheckpoint(resource: CivitaiResourceListItem) {
    if (resource.resourceType !== "model") {
      return;
    }

    if (selectedCheckpointId === resource.id) {
      updateProjectSettings({
        selectedCivitaiCheckpointId: null,
        selectedCivitaiLoraIds: [],
      });
      setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
      setCivitaiPickerKind("checkpoint");
      setAdvice({ error: "", result: null, status: "idle" });
      return;
    }

    const checkpointPreview = previewFromCivitaiListItem(resource);
    const compatibleLoraIds = selectedResources.loras
      .filter((lora) => sameBaseModel(lora.baseModel, resource.baseModel))
      .map((lora) => lora.id);
    const compatibleLoras = selectedResources.loras.filter((lora) => compatibleLoraIds.includes(lora.id));

    updateProjectSettings({
      selectedCivitaiCheckpointId: resource.id,
      selectedCivitaiLoraIds: compatibleLoraIds,
    });
    if (checkpointPreview) {
      setSelectedResources({
        checkpoint: checkpointPreview,
        loras: compatibleLoras,
      });
    }
    setCivitaiPickerKind("lora");
    setCivitaiPickerOpen(true);
    setCivitaiPickerQuery("");
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function removeSelectedCivitaiResource(resource: SelectedCivitaiResourcePreview) {
    if (resource.resourceType === "model") {
      updateProjectSettings({
        selectedCivitaiCheckpointId: null,
        selectedCivitaiLoraIds: [],
      });
      setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
      setCivitaiPickerKind("checkpoint");
      setAdvice({ error: "", result: null, status: "idle" });
      return;
    }

    updateProjectSettings({
      selectedCivitaiLoraIds: selectedLoraIds.filter((id) => id !== resource.id),
    });
    setSelectedResources((current) => ({
      ...current,
      loras: current.loras.filter((lora) => lora.id !== resource.id),
    }));
    setAdvice({ error: "", result: null, status: "idle" });
  }

  function handleToggleLora(resource: CivitaiResourceListItem) {
    if (resource.resourceType !== "lora" || !selectedCheckpointBaseModel) {
      return;
    }

    if (!sameBaseModel(resource.baseModel, selectedCheckpointBaseModel)) {
      return;
    }

    const nextSelectedLoras = selectedLoraIdSet.has(resource.id)
      ? selectedLoraIds.filter((id) => id !== resource.id)
      : [...selectedLoraIds, resource.id];

    updateProjectSettings({
      selectedCivitaiLoraIds: nextSelectedLoras,
    });
    setSelectedResources((current) => {
      if (selectedLoraIdSet.has(resource.id)) {
        return {
          ...current,
          loras: current.loras.filter((lora) => lora.id !== resource.id),
        };
      }

      if (current.loras.some((lora) => lora.id === resource.id)) {
        return current;
      }

      const loraPreview = previewFromCivitaiListItem(resource);
      return loraPreview
        ? {
            ...current,
            loras: [...current.loras, loraPreview],
          }
        : current;
    });
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
        setSelectedCivitaiError("");
        return;
      }

      setSelectedCivitaiStatus("loading");
      setSelectedCivitaiError("");

      try {
        const payload = await fetchJson<SelectedCivitaiResourcesPreview>(
          `/api/civitai-lora-library/selected-resources?${civitaiQuery}`,
          { signal: controller.signal },
        );
        setSelectedResources(payload);
        setSelectedCivitaiStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setSelectedCivitaiStatus("error");
        setSelectedCivitaiError(error instanceof Error ? error.message : "Unable to load selected Civitai resources.");
      }
    }

    const timeout = window.setTimeout(() => {
      void loadSelectedCivitaiResources();
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, selectedCheckpointId, selectedLoraIdsKey]);

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

  useEffect(() => {
    if (!open || !civitaiPickerOpen) {
      return;
    }

    const controller = new AbortController();

    async function loadCivitaiPickerItems() {
      if (civitaiPickerKind === "lora" && !selectedCheckpointId) {
        setCivitaiPickerItems([]);
        setCivitaiPickerStatus("success");
        setCivitaiPickerError("");
        return;
      }

      if (civitaiPickerKind === "lora" && !selectedCheckpointBaseModel) {
        setCivitaiPickerItems([]);
        setCivitaiPickerStatus("success");
        setCivitaiPickerError("");
        return;
      }

      setCivitaiPickerStatus("loading");
      setCivitaiPickerError("");

      try {
        const params = new URLSearchParams();
        params.set("resourceType", civitaiPickerKind === "checkpoint" ? "model" : "lora");
        params.set("nsfw", "all");
        params.set("importedCount", "all");
        if (civitaiPickerKind === "lora" && selectedCheckpointBaseModel) {
          params.set("baseModel", selectedCheckpointBaseModel);
        }
        if (civitaiPickerQuery.trim()) {
          params.set("query", civitaiPickerQuery.trim());
        }

        const payload = await fetchJson<CivitaiResourcesResponse>(`/api/civitai-lora-library/resources?${params.toString()}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setCivitaiPickerItems(payload.items);
        setCivitaiPickerStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setCivitaiPickerItems([]);
        setCivitaiPickerStatus("error");
        setCivitaiPickerError(error instanceof Error ? error.message : "Unable to load Civitai resources.");
      }
    }

    const timeout = window.setTimeout(() => {
      void loadCivitaiPickerItems();
    }, 160);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    civitaiPickerKind,
    civitaiPickerOpen,
    civitaiPickerQuery,
    open,
    selectedCheckpointBaseModel,
    selectedCheckpointId,
  ]);

  async function generateAdvice() {
    if (!selectedResources.checkpoint) {
      setAdvice({
        error: "Please select a Civitai checkpoint before generating style advice.",
        result: null,
        status: "error",
      });
      return;
    }

    setAdvice({ error: "", result: null, status: "loading" });

    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "stable-diffusion-prompt-generation",
          messages: buildStylePaletteAdviceMessages({
            artistPrompts: effectiveArtistPrompts,
            preset,
            resources: effectiveSelectedResources,
          }),
          temperature: 0.25,
          maxTokens: 900,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        throw new Error("AI style advice returned an invalid response.");
      }

      setAdvice({
        error: "",
        result: parseCivitaiAiPromptResponse(payload.content),
        status: "success",
      });
    } catch (error) {
      setAdvice({
        error: error instanceof Error ? error.message : "AI style advice failed.",
        result: null,
        status: "error",
      });
    }
  }

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
        <div className="self-start rounded-md border border-teal-100 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700">AI Style Advice</p>
            <Button
              className="h-8 rounded-md bg-teal-600 px-3 text-xs text-white hover:bg-teal-700 disabled:opacity-60"
              disabled={advice.status === "loading" || (selectedCivitaiStatus === "loading" && !selectedResources.checkpoint)}
              onClick={() => void generateAdvice()}
              size="sm"
              type="button"
            >
              {advice.status === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Generate
            </Button>
          </div>
          {advice.status === "error" && advice.error ? (
            <p className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
              {advice.error}
            </p>
          ) : null}
          {advice.result ? (
            <div className="mt-3 max-h-[min(46vh,360px)] space-y-3 overflow-y-auto rounded-md border border-teal-100 bg-teal-50/60 p-3 pr-2 text-xs">
              {advice.result.parseWarning ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 leading-relaxed text-amber-800">{advice.result.parseWarning}</p>
              ) : null}
              {advice.result.parameterSuggestionReason ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Reason</p>
                  <p className="mt-1 leading-relaxed text-slate-700">{advice.result.parameterSuggestionReason}</p>
                </div>
              ) : null}
              {advice.result.overallEffect ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Overall Effect</p>
                  <p className="mt-1 leading-relaxed text-slate-700">{advice.result.overallEffect}</p>
                </div>
              ) : null}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Parameters</p>
                <div className="mt-1">
                  <AdviceValue value={advice.result.parameterSuggestions} />
                </div>
              </div>
            </div>
          ) : advice.status === "loading" ? (
            <p className="mt-3 rounded-md bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-700">
              <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
              Generating style-only parameter advice...
            </p>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Advice uses only the selected artist strings and Civitai resources, not the canvas prompt.
            </p>
          )}
        </div>
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
                快捷选择
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
                {artistStringsMasked ? "恢复 Artist Strings" : "屏蔽 Artist Strings"}
              </Button>
              <select
                aria-label="选择画师串 Prompt 格式"
                className="h-8 max-w-[190px] rounded-md border border-fuchsia-100 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  selectedArtistStatus === "error" ||
                  selectedArtistStrings.length !== selectedArtistStringIds.length
                }
                onChange={(event) =>
                  handleArtistStringPromptRenderModeChange(event.target.value as ArtistStringPromptRenderMode)
                }
                title="选择添加到 Prompt 的画师串格式"
                value={artistRenderMode}
              >
                {ARTIST_STRING_PROMPT_RENDER_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {artistStringsMasked ? (
            <p className="mb-2 rounded-md border border-fuchsia-100 bg-fuchsia-50 px-3 py-2 text-xs leading-relaxed text-fuchsia-700">
              Artist Strings 已临时屏蔽：锁定 positive、AI 建议和 ComfyUI 生图暂时不会使用画师串。
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
                    placeholder="搜索序号、画师、分类或 Prompt"
                    value={artistPickerQuery}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100"
                  onChange={(event) => setArtistPickerCategory(event.target.value)}
                  value={artistPickerCategory}
                >
                  <option value="all">全部分类</option>
                  {artistPickerCategories.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name} ({entry.count})
                    </option>
                  ))}
                </select>
              </div>
              {artistPickerStatus === "success" ? (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  显示 {artistPickerItems.length} 个可选画师串
                </p>
              ) : null}
              <div className="mt-3 grid max-h-[min(45vh,560px)] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto overscroll-contain pr-1">
                {artistPickerStatus === "loading" ? (
                  <p className="col-span-full rounded-md bg-fuchsia-50 px-3 py-2 text-xs leading-relaxed text-fuchsia-700">
                    <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                    正在读取画师串...
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
                            已选
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
                          {active ? "取消" : "添加"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {artistPickerStatus === "success" && artistPickerItems.length === 0 ? (
                  <p className="col-span-full rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                    当前筛选没有匹配的画师串。
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
                const prompt = storedArtistPrompts[index] ?? formatArtistPrompt(item, artistRenderMode);
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected Civitai Resources</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-8 rounded-md border-indigo-100 bg-white px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                onClick={() => openCivitaiPicker("checkpoint")}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Search className="size-3.5" />
                选择 Checkpoint
              </Button>
              <Button
                className="h-8 rounded-md border-indigo-100 bg-white px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedCheckpointId}
                onClick={() => openCivitaiPicker("lora")}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Search className="size-3.5" />
                选择 LoRA
              </Button>
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
                {lorasMasked ? "恢复 LoRA" : "屏蔽 LoRA"}
              </Button>
            </div>
          </div>
          {lorasMasked ? (
            <p className="mb-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700">
              LoRA 已临时屏蔽：锁定 positive、AI 建议和 ComfyUI 生图暂时不会使用任何 LoRA 或触发词。
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
          {civitaiPickerOpen ? (
            <div className="rounded-md border border-indigo-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                    {civitaiPickerKind === "checkpoint" ? "Checkpoint Quick Select" : "LoRA Quick Select"}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {civitaiPickerKind === "checkpoint"
                      ? "先选择 checkpoint；切换 checkpoint 会保留相同 base model 的已选 LoRA。"
                      : selectedCheckpointBaseModel
                        ? `仅显示 base model 为 ${selectedCheckpointBaseModel} 的 LoRA。`
                        : "请先选择带 base model 的 checkpoint。"}
                  </p>
                </div>
                <div className="flex rounded-md border border-indigo-100 bg-indigo-50 p-0.5">
                  <button
                    className={`h-7 rounded px-2 text-[11px] font-medium ${
                      civitaiPickerKind === "checkpoint" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"
                    }`}
                    onClick={() => {
                      setCivitaiPickerKind("checkpoint");
                      setCivitaiPickerQuery("");
                    }}
                    type="button"
                  >
                    Checkpoint
                  </button>
                  <button
                    className={`h-7 rounded px-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                      civitaiPickerKind === "lora" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"
                    }`}
                    disabled={!selectedCheckpointId}
                    onClick={() => {
                      setCivitaiPickerKind("lora");
                      setCivitaiPickerQuery("");
                    }}
                    type="button"
                  >
                    LoRA
                  </button>
                </div>
              </div>
              <div className="relative mt-3 min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  onChange={(event) => setCivitaiPickerQuery(event.target.value)}
                  placeholder={
                    civitaiPickerKind === "checkpoint"
                      ? "搜索 checkpoint 名称、版本、作者或 base model"
                      : "搜索 LoRA 名称、触发词、版本或作者"
                  }
                  value={civitaiPickerQuery}
                />
              </div>
              {civitaiPickerStatus === "success" ? (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  显示 {visibleCivitaiPickerItems.length} 个可选
                  {civitaiPickerKind === "checkpoint" ? " checkpoint" : " LoRA"}
                </p>
              ) : null}
              <div className="mt-3 min-h-[min(45vh,520px)] max-h-[min(45vh,520px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                {civitaiPickerStatus === "loading" && visibleCivitaiPickerItems.length === 0 ? (
                  <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700">
                    <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                    正在读取 Civitai 资源...
                  </p>
                ) : null}
                {civitaiPickerStatus === "error" && civitaiPickerError ? (
                  <p className="rounded-md bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
                    {civitaiPickerError}
                  </p>
                ) : null}
                {civitaiPickerKind === "lora" && !selectedCheckpointId ? (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                    请先选择 checkpoint，再选择同 base model 的 LoRA。
                  </p>
                ) : null}
                {loraPickerMissingBaseModel ? (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                    Selected checkpoint has no base model metadata. Choose a checkpoint with a base model before selecting LoRA resources.
                  </p>
                ) : null}
                {visibleCivitaiPickerItems.map((resource) => (
                  <CivitaiPickerResourceCard
                    active={
                      resource.resourceType === "model"
                        ? selectedCheckpointId === resource.id
                        : selectedLoraIdSet.has(resource.id)
                    }
                    key={resource.id}
                    onToggle={() =>
                      resource.resourceType === "model"
                        ? handleToggleCheckpoint(resource)
                        : handleToggleLora(resource)
                    }
                    resource={resource}
                  />
                ))}
                {civitaiPickerStatus === "success" &&
                visibleCivitaiPickerItems.length === 0 &&
                selectedCheckpointId &&
                (civitaiPickerKind !== "lora" || Boolean(selectedCheckpointBaseModel)) ? (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                    当前筛选没有匹配的 Civitai 资源。
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="space-y-2 rounded-md border border-indigo-100 bg-indigo-50/50 p-3">
            {selectedCivitaiStatus === "loading" && selectedResourceCards.length === 0 ? (
              <p className="text-xs leading-relaxed text-indigo-700">
                <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                Loading selected resources...
              </p>
            ) : null}
            {selectedCivitaiStatus === "error" && selectedCivitaiError ? (
              <p className="text-xs leading-relaxed text-rose-700">{selectedCivitaiError}</p>
            ) : null}
            {selectedResourceCards.length > 0 ? (
              selectedResourceCards.map((resource) => (
                <div className={lorasMasked && resource.resourceType === "lora" ? "opacity-50" : ""} key={resource.id}>
                  <ResourceCard
                    onRemove={() => removeSelectedCivitaiResource(resource)}
                    resource={resource}
                  />
                </div>
              ))
            ) : selectedCivitaiStatus !== "loading" ? (
              <p className="text-xs leading-relaxed text-slate-500">No Civitai resources selected.</p>
            ) : null}
          </div>
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
          <h2 className="text-[13px] font-semibold text-slate-900">风格调色板</h2>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            用固定预设 prompt 测试当前画师串、checkpoint 与 LoRA 的画风表现。
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
        打开风格调色板
      </Button>
      <ComfyUiGenerationDialog
        activePrompt={stylePaletteActivePrompt}
        advice={advice.result}
        allowDiagnosis
        allowControlNet={false}
        allowInpaint={false}
        baseNegativePrompt={preset.negative}
        diagnosisScopes={{ parameters: true, prompt: false }}
        description="使用固定预设 prompt 初始化风格测试；Active Prompt 可临时编辑，Locked Positive 不会被改写。"
        introContent={introContent}
        onSaveParameters={(parameters) => updateProjectSettings({ savedComfyUiGenerationParams: parameters })}
        onClose={() => setOpen(false)}
        open={open}
        promptRefreshKey={stylePalettePromptRefreshKey}
        savedParameters={savedParameters}
        selectedCheckpointId={selectedCheckpointId}
        selectedLoraIds={effectiveSelectedLoraIds}
        title="风格调色板"
      />
    </section>
  );
}
