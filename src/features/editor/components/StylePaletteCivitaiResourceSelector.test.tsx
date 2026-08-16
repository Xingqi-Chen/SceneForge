import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CivitaiResourceListItem,
  ImportedImageListItem,
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

function createImportedImage(overrides: Partial<ImportedImageListItem> = {}): ImportedImageListItem {
  return {
    id: "image-ready",
    civitaiImageId: 12345,
    civitaiImagePageUrl: "https://civitai.test/images/12345",
    imageUrl: "https://image.civitai.test/12345.jpeg",
    sourceImageUrl: null,
    width: 832,
    height: 1216,
    nsfw: false,
    nsfwLevel: 1,
    browsingLevel: null,
    createdAtOnCivitai: "2026-08-01T00:00:00.000Z",
    postId: null,
    username: "tester",
    baseModel: "Illustrious",
    prompt: "test prompt",
    negativePrompt: null,
    sampler: "euler",
    steps: 28,
    cfgScale: 5,
    seed: "123",
    rawMetaJson: null,
    importedByUserId: null,
    importedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    resourceCount: 7,
    loraCount: 6,
    checkpointCount: 1,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function findButton(text: string, scope: ParentNode = document.body) {
  return Array.from(scope.querySelectorAll("button")).find(
    (button) => button.textContent?.replace(/\s+/g, " ").trim() === text,
  ) as HTMLButtonElement | undefined;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
    const defaultSummary = checkpointRemove?.parentElement?.parentElement;

    expect(checkpointRemove?.parentElement?.className).toContain("min-h-9");
    expect(checkpointRemove?.parentElement?.className).toContain("grid-cols-[28px_minmax(0,1fr)_28px]");
    expect(checkpointRemove?.className).toContain("size-6");
    expect(loraRemove).not.toBeNull();
    expect(defaultSummary?.className).toContain("max-h-32");
    expect(defaultSummary?.className).toContain("overflow-y-auto");
    expect(defaultSummary?.className).not.toContain("xl:grid-cols-2");

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

  it("uses the opt-in Run summary grid without constraining resource overflow", async () => {
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
          summaryLayout="run-grid"
        />,
      );
    });
    await flushTimer();

    const removeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove "]'),
    );
    const summaryGrid = removeButtons[0]?.parentElement?.parentElement;

    expect(removeButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove checkpoint Ready Checkpoint",
      "Remove LoRA Ready Detail LoRA",
    ]);
    expect(summaryGrid?.className).toContain("grid");
    expect(summaryGrid?.className).toContain("grid-cols-1");
    expect(summaryGrid?.className).toContain("xl:grid-cols-2");
    expect(summaryGrid?.className).not.toContain("max-h-");
    expect(summaryGrid?.className).not.toContain("overflow-y-auto");

    act(() => {
      removeButtons[0]?.click();
    });
    expect(onSelectionChange).toHaveBeenCalledWith({
      checkpointId: null,
      loraIds: [],
    });
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

  it("keeps image selection opt-in and disabled until checkpoint base metadata is loaded", async () => {
    const checkpointWithoutBase = createSelectedResource({
      id: "checkpoint-without-base",
      baseModel: null,
      resourceType: "model",
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      checkpoint: checkpointWithoutBase,
      loras: [],
    })));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          onSelectionChange={vi.fn()}
          pickerLayout="dialog"
          selectedCheckpointId={null}
          selectedLoraIds={[]}
        />,
      );
    });
    expect(findButton("Select by image", container)).toBeUndefined();

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={vi.fn()}
          pickerLayout="dialog"
          selectedCheckpointId={null}
          selectedLoraIds={[]}
        />,
      );
    });
    expect(findButton("Select by image", container)?.disabled).toBe(true);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={vi.fn()}
          pickerLayout="dialog"
          selectedCheckpointId={checkpointWithoutBase.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    expect(findButton("Select by image", container)?.disabled).toBe(true);
    expect(findButton("Select by image", container)?.title).toContain("base-model metadata");
  });

  it("shows loading, safe error, retry, and empty states for the checkpoint-filtered gallery", async () => {
    const firstListRequest = deferred<Response>();
    let listRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return jsonResponse({ checkpoint, loras: [] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        listRequestCount += 1;
        return listRequestCount === 1
          ? firstListRequest.promise
          : jsonResponse({ items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={vi.fn()}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);

    expect(document.body.textContent).toContain("Loading imported Civitai images");
    await act(async () => {
      firstListRequest.resolve(jsonResponse({
        error: { message: "Gallery unavailable; retry safely." },
      }, 503));
      await Promise.resolve();
    });
    await flushTimer();
    expect(document.body.textContent).toContain("Gallery unavailable; retry safely.");
    expect(findButton("Retry")).toBeDefined();

    act(() => findButton("Retry")?.click());
    await flushTimer(180);
    expect(document.body.textContent).toContain("No imported Illustrious Civitai images match this search.");
    expect(listRequestCount).toBe(2);
    const galleryUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.startsWith("/api/civitai-lora-library/imported-images?"));
    expect(galleryUrl).toContain("baseModel=Illustrious");
    expect(galleryUrl).toContain("resourceCount=all");
  });

  it("uses the wide responsive image gallery with complete 4:3 previews and fallback", async () => {
    const matchingImage = createImportedImage();
    const mismatchedImage = createImportedImage({
      id: "image-anima",
      civitaiImageId: 98765,
      baseModel: "Anima",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return jsonResponse({ checkpoint, loras: [] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        const params = new URL(url, "http://localhost").searchParams;
        return jsonResponse({ items: params.has("query") ? [] : [matchingImage, mismatchedImage] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={vi.fn()}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();

    act(() => findButton("Select checkpoint", container)?.click());
    const resourceDialogWidth = document.body.querySelector('[data-testid="civitai-resource-picker"]')?.parentElement;
    expect(resourceDialogWidth?.className).toContain("max-w-3xl");
    act(() => findButton("By image")?.click());
    await flushTimer(180);

    const imageDialogWidth = document.body.querySelector('[data-testid="civitai-resource-picker"]')?.parentElement;
    expect(imageDialogWidth?.className).toContain("max-w-6xl");
    expect(imageDialogWidth?.className).not.toContain("max-w-3xl");
    expect(document.body.textContent).toContain("Image #12345");
    expect(document.body.textContent).not.toContain("Image #98765");
    expect(document.body.textContent).toContain("6 LoRA");
    expect(document.body.textContent).toContain("1 checkpoint");

    const preview = document.body.querySelector('img[alt="Civitai image 12345"]') as HTMLImageElement | null;
    expect(preview?.className).toContain("object-contain");
    expect(preview?.parentElement?.className).toContain("aspect-[4/3]");
    const galleryGrid = preview?.closest("button")?.parentElement;
    expect(galleryGrid?.className).toContain("grid-cols-1");
    expect(galleryGrid?.className).toContain("md:grid-cols-2");
    expect(galleryGrid?.className).toContain("xl:grid-cols-3");

    act(() => preview?.dispatchEvent(new Event("error")));
    expect(document.body.textContent).toContain("Image preview unavailable");

    const search = document.body.querySelector(
      'input[placeholder="Search image ID, prompts, username, resources, or tags"]',
    ) as HTMLInputElement;
    act(() => setNativeInputValue(search, "portrait test"));
    await flushTimer(180);
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((url) =>
      url.includes("query=portrait+test") && url.includes("baseModel=Illustrious")
    )).toBe(true);
    expect(document.body.textContent).toContain("No imported Illustrious Civitai images match this search.");
  });

  it("keeps the checkpoint and selects every image LoRA with warnings and no count limit", async () => {
    const image = createImportedImage();
    const loraIds = ["lora-6", "lora-2", "lora-5", "lora-1", "lora-4", "lora-3"];
    const onSelectionChange = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return jsonResponse({ checkpoint, loras: [] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        return jsonResponse({ items: [image] });
      }
      if (url.includes("/resource-selection?")) {
        return jsonResponse({
          checkpointId: checkpoint.id,
          loraIds,
          warnings: [{
            resourceId: "lora-skipped",
            resourceName: "Skipped LoRA",
            reason: "not_ready",
            message: "LoRA \"Skipped LoRA\" was skipped because its ready local file is unavailable.",
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    const imageButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Image #12345"),
    );
    act(() => imageButton?.click());
    await flushTimer();

    expect(onSelectionChange).toHaveBeenCalledWith({ checkpointId: checkpoint.id, loraIds });
    expect(onSelectionChange.mock.calls[0]?.[0].loraIds).toHaveLength(6);
    expect(document.body.textContent).toContain("Kept the current checkpoint and selected 6 LoRAs");
    expect(document.body.textContent).toContain("Some LoRAs were skipped");
    expect(document.body.textContent).toContain("Skipped LoRA");
    const selectionUrl = fetchMock.mock.calls.map(([input]) => String(input)).find((url) =>
      url.includes("/resource-selection?")
    );
    expect(selectionUrl).toContain(`checkpointId=${checkpoint.id}`);
    expect(selectionUrl).toContain("checkpointBaseModel=Illustrious");
  });

  it("treats a successful zero-LoRA result as replacement that clears old LoRAs", async () => {
    const oldLoras = ["old-lora-a", "old-lora-b"];
    const onSelectionChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return jsonResponse({ checkpoint, loras: oldLoras.map((id) => createSelectedResource({ id, name: id })) });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        return jsonResponse({ items: [createImportedImage()] });
      }
      if (url.includes("/resource-selection?")) {
        return jsonResponse({ checkpointId: checkpoint.id, loraIds: [], warnings: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={oldLoras}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    const imageButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Image #12345"),
    );
    act(() => imageButton?.click());
    await flushTimer();

    expect(onSelectionChange).toHaveBeenCalledWith({ checkpointId: checkpoint.id, loraIds: [] });
    expect(document.body.textContent).toContain("selected 0 LoRAs");
  });

  it("does not mutate on failure or a response that changes the checkpoint", async () => {
    const onSelectionChange = vi.fn();
    let selectionAttempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return jsonResponse({ checkpoint, loras: [lora] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        return jsonResponse({ items: [createImportedImage()] });
      }
      if (url.includes("/resource-selection?")) {
        selectionAttempt += 1;
        return selectionAttempt === 1
          ? jsonResponse({ error: { message: "The image no longer matches this checkpoint." } }, 409)
          : jsonResponse({ checkpointId: "checkpoint-forged", loraIds: [], warnings: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[lora.id]}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    const imageButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Image #12345"),
    );
    act(() => imageButton?.click());
    await flushTimer();
    expect(document.body.textContent).toContain("The image no longer matches this checkpoint.");
    expect(onSelectionChange).not.toHaveBeenCalled();

    act(() => imageButton?.click());
    await flushTimer();
    expect(document.body.textContent).toContain("did not preserve the current checkpoint");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("keeps identical ordered IDs as a no-op but treats reordered IDs as a change", async () => {
    const selectedLoraIds = ["lora-a", "lora-b", "lora-c"];
    const onSelectionChange = vi.fn();
    let selectionAttempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return jsonResponse({
          checkpoint,
          loras: selectedLoraIds.map((id) => createSelectedResource({ id, name: id })),
        });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        return jsonResponse({ items: [createImportedImage()] });
      }
      if (url.includes("/resource-selection?")) {
        selectionAttempt += 1;
        return jsonResponse({
          checkpointId: checkpoint.id,
          loraIds: selectionAttempt === 1 ? selectedLoraIds : ["lora-b", "lora-a", "lora-c"],
          warnings: [],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={selectedLoraIds}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    const imageButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Image #12345"),
    );

    act(() => imageButton?.click());
    await flushTimer();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("No Run settings changed");

    act(() => imageButton?.click());
    await flushTimer();
    expect(onSelectionChange).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith({
      checkpointId: checkpoint.id,
      loraIds: ["lora-b", "lora-a", "lora-c"],
    });
  });

  it("reloads for a new checkpoint base model and ignores a stale gallery response", async () => {
    const checkpointAnima = createSelectedResource({
      id: "checkpoint-anima",
      name: "Anima Checkpoint",
      baseModel: "Anima",
      resourceType: "model",
    });
    const oldGallery = deferred<Response>();
    const galleryUrls: string[] = [];
    const onSelectionChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return url.includes(`checkpointId=${checkpointAnima.id}`)
          ? jsonResponse({ checkpoint: checkpointAnima, loras: [] })
          : jsonResponse({ checkpoint, loras: [] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        galleryUrls.push(url);
        return url.includes("baseModel=Anima")
          ? jsonResponse({ items: [createImportedImage({
              id: "image-anima",
              civitaiImageId: 22222,
              baseModel: "Anima",
            })] })
          : oldGallery.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    expect(galleryUrls.some((url) => url.includes("baseModel=Illustrious"))).toBe(true);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpointAnima.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    await flushTimer(180);
    expect(galleryUrls.some((url) => url.includes("baseModel=Anima"))).toBe(true);
    expect(document.body.textContent).toContain("Image #22222");

    await act(async () => {
      oldGallery.resolve(jsonResponse({ items: [createImportedImage({ civitaiImageId: 11111 })] }));
      await Promise.resolve();
    });
    await flushTimer();
    expect(document.body.textContent).toContain("Image #22222");
    expect(document.body.textContent).not.toContain("Image #11111");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("ignores a stale image-selection response after checkpoint context changes", async () => {
    const checkpointAnima = createSelectedResource({
      id: "checkpoint-anima",
      name: "Anima Checkpoint",
      baseModel: "Anima",
      resourceType: "model",
    });
    const oldSelection = deferred<Response>();
    const onSelectionChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return url.includes(`checkpointId=${checkpointAnima.id}`)
          ? jsonResponse({ checkpoint: checkpointAnima, loras: [] })
          : jsonResponse({ checkpoint, loras: [] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        return url.includes("baseModel=Anima")
          ? jsonResponse({ items: [createImportedImage({
              id: "image-anima",
              civitaiImageId: 22222,
              baseModel: "Anima",
            })] })
          : jsonResponse({ items: [createImportedImage()] });
      }
      if (url.includes("/resource-selection?")) {
        return oldSelection.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    const oldImageButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Image #12345"),
    );
    act(() => oldImageButton?.click());

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpointAnima.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    await flushTimer(180);

    await act(async () => {
      oldSelection.resolve(jsonResponse({
        checkpointId: checkpoint.id,
        loraIds: ["stale-lora"],
        warnings: [],
      }));
      await Promise.resolve();
    });
    await flushTimer();

    expect(document.body.textContent).toContain("Image #22222");
    expect(document.body.textContent).not.toContain("stale-lora");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("invalidates an A-to-B-to-A image request and leaves the returned gallery selectable", async () => {
    const checkpointAnima = createSelectedResource({
      id: "checkpoint-anima",
      name: "Anima Checkpoint",
      baseModel: "Anima",
      resourceType: "model",
    });
    const oldSelection = deferred<Response>();
    const onSelectionChange = vi.fn();
    let selectionRequestCount = 0;
    const selectionSignals: Array<AbortSignal | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/civitai-lora-library/selected-resources?")) {
        return url.includes(`checkpointId=${checkpointAnima.id}`)
          ? jsonResponse({ checkpoint: checkpointAnima, loras: [] })
          : jsonResponse({ checkpoint, loras: [] });
      }
      if (url.startsWith("/api/civitai-lora-library/imported-images?")) {
        return url.includes("baseModel=Anima")
          ? jsonResponse({ items: [createImportedImage({
              id: "image-anima",
              civitaiImageId: 22222,
              baseModel: "Anima",
            })] })
          : jsonResponse({ items: [createImportedImage()] });
      }
      if (url.includes("/resource-selection?")) {
        selectionRequestCount += 1;
        if (selectionRequestCount === 1) {
          selectionSignals.push(init?.signal ?? null);
          return oldSelection.promise;
        }
        return jsonResponse({
          checkpointId: checkpoint.id,
          loraIds: ["fresh-lora"],
          warnings: [],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    act(() => findButton("Select by image", container)?.click());
    await flushTimer(180);
    const findIllustriousImageButton = () => Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Image #12345"),
    ) as HTMLButtonElement | undefined;

    act(() => findIllustriousImageButton()?.click());
    await flushTimer();
    expect(findIllustriousImageButton()?.disabled).toBe(true);

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpointAnima.id}
          selectedLoraIds={[]}
        />,
      );
    });
    expect(selectionSignals[0]?.aborted).toBe(true);
    await flushTimer();
    await flushTimer(180);
    expect(document.body.textContent).toContain("Image #22222");

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          enableImageSelection
          onSelectionChange={onSelectionChange}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={[]}
        />,
      );
    });
    await flushTimer();
    await flushTimer(180);
    expect(document.body.textContent).toContain("Image #12345");

    await act(async () => {
      oldSelection.resolve(jsonResponse({
        checkpointId: checkpoint.id,
        loraIds: ["stale-lora"],
        warnings: [],
      }));
      await Promise.resolve();
    });
    await flushTimer();

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("stale-lora");
    expect(findIllustriousImageButton()?.disabled).toBe(false);

    act(() => findIllustriousImageButton()?.click());
    await flushTimer();
    expect(selectionRequestCount).toBe(2);
    expect(onSelectionChange).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith({
      checkpointId: checkpoint.id,
      loraIds: ["fresh-lora"],
    });
  });

  it("renders a large selected LoRA stack without truncating the Run summary", async () => {
    const loras = Array.from({ length: 7 }, (_, index) => createSelectedResource({
      id: `lora-${index + 1}`,
      name: `Ready LoRA ${index + 1}`,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ checkpoint, loras })));

    act(() => {
      root.render(
        <StylePaletteCivitaiResourceSelector
          onSelectionChange={vi.fn()}
          pickerLayout="dialog"
          selectedCheckpointId={checkpoint.id}
          selectedLoraIds={loras.map(({ id }) => id)}
          summaryDensity="compact"
          summaryLayout="run-grid"
        />,
      );
    });
    await flushTimer();

    const removeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove "]'),
    );
    expect(removeButtons).toHaveLength(8);
    expect(removeButtons.at(-1)?.getAttribute("aria-label")).toBe("Remove LoRA Ready LoRA 7");
    const summary = removeButtons[0]?.parentElement?.parentElement;
    expect(summary?.className).not.toContain("max-h-");
    expect(summary?.className).not.toContain("overflow-y-auto");
  });
});
