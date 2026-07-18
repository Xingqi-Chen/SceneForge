import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CivitaiResourceListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";

import { StylePaletteCivitaiResourceSelector } from "./StylePaletteCivitaiResourceSelector";

const checkpoint = createSelectedResource({
  id: "checkpoint-ready",
  name: "Ready Checkpoint",
  resourceType: "model",
});
const lora = createSelectedResource({
  id: "lora-ready",
  name: "Ready Detail LoRA",
  resourceType: "lora",
  trainedWords: ["detail one", "detail two", "detail three"],
});

let container: HTMLDivElement;
let root: Root;

function createSelectedResource(
  overrides: Partial<SelectedCivitaiResourcePreview>,
): SelectedCivitaiResourcePreview {
  return {
    id: "resource-ready",
    resourceType: "lora",
    name: "Ready Resource",
    versionName: "v1",
    baseModel: "Illustrious",
    creator: "SceneForge Test",
    trainedWords: [],
    tags: [],
    categories: ["style"],
    usageGuide: null,
    descriptionSnippet: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    modelFileName: "ready.safetensors",
    ...overrides,
  };
}

function createResourceListItem(resource: SelectedCivitaiResourcePreview): CivitaiResourceListItem {
  return {
    id: resource.id,
    resourceType: resource.resourceType,
    civitaiModelId: null,
    civitaiModelVersionId: null,
    name: resource.name,
    versionName: resource.versionName,
    hash: null,
    baseModel: resource.baseModel,
    trainedWords: resource.trainedWords,
    tags: resource.tags,
    description: resource.descriptionSnippet,
    creator: resource.creator,
    downloadUrl: null,
    filesJson: null,
    officialImagesJson: null,
    category: null,
    categories: resource.categories,
    usageGuide: resource.usageGuide,
    recommendations: resource.recommendations,
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    importedImageCount: 1,
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    previewImage: resource.previewImage,
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

async function flushTimer(milliseconds = 0) {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StylePaletteCivitaiResourceSelector", () => {
  it("keeps compact selected rows removable and preserves the dialog default density", async () => {
    const selectedResources: SelectedCivitaiResourcesPreview = {
      checkpoint,
      loras: [lora],
    };
    const onSelectionChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(selectedResources)));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[lora.id]}
          summaryDensity="compact"
        />,
      );
    });
    await flushTimer();

    const checkpointRemove = container.querySelector(
      '[aria-label="Remove checkpoint Ready Checkpoint"]',
    ) as HTMLButtonElement | null;
    const loraRemove = container.querySelector(
      '[aria-label="Remove LoRA Ready Detail LoRA"]',
    ) as HTMLButtonElement | null;

    expect(checkpointRemove?.parentElement?.className).toContain("min-h-9");
    expect(checkpointRemove?.parentElement?.className).toContain("grid-cols-[28px_minmax(0,1fr)_28px]");
    expect(checkpointRemove?.className).toContain("size-6");
    expect(loraRemove).not.toBeNull();

    act(() => {
      loraRemove?.click();
    });
    expect(onSelectionChange).toHaveBeenCalledWith({
      checkpointId: checkpoint.id,
      loraIds: [],
    });
    expect(container.querySelector('[aria-label="Remove LoRA Ready Detail LoRA"]')).toBeNull();

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[lora.id]}
        />,
      );
    });

    const defaultDensityCheckpointRemove = container.querySelector(
      '[aria-label="Remove checkpoint Ready Checkpoint"]',
    );
    expect(defaultDensityCheckpointRemove?.parentElement?.className).toContain("min-h-10");
    expect(defaultDensityCheckpointRemove?.parentElement?.className).toContain(
      "grid-cols-[32px_minmax(0,1fr)_32px]",
    );
    expect(defaultDensityCheckpointRemove?.className).toContain("size-7");
  });

  it("keeps checkpoint selection accessible in the compact dialog variant", async () => {
    const onSelectionChange = vi.fn();
    const checkpointListItem = createResourceListItem(checkpoint);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/resources?")) {
        return jsonResponse({ items: [checkpointListItem] });
      }

      return jsonResponse({ checkpoint: null, loras: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          readyOnly
          selectedCheckpointId={null}
          selectedLoraIds={[]}
          summaryDensity="compact"
        />,
      );
    });

    const selectCheckpoint = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Select checkpoint",
    );
    expect(selectCheckpoint).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      selectCheckpoint?.click();
    });
    expect(document.body.querySelector('[aria-label="Close Civitai resource picker"]')).not.toBeNull();
    await flushTimer(180);

    const selectResource = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Select",
    );
    expect(selectResource).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      selectResource?.click();
    });
    expect(onSelectionChange).toHaveBeenCalledWith({
      checkpointId: checkpoint.id,
      loraIds: [],
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("downloaded=ready"))).toBe(true);
  });
});
