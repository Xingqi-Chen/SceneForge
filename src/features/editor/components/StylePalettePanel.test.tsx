import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArtistStringItemRecord } from "@/features/artist-string-library";
import type { SelectedCivitaiResourcePreview, SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
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

const loraResource = createSelectedResource({
  id: "lora-1",
  name: "Neon Detail LoRA",
  resourceType: "lora",
  trainedWords: ["neon_detail"],
});

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

function selectedResourcesForUrl(url: string): SelectedCivitaiResourcesPreview {
  const paramsText = url.split("?")[1] ?? "";
  const params = new URLSearchParams(paramsText);
  const checkpointId = params.get("checkpointId");
  const loraIds = params.get("loraIds")?.split(",").filter(Boolean) ?? [];

  return {
    checkpoint: checkpointId === checkpointResource.id ? checkpointResource : null,
    loras: loraIds.includes(loraResource.id) ? [loraResource] : [],
  };
}

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("/api/civitai-lora-library/selected-resources")) {
        return jsonResponse(selectedResourcesForUrl(url));
      }

      if (url.startsWith("/api/artist-string-library/selected-resources")) {
        return jsonResponse({ items: url.includes("artist-1") ? [artistString] : [] });
      }

      if (url.startsWith("/api/artist-string-library/items")) {
        return jsonResponse({ categories: [], items: [artistString], platforms: [] });
      }

      if (url.startsWith("/api/civitai-lora-library/resources")) {
        return jsonResponse({ items: [] });
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

  it("uses only the selected style preset as the ComfyUI prompt refresh key", async () => {
    await openPaletteAndWaitForContext();

    const initialPromptRefreshKey = dialogProps.at(-1)?.promptRefreshKey;
    expect(initialPromptRefreshKey).toBe(STYLE_PALETTE_PROMPT_PRESETS[0].id);

    act(() => {
      getButtonByAriaLabel("Remove LoRA Neon Detail LoRA")?.click();
    });

    expect(dialogProps.at(-1)?.promptRefreshKey).toBe(initialPromptRefreshKey);

    const presetSelect = getPresetSelect();
    await act(async () => {
      presetSelect.value = STYLE_PALETTE_PROMPT_PRESETS[1].id;
      presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(dialogProps.at(-1)?.promptRefreshKey).toBe(STYLE_PALETTE_PROMPT_PRESETS[1].id);
  });
});
