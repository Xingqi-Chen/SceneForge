"use client";

import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  CivitaiResourceListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { getCivitaiImageVariantUrl } from "@/features/civitai-lora-library/image-url";
import {
  getCivitaiModelStorageKind,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library/resource-files";
import { selectedCivitaiResourceCards } from "@/features/editor/ai-prompt/civitai-ai-context";

type LoadStatus = "idle" | "loading" | "success" | "error";
type CivitaiPickerKind = "checkpoint" | "lora";

type CivitaiResourcesResponse = {
  items: CivitaiResourceListItem[];
};

export type StylePaletteCivitaiResourceSelection = {
  checkpointId: string | null;
  loraIds: string[];
};

export type StylePaletteCivitaiResourceSelectorProps = {
  selectedCheckpointId: string | null;
  selectedLoraIds: string[];
  onSelectionChange: (selection: StylePaletteCivitaiResourceSelection) => void;
  onSelectedResourcesChange?: (resources: SelectedCivitaiResourcesPreview) => void;
  pickerLayout?: "inline" | "dialog";
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
  onRemove,
  resource,
}: {
  onRemove: () => void;
  resource: SelectedCivitaiResourcePreview;
}) {
  const previewImage = resource.previewImage
    ? (getCivitaiImageVariantUrl(resource.previewImage, 160) ?? resource.previewImage)
    : null;
  const trainedWords = resource.trainedWords.slice(0, 4);

  return (
    <div className="grid min-h-14 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
      <div className="flex size-11 overflow-hidden rounded-md bg-slate-100">
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
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
            {resource.resourceType === "model" ? "Checkpoint" : "LoRA"}
          </span>
          {resource.resourceType === "lora" ? (
            <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              {weightLabel(resource)}
            </span>
          ) : null}
          <p className="min-w-0 truncate text-sm font-semibold text-slate-900" title={resource.name}>
            {resource.name}
          </p>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
          <span className="shrink-0 truncate">{resource.versionName ?? resource.baseModel ?? "unknown version"}</span>
          {trainedWords.map((word) => (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600" key={word}>
              {word}
            </span>
          ))}
          {resource.trainedWords.length > trainedWords.length ? (
            <span className="shrink-0 text-[10px] text-slate-400">+{resource.trainedWords.length - trainedWords.length}</span>
          ) : null}
        </div>
      </div>
      <Button
        aria-label={`Remove ${resource.resourceType === "model" ? "checkpoint" : "LoRA"} ${resource.name}`}
        className="size-8 rounded-md border border-rose-100 bg-white p-0 text-rose-700 hover:bg-rose-50"
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
  onSelectionChange,
  onSelectedResourcesChange,
  pickerLayout = "inline",
  selectedCheckpointId,
  selectedLoraIds,
}: StylePaletteCivitaiResourceSelectorProps) {
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(EMPTY_SELECTED_CIVITAI_RESOURCES);
  const [selectedCivitaiStatus, setSelectedCivitaiStatus] = useState<LoadStatus>("idle");
  const [selectedCivitaiError, setSelectedCivitaiError] = useState("");
  const [civitaiPickerOpen, setCivitaiPickerOpen] = useState(false);
  const [civitaiPickerKind, setCivitaiPickerKind] = useState<CivitaiPickerKind>("checkpoint");
  const [civitaiPickerQuery, setCivitaiPickerQuery] = useState("");
  const [civitaiPickerItems, setCivitaiPickerItems] = useState<CivitaiResourceListItem[]>([]);
  const [civitaiPickerStatus, setCivitaiPickerStatus] = useState<LoadStatus>("idle");
  const [civitaiPickerError, setCivitaiPickerError] = useState("");
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectedResourcesChangeRef = useRef(onSelectedResourcesChange);
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const selectedLoraIdSet = useMemo(() => new Set(selectedLoraIds), [selectedLoraIds]);
  const selectedResourceCards = useMemo(() => selectedCivitaiResourceCards(selectedResources), [selectedResources]);
  const compactSelectedResources = pickerLayout === "dialog";
  const selectedCheckpointBaseModel =
    selectedResources.checkpoint?.id === selectedCheckpointId ? (selectedResources.checkpoint.baseModel ?? null) : null;
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

  function openCivitaiPicker(kind: CivitaiPickerKind) {
    setCivitaiPickerKind(kind);
    setCivitaiPickerQuery("");
    setCivitaiPickerOpen((current) => (current && civitaiPickerKind === kind ? false : true));
  }

  function handleToggleCheckpoint(resource: CivitaiResourceListItem) {
    if (resource.resourceType !== "model") {
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
    if (resource.resourceType !== "lora" || !selectedCheckpointBaseModel) {
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
  }, [selectedCheckpointId, selectedLoraIdsKey]);

  useEffect(() => {
    if (!civitaiPickerOpen) {
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
    selectedCheckpointBaseModel,
    selectedCheckpointId,
  ]);

  const pickerContent = civitaiPickerOpen ? (
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
              {civitaiPickerKind === "checkpoint" ? "Checkpoint Quick Select" : "LoRA Quick Select"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {civitaiPickerKind === "checkpoint"
                ? "Select a checkpoint first; switching checkpoint keeps already selected LoRAs with the same base model."
                : selectedCheckpointBaseModel
                  ? `Only LoRAs with base model ${selectedCheckpointBaseModel} are shown.`
                  : "Select a checkpoint with base model metadata before choosing LoRAs."}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              civitaiPickerKind === "checkpoint"
                ? "Search checkpoint name, version, creator, or base model"
                : "Search LoRA name, trained words, version, or creator"
            }
            value={civitaiPickerQuery}
          />
        </div>
        {civitaiPickerStatus === "success" ? (
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
      </div>
    </div>
  ) : null;

  return (
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
            Select checkpoint
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
            Select LoRA
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {pickerLayout === "dialog" && civitaiPickerOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl">{pickerContent}</div>
          </div>
        ) : pickerContent}
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
            <div className={compactSelectedResources ? "max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-1" : "space-y-2"}>
              {selectedResourceCards.map((resource) => (
                compactSelectedResources ? (
                  <CompactResourceRow
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
    </div>
  );
}
