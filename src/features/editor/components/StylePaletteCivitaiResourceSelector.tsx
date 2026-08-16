"use client";

import { Check, ImageIcon, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  CivitaiImageResourceSelectionResult,
  CivitaiResourceListItem,
  ImportedImageListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { getCivitaiImageVariantUrl } from "@/features/civitai-lora-library/image-url";
import {
  getCivitaiModelStorageKind,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library/resource-files";
import { selectedCivitaiResourceCards } from "@/features/editor/ai-prompt/civitai-ai-context";
import type { PromptProfileId } from "@/shared/prompt-profile";

type LoadStatus = "idle" | "loading" | "success" | "error";
type CivitaiPickerKind = "checkpoint" | "lora";
type CivitaiPickerMode = "image" | "resource";

type CivitaiResourcesResponse = {
  items: CivitaiResourceListItem[];
};

export type StylePaletteCivitaiResourceSelection = {
  checkpointId: string | null;
  loraIds: string[];
};

export type StylePaletteCivitaiResourceSelectorProps = {
  disabled?: boolean;
  enableImageSelection?: boolean;
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
  onSelectionChange: (selection: StylePaletteCivitaiResourceSelection) => void;
  onSelectedResourcesChange?: (resources: SelectedCivitaiResourcesPreview) => void;
  pickerLayout?: "inline" | "dialog";
  promptProfile?: PromptProfileId;
  readyOnly?: boolean;
  summaryDensity?: "default" | "compact";
  summaryLayout?: "stack" | "run-grid";
};

const EMPTY_SELECTED_CIVITAI_RESOURCES: SelectedCivitaiResourcesPreview = {
  checkpoint: null,
  loras: [],
};

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

function isCivitaiImageResourceSelectionResult(value: unknown): value is CivitaiImageResourceSelectionResult {
  if (
    !isRecord(value) ||
    typeof value.checkpointId !== "string" ||
    !value.checkpointId.trim() ||
    !Array.isArray(value.loraIds) ||
    !value.loraIds.every((id) => typeof id === "string" && Boolean(id.trim())) ||
    new Set(value.loraIds).size !== value.loraIds.length ||
    !Array.isArray(value.warnings)
  ) {
    return false;
  }

  return value.warnings.every((entry) => (
      isRecord(entry) &&
      typeof entry.resourceId === "string" &&
      typeof entry.resourceName === "string" &&
      (entry.reason === "base_model_mismatch" || entry.reason === "duplicate_usage" || entry.reason === "not_ready") &&
      typeof entry.message === "string"
  ));
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
    modelFileName: makeCivitaiResourceTargetFileName(resource),
    ...(resource.resourceType === "model" ? { modelStorageKind: getCivitaiModelStorageKind(resource) } : {}),
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
        {active ? "Remove" : resource.resourceType === "model" ? "Select" : "Add"}
      </Button>
    </div>
  );
}

function ImportedImageThumbnail({ image }: { image: ImportedImageListItem }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  if (!image.imageUrl || failedImageUrl === image.imageUrl) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 text-slate-400">
        <ImageIcon className="size-8" />
        <span className="sr-only">Image preview unavailable</span>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`Civitai image ${image.civitaiImageId}`}
        className="h-full w-full object-contain"
        decoding="async"
        loading="lazy"
        onError={() => setFailedImageUrl(image.imageUrl)}
        src={image.imageUrl}
      />
    </div>
  );
}

function CivitaiPickerImageCard({
  disabled,
  image,
  onSelect,
  resolving,
}: {
  disabled: boolean;
  image: ImportedImageListItem;
  onSelect: () => void;
  resolving: boolean;
}) {
  return (
    <button
      className="overflow-hidden rounded-md border border-slate-200 bg-white text-left transition hover:border-indigo-200 hover:bg-indigo-50/30 disabled:cursor-wait disabled:opacity-70"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <ImportedImageThumbnail image={image} />
      <div className="space-y-1.5 p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold text-slate-900">Image #{image.civitaiImageId}</p>
          {resolving ? <Loader2 className="size-3.5 shrink-0 animate-spin text-indigo-600" /> : null}
        </div>
        <p className="truncate text-[11px] text-slate-500">{image.baseModel ?? "unknown base model"}</p>
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
            {image.loraCount} LoRA
          </span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {image.checkpointCount} checkpoint
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
            image.nsfw ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}>
            {image.nsfw ? `NSFW${image.nsfwLevel === null ? "" : ` ${image.nsfwLevel}`}` : "SFW / unknown"}
          </span>
        </div>
      </div>
    </button>
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
        <p className="mt-0.5 text-[11px] text-slate-500">
          {resource.versionName ?? resource.baseModel ?? "unknown version"}
        </p>
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

function CompactResourceRow({
  density,
  onRemove,
  resource,
}: {
  density: "default" | "compact";
  onRemove: () => void;
  resource: SelectedCivitaiResourcePreview;
}) {
  const previewImage = resource.previewImage
    ? (getCivitaiImageVariantUrl(resource.previewImage, 160) ?? resource.previewImage)
    : null;
  const trainedWords = resource.trainedWords.slice(0, 4);
  const compact = density === "compact";

  return (
    <div
      className={`grid items-center rounded-md border border-slate-200 bg-white ${
        compact
          ? "min-h-9 grid-cols-[28px_minmax(0,1fr)_28px] gap-1.5 px-1.5 py-1"
          : "min-h-10 grid-cols-[32px_minmax(0,1fr)_32px] gap-2 px-2 py-1.5"
      }`}
    >
      <div className={`flex overflow-hidden rounded-md bg-slate-100 ${compact ? "size-7" : "size-8"}`}>
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
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
            {resource.resourceType === "model" ? "Checkpoint" : "LoRA"}
          </span>
          {resource.resourceType === "lora" ? (
            <span className="hidden shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 sm:inline">
              {weightLabel(resource)}
            </span>
          ) : null}
          <p className={`min-w-0 truncate font-semibold text-slate-900 ${compact ? "text-xs" : "text-sm"}`} title={resource.name}>
            {resource.name}
          </p>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-[10px] text-slate-500">
          <span className="shrink-0 truncate">{resource.versionName ?? resource.baseModel ?? "unknown version"}</span>
          {trainedWords.slice(0, 2).map((word) => (
            <span className="shrink-0 rounded-full bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600" key={word}>
              {word}
            </span>
          ))}
          {resource.trainedWords.length > 2 ? (
            <span className="shrink-0 text-[10px] text-slate-400">+{resource.trainedWords.length - 2}</span>
          ) : null}
        </div>
      </div>
      <Button
        aria-label={`Remove ${resource.resourceType === "model" ? "checkpoint" : "LoRA"} ${resource.name}`}
        className={`${compact ? "size-6" : "size-7"} rounded-md border border-rose-100 bg-white p-0 text-rose-700 hover:bg-rose-50`}
        onClick={onRemove}
        size="sm"
        title="Remove selected resource"
        type="button"
        variant="secondary"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

export function StylePaletteCivitaiResourceSelector({
  disabled = false,
  enableImageSelection = false,
  onSelectionChange,
  onSelectedResourcesChange,
  pickerLayout = "inline",
  promptProfile,
  readyOnly = false,
  selectedCheckpointId,
  selectedLoraIds,
  summaryDensity = "default",
  summaryLayout = "stack",
}: StylePaletteCivitaiResourceSelectorProps) {
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_CIVITAI_RESOURCES);
  const [selectedCivitaiStatus, setSelectedCivitaiStatus] = useState<LoadStatus>("idle");
  const [selectedCivitaiError, setSelectedCivitaiError] = useState("");
  const [civitaiPickerOpen, setCivitaiPickerOpen] = useState(false);
  const [civitaiPickerMode, setCivitaiPickerMode] = useState<CivitaiPickerMode>("resource");
  const [civitaiPickerKind, setCivitaiPickerKind] = useState<CivitaiPickerKind>("checkpoint");
  const [civitaiPickerQuery, setCivitaiPickerQuery] = useState("");
  const [civitaiPickerItems, setCivitaiPickerItems] = useState<CivitaiResourceListItem[]>([]);
  const [civitaiPickerStatus, setCivitaiPickerStatus] = useState<LoadStatus>("idle");
  const [civitaiPickerError, setCivitaiPickerError] = useState("");
  const [civitaiPickerImages, setCivitaiPickerImages] = useState<ImportedImageListItem[]>([]);
  const [civitaiPickerImagesContextKey, setCivitaiPickerImagesContextKey] = useState("");
  const [civitaiImagePickerStatus, setCivitaiImagePickerStatus] = useState<LoadStatus>("idle");
  const [civitaiImagePickerError, setCivitaiImagePickerError] = useState("");
  const [civitaiImagePickerFeedback, setCivitaiImagePickerFeedback] = useState("");
  const [civitaiImagePickerWarnings, setCivitaiImagePickerWarnings] = useState<string[]>([]);
  const [civitaiImagePickerRetryKey, setCivitaiImagePickerRetryKey] = useState(0);
  const [resolvingCivitaiImage, setResolvingCivitaiImage] = useState<{
    contextKey: string;
    imageId: string;
  } | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectedResourcesChangeRef = useRef(onSelectedResourcesChange);
  const imageSelectionAbortControllerRef = useRef<AbortController | null>(null);
  const imageSelectionRequestIdRef = useRef(0);
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const selectedLoraIdSet = useMemo(() => new Set(selectedLoraIds), [selectedLoraIds]);
  const selectedResourceCards = useMemo(() => selectedCivitaiResourceCards(selectedResources), [selectedResources]);
  const compactSelectedResources = pickerLayout === "dialog";
  const denseSelectedResources = compactSelectedResources && summaryDensity === "compact";
  const runSummaryGrid = compactSelectedResources && summaryLayout === "run-grid";
  const selectedCheckpointBaseModel =
    selectedResources.checkpoint?.id === selectedCheckpointId ? (selectedResources.checkpoint.baseModel ?? null) : null;
  const imagePickerAvailable = Boolean(
    enableImageSelection && selectedCheckpointId && selectedCheckpointBaseModel?.trim(),
  );
  const imageSelectionContextKey = imagePickerAvailable
    ? `${selectedCheckpointId}\u0000${normalizeBaseModel(selectedCheckpointBaseModel)}`
    : "";
  const imageSelectionContextKeyRef = useRef(imageSelectionContextKey);
  const imagePickerActive = imagePickerAvailable && civitaiPickerMode === "image";
  const visibleCivitaiPickerImages = civitaiPickerImagesContextKey === imageSelectionContextKey
    ? civitaiPickerImages
    : [];
  const visibleCivitaiImagePickerStatus = civitaiPickerImagesContextKey === imageSelectionContextKey
    ? civitaiImagePickerStatus
    : "loading";
  const resolvingCivitaiImageId = resolvingCivitaiImage?.contextKey === imageSelectionContextKey
    ? resolvingCivitaiImage.imageId
    : null;
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

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    onSelectedResourcesChangeRef.current = onSelectedResourcesChange;
  }, [onSelectedResourcesChange]);

  useLayoutEffect(() => {
    const contextChanged = imageSelectionContextKeyRef.current !== imageSelectionContextKey;
    imageSelectionContextKeyRef.current = imageSelectionContextKey;
    if (contextChanged) {
      imageSelectionRequestIdRef.current += 1;
      imageSelectionAbortControllerRef.current?.abort();
      imageSelectionAbortControllerRef.current = null;
      setResolvingCivitaiImage(null);
    }
  }, [imageSelectionContextKey]);

  useEffect(() => () => {
    imageSelectionRequestIdRef.current += 1;
    imageSelectionAbortControllerRef.current?.abort();
    imageSelectionAbortControllerRef.current = null;
  }, []);

  function openCivitaiPicker(kind: CivitaiPickerKind) {
    if (disabled) {
      return;
    }

    setCivitaiPickerMode("resource");
    setCivitaiPickerKind(kind);
    setCivitaiPickerQuery("");
    setCivitaiPickerOpen((current) => (current && civitaiPickerKind === kind ? false : true));
  }

  function openCivitaiImagePicker() {
    if (disabled || !imagePickerAvailable) {
      return;
    }

    setCivitaiPickerMode("image");
    setCivitaiPickerQuery("");
    setCivitaiImagePickerError("");
    setCivitaiImagePickerFeedback("");
    setCivitaiImagePickerWarnings([]);
    setCivitaiPickerOpen((current) => (current && civitaiPickerMode === "image" ? false : true));
  }

  async function handleSelectCivitaiImage(image: ImportedImageListItem) {
    if (
      disabled ||
      !imagePickerAvailable ||
      !selectedCheckpointId ||
      !selectedCheckpointBaseModel ||
      resolvingCivitaiImageId
    ) {
      return;
    }

    const requestContextKey = imageSelectionContextKey;
    const requestCheckpointId = selectedCheckpointId;
    const requestCheckpointBaseModel = selectedCheckpointBaseModel;
    const requestId = imageSelectionRequestIdRef.current + 1;
    const controller = new AbortController();
    imageSelectionAbortControllerRef.current?.abort();
    imageSelectionAbortControllerRef.current = controller;
    imageSelectionRequestIdRef.current = requestId;
    setResolvingCivitaiImage({ contextKey: requestContextKey, imageId: image.id });
    setCivitaiImagePickerError("");
    setCivitaiImagePickerFeedback("");
    setCivitaiImagePickerWarnings([]);

    try {
      const payload: unknown = await fetchJson<unknown>(
        `/api/civitai-lora-library/imported-images/${encodeURIComponent(image.id)}/resource-selection?checkpointId=${encodeURIComponent(requestCheckpointId)}&checkpointBaseModel=${encodeURIComponent(requestCheckpointBaseModel)}`,
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        imageSelectionAbortControllerRef.current !== controller ||
        imageSelectionRequestIdRef.current !== requestId ||
        imageSelectionContextKeyRef.current !== requestContextKey
      ) {
        return;
      }
      if (!isCivitaiImageResourceSelectionResult(payload)) {
        throw new Error("Image resource selection returned an invalid response.");
      }
      if (payload.checkpointId !== requestCheckpointId) {
        throw new Error("Image resource selection did not preserve the current checkpoint.");
      }

      const unchanged = requestCheckpointId === payload.checkpointId &&
        selectedLoraIds.length === payload.loraIds.length &&
        selectedLoraIds.every((id, index) => id === payload.loraIds[index]);
      if (!unchanged) {
        onSelectionChangeRef.current({
          checkpointId: payload.checkpointId,
          loraIds: payload.loraIds,
        });
      }

      setCivitaiImagePickerWarnings(payload.warnings.map((entry) => entry.message));
      setCivitaiImagePickerFeedback(
        unchanged
          ? "This image already matches the current ordered resource selection. No Run settings changed."
          : `Kept the current checkpoint and selected ${payload.loraIds.length} LoRA${payload.loraIds.length === 1 ? "" : "s"} from the image.`,
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        imageSelectionAbortControllerRef.current !== controller ||
        imageSelectionRequestIdRef.current !== requestId ||
        imageSelectionContextKeyRef.current !== requestContextKey
      ) {
        return;
      }
      setCivitaiImagePickerError(
        error instanceof Error ? error.message : "Unable to select resources from this imported image.",
      );
    } finally {
      if (
        imageSelectionAbortControllerRef.current === controller &&
        imageSelectionRequestIdRef.current === requestId
      ) {
        imageSelectionAbortControllerRef.current = null;
        setResolvingCivitaiImage(null);
      }
    }
  }

  function handleToggleCheckpoint(resource: CivitaiResourceListItem) {
    if (disabled || resource.resourceType !== "model") {
      return;
    }

    if (selectedCheckpointId === resource.id) {
      onSelectionChange({
        checkpointId: null,
        loraIds: [],
      });
      setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
      setCivitaiPickerKind("checkpoint");
      return;
    }

    const checkpointPreview = previewFromCivitaiListItem(resource);
    const compatibleLoraIds = selectedResources.loras
      .filter((lora) => sameBaseModel(lora.baseModel, resource.baseModel))
      .map((lora) => lora.id);
    const compatibleLoras = selectedResources.loras.filter((lora) => compatibleLoraIds.includes(lora.id));

    onSelectionChange({
      checkpointId: resource.id,
      loraIds: compatibleLoraIds,
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
  }

  function removeSelectedCivitaiResource(resource: SelectedCivitaiResourcePreview) {
    if (disabled) {
      return;
    }

    if (resource.resourceType === "model") {
      onSelectionChange({
        checkpointId: null,
        loraIds: [],
      });
      setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
      setCivitaiPickerKind("checkpoint");
      return;
    }

    onSelectionChange({
      checkpointId: selectedCheckpointId,
      loraIds: selectedLoraIds.filter((id) => id !== resource.id),
    });
    setSelectedResources((current) => ({
      ...current,
      loras: current.loras.filter((lora) => lora.id !== resource.id),
    }));
  }

  function handleToggleLora(resource: CivitaiResourceListItem) {
    if (disabled || resource.resourceType !== "lora" || !selectedCheckpointBaseModel) {
      return;
    }

    if (!sameBaseModel(resource.baseModel, selectedCheckpointBaseModel)) {
      return;
    }

    const removing = selectedLoraIdSet.has(resource.id);
    const nextSelectedLoras = removing
      ? selectedLoraIds.filter((id) => id !== resource.id)
      : [...selectedLoraIds, resource.id];

    onSelectionChange({
      checkpointId: selectedCheckpointId,
      loraIds: nextSelectedLoras,
    });
    setSelectedResources((current) => {
      if (removing) {
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
  }

  useEffect(() => {
    if (disabled) {
      return;
    }

    const controller = new AbortController();

    async function loadSelectedCivitaiResources() {
      const loraIds = selectedLoraIdsKey ? selectedLoraIdsKey.split(",").filter(Boolean) : [];
      const civitaiQuery = buildSelectedCivitaiResourcesQuery(selectedCheckpointId, loraIds);

      if (!civitaiQuery) {
        setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
        onSelectedResourcesChangeRef.current?.(EMPTY_SELECTED_CIVITAI_RESOURCES);
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
        const compatibleLoraIds = payload.loras.map((lora) => lora.id);
        if (
          compatibleLoraIds.length !== loraIds.length ||
          compatibleLoraIds.some((id, index) => id !== loraIds[index])
        ) {
          onSelectionChangeRef.current({
            checkpointId: selectedCheckpointId,
            loraIds: compatibleLoraIds,
          });
        }
        setSelectedResources(payload);
        onSelectedResourcesChangeRef.current?.(payload);
        setSelectedCivitaiStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        onSelectedResourcesChangeRef.current?.(EMPTY_SELECTED_CIVITAI_RESOURCES);
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
  }, [disabled, selectedCheckpointId, selectedLoraIdsKey]);

  useEffect(() => {
    if (disabled || !civitaiPickerOpen || imagePickerActive) {
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
        if (readyOnly) {
          params.set("downloaded", "ready");
        }
        if (promptProfile) {
          params.set("promptProfile", promptProfile);
        }
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
    disabled,
    imagePickerActive,
    promptProfile,
    readyOnly,
    selectedCheckpointBaseModel,
    selectedCheckpointId,
  ]);

  useEffect(() => {
    if (
      disabled ||
      !civitaiPickerOpen ||
      !imagePickerActive ||
      !selectedCheckpointId ||
      !selectedCheckpointBaseModel
    ) {
      return;
    }

    const controller = new AbortController();
    const requestContextKey = imageSelectionContextKey;
    const requestBaseModel = selectedCheckpointBaseModel;

    async function loadCivitaiPickerImages() {
      setCivitaiImagePickerStatus("loading");
      setCivitaiImagePickerError("");

      try {
        const params = new URLSearchParams({
          nsfw: "all",
          resourceCount: "all",
        });
        params.set("baseModel", requestBaseModel);
        if (civitaiPickerQuery.trim()) {
          params.set("query", civitaiPickerQuery.trim());
        }

        const payload: unknown = await fetchJson<unknown>(
          `/api/civitai-lora-library/imported-images?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error("Imported image list returned an invalid response.");
        }
        if (
          controller.signal.aborted ||
          imageSelectionContextKeyRef.current !== requestContextKey
        ) {
          return;
        }

        setCivitaiPickerImages(
          (payload.items as ImportedImageListItem[]).filter((image) => (
            sameBaseModel(image.baseModel, requestBaseModel)
          )),
        );
        setCivitaiPickerImagesContextKey(requestContextKey);
        setCivitaiImagePickerStatus("success");
      } catch (error) {
        if (
          controller.signal.aborted ||
          imageSelectionContextKeyRef.current !== requestContextKey
        ) {
          return;
        }

        setCivitaiPickerImages([]);
        setCivitaiPickerImagesContextKey(requestContextKey);
        setCivitaiImagePickerStatus("error");
        setCivitaiImagePickerError(
          error instanceof Error ? error.message : "Unable to load imported Civitai images.",
        );
      }
    }

    const timeout = window.setTimeout(() => {
      void loadCivitaiPickerImages();
    }, 160);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    civitaiImagePickerRetryKey,
    civitaiPickerOpen,
    civitaiPickerQuery,
    disabled,
    imagePickerActive,
    imageSelectionContextKey,
    selectedCheckpointBaseModel,
    selectedCheckpointId,
  ]);

  const pickerContent = !disabled && civitaiPickerOpen ? (
    <div
      className={
        pickerLayout === "dialog"
          ? "flex max-h-[min(86vh,720px)] min-h-0 flex-col overflow-hidden rounded-md border border-indigo-100 bg-white shadow-xl"
          : "rounded-md border border-indigo-100 bg-white p-3"
      }
      data-testid="civitai-resource-picker"
    >
      <div
        className={
          pickerLayout === "dialog"
            ? "border-b border-indigo-50 bg-white p-3"
            : ""
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              {imagePickerActive
                ? "Select resources by imported image"
                : civitaiPickerKind === "checkpoint"
                  ? "Checkpoint Quick Select"
                  : "LoRA Quick Select"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {imagePickerActive
                ? `Keep the current checkpoint and replace its LoRA stack from imported ${selectedCheckpointBaseModel} examples.`
                : civitaiPickerKind === "checkpoint"
                  ? "Select a checkpoint first; switching checkpoint keeps already selected LoRAs with the same base model."
                  : selectedCheckpointBaseModel
                    ? `Only LoRAs with base model ${selectedCheckpointBaseModel} are shown.`
                    : "Select a checkpoint with base model metadata before choosing LoRAs."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {enableImageSelection ? (
              <div className="flex rounded-md border border-indigo-100 bg-indigo-50 p-0.5">
                <button
                  className={`h-7 rounded px-2 text-[11px] font-medium ${
                    !imagePickerActive ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"
                  }`}
                  onClick={() => {
                    setCivitaiPickerMode("resource");
                    setCivitaiPickerQuery("");
                  }}
                  type="button"
                >
                  By resource
                </button>
                <button
                  className={`h-7 rounded px-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                    imagePickerActive ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"
                  }`}
                  disabled={!imagePickerAvailable}
                  onClick={() => {
                    setCivitaiPickerMode("image");
                    setCivitaiPickerQuery("");
                    setCivitaiImagePickerError("");
                    setCivitaiImagePickerFeedback("");
                    setCivitaiImagePickerWarnings([]);
                  }}
                  title={imagePickerAvailable ? "Choose LoRAs from a matching imported image" : "Select a checkpoint with base-model metadata first"}
                  type="button"
                >
                  By image
                </button>
              </div>
            ) : null}
            {!imagePickerActive ? (
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
            ) : null}
            {pickerLayout === "dialog" ? (
              <button
                aria-label="Close Civitai resource picker"
                className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                onClick={() => setCivitaiPickerOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="relative mt-3 min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            onChange={(event) => setCivitaiPickerQuery(event.target.value)}
            placeholder={
              imagePickerActive
                ? "Search image ID, prompts, username, resources, or tags"
                : civitaiPickerKind === "checkpoint"
                ? "Search checkpoint name, version, creator, or base model"
                : "Search LoRA name, trained words, version, or creator"
            }
            value={civitaiPickerQuery}
          />
        </div>
        {imagePickerActive && visibleCivitaiImagePickerStatus === "success" ? (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Showing {visibleCivitaiPickerImages.length} imported image{visibleCivitaiPickerImages.length === 1 ? "" : "s"}
          </p>
        ) : !imagePickerActive && civitaiPickerStatus === "success" ? (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Showing {visibleCivitaiPickerItems.length} selectable
            {civitaiPickerKind === "checkpoint" ? " checkpoint" : " LoRA"}
          </p>
        ) : null}
      </div>
      <div
        className={
          pickerLayout === "dialog"
            ? "min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 pr-2"
            : "mt-3 min-h-[min(45vh,520px)] max-h-[min(45vh,520px)] space-y-2 overflow-y-auto overscroll-contain pr-1"
        }
      >
        {imagePickerActive ? (
          <>
            {civitaiImagePickerFeedback ? (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-700">
                {civitaiImagePickerFeedback}
              </p>
            ) : null}
            {civitaiImagePickerWarnings.length > 0 ? (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                <p className="font-semibold">Some LoRAs were skipped:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {civitaiImagePickerWarnings.map((message, index) => (
                    <li key={`${message}:${index}`}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {visibleCivitaiImagePickerStatus === "loading" && visibleCivitaiPickerImages.length === 0 ? (
              <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700">
                <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                Loading imported Civitai images...
              </p>
            ) : null}
            {civitaiImagePickerError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
                <span>{civitaiImagePickerError}</span>
                {civitaiImagePickerStatus === "error" ? (
                  <Button
                    className="h-7 border-rose-200 bg-white px-2 text-[11px] text-rose-700 hover:bg-rose-50"
                    onClick={() => setCivitaiImagePickerRetryKey((current) => current + 1)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : null}
            {visibleCivitaiImagePickerStatus === "success" && visibleCivitaiPickerImages.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                No imported {selectedCheckpointBaseModel} Civitai images match this search.
              </p>
            ) : null}
            {visibleCivitaiPickerImages.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleCivitaiPickerImages.map((image) => (
                  <CivitaiPickerImageCard
                    disabled={Boolean(resolvingCivitaiImageId)}
                    image={image}
                    key={image.id}
                    onSelect={() => void handleSelectCivitaiImage(image)}
                    resolving={resolvingCivitaiImageId === image.id}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {civitaiPickerStatus === "loading" && visibleCivitaiPickerItems.length === 0 ? (
              <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700">
                <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
                Loading Civitai resources...
              </p>
            ) : null}
            {civitaiPickerStatus === "error" && civitaiPickerError ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
                {civitaiPickerError}
              </p>
            ) : null}
            {civitaiPickerKind === "lora" && !selectedCheckpointId ? (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                Select a checkpoint before choosing compatible LoRAs.
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
                No matching Civitai resources for the current filters.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <fieldset
      aria-disabled={disabled}
      className="m-0 min-w-0 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected Civitai Resources</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-8 rounded-md border-indigo-100 bg-white px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
            disabled={disabled}
            onClick={() => openCivitaiPicker("checkpoint")}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Search className="size-3.5" />
            Select checkpoint
          </Button>
          <Button
            className="h-8 rounded-md border-indigo-100 bg-white px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || !selectedCheckpointId}
            onClick={() => openCivitaiPicker("lora")}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Search className="size-3.5" />
            Select LoRA
          </Button>
          {enableImageSelection ? (
            <Button
              className="h-8 rounded-md border-indigo-100 bg-white px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
              disabled={disabled || !imagePickerAvailable}
              onClick={openCivitaiImagePicker}
              size="sm"
              title={imagePickerAvailable ? "Choose LoRAs from a matching imported image" : "Select a checkpoint with base-model metadata first"}
              type="button"
              variant="secondary"
            >
              <ImageIcon className="size-3.5" />
              Select by image
            </Button>
          ) : null}
        </div>
      </div>
      <div className={denseSelectedResources ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
        {pickerLayout === "dialog" && !disabled && civitaiPickerOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-2 backdrop-blur-sm sm:p-4">
            <div className={`w-full ${imagePickerActive ? "max-w-6xl" : "max-w-3xl"}`}>{pickerContent}</div>
          </div>
        ) : pickerContent}
        <div
          className={`rounded-md border border-indigo-100 bg-indigo-50/50 ${
            denseSelectedResources ? "space-y-1.5 p-2" : "space-y-2 p-3"
          }`}
        >
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
            <div
              className={
                runSummaryGrid
                  ? "grid grid-cols-1 gap-1.5 xl:grid-cols-2"
                  : denseSelectedResources
                    ? "max-h-32 space-y-1 overflow-y-auto overscroll-contain pr-1"
                    : compactSelectedResources
                      ? "max-h-36 space-y-1.5 overflow-y-auto overscroll-contain pr-1"
                      : "space-y-2"
              }
            >
              {selectedResourceCards.map((resource) => (
                compactSelectedResources ? (
                  <CompactResourceRow
                    density={summaryDensity}
                    key={resource.id}
                    onRemove={() => removeSelectedCivitaiResource(resource)}
                    resource={resource}
                  />
                ) : (
                  <ResourceCard
                    key={resource.id}
                    onRemove={() => removeSelectedCivitaiResource(resource)}
                    resource={resource}
                  />
                )
              ))}
            </div>
          ) : selectedCivitaiStatus !== "loading" ? (
            <p className="text-xs leading-relaxed text-slate-500">No Civitai resources selected.</p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
