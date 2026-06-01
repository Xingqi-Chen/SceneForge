import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArtistStringItemRecord } from "@/features/artist-string-library";
import type {
  CivitaiResourceListItem,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { STYLE_PALETTE_PROMPT_PRESETS } from "@/features/editor/ai-prompt/style-palette-prompts";
import { createDefaultProject } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";

const dialogProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("./ImageGenerationPanel", () => ({
  ComfyUiGenerationDialog: (props: Record<string, unknown>) => {
    dialogProps.push(props);

    if (!props.open) {
      return null;
    }

    return <div data-testid="mock-comfyui-generation-dialog">{props.introContent as ReactNode}</div>;
  },
}));

import { StylePalettePanel } from "./StylePalettePanel";

let container: HTMLDivElement;
let root: Root;

const artistString: ArtistStringItemRecord = {
  id: "artist-1",
  platformId: "nai_bot_artists_gallery",
  sourceSequence: 7,
  categoryKey: "style",
  categoryName: "Painterly",
  rawArtistString: "artist:example",
  structuredArtistString: {
    type: "novelai",
    raw: "artist:example",
    nodes: [],
    warnings: [],
  },
  promptFormat: "novelai",
  parseStatus: "parsed",
  parseError: null,
  formattedPrompt: "artist:example",
  sourceUrl: "https://example.test/artist",
  normalizedArtistString: "artist:example",
  referenceImages: [],
  createdAt: "2026-05-30T00:00:00.000Z",
  updatedAt: "2026-05-30T00:00:00.000Z",
};

const checkpointResource = createSelectedResource({
  id: "checkpoint-1",
  name: "Dream Checkpoint",
  resourceType: "model",
});

const alternateCheckpointResource = createSelectedResource({
  id: "checkpoint-2",
  name: "Ink Checkpoint",
  baseModel: "Pony",
  resourceType: "model",
});

const noBaseCheckpointResource = createSelectedResource({
  id: "checkpoint-no-base",
  name: "Metadata Light Checkpoint",
  baseModel: null,
  resourceType: "model",
});

const loraResource = createSelectedResource({
  id: "lora-1",
  name: "Neon Detail LoRA",
  resourceType: "lora",
  trainedWords: ["neon_detail"],
});

const checkpointListItem = createResourceListItem(checkpointResource);
const alternateCheckpointListItem = createResourceListItem(alternateCheckpointResource);
const loraListItem = createResourceListItem(loraResource);

function createSelectedResource(
  overrides: Partial<SelectedCivitaiResourcePreview>,
): SelectedCivitaiResourcePreview {
  return {
    id: "resource-1",
    resourceType: "lora",
    name: "Test Resource",
    versionName: "v1",
    baseModel: "SDXL",
    creator: "creator",
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
    modelFileName: "resource.safetensors",
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
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    importedImageCount: 1,
    averageWeight: resource.averageWeight,
    minWeight: resource.minWeight,
    maxWeight: resource.maxWeight,
    previewImage: resource.previewImage,
  };
}

function selectedResourcesForUrl(url: string): SelectedCivitaiResourcesPreview {
  const paramsText = url.split("?")[1] ?? "";
  const params = new URLSearchParams(paramsText);
  const checkpointId = params.get("checkpointId");
  const loraIds = params.get("loraIds")?.split(",").filter(Boolean) ?? [];

  return {
    checkpoint:
      checkpointId === checkpointResource.id
        ? checkpointResource
        : checkpointId === alternateCheckpointResource.id
          ? alternateCheckpointResource
          : checkpointId === noBaseCheckpointResource.id
            ? noBaseCheckpointResource
            : null,
    loras: loraIds.includes(loraResource.id) ? [loraResource] : [],
  };
}

function defaultLlmChatResponse(init?: RequestInit) {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as { maxTokens?: number } : {};

  if (body.maxTokens === 120) {
    return jsonResponse({ content: "Tags: hatsune_miku, 1girl, twintails", role: "assistant" });
  }

  return jsonResponse({
    content: JSON.stringify({
      prompt: "advised style prompt",
      parameterSuggestions: { steps: 28 },
      parameterSuggestionReason: "Use moderate steps for this checkpoint.",
      overallEffect: "Crisp anime lighting with controlled detail.",
    }),
    role: "assistant",
  });
}

function mockFetch(
  options: {
    llmChatResponse?: (init?: RequestInit) => Promise<Response> | Response;
    resourcesResponse?: (url: string, init?: RequestInit) => Promise<Response> | Response;
    selectedResourcesResponse?: (url: string, init?: RequestInit) => Promise<Response> | Response;
  } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith("/api/civitai-lora-library/selected-resources")) {
        if (options.selectedResourcesResponse) {
          return options.selectedResourcesResponse(url, init);
        }

        return jsonResponse(selectedResourcesForUrl(url));
      }

      if (url.startsWith("/api/artist-string-library/selected-resources")) {
        return jsonResponse({ items: url.includes("artist-1") ? [artistString] : [] });
      }

      if (url.startsWith("/api/artist-string-library/items")) {
        return jsonResponse({ categories: [], items: [artistString], platforms: [] });
      }

      if (url.startsWith("/api/civitai-lora-library/resources")) {
        if (options.resourcesResponse) {
          return options.resourcesResponse(url, init);
        }

        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const resourceType = params.get("resourceType");
        const baseModel = params.get("baseModel");

        if (resourceType === "model") {
          return jsonResponse({ items: [checkpointListItem, alternateCheckpointListItem] });
        }

        if (resourceType === "lora") {
          return jsonResponse({
            items: !baseModel || baseModel === loraListItem.baseModel ? [loraListItem] : [],
          });
        }

        return jsonResponse({ items: [] });
      }

      if (url === "/api/llm/chat") {
        return options.llmChatResponse ? options.llmChatResponse(init) : defaultLlmChatResponse(init);
      }

      return jsonResponse({ error: { message: `Unhandled request: ${url}` } }, false);
    }) satisfies typeof fetch,
  );
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    statusText: ok ? "OK" : "Unhandled request",
    json: async () => payload,
  } as Response;
}

function resetProjectWithSelections() {
  const project = createDefaultProject();

  useEditorStore.getState().setProject({
    ...project,
    scene: {
      ...project.scene,
      promptTags: [
        ...project.scene.promptTags,
        {
          id: "artist-tag-1",
          label: "NAI 007 / Painterly",
          prompt: "stored artist prompt",
          category: "style",
          subcategory: "style-rendering",
          weight: { enabled: false, value: 1 },
        },
      ],
    },
    settings: {
      ...project.settings,
      selectedArtistStringIds: [artistString.id],
      selectedArtistStringPrompts: ["stored artist prompt"],
      selectedCivitaiCheckpointId: checkpointResource.id,
      selectedCivitaiLoraIds: [loraResource.id],
    },
  });
}

async function openPaletteAndWaitForContext() {
  act(() => {
    root.render(<StylePalettePanel />);
  });

  const openButton = container.querySelector("section button") as HTMLButtonElement | null;
  expect(openButton).not.toBeNull();

  await act(async () => {
    openButton?.click();
  });

  await waitFor(() => {
    expect(getButtonByAriaLabel("Remove artist string NAI 007")).not.toBeNull();
    expect(getButtonByAriaLabel("Remove LoRA Neon Detail LoRA")).not.toBeNull();
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }

  throw lastError;
}

function getButtonByAriaLabel(label: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="${label}"]`);
}

function getButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

function getLastButtonWithin(rootElement: HTMLElement): HTMLButtonElement {
  const button = Array.from(rootElement.querySelectorAll("button")).at(-1);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

function countFetchCallsStartingWith(prefix: string) {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith(prefix)).length;
}

function hasCivitaiResourceFetch(params: Record<string, string>) {
  return vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = String(input);
    if (!url.startsWith("/api/civitai-lora-library/resources")) {
      return false;
    }

    const searchParams = new URLSearchParams(url.split("?")[1] ?? "");
    return Object.entries(params).every(([key, value]) => searchParams.get(key) === value);
  });
}

function countCivitaiResourceFetches(params: Record<string, string>) {
  return vi.mocked(fetch).mock.calls.filter(([input]) => {
    const url = String(input);
    if (!url.startsWith("/api/civitai-lora-library/resources")) {
      return false;
    }

    const searchParams = new URLSearchParams(url.split("?")[1] ?? "");
    return Object.entries(params).every(([key, value]) => searchParams.get(key) === value);
  }).length;
}

function getTextElement(text: string): HTMLElement {
  const element = Array.from(container.querySelectorAll("p")).find((candidate) => candidate.textContent?.trim() === text);
  expect(element).toBeInstanceOf(HTMLElement);
  return element as HTMLElement;
}

function getSectionColumn(title: string): HTMLElement {
  const heading = Array.from(container.querySelectorAll("p")).find((element) => element.textContent?.trim() === title);
  expect(heading).not.toBeUndefined();

  const column = heading?.parentElement?.parentElement;
  expect(column).toBeInstanceOf(HTMLElement);
  return column as HTMLElement;
}

function getStackColumnWrapper(sectionTitle: string): HTMLElement {
  const column = getSectionColumn(sectionTitle);
  const wrapper = Array.from(column.children).find((child) =>
    child instanceof HTMLElement && child.className.includes("flex flex-col gap-3"),
  );
  expect(wrapper).toBeInstanceOf(HTMLElement);
  return wrapper as HTMLElement;
}

function clickFirstHeaderButton(sectionTitle: string) {
  const column = getSectionColumn(sectionTitle);
  const button = column.querySelector("button") as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  act(() => {
    button?.click();
  });
}

function getPresetSelect(): HTMLSelectElement {
  const select = Array.from(container.querySelectorAll("select")).find((candidate) =>
    Array.from(candidate.options).some((option) => option.value === STYLE_PALETTE_PROMPT_PRESETS[1].id),
  );
  expect(select).toBeInstanceOf(HTMLSelectElement);
  return select as HTMLSelectElement;
}

function getSubjectInput(): HTMLInputElement {
  const input = container.querySelector('input[aria-label="Subject Input"]');
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function createDeferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  dialogProps.length = 0;
  resetProjectWithSelections();
  mockFetch();
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

describe("StylePalettePanel", () => {
  it("deselects selected artist strings and Civitai resources from right-side remove buttons", async () => {
    await openPaletteAndWaitForContext();

    const artistRemoveButton = getButtonByAriaLabel("Remove artist string NAI 007");
    const loraRemoveButton = getButtonByAriaLabel("Remove LoRA Neon Detail LoRA");
    const checkpointRemoveButton = getButtonByAriaLabel("Remove checkpoint Dream Checkpoint");

    expect(artistRemoveButton?.className).toContain("justify-self-end");
    expect(artistRemoveButton?.parentElement?.className).toContain("sm:grid-cols-[64px_minmax(0,1fr)_auto]");
    expect(loraRemoveButton?.className).toContain("justify-self-end");
    expect(loraRemoveButton?.parentElement?.className).toContain("sm:grid-cols-[64px_minmax(0,1fr)_auto]");
    expect(checkpointRemoveButton?.className).toContain("justify-self-end");

    act(() => {
      artistRemoveButton?.click();
    });

    expect(useEditorStore.getState().project.settings.selectedArtistStringIds).toEqual([]);
    expect(useEditorStore.getState().project.settings.selectedArtistStringPrompts).toEqual([]);
    expect(useEditorStore.getState().project.scene.promptTags).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "artist-tag-1" })]),
    );

    act(() => {
      loraRemoveButton?.click();
    });

    expect(useEditorStore.getState().project.settings.selectedCivitaiLoraIds).toEqual([]);

    act(() => {
      checkpointRemoveButton?.click();
    });

    expect(useEditorStore.getState().project.settings.selectedCivitaiCheckpointId).toBeNull();
    expect(useEditorStore.getState().project.settings.selectedCivitaiLoraIds).toEqual([]);
  });

  it("removes selected Civitai LoRAs that are filtered out by the selected-resource refresh", async () => {
    mockFetch({
      selectedResourcesResponse: () =>
        jsonResponse({
          checkpoint: checkpointResource,
          loras: [],
        }),
    });

    act(() => {
      root.render(<StylePalettePanel />);
    });

    const openButton = container.querySelector("section button") as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();

    await act(async () => {
      openButton?.click();
    });

    await waitFor(() => {
      expect(useEditorStore.getState().project.settings.selectedCivitaiCheckpointId).toBe(checkpointResource.id);
      expect(useEditorStore.getState().project.settings.selectedCivitaiLoraIds).toEqual([]);
      expect(getButtonByAriaLabel("Remove checkpoint Dream Checkpoint")).not.toBeNull();
    });
    expect(getButtonByAriaLabel("Remove LoRA Neon Detail LoRA")).toBeNull();
  });

  it("keeps selected Civitai cards mounted while selected resources refresh", async () => {
    await openPaletteAndWaitForContext();

    const deferred = createDeferredResponse();
    let pendingSelectedRefresh = false;
    mockFetch({
      selectedResourcesResponse: () => {
        pendingSelectedRefresh = true;
        return deferred.promise;
      },
    });

    const loraRemoveButton = getButtonByAriaLabel("Remove LoRA Neon Detail LoRA");

    act(() => {
      loraRemoveButton?.click();
    });

    await waitFor(() => {
      expect(pendingSelectedRefresh).toBe(true);
      expect(useEditorStore.getState().project.settings.selectedCivitaiLoraIds).toEqual([]);
    });

    expect(getButtonByAriaLabel("Remove LoRA Neon Detail LoRA")).toBeNull();
    expect(getButtonByAriaLabel("Remove checkpoint Dream Checkpoint")).not.toBeNull();
    expect(container.textContent).toContain("Dream Checkpoint");
    expect(container.textContent).not.toContain("Loading selected resources...");

    await act(async () => {
      deferred.resolve(
        jsonResponse(selectedResourcesForUrl("/api/civitai-lora-library/selected-resources?checkpointId=checkpoint-1")),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(getButtonByAriaLabel("Remove checkpoint Dream Checkpoint")).not.toBeNull();
  });

  it("keeps quick-pick panels above selected content in visual and keyboard order", async () => {
    await openPaletteAndWaitForContext();

    clickFirstHeaderButton("Selected Artist Strings");
    clickFirstHeaderButton("Selected Civitai Resources");

    const artistWrapper = getStackColumnWrapper("Selected Artist Strings");
    const civitaiWrapper = getStackColumnWrapper("Selected Civitai Resources");

    expect(artistWrapper.children[0]?.querySelector("input")).not.toBeNull();
    expect(artistWrapper.children[1]?.textContent).toContain("NAI 007");
    expect(civitaiWrapper.children[0]?.textContent).toContain("Checkpoint Quick Select");
    expect(civitaiWrapper.children[1]?.textContent).toContain("Dream Checkpoint");
  });

  it("does not refresh selected Civitai resources when artist string selection changes", async () => {
    await openPaletteAndWaitForContext();

    clickFirstHeaderButton("Selected Artist Strings");
    const artistWrapper = getStackColumnWrapper("Selected Artist Strings");

    await waitFor(() => {
      expect(artistWrapper.children[0]?.querySelector("input")).not.toBeNull();
      expect((artistWrapper.children[0] as HTMLElement).querySelector("button")).not.toBeNull();
    });

    const selectedResourceFetches = countFetchCallsStartingWith("/api/civitai-lora-library/selected-resources");
    const artistToggleButton = getLastButtonWithin(artistWrapper.children[0] as HTMLElement);

    act(() => {
      artistToggleButton.click();
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    });

    expect(countFetchCallsStartingWith("/api/civitai-lora-library/selected-resources")).toBe(selectedResourceFetches);
    expect(container.textContent).not.toContain("Loading selected resources...");
  });

  it("keeps the Civitai picker list mounted when toggling a selected LoRA", async () => {
    await openPaletteAndWaitForContext();

    const civitaiColumn = getSectionColumn("Selected Civitai Resources");
    const headerButtons = civitaiColumn.children[0]?.querySelectorAll("button");
    expect(headerButtons?.[1]).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      (headerButtons?.[1] as HTMLButtonElement).click();
    });

    const civitaiWrapper = getStackColumnWrapper("Selected Civitai Resources");

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("LoRA Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Neon Detail LoRA");
    });

    const resourceFetches = countFetchCallsStartingWith("/api/civitai-lora-library/resources");
    const loraToggleButton = getLastButtonWithin(civitaiWrapper.children[0] as HTMLElement);

    act(() => {
      loraToggleButton.click();
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    });

    expect(useEditorStore.getState().project.settings.selectedCivitaiLoraIds).toEqual([]);
    expect(countFetchCallsStartingWith("/api/civitai-lora-library/resources")).toBe(resourceFetches);
    expect(civitaiWrapper.children[0]?.textContent).toContain("Neon Detail LoRA");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("正在读取 Civitai 资源...");
  });

  it("uses the clicked checkpoint base model when switching directly into the LoRA picker", async () => {
    await openPaletteAndWaitForContext();

    clickFirstHeaderButton("Selected Civitai Resources");
    const civitaiWrapper = getStackColumnWrapper("Selected Civitai Resources");

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("Checkpoint Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Ink Checkpoint");
    });

    const checkpointPicker = civitaiWrapper.children[0] as HTMLElement;
    const alternateCheckpointButton = Array.from(checkpointPicker.querySelectorAll("button")).find((button) =>
      button.parentElement?.textContent?.includes("Ink Checkpoint"),
    );
    expect(alternateCheckpointButton).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      (alternateCheckpointButton as HTMLButtonElement).click();
    });

    expect(useEditorStore.getState().project.settings.selectedCivitaiCheckpointId).toBe(alternateCheckpointResource.id);
    expect(useEditorStore.getState().project.settings.selectedCivitaiLoraIds).toEqual([]);

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("LoRA Quick Select");
      expect(hasCivitaiResourceFetch({ resourceType: "lora", baseModel: "Pony" })).toBe(true);
    });
  });

  it("hides stale checkpoint rows while checkpoint-to-LoRA resource loading is pending", async () => {
    await openPaletteAndWaitForContext();

    clickFirstHeaderButton("Selected Civitai Resources");
    const civitaiWrapper = getStackColumnWrapper("Selected Civitai Resources");

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("Checkpoint Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Dream Checkpoint");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Ink Checkpoint");
    });

    const deferred = createDeferredResponse();
    let pendingLoraFetch = false;
    mockFetch({
      resourcesResponse: (url) => {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        if (params.get("resourceType") === "lora") {
          pendingLoraFetch = true;
          return deferred.promise;
        }

        return jsonResponse({ items: [checkpointListItem, alternateCheckpointListItem] });
      },
    });

    const checkpointPicker = civitaiWrapper.children[0] as HTMLElement;
    const alternateCheckpointButton = Array.from(checkpointPicker.querySelectorAll("button")).find((button) =>
      button.parentElement?.textContent?.includes("Ink Checkpoint"),
    );
    expect(alternateCheckpointButton).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      (alternateCheckpointButton as HTMLButtonElement).click();
    });

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("LoRA Quick Select");
    });

    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Dream Checkpoint");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Ink Checkpoint");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(pendingLoraFetch).toBe(true);
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Dream Checkpoint");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Ink Checkpoint");

    await act(async () => {
      deferred.resolve(jsonResponse({ items: [] }));
      await deferred.promise;
    });
  });

  it("clears stale picker items when the selected checkpoint has no base model for LoRA filtering", async () => {
    await openPaletteAndWaitForContext();

    clickFirstHeaderButton("Selected Civitai Resources");
    const civitaiWrapper = getStackColumnWrapper("Selected Civitai Resources");

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("Checkpoint Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Dream Checkpoint");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Ink Checkpoint");
    });

    act(() => {
      useEditorStore.getState().updateProjectSettings({
        selectedCivitaiCheckpointId: noBaseCheckpointResource.id,
        selectedCivitaiLoraIds: [],
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Metadata Light Checkpoint");
    });

    const loraFetchesBefore = countCivitaiResourceFetches({ resourceType: "lora" });
    const segmentedButtons = (civitaiWrapper.children[0] as HTMLElement).querySelectorAll("button");
    const loraTabButton = Array.from(segmentedButtons).find((button) => button.textContent?.includes("LoRA"));
    expect(loraTabButton).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      (loraTabButton as HTMLButtonElement).click();
    });

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("LoRA Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Selected checkpoint has no base model metadata.");
    });

    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Dream Checkpoint");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Ink Checkpoint");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Neon Detail LoRA");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("正在读取 Civitai 资源...");
    expect(countCivitaiResourceFetches({ resourceType: "lora" })).toBe(loraFetchesBefore);
  });

  it("does not use stale checkpoint metadata when selected-resource refresh fails", async () => {
    await openPaletteAndWaitForContext();

    clickFirstHeaderButton("Selected Civitai Resources");
    const civitaiWrapper = getStackColumnWrapper("Selected Civitai Resources");

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("Checkpoint Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Dream Checkpoint");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Ink Checkpoint");
    });

    mockFetch({
      selectedResourcesResponse: () =>
        jsonResponse({ error: { message: "Selected resource refresh failed" } }, false),
    });

    act(() => {
      useEditorStore.getState().updateProjectSettings({
        selectedCivitaiCheckpointId: noBaseCheckpointResource.id,
        selectedCivitaiLoraIds: [],
      });
    });

    const segmentedButtons = (civitaiWrapper.children[0] as HTMLElement).querySelectorAll("button");
    const loraTabButton = Array.from(segmentedButtons).find((button) => button.textContent?.includes("LoRA"));
    expect(loraTabButton).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      (loraTabButton as HTMLButtonElement).click();
    });

    await waitFor(() => {
      expect(civitaiWrapper.children[0]?.textContent).toContain("LoRA Quick Select");
      expect(civitaiWrapper.children[0]?.textContent).toContain("Selected checkpoint has no base model metadata.");
      expect(container.textContent).toContain("Selected resource refresh failed");
    });

    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Dream Checkpoint");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Ink Checkpoint");
    expect(civitaiWrapper.children[0]?.textContent).not.toContain("Neon Detail LoRA");
    expect(countCivitaiResourceFetches({ resourceType: "lora" })).toBe(0);
  });

  it("keeps Subject Input outside resource refreshes while refreshing the ComfyUI prompt key", async () => {
    await openPaletteAndWaitForContext();

    const initialPromptRefreshKey = dialogProps.at(-1)?.promptRefreshKey;
    const subjectInput = getSubjectInput();

    await act(async () => {
      setInputValue(subjectInput, "custom_subject");
    });

    act(() => {
      getButtonByAriaLabel("Remove LoRA Neon Detail LoRA")?.click();
    });

    await waitFor(() => {
      expect(String(dialogProps.at(-1)?.activePrompt)).not.toContain("neon_detail");
    });

    expect(getSubjectInput().value).toBe("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("custom_subject");
    expect(dialogProps.at(-1)?.promptRefreshKey).not.toBe(initialPromptRefreshKey);

    const presetSelect = getPresetSelect();
    await act(async () => {
      presetSelect.value = STYLE_PALETTE_PROMPT_PRESETS[1].id;
      presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(getSubjectInput().value).toBe("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("custom_subject");
    expect(dialogProps.at(-1)?.promptRefreshKey).not.toBe(initialPromptRefreshKey);
  });

  it("places Subject Input before palette selections and refreshes prompt key across checkpoint, advice, and preset context", async () => {
    await openPaletteAndWaitForContext();

    const lockedPositive = getTextElement("Locked Positive");
    const subjectHeading = getTextElement("Subject Input");
    const selectedArtistHeading = getTextElement("Selected Artist Strings");

    expect(lockedPositive.compareDocumentPosition(subjectHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(subjectHeading.compareDocumentPosition(selectedArtistHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await act(async () => {
      setInputValue(getSubjectInput(), "custom_subject");
    });

    const subjectKey = dialogProps.at(-1)?.promptRefreshKey;
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("stored artist prompt");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("neon_detail");

    act(() => {
      useEditorStore.getState().updateProjectSettings({ selectedCivitaiCheckpointId: alternateCheckpointResource.id });
    });

    await waitFor(() => {
      expect(dialogProps.at(-1)?.selectedCheckpointId).toBe(alternateCheckpointResource.id);
      expect(getButtonByAriaLabel("Remove checkpoint Ink Checkpoint")).not.toBeNull();
    });

    const checkpointKey = dialogProps.at(-1)?.promptRefreshKey;
    expect(checkpointKey).not.toBe(subjectKey);
    expect(getSubjectInput().value).toBe("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("custom_subject");

    await act(async () => {
      getButtonByText("Generate").click();
    });

    await waitFor(() => {
      expect(dialogProps.at(-1)?.advice).toEqual(
        expect.objectContaining({ overallEffect: "Crisp anime lighting with controlled detail." }),
      );
    });

    const adviceKey = dialogProps.at(-1)?.promptRefreshKey;
    expect(adviceKey).not.toBe(checkpointKey);

    const presetSelect = getPresetSelect();
    await act(async () => {
      presetSelect.value = STYLE_PALETTE_PROMPT_PRESETS[1].id;
      presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => {
      expect(dialogProps.at(-1)?.baseNegativePrompt).toBe(STYLE_PALETTE_PROMPT_PRESETS[1].negative);
    });

    expect(dialogProps.at(-1)?.promptRefreshKey).not.toBe(adviceKey);
    expect(getSubjectInput().value).toBe("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("custom_subject");
  });

  it("converts the Subject Input through the existing LLM chat endpoint", async () => {
    await openPaletteAndWaitForContext();

    const subjectInput = getSubjectInput();
    await act(async () => {
      setInputValue(subjectInput, "Hatsune Miku");
    });

    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("Hatsune Miku");

    const convertButton = getButtonByAriaLabel("Convert subject to Danbooru tags");
    expect(convertButton).not.toBeNull();

    await act(async () => {
      convertButton?.click();
    });

    await waitFor(() => {
      expect(getSubjectInput().value).toBe("hatsune_miku, 1girl, twintails");
    });

    const chatCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input) === "/api/llm/chat");
    const chatRequest = JSON.parse(String((chatCall?.[1] as RequestInit | undefined)?.body));

    expect(chatRequest).toMatchObject({
      purpose: "stable-diffusion-prompt-generation",
      temperature: 0.1,
      maxTokens: 120,
    });
    expect(chatRequest.messages[0].content).toContain("Return only comma-separated tags");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("hatsune_miku, 1girl, twintails");
  });

  it("does not overwrite newer Subject Input text with a stale Danbooru response", async () => {
    const deferred = createDeferredResponse();
    mockFetch({ llmChatResponse: () => deferred.promise });
    await openPaletteAndWaitForContext();

    await act(async () => {
      setInputValue(getSubjectInput(), "Hatsune Miku");
    });

    const convertButton = getButtonByAriaLabel("Convert subject to Danbooru tags");
    expect(convertButton).not.toBeNull();

    act(() => {
      convertButton?.click();
    });

    await act(async () => {
      setInputValue(getSubjectInput(), "custom_subject");
    });

    await act(async () => {
      deferred.resolve(jsonResponse({ content: "hatsune_miku, 1girl", role: "assistant" }));
      await deferred.promise;
    });

    await waitFor(() => {
      expect(convertButton?.disabled).toBe(false);
    });
    expect(getSubjectInput().value).toBe("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).toContain("custom_subject");
    expect(String(dialogProps.at(-1)?.activePrompt)).not.toContain("hatsune_miku");
  });

  it("disables Danbooru conversion while loading and reports conversion errors", async () => {
    const deferred = createDeferredResponse();
    mockFetch({ llmChatResponse: () => deferred.promise });
    await openPaletteAndWaitForContext();

    await act(async () => {
      setInputValue(getSubjectInput(), "Miku");
    });

    const convertButton = getButtonByAriaLabel("Convert subject to Danbooru tags");
    expect(convertButton).not.toBeNull();

    act(() => {
      convertButton?.click();
    });

    expect(convertButton?.disabled).toBe(true);

    await act(async () => {
      deferred.resolve(jsonResponse({ error: { message: "LLM unavailable" } }, false));
      await deferred.promise;
    });

    await waitFor(() => {
      expect(container.textContent).toContain("LLM unavailable");
    });
    expect(getSubjectInput().value).toBe("Miku");
  });
});
