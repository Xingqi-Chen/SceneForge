import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  completeTimelineNode,
  confirmTimelineGeneration,
  failTimelineNode,
  type TimelineWorkflowState,
} from "@/features/agent-timeline";
import type { PromptTag } from "@/shared/types";

const savePromptLibraryMock = vi.hoisted(() =>
  vi.fn((state: unknown) => {
    void state;
    return Promise.resolve();
  }),
);

vi.mock("@/features/editor/components/CanvasViewport", () => ({
  CanvasViewport: ({
    lockedSceneMode,
    showSceneModeSwitcher,
  }: {
    lockedSceneMode?: "2d" | "3d";
    showSceneModeSwitcher?: boolean;
  }) => (
    <div
      data-locked-scene-mode={lockedSceneMode ?? ""}
      data-show-scene-mode-switcher={String(showSceneModeSwitcher ?? true)}
      data-testid="existing-editor-canvas-viewport"
    >
      Existing editor 3D canvas viewport
    </div>
  ),
}));

vi.mock("@/features/editor/components/PromptTagPickerPanel", () => ({
  PromptTagPickerPanel: () => (
    <div data-testid="existing-prompt-tag-picker-panel">Existing prompt tag picker panel</div>
  ),
}));

vi.mock("@/features/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/features/persistence")>(
    "@/features/persistence",
  );

  return {
    ...actual,
    savePromptLibrary: savePromptLibraryMock,
  };
});

import { TimelineShell } from "./TimelineShell";

const nodeTitles = [
  "Scene input",
  "Prompt generation",
  "Character tags",
  "Action planning",
  "Layout planning",
  "Model resources",
  "Render prompt",
  "Review / export",
  "Render execution",
  "Artifact result",
];

let container: HTMLDivElement;
let root: Root;

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createConfirmedGenerationWorkflow(workflow: TimelineWorkflowState) {
  let confirmedWorkflow = confirmTimelineGeneration(workflow);
  confirmedWorkflow = completeTimelineNode(
    confirmedWorkflow,
    "comfyui-execution",
    {
      nodeIds: {},
      outputNodeId: "9",
      promptId: "prompt-confirmed",
      request: {
        batchSize: 1,
        checkpointName: "Cyber Checkpoint__v1__mv101.safetensors",
        positivePrompt: "neon market alley, sunrise, courier sprinting",
        preview: false,
      },
      warnings: [],
    },
    "system",
  );
  confirmedWorkflow = completeTimelineNode(
    confirmedWorkflow,
    "result-display",
    {
      completed: true,
      image: {
        filename: "timeline-confirmed.png",
        nodeId: "9",
        type: "output",
        url: "/api/comfyui/generated-images/timeline-confirmed.png",
      },
      promptId: "prompt-confirmed",
      sourceImage: {
        filename: "timeline-confirmed.png",
        nodeId: "9",
        type: "output",
      },
      storedImage: {
        byteLength: 12,
        contentType: "image/png",
        filename: "timeline-confirmed.png",
        url: "/api/comfyui/generated-images/timeline-confirmed.png",
      },
      warnings: [],
    },
    "system",
  );

  return confirmedWorkflow;
}

function createObjectInfoMismatchWorkflow(workflow: TimelineWorkflowState) {
  const message = [
    "ComfyUI request does not match the current ComfyUI model/node options.",
    "Checkpoint is not available in ComfyUI: missing.safetensors",
    "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
  ].join(" ");

  return failTimelineNode(confirmTimelineGeneration(workflow), "comfyui-execution", {
    code: "comfyui_object_info_mismatch",
    message,
    details: {
      errors: [
        "Checkpoint is not available in ComfyUI: missing.safetensors",
        "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
      ],
    },
  });
}

function createPoseResponse() {
  return JSON.stringify({
    characterDescription: "courier leaping across wet pavement",
    targets: {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0.08 },
      head: { x: 0, y: 1.72, z: 0.1 },
      leftHand: { x: -0.5, y: 1.25, z: 0.2 },
      rightHand: { x: 0.45, y: 1.36, z: -0.1 },
      leftFoot: { x: -0.2, y: 0.35, z: 0.22 },
      rightFoot: { x: 0.25, y: 0.04, z: -0.08 },
    },
    poles: {
      leftElbowPole: { x: -0.65, y: 1.2, z: 0.25 },
      rightElbowPole: { x: 0.65, y: 1.2, z: 0.15 },
      leftKneePole: { x: -0.28, y: 0.58, z: 0.8 },
      rightKneePole: { x: 0.28, y: 0.52, z: 0.2 },
    },
  });
}

function getFetchPurpose(init: RequestInit | undefined) {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as { purpose?: string }).purpose : undefined;
}

function getFetchUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function makeCivitaiResource(resourceType: "lora" | "model", id: string, name: string) {
  return {
    id,
    resourceType,
    civitaiModelId: 10,
    civitaiModelVersionId: resourceType === "model" ? 101 : 201,
    name,
    versionName: "v1",
    hash: null,
    baseModel: "Illustrious",
    creator: "creator",
    trainedWords: resourceType === "lora" ? ["neon_style"] : [],
    tags: ["anime", "neon"],
    description: "Neon resource",
    downloadUrl: null,
    filesJson: [
      {
        name: `${name}.safetensors`,
        primary: true,
        type: "Model",
      },
    ],
    officialImagesJson: [],
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style"] : [],
    usageGuide: null,
    recommendations: [
      {
        condition: "neon scene",
        baseModel: "Illustrious",
        checkpoint: null,
        sampler: "euler",
        loraWeightMin: null,
        loraWeightMax: null,
        loraWeight: resourceType === "lora" ? 0.72 : null,
        hdRedrawRate: null,
        notes: null,
      },
    ],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: false,
    aiNsfwLevel: "sfw",
    aiNsfwConfidence: 0.8,
    aiNsfwReason: "safe",
    rawVersionJson: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    importedImageCount: 2,
    averageWeight: resourceType === "lora" ? 0.72 : null,
    minWeight: resourceType === "lora" ? 0.6 : null,
    maxWeight: resourceType === "lora" ? 0.9 : null,
    previewImage: null,
  };
}

const checkpointResource = makeCivitaiResource("model", "checkpoint-a", "Cyber Checkpoint");
const loraResource = makeCivitaiResource("lora", "lora-a", "Neon LoRA");

function createTimelineRecommendationResponse() {
  return createJsonResponse({
    checkpoint: {
      resource: {
        ...checkpointResource,
        resourceType: "model",
        descriptionSnippet: "Neon resource",
        modelFileName: "Cyber Checkpoint__v1__mv101.safetensors",
        modelStorageKind: "checkpoint",
      },
      reason: "Local checkpoint fits the neon scene.",
    },
    loras: [
      {
        resource: {
          ...loraResource,
          resourceType: "lora",
          descriptionSnippet: "Neon resource",
          modelFileName: "Neon LoRA__v1__mv201.safetensors",
        },
        suggestedWeight: 0.72,
        reason: "Adds neon styling.",
      },
    ],
    recommendationReason: "Selected from local Civitai candidates.",
    overallEffect: "Neon anime rendering.",
    warnings: [],
  });
}

function createT5ResponseForPurpose(purpose: string | undefined) {
  if (purpose === "stable-diffusion-prompt-generation") {
    return createJsonResponse({
      role: "assistant",
      content: JSON.stringify({
        positivePrompt: "neon market alley, sunrise, courier sprinting",
        primaryCharacter: {
          name: "Courier",
          identity: "A focused courier in a reflective jacket",
          publicFacts: ["solo courier protagonist", "reflective jacket"],
        },
        sceneIntent: "Courier sprints through a neon market alley at sunrise",
        styleTone: "cinematic realism",
        setting: "neon market alley",
        sharedFacts: ["sunrise", "wet pavement"],
        negativeSuggestions: ["low detail"],
        style: [{ label: "Cinematic", prompt: "cinematic realism" }],
        camera: [{ label: "Wide", prompt: "wide angle tracking shot" }],
        lighting: [{ label: "Rim", prompt: "warm sunrise rim light" }],
      }),
    });
  }

  if (purpose === "prompt-tag-reverse") {
    return createJsonResponse({
      role: "assistant",
      content: JSON.stringify({
        items: [
          {
            targetKind: "character",
            label: "快递员",
            prompt: "solo courier protagonist",
            category: "character",
            subcategory: "character-subject",
          },
          {
            targetKind: "bodyPart",
            label: "反光夹克",
            prompt: "reflective yellow jacket",
            category: "outfit",
            subcategory: "outfit-upper",
            bodyPartId: "torso",
          },
        ],
      }),
    });
  }

  return createJsonResponse({
    role: "assistant",
    content: createPoseResponse(),
  });
}

function mockT5Fetch() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = getFetchUrl(input);

    if (url.startsWith("/api/civitai-lora-library/resources")) {
      return createJsonResponse({
        items: url.includes("resourceType=model") ? [checkpointResource] : [loraResource],
      });
    }

    if (url === "/api/civitai-lora-library/ai-recommendation") {
      return createTimelineRecommendationResponse();
    }

    if (url === "/api/comfyui/sampler-options") {
      return createJsonResponse({
        samplers: ["euler", "dpmpp_2m"],
        schedulers: ["normal", "karras"],
      });
    }

    return createT5ResponseForPurpose(getFetchPurpose(init));
  });
}

function mockT5FetchWithDeferredPose() {
  const poseRequests: Array<{
    reject: (reason?: unknown) => void;
    resolve: (response: Response) => void;
  }> = [];

  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    const url = getFetchUrl(_input);
    if (url.startsWith("/api/civitai-lora-library/resources")) {
      return createJsonResponse({
        items: url.includes("resourceType=model") ? [checkpointResource] : [loraResource],
      });
    }

    if (url === "/api/civitai-lora-library/ai-recommendation") {
      return createTimelineRecommendationResponse();
    }

    if (url === "/api/comfyui/sampler-options") {
      return createJsonResponse({ samplers: ["euler"], schedulers: ["normal"] });
    }

    const purpose = getFetchPurpose(init);

    if (purpose !== "stick-figure-pose-generation") {
      return createT5ResponseForPurpose(purpose);
    }

    return new Promise<Response>((resolve, reject) => {
      poseRequests.push({
        reject,
        resolve,
      });
    });
  });

  return { fetchMock, poseRequests };
}

function mockT5FetchWithDeferredPrompt() {
  const promptRequests: Array<{
    reject: (reason?: unknown) => void;
    resolve: (response: Response) => void;
  }> = [];

  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    const url = getFetchUrl(_input);
    if (url.startsWith("/api/civitai-lora-library/resources")) {
      return createJsonResponse({
        items: url.includes("resourceType=model") ? [checkpointResource] : [loraResource],
      });
    }

    if (url === "/api/civitai-lora-library/ai-recommendation") {
      return createTimelineRecommendationResponse();
    }

    if (url === "/api/comfyui/sampler-options") {
      return createJsonResponse({ samplers: ["euler"], schedulers: ["normal"] });
    }

    const purpose = getFetchPurpose(init);

    if (purpose !== "stable-diffusion-prompt-generation") {
      return createT5ResponseForPurpose(purpose);
    }

    return new Promise<Response>((resolve, reject) => {
      promptRequests.push({
        reject,
        resolve,
      });
    });
  });

  return { fetchMock, promptRequests };
}

async function flushAsyncWork(cycles = 6) {
  for (let index = 0; index < cycles; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function getButtonByText(label: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  return button as HTMLButtonElement;
}

function getSectionByHeading(headingText: string) {
  const heading = Array.from(container.querySelectorAll("h2")).find(
    (candidate) => candidate.textContent?.trim() === headingText,
  );
  const section = heading?.closest("section");

  if (!section) {
    throw new Error(`Unable to find section "${headingText}".`);
  }

  return section as HTMLElement;
}

function getWorkflowStepTitles() {
  return Array.from(container.querySelectorAll("button[data-node-id]"))
    .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .map((text) => nodeTitles.find((title) => text.includes(title)))
    .filter((title): title is string => Boolean(title));
}

function setNativeTextAreaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set textarea value.");
  }

  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;

  if (!setter) {
    throw new Error("Unable to set select value.");
  }

  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function submitInitialScene(sceneRequest: string) {
  const textarea = container.querySelector("#scene-request") as HTMLTextAreaElement | null;
  const form = container.querySelector("form");

  if (!textarea || !form) {
    throw new Error("Initial scene form is not rendered.");
  }

  act(() => {
    setNativeTextAreaValue(textarea, sceneRequest);
  });

  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await flushAsyncWork();
}

function createPromptLibraryTag(patch: Partial<PromptTag> = {}): PromptTag {
  return {
    id: patch.id ?? "library-courier",
    label: patch.label ?? "Library courier",
    prompt: patch.prompt ?? "solo courier protagonist",
    category: patch.category ?? "character",
    subcategory: patch.subcategory ?? "character-subject",
    negative: patch.negative ?? false,
    weight: patch.weight ?? { enabled: true, value: 1.35 },
  };
}

function setPromptLibraryTags(promptLibraryTags: PromptTag[]) {
  const project = createDefaultProject();
  project.settings.promptLibraryTags = promptLibraryTags;
  useEditorStore.getState().setProject(project);
}

function setProjectSupportsNsfw(supportsNsfw: boolean) {
  const project = createDefaultProject();
  project.settings.supportsNsfw = supportsNsfw;
  useEditorStore.getState().setProject(project);
}

async function choosePromptTagReviewOption(label: string) {
  act(() => {
    getButtonByText(label).click();
  });

  await flushAsyncWork();
}

async function submitSceneAndChoosePromptTagReview(sceneRequest: string, label: string) {
  await submitInitialScene(sceneRequest);
  await choosePromptTagReviewOption(label);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  savePromptLibraryMock.mockClear();
  useEditorStore.getState().setProject(createDefaultProject());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("TimelineShell", () => {
  it("starts with the workbench, workflow steps, scene composer, and disabled run actions for blank input", () => {
    act(() => {
      root.render(<TimelineShell />);
    });

    const sceneInput = container.querySelector("#scene-request") as HTMLTextAreaElement | null;
    const promptProfile = container.querySelector("#prompt-profile") as HTMLSelectElement | null;
    const startButton = getButtonByText("Start workflow");
    const settingsLink = container.querySelector('a[href="/settings"]');

    expect(sceneInput).not.toBeNull();
    expect(promptProfile?.value).toBe("illustrious");
    expect(Array.from(promptProfile?.options ?? []).map((option) => option.value)).toEqual([
      "illustrious",
      "anima",
      "generic",
    ]);
    expect(startButton.disabled).toBe(true);
    expect(settingsLink?.textContent).toContain("Settings");
    expect(getWorkflowStepTitles()).toEqual(nodeTitles);
    expect(container.textContent?.match(/Parallel/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Inspector");
    expect(container.textContent).toContain("Agent activity");
    expect(container.textContent).toContain("Tool calls");
    expect(container.textContent).toContain("Generated artifacts");

    const workbench = container.querySelector(".sf-agent-workbench");
    const nav = container.querySelector(".sf-agent-workbench__nav");
    const main = container.querySelector(".sf-agent-workbench__main");
    const inspector = container.querySelector(".sf-agent-workbench__inspector");
    const middleWorkspace = main?.querySelector(".mx-auto");
    const selectedStepCard = main?.querySelector("article");

    expect(workbench?.className).toContain("lg:flex-row");
    expect(nav?.className).toContain("order-2");
    expect(nav?.className).toContain("lg:order-1");
    expect(main?.className).toContain("order-1");
    expect(main?.className).toContain("lg:order-2");
    expect(middleWorkspace?.className).toContain("max-w-7xl");
    expect(selectedStepCard?.className).toContain("min-h-[50rem]");
    expect(inspector?.className).toContain("order-3");

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("Waiting for scene command.");

    act(() => {
      setNativeTextAreaValue(sceneInput as HTMLTextAreaElement, "   ");
    });

    expect(getButtonByText("Start workflow").disabled).toBe(true);
  });

  it("persists the selected prompt profile in scene input before prompt generation", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockT5Fetch();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      const promptProfile = container.querySelector("#prompt-profile") as HTMLSelectElement | null;
      expect(promptProfile).not.toBeNull();

      act(() => {
        setNativeSelectValue(promptProfile as HTMLSelectElement, "anima");
      });

      await submitInitialScene("A rainy courier under station lights");

      const promptRequest = fetchMock.mock.calls
        .map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : null))
        .find((body) => body?.purpose === "stable-diffusion-prompt-generation");

      expect(promptRequest).toBeDefined();
      expect(promptRequest.messages[0].content).toContain("Selected prompt profile: Anima (anima)");
      expect(JSON.parse(promptRequest.messages[1].content)).toMatchObject({
        promptProfile: "anima",
        sceneRequest: "A rainy courier under station lights",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("submits a usable scene request through timeline recommendations without persistence or execution calls", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const originalFetch = globalThis.fetch;
    const fetchMock = mockT5Fetch();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("  A neon market alley with a courier at sunrise  ");
      expect(document.body.textContent).toContain("导入新的部位提示词");
      expect(document.body.textContent).toContain("仅选中已有词条");
      expect(document.body.textContent).toContain("本次保留，不入词库");
      expect(document.body.textContent).toContain("导入并选中");

      await choosePromptTagReviewOption("本次保留，不入词库");

      expect(getWorkflowStepTitles()).toEqual(nodeTitles);
      expect(container.textContent).toContain("A neon market alley with a courier at sunrise");

      const sceneInputButton = container.querySelector('button[data-node-id="scene-input"]') as HTMLButtonElement | null;
      act(() => {
        sceneInputButton?.click();
      });

      const sceneInputSection = getSectionByHeading("Scene input");
      expect(sceneInputSection.textContent).toContain("Done");
      expect(sceneInputSection.textContent).toContain("A neon market alley with a courier at sunrise");
      expect(sceneInputSection.textContent).toContain("Rewrite");

      const promptStepButton = container.querySelector('button[data-node-id="scene-prompt"]') as HTMLButtonElement | null;
      expect(promptStepButton).not.toBeNull();

      act(() => {
        promptStepButton?.click();
      });

      const scenePromptSection = getSectionByHeading("Prompt generation");
      expect(scenePromptSection.textContent).toContain("Done");
      expect(scenePromptSection.textContent).toContain("Scene context table");
      expect(scenePromptSection.textContent).toContain("Save context");
      expect(
        (scenePromptSection.querySelector('textarea[aria-label="Positive prompt"]') as HTMLTextAreaElement | null)
          ?.value,
      ).toContain("neon market alley, sunrise, courier sprinting");
      expect(scenePromptSection.textContent).toContain("Regenerate");

      const characterTagsButton = container.querySelector('button[data-node-id="character-tags"]') as HTMLButtonElement | null;
      act(() => {
        characterTagsButton?.click();
      });

      const characterTagsSection = getSectionByHeading("Character tags");
      expect(characterTagsSection.textContent).toContain("Non-editable");
      expect(characterTagsSection.textContent).toContain("Raw JSON only");
      expect(characterTagsSection.textContent).toContain("Inspect only");
      expect(characterTagsSection.textContent).toContain("reflective yellow jacket");
      expect(characterTagsSection.textContent).not.toContain("Existing editor 3D canvas viewport");
      expect(characterTagsSection.textContent).not.toContain("Existing prompt tag picker panel");
      expect(characterTagsSection.textContent).not.toContain("Edit");

      const actionButton = container.querySelector('button[data-node-id="character-action"]') as HTMLButtonElement | null;
      act(() => {
        actionButton?.click();
      });

      const characterActionSection = getSectionByHeading("Action planning");
      expect(characterActionSection.textContent).toContain("Non-editable");
      expect(characterActionSection.textContent).toContain("Raw JSON only");
      expect(characterActionSection.textContent).toContain("Inspect only");
      expect(characterActionSection.textContent).toContain("courier leaping across wet pavement");
      expect(characterActionSection.textContent).not.toContain("Existing editor 3D canvas viewport");
      expect(characterActionSection.textContent).not.toContain("Existing prompt tag picker panel");
      expect(characterActionSection.textContent).not.toContain("Edit");

      const canvasButton = container.querySelector('button[data-node-id="canvas-binding"]') as HTMLButtonElement | null;
      act(() => {
        canvasButton?.click();
      });

      const canvasSection = getSectionByHeading("Layout planning");
      const canvasViewport = canvasSection.querySelector(
        '[data-testid="existing-editor-canvas-viewport"]',
      ) as HTMLElement | null;
      expect(canvasSection.textContent).toContain("Existing editor 3D canvas viewport");
      expect(canvasViewport?.dataset.lockedSceneMode).toBe("3d");
      expect(canvasViewport?.dataset.showSceneModeSwitcher).toBe("false");
      expect(canvasSection.textContent).toContain("Prompt library");
      expect(canvasSection.querySelector('[data-testid="timeline-prompt-library-drawer"]')).not.toBeNull();
      expect(canvasSection.querySelector('[data-testid="timeline-prompt-library-tag"]')).not.toBeNull();
      expect(canvasSection.textContent).not.toContain("Existing prompt tag picker panel");
      expect(canvasSection.textContent).toContain("Visual only");
      expect(canvasSection.textContent).not.toContain("Raw JSON");
      expect(canvasSection.textContent).toContain("3D layout binding active");
      expect(canvasSection.textContent).not.toContain("JSON diagnostics");
      expect(canvasSection.textContent).toContain("editable 3D character");
      expect(canvasSection.textContent).toContain("Courier");

      const promptLibraryToggle = canvasSection.querySelector(
        '[data-testid="timeline-prompt-library-toggle"]',
      ) as HTMLButtonElement | null;
      act(() => {
        promptLibraryToggle?.click();
      });
      expect(canvasSection.querySelector('[data-testid="timeline-prompt-library-drawer"]')).toBeNull();

      act(() => {
        promptLibraryToggle?.click();
      });
      expect(canvasSection.querySelector('[data-testid="timeline-prompt-library-drawer"]')).not.toBeNull();

      const resourceButton = container.querySelector('button[data-node-id="resource-recommendation"]') as HTMLButtonElement | null;
      act(() => {
        resourceButton?.click();
      });

      const resourceSection = getSectionByHeading("Model resources");
      expect(resourceSection.textContent).not.toContain("Reserved");
      expect(resourceSection.textContent).toContain("Cyber Checkpoint");
      expect(resourceSection.textContent).toContain("Neon LoRA");
      expect(resourceSection.querySelector('[data-testid="timeline-resource-workspace"]')).not.toBeNull();
      expect(resourceSection.textContent).toContain("Save resources");
      const resourceRawJsonButton = Array.from(resourceSection.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Raw JSON",
      ) as HTMLButtonElement | undefined;
      expect(resourceRawJsonButton).not.toBeUndefined();

      act(() => {
        resourceRawJsonButton?.click();
      });

      expect(resourceSection.textContent).toContain('"loras"');
      expect(resourceSection.textContent).toContain('"suggestedWeight": 0.72');
      expect(resourceSection.textContent).toContain('"modelFileName": "Neon LoRA__v1__mv201__201.safetensors"');

      const parameterButton = container.querySelector('button[data-node-id="parameter-recommendation"]') as HTMLButtonElement | null;
      act(() => {
        parameterButton?.click();
      });

      const parameterSection = getSectionByHeading("Render prompt");
      expect(parameterSection.textContent).not.toContain("Reserved");
      expect(parameterSection.querySelector('[data-testid="timeline-parameter-workspace"]')).not.toBeNull();
      expect(parameterSection.textContent).not.toContain("Request preview");
      expect(parameterSection.textContent).toContain("Save parameters");
      const parameterRawJsonButton = Array.from(parameterSection.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Raw JSON",
      ) as HTMLButtonElement | undefined;
      expect(parameterRawJsonButton).not.toBeUndefined();

      act(() => {
        parameterRawJsonButton?.click();
      });

      expect(parameterSection.textContent).toContain('"requestPreview"');
      expect(parameterSection.textContent).toContain('"loras"');
      expect(parameterSection.textContent).toContain('"strengthModel": 0.72');
      expect(parameterSection.textContent).toContain('"strengthClip": 0.72');

      const generationGateButton = container.querySelector('button[data-node-id="generation-gate"]') as HTMLButtonElement | null;
      act(() => {
        generationGateButton?.click();
      });

      const generationGateSection = getSectionByHeading("Review / export");
      expect(generationGateSection.textContent).toContain(
        "ComfyUI execution requires explicit confirmation. The timeline stops here until you confirm the single-image request.",
      );
      expect(generationGateSection.textContent).toContain("Confirm and render");

      const comfyButton = container.querySelector('button[data-node-id="comfyui-execution"]') as HTMLButtonElement | null;
      act(() => {
        comfyButton?.click();
      });

      const comfyExecutionSection = getSectionByHeading("Render execution");
      expect(comfyExecutionSection.textContent).toContain(
        "Waiting for explicit confirmation before queuing ComfyUI.",
      );

      const resultButton = container.querySelector('button[data-node-id="result-display"]') as HTMLButtonElement | null;
      act(() => {
        resultButton?.click();
      });

      const resultSection = getSectionByHeading("Artifact result");
      expect(resultSection.textContent).toContain(
        "Waiting for confirmed ComfyUI execution to return an image.",
      );

      expect(storageSpy).not.toHaveBeenCalled();
      expect(savePromptLibraryMock).not.toHaveBeenCalled();
      const fetchUrls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(fetchUrls).toEqual([
        "/api/llm/chat",
        "/api/llm/chat",
        "/api/llm/chat",
        "/api/civitai-lora-library/resources?resourceType=model&category=all&nsfw=sfw",
        "/api/civitai-lora-library/resources?resourceType=lora&category=all&nsfw=sfw",
        "/api/civitai-lora-library/ai-recommendation",
        "/api/comfyui/sampler-options",
      ]);
      expect(fetchUrls).not.toContain("/api/comfyui/generate-image");
      expect(fetchUrls).not.toContain("/api/comfyui/generated-images");
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(container.textContent).not.toMatch(/C:\\|SCENEFORGE_|API_KEY|generated-images|data\//);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loads local resource candidates with NSFW filtering enabled from project settings", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockT5Fetch();
    setProjectSupportsNsfw(true);
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitSceneAndChoosePromptTagReview(
        "A neon market alley with a courier at sunrise",
        "本次保留，不入词库",
      );

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        "/api/llm/chat",
        "/api/llm/chat",
        "/api/llm/chat",
        "/api/civitai-lora-library/resources?resourceType=model&category=all&nsfw=all",
        "/api/civitai-lora-library/resources?resourceType=lora&category=all&nsfw=all",
        "/api/civitai-lora-library/ai-recommendation",
        "/api/comfyui/sampler-options",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts to the confirmed-generation API only after clicking Confirm and render", async () => {
    const originalFetch = globalThis.fetch;
    const t5FetchMock = mockT5Fetch();
    const confirmPayloads: TimelineWorkflowState[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = getFetchUrl(input);

      if (url === "/api/agent-timeline/confirm-generation") {
        const payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        confirmPayloads.push(payload.workflow as TimelineWorkflowState);

        return createJsonResponse({
          workflow: createConfirmedGenerationWorkflow(payload.workflow as TimelineWorkflowState),
        });
      }

      return t5FetchMock(input, init);
    });

    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitSceneAndChoosePromptTagReview(
        "A neon market alley with a courier at sunrise",
        "本次保留，不入词库",
      );

      expect(fetchMock.mock.calls.map(([input]) => getFetchUrl(input))).not.toContain(
        "/api/agent-timeline/confirm-generation",
      );

      const generationGateButton = container.querySelector('button[data-node-id="generation-gate"]') as HTMLButtonElement | null;
      act(() => {
        generationGateButton?.click();
      });

      const confirmButton = getButtonByText("Confirm and render");
      expect(confirmButton.disabled).toBe(false);

      act(() => {
        confirmButton.click();
      });
      await flushAsyncWork();

      expect(confirmPayloads).toHaveLength(1);
      expect(confirmPayloads[0]?.generationConfirmed).toBe(false);
      expect(confirmPayloads[0]?.nodes["generation-gate"].status).toBe("blocked");
      expect(confirmPayloads[0]?.nodes["generation-gate"].error?.code).toBe("confirmation_required");

      const fetchUrls = fetchMock.mock.calls.map(([input]) => getFetchUrl(input));
      expect(fetchUrls.filter((url) => url === "/api/agent-timeline/confirm-generation")).toHaveLength(1);
      expect(fetchUrls).not.toContain("/api/comfyui/generate-image");
      expect(fetchUrls).not.toContain("/api/comfyui/generated-images");

      const resultSection = getSectionByHeading("Artifact result");
      expect(resultSection.textContent).toContain("Done");
      expect(resultSection.textContent).toContain("timeline-confirmed.png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("shows object_info mismatch details returned by confirmed timeline generation", async () => {
    const originalFetch = globalThis.fetch;
    const t5FetchMock = mockT5Fetch();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = getFetchUrl(input);

      if (url === "/api/agent-timeline/confirm-generation") {
        const payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};

        return createJsonResponse({
          workflow: createObjectInfoMismatchWorkflow(payload.workflow as TimelineWorkflowState),
        });
      }

      return t5FetchMock(input, init);
    });

    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitSceneAndChoosePromptTagReview(
        "A neon market alley with a courier at sunrise",
        "本次保留，不入词库",
      );

      const generationGateButton = container.querySelector('button[data-node-id="generation-gate"]') as HTMLButtonElement | null;
      act(() => {
        generationGateButton?.click();
      });

      const confirmButton = getButtonByText("Confirm and render");
      act(() => {
        confirmButton.click();
      });
      await flushAsyncWork();

      const comfyExecutionSection = getSectionByHeading("Render execution");
      expect(comfyExecutionSection.textContent).toContain(
        "ComfyUI request does not match the current ComfyUI model/node options.",
      );
      expect(comfyExecutionSection.textContent).toContain(
        "Checkpoint is not available in ComfyUI: missing.safetensors",
      );
      expect(comfyExecutionSection.textContent).toContain(
        "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("binds only existing library tags when skipping new Node 5 prompt tags", async () => {
    const originalFetch = globalThis.fetch;
    const existingTag = createPromptLibraryTag({
      id: "library-existing-courier",
      label: "Existing courier",
      prompt: "  SOLO COURIER PROTAGONIST  ",
      weight: { enabled: true, value: 1.4 },
    });
    setPromptLibraryTags([existingTag]);
    globalThis.fetch = mockT5Fetch();

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("A neon market alley with a courier at sunrise");

      expect(document.body.textContent).toContain("导入新的部位提示词");
      expect(document.body.textContent).toContain("仅选中已有词条");
      expect(document.body.textContent).toContain("本次保留，不入词库");
      expect(document.body.textContent).toContain("导入并选中");

      await choosePromptTagReviewOption("仅选中已有词条");

      const character = useEditorStore.getState().project.scene.characters[0];
      const torso = character.bodyParts.find((bodyPart) => bodyPart.id === "torso");

      expect(character.promptTags).toHaveLength(1);
      expect(character.promptTags[0]).toMatchObject({
        label: "Existing courier",
        prompt: "  SOLO COURIER PROTAGONIST  ",
        weight: { enabled: true, value: 1.4 },
      });
      expect(character.promptTags[0]?.id).toMatch(/^timeline-t5-/);
      expect(torso?.promptTags).toEqual([]);
      expect(useEditorStore.getState().project.settings.promptLibraryTags).toHaveLength(1);
      expect(savePromptLibraryMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("binds new Node 5 prompt tags transiently without growing the prompt library", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockT5Fetch();

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitSceneAndChoosePromptTagReview(
        "A neon market alley with a courier at sunrise",
        "本次保留，不入词库",
      );

      const state = useEditorStore.getState();
      const character = state.project.scene.characters[0];
      const torso = character.bodyParts.find((bodyPart) => bodyPart.id === "torso");

      expect(character.promptTags.map((tag) => tag.prompt)).toEqual(["solo courier protagonist"]);
      expect(torso?.promptTags.map((tag) => tag.prompt)).toEqual(["reflective yellow jacket"]);
      expect(character.promptTags[0]?.id).toMatch(/^timeline-t5-/);
      expect(torso?.promptTags[0]?.id).toMatch(/^timeline-t5-/);
      expect(state.project.settings.promptLibraryTags).toEqual([]);
      expect(savePromptLibraryMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("imports and binds new Node 5 prompt tags when the review chooses import", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockT5Fetch();

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitSceneAndChoosePromptTagReview(
        "A neon market alley with a courier at sunrise",
        "导入并选中",
      );

      const state = useEditorStore.getState();
      const character = state.project.scene.characters[0];
      const torso = character.bodyParts.find((bodyPart) => bodyPart.id === "torso");

      expect(state.project.settings.promptLibraryTags.map((tag) => tag.prompt)).toEqual([
        "solo courier protagonist",
        "reflective yellow jacket",
      ]);
      expect(character.promptTags.map((tag) => tag.prompt)).toEqual(["solo courier protagonist"]);
      expect(torso?.promptTags.map((tag) => tag.prompt)).toEqual(["reflective yellow jacket"]);
      expect(character.promptTags[0]?.id).toMatch(/^timeline-t5-/);
      expect(torso?.promptTags[0]?.id).toMatch(/^timeline-t5-/);
      expect(savePromptLibraryMock).toHaveBeenCalledTimes(1);
      const savedLibrary = savePromptLibraryMock.mock.calls[0]?.[0] as
        | { promptLibraryTags: PromptTag[] }
        | undefined;
      expect(savedLibrary?.promptLibraryTags).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not apply Node 5 binding when the missing-tag review is canceled", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockT5Fetch();

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("A neon market alley with a courier at sunrise");

      const closeButton = document.body.querySelector(
        'button[aria-label="关闭新增提示词确认"]',
      ) as HTMLButtonElement | null;

      expect(closeButton).not.toBeNull();

      act(() => {
        closeButton?.click();
      });
      await flushAsyncWork();

      expect(useEditorStore.getState().project.scene.characters).toHaveLength(0);
      expect(container.textContent).toContain(
        "Layout planning prompt tag review was canceled. Rerun layout planning to try again.",
      );
      expect(getSectionByHeading("Layout planning").textContent).toContain("Blocked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores stale graph results and canvas binding after starting a new scene", async () => {
    const originalFetch = globalThis.fetch;
    const { fetchMock, poseRequests } = mockT5FetchWithDeferredPose();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("A stale neon market courier scene");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(poseRequests).toHaveLength(1);
      expect(container.textContent).toContain("A stale neon market courier scene");

      act(() => {
        getButtonByText("New scene").click();
      });

      expect((container.querySelector("#scene-request") as HTMLTextAreaElement | null)?.value).toBe("");
      expect(container.textContent).toContain("Waiting for scene command.");
      expect(container.textContent).not.toContain("A stale neon market courier scene");

      await act(async () => {
        poseRequests[0]?.resolve(createT5ResponseForPurpose("stick-figure-pose-generation"));
        await Promise.resolve();
      });
      await flushAsyncWork();

      const editorState = useEditorStore.getState();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((container.querySelector("#scene-request") as HTMLTextAreaElement | null)?.value).toBe("");
      expect(container.textContent).toContain("Waiting for scene command.");
      expect(container.textContent).not.toContain("A stale neon market courier scene");
      expect(container.textContent).not.toContain("neon market alley, sunrise, courier sprinting");
      expect(container.textContent).not.toContain("Courier");
      expect(editorState.project.scene.mode).toBe("2d");
      expect(editorState.project.scene.characters).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps a visual scene prompt save when an in-flight graph result resolves later", async () => {
    const originalFetch = globalThis.fetch;
    const { fetchMock, promptRequests } = mockT5FetchWithDeferredPrompt();
    globalThis.fetch = fetchMock;

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitInitialScene("A pending greenhouse scene");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(promptRequests).toHaveLength(1);

      const promptStepButton = container.querySelector('button[data-node-id="scene-prompt"]') as HTMLButtonElement | null;

      act(() => {
        promptStepButton?.click();
      });

      let scenePromptSection = getSectionByHeading("Prompt generation");
      let positivePrompt = scenePromptSection.querySelector(
        'textarea[aria-label="Positive prompt"]',
      ) as HTMLTextAreaElement | null;

      expect(positivePrompt).not.toBeNull();

      act(() => {
        setNativeTextAreaValue(positivePrompt as HTMLTextAreaElement, "manual visual scene context");
      });

      const saveContextButton = Array.from(scenePromptSection.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Save context",
      ) as HTMLButtonElement | undefined;

      expect(saveContextButton?.disabled).toBe(false);

      act(() => {
        saveContextButton?.click();
      });

      scenePromptSection = getSectionByHeading("Prompt generation");
      positivePrompt = scenePromptSection.querySelector(
        'textarea[aria-label="Positive prompt"]',
      ) as HTMLTextAreaElement | null;
      expect(positivePrompt?.value).toBe("manual visual scene context");

      await act(async () => {
        promptRequests[0]?.resolve(createT5ResponseForPurpose("stable-diffusion-prompt-generation"));
        await Promise.resolve();
      });
      await flushAsyncWork();

      scenePromptSection = getSectionByHeading("Prompt generation");
      positivePrompt = scenePromptSection.querySelector(
        'textarea[aria-label="Positive prompt"]',
      ) as HTMLTextAreaElement | null;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(positivePrompt?.value).toBe("manual visual scene context");
      expect(positivePrompt?.value).not.toContain("neon market alley, sunrise, courier sprinting");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces downstream stale status after a manual scene prompt edit", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockT5Fetch();

    try {
      act(() => {
        root.render(<TimelineShell />);
      });

      await submitSceneAndChoosePromptTagReview(
        "A glass greenhouse control room",
        "本次保留，不入词库",
      );

      const promptStepButton = container.querySelector('button[data-node-id="scene-prompt"]') as HTMLButtonElement | null;

      act(() => {
        promptStepButton?.click();
      });

      const scenePromptSection = getSectionByHeading("Prompt generation");
      const rawJsonButton = Array.from(scenePromptSection.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Raw JSON",
      ) as HTMLButtonElement | undefined;

      expect(rawJsonButton).not.toBeUndefined();

      act(() => {
        rawJsonButton?.click();
      });

      const editButton = Array.from(scenePromptSection.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Edit",
      ) as HTMLButtonElement | undefined;

      expect(editButton).not.toBeUndefined();

      act(() => {
        editButton?.click();
      });

      let draft = scenePromptSection.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(draft).not.toBeNull();

      act(() => {
        setNativeTextAreaValue(draft as HTMLTextAreaElement, "discarded prompt draft");
      });

      const cancelButton = Array.from(scenePromptSection.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Cancel"),
      ) as HTMLButtonElement | undefined;

      act(() => {
        cancelButton?.click();
      });

      act(() => {
        editButton?.click();
      });

      draft = scenePromptSection.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(draft?.value).toContain("neon market alley, sunrise, courier sprinting");

      act(() => {
        setNativeTextAreaValue(draft as HTMLTextAreaElement, "wide lens greenhouse command deck");
      });

      const saveButton = Array.from(scenePromptSection.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Save manual"),
      ) as HTMLButtonElement | undefined;

      expect(saveButton?.disabled).toBe(false);

      act(() => {
        saveButton?.click();
      });

      expect(getSectionByHeading("Prompt generation").textContent).toContain("Done");
      expect(getSectionByHeading("Prompt generation").textContent).toContain("wide lens greenhouse command deck");

      for (const title of nodeTitles.slice(2)) {
        const stepButton = Array.from(container.querySelectorAll("button[data-node-id]")).find((button) =>
          button.textContent?.includes(title),
        );

        expect(stepButton?.textContent).toContain("Pending");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
