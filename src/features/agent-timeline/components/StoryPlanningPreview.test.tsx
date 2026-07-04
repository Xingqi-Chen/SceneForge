import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTimelineWorkflowRecord,
  startStoryGraphWorkflow,
  type StoryWorkflowState,
} from "@/features/agent-timeline";

const dialogProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/features/editor/components/ImageGenerationPanel", () => ({
  ComfyUiGenerationDialog: (props: Record<string, unknown>) => {
    dialogProps.push(props);
    const open = props.open === true;
    const onSaveParameters = props.onSaveParameters as ((parameters: Record<string, unknown>) => void) | undefined;

    if (!open) {
      return null;
    }

    return (
      <div data-testid="mock-comfyui-generation-dialog">
        {props.introContent as ReactNode}
        <span>{props.parametersOnly === true ? "parameters-only" : "generation-enabled"}</span>
        {props.advice ? <span>advice-loaded</span> : null}
        <button
          onClick={() =>
            onSaveParameters?.({
              width: 832,
              height: 1216,
              seed: 98765,
              seedMode: "fixed",
              steps: 31,
              cfg: 4.25,
              samplerName: "euler",
              scheduler: "normal",
              denoise: 0.88,
              imageCount: 3,
              latentImageNode: "EmptyLatentImage",
              promptWrapper: { positivePrefix: "ignored", negativePrefix: "ignored" },
              inpaint: { denoise: 0.5, growMaskBy: 4, mode: "fill" },
              outputPrefix: "Ignored",
              faceDetailer: { enabled: true, detectorModelName: "bbox/custom-face.pt", steps: 18 },
              handDetailer: { enabled: true, detectorModelName: "bbox/custom-hand.pt", steps: 19 },
              loras: [],
              savedAt: "2026-06-15T00:00:00.000Z",
            })
          }
          type="button"
        >
          Save mock parameters
        </button>
      </div>
    );
  },
}));

import { StoryPlanningPreview } from "./StoryPlanningPreview";

let container: HTMLDivElement;
let root: Root;

function setNativeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;

  if (!setter) {
    throw new Error("Unable to set input value.");
  }

  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")?.set;

  if (!setter) {
    throw new Error("Unable to set select value.");
  }

  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

const resourceCandidates = {
  checkpoints: [
    {
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Illustrious",
      modelFileName: "local.safetensors",
    },
  ],
  loras: [],
};

function createCivitaiResourceItem(resourceType: "lora" | "model", id: string, name: string) {
  return {
    id,
    resourceType,
    name,
    versionName: "v1",
    baseModel: "Illustrious",
    civitaiModelVersionId: id === "checkpoint-local" ? 101 : 202,
    creator: "SceneForge Test",
    trainedWords: resourceType === "lora" ? ["neon market"] : [],
    tags: [],
    categories: [],
    usageGuide: null,
    averageWeight: null,
    minWeight: null,
    maxWeight: null,
    recommendations: [],
    previewImage: null,
    description: null,
    officialImagesJson: resourceType === "model"
      ? [
          { width: 896, height: 1152 },
          { width: 896, height: 1152 },
          { width: 1152, height: 896 },
        ]
      : null,
    importedImageCount: 1,
    downloadUrl: null,
    filesJson: [
      {
        name: resourceType === "model" ? "local.safetensors" : "local-lora.safetensors",
        type: "Model",
        primary: true,
      },
    ],
  };
}

const downloadedCheckpointItem = createCivitaiResourceItem("model", "checkpoint-local", "Local Checkpoint");
const downloadedLoraItem = createCivitaiResourceItem("lora", "lora-local", "Local LoRA");

function selectedResourcePreviewFromItem(item: ReturnType<typeof createCivitaiResourceItem>) {
  const fileName = item.resourceType === "model" ? "local.safetensors" : "local-lora.safetensors";

  return {
    id: item.id,
    resourceType: item.resourceType,
    name: item.name,
    versionName: item.versionName,
    baseModel: item.baseModel,
    creator: item.creator,
    trainedWords: item.trainedWords,
    tags: item.tags,
    categories: item.categories,
    usageGuide: item.usageGuide,
    descriptionSnippet: item.description,
    averageWeight: item.averageWeight,
    minWeight: item.minWeight,
    maxWeight: item.maxWeight,
    recommendations: item.recommendations,
    previewImage: item.previewImage,
    modelFileName: fileName,
    modelFileNameAliases: [fileName],
  };
}

const selectedCheckpointPreview = selectedResourcePreviewFromItem(downloadedCheckpointItem);
const selectedLoraPreview = selectedResourcePreviewFromItem(downloadedLoraItem);

function handleStoryResourceListFetch(target: string): Response | null {
  if (target.includes("/api/civitai-lora-library/resources?resourceType=model")) {
    return {
      ok: true,
      json: async () => ({
        items: [downloadedCheckpointItem],
      }),
    } as Response;
  }

  if (target.includes("/api/civitai-lora-library/resources?resourceType=lora")) {
    return {
      ok: true,
      json: async () => ({
        items: [downloadedLoraItem],
      }),
    } as Response;
  }

  return null;
}

function createPlannedWorkflow(rawIntent = "A detective follows a signal through a storm-lit city.") {
  return startStoryGraphWorkflow({
    rawIntent,
    targetShotCount: 2,
    nsfwEnabled: false,
    now: () => "2026-06-15T00:00:00.000Z",
    settingsSnapshot: {
      resourceCandidates,
    },
  });
}

function withExecution(workflow: StoryWorkflowState, promptPrefix = "prompt"): StoryWorkflowState {
  const execution = {
    storyId: workflow.storyId,
    mode: "final",
    status: "done",
    errors: [],
    readyShotIds: [],
    staleShotIds: [],
    updatedAt: "2026-06-15T00:00:01.000Z",
    shots: ["shot-1", "shot-2"].map((shotId) => ({
      shotId,
      sourceShotIds: shotId === "shot-2" ? ["shot-1"] : [],
      status: "done",
      updatedAt: "2026-06-15T00:00:01.000Z",
      queueMetadata: {
        outputNodeId: "9",
        promptId: `${promptPrefix}-${shotId}`,
        warnings: [],
      },
      resultReference: {
        completed: true,
        image: {
          filename: `${shotId}.png`,
          nodeId: "9",
          type: "output",
          url: `http://comfyui.test/view?filename=${promptPrefix}-${shotId}.png&type=output`,
        },
        promptId: `${promptPrefix}-${shotId}`,
        shotId,
        storedImage: {
          byteLength: 12,
          contentType: "image/png",
          filename: `${shotId}.png`,
          url: `/api/comfyui/generated-images/${promptPrefix}-${shotId}.png`,
        },
        warnings: [],
      },
    })),
  };
  const resultDisplay = {
    storyId: workflow.storyId,
    status: "complete",
    nsfwContext: {
      audienceRating: "safe",
      contentWarnings: [],
      enabled: false,
      rationale: "Safe test context.",
    },
    previewReferences: [],
    finalReferences: execution.shots.map((shot) => shot.resultReference),
    errors: [],
    updatedAt: execution.updatedAt,
  };

  return {
    ...workflow,
    generationConfirmed: true,
    nodes: {
      ...workflow.nodes,
      "shot-graph-execution": {
        nodeId: "shot-graph-execution",
        status: "done",
        source: "system",
        result: execution,
        updatedAt: execution.updatedAt,
      },
      "story-result-display": {
        nodeId: "story-result-display",
        status: "done",
        source: "system",
        result: resultDisplay,
        updatedAt: execution.updatedAt,
      },
    },
  };
}

function createStoryPlanningStreamResponse() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
  });

  return {
    close() {
      controller?.close();
    },
    response: new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson",
      },
    }),
    write(event: unknown) {
      controller?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    },
  };
}

async function clickButtonAsync(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );

  if (!button) {
    throw new Error(`Unable to find button "${label}".`);
  }

  await act(async () => {
    (button as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForPickerDebounce() {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  dialogProps.length = 0;
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

describe("StoryPlanningPreview", () => {
  it("opens a saved Story Graph workflow from the empty Story toolbar project menu", async () => {
    const savedWorkflow = createPlannedWorkflow("A saved Story Graph project opens from the toolbar.");
    const savedRecord = createTimelineWorkflowRecord({
      projectId: "story-workflow-opened",
      name: "Opened story workflow",
      workflow: savedWorkflow,
      sceneRequest: "A saved Story Graph project opens from the toolbar.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "story-input",
    });
    const activeSaveBodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/active-workflow") {
        if (init?.method === "PUT") {
          activeSaveBodies.push(typeof init.body === "string" ? JSON.parse(init.body) : null);
          return {
            ok: true,
            json: async () => ({
              ok: true,
              record: activeSaveBodies.at(-1),
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "",
        } as Response;
      }

      if (target === "/api/agent-timeline/workflows") {
        return {
          ok: true,
          json: async () => ({
            workflows: [
              {
                id: "run-workflow",
                name: "Run workflow",
                createdAt: "2026-06-05T00:00:00.000Z",
                updatedAt: "2026-06-05T00:01:00.000Z",
                workflowMode: "single-image",
              },
              {
                id: "story-workflow-opened",
                name: "Opened story workflow",
                createdAt: "2026-06-15T00:00:00.000Z",
                updatedAt: "2026-06-15T00:01:00.000Z",
                workflowMode: "story-graph",
              },
            ],
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/workflows/item?id=story-workflow-opened") {
        return {
          ok: true,
          json: async () => savedRecord,
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Start Story Graph");
    expect(container.textContent).toContain("New story");
    expect(container.textContent).toContain("Unnamed draft");
    expect(container.textContent).not.toContain("Opened story workflow");

    await clickButtonAsync("Unnamed draft");
    await flushAsyncWork();

    expect(container.textContent).toContain("Opened story workflow");
    expect(container.textContent).not.toContain("Run workflow");

    const openedWorkflowButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Opened story workflow"),
    ) as HTMLButtonElement | undefined;
    expect(openedWorkflowButton).not.toBeUndefined();

    await act(async () => {
      openedWorkflowButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("A saved Story Graph project opens from the toolbar.");
    expect(container.textContent).toContain("New story");
    expect(activeSaveBodies.at(-1)).toMatchObject({
      kind: "sceneforge-timeline-workflow",
      projectId: "story-workflow-opened",
      name: "Opened story workflow",
      selectedNodeId: "story-input",
      workflow: {
        workflowId: savedWorkflow.workflowId,
        workflowMode: "story-graph",
      },
    });
  });

  it("does not let a late active restore overwrite a newly started Story Graph workflow", async () => {
    let resolveActiveWorkflow: ((response: Response) => void) | null = null;
    const activeWorkflowResponse = new Promise<Response>((resolve) => {
      resolveActiveWorkflow = resolve;
    });
    const oldWorkflow = createPlannedWorkflow("An old autosaved story request.");
    const oldRecord = createTimelineWorkflowRecord({
      workflow: oldWorkflow,
      sceneRequest: "An old autosaved story request.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "story-input",
    });
    const newWorkflow = createPlannedWorkflow("A brand new story request.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/active-workflow") {
        return activeWorkflowResponse;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: newWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A brand new story request.");
    });
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("Step 13 / 15");
    expect(container.textContent).toContain("Generation gate summary");
    expect(container.textContent).not.toContain("old autosaved story request");

    await act(async () => {
      resolveActiveWorkflow?.({
        ok: true,
        json: async () => oldRecord,
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Step 13 / 15");
    expect(container.textContent).toContain("Generation gate summary");
    expect(container.textContent).not.toContain("old autosaved story request");
    expect(container.textContent).not.toContain("An old autosaved story request.");
  });

  it("restores an active Story Graph workflow and autosaves selected shot display state", async () => {
    vi.useFakeTimers();
    const plannedWorkflow = createPlannedWorkflow("A courier follows a restored signal.");
    const restoredWorkflow = withExecution(plannedWorkflow, "restored");
    const activeRecord = createTimelineWorkflowRecord({
      projectId: "story-workflow-restored",
      name: "Restored story workflow",
      workflow: restoredWorkflow,
      sceneRequest: "A courier follows a restored signal.",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 2,
      selectedNodeId: "shot-graph-execution",
      selectedStoryShotId: "shot-2",
      outputDisplayModes: {
        "shot-graph-execution": "visual",
      },
    });
    const activeSaveBodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/active-workflow") {
        if (init?.method === "PUT") {
          activeSaveBodies.push(typeof init.body === "string" ? JSON.parse(init.body) : null);
          return {
            ok: true,
            json: async () => ({
              ok: true,
              record: activeSaveBodies.at(-1),
            }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => activeRecord,
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await act(async () => {
        root.render(<StoryPlanningPreview />);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.textContent).toContain("User-started planning workflow");
      expect(container.textContent).toContain("Restored story workflow");
      expect(Array.from(container.querySelectorAll("img")).some((image) =>
        image.getAttribute("src") === "/api/comfyui/generated-images/restored-shot-1.png",
      )).toBe(true);
      expect(container.querySelector('article[data-selected="true"]')?.textContent).toContain("shot-2");

      const rawJsonButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Raw JSON",
      ) as HTMLButtonElement | undefined;
      expect(rawJsonButton).toBeDefined();

      await act(async () => {
        rawJsonButton?.click();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(activeSaveBodies.at(-1)).toMatchObject({
        kind: "sceneforge-timeline-workflow",
        projectId: "story-workflow-restored",
        name: "Restored story workflow",
        selectedNodeId: "shot-graph-execution",
        selectedStoryShotId: "shot-2",
        outputDisplayModes: {
          "shot-graph-execution": "json",
        },
        workflow: {
          workflowMode: "story-graph",
          workflowId: restoredWorkflow.workflowId,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts empty and initializes a user-started story graph workflow from request and optional shots", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({
            general: {
              nsfw: {
                supportsNsfw: true,
              },
            },
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Story input / start workflow");
    expect(container.textContent).toContain("New story");
    expect(container.textContent).toContain("Start Story Graph");
    expect(container.textContent).not.toContain("Rain Station Signal");
    expect(container.textContent).not.toContain("Audience rating follows Settings NSFW");
    expect(container.textContent).not.toContain("Title");
    expect(container.textContent).not.toContain("Content warnings");
    expect(container.textContent).not.toContain("NSFW context");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const shotsInput = container.querySelector("#story-target-shot-count") as HTMLInputElement | null;
    const img2imgDenoiseInput = container.querySelector("#story-img2img-denoise") as HTMLInputElement | null;
    const faceDetailerInput = container.querySelector("#story-face-detailer-enabled") as HTMLInputElement | null;
    const handDetailerInput = container.querySelector("#story-hand-detailer-enabled") as HTMLInputElement | null;

    expect(textarea).not.toBeNull();
    expect(shotsInput).not.toBeNull();
    expect(img2imgDenoiseInput).not.toBeNull();
    expect(faceDetailerInput?.checked).toBe(false);
    expect(handDetailerInput?.checked).toBe(false);
    expect(img2imgDenoiseInput?.value).toBe("0.9");
    const baseModelSelect = container.querySelector("select") as HTMLSelectElement | null;

    expect(baseModelSelect).not.toBeNull();
    expect(baseModelSelect?.value).toBe("illustrious");

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
      setNativeInputValue(shotsInput as HTMLInputElement, "4");
      setNativeInputValue(img2imgDenoiseInput as HTMLInputElement, "0.72");
    });
    const startPlanningButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Start planning",
    );
    expect(startPlanningButton?.parentElement?.className).toContain("border-t");
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("New story");
    expect(container.textContent).toContain("15 steps");
    expect(container.textContent).toContain("Step 13 / 15");
    expect(container.textContent).toContain("Start shot generation");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-timeline/story/run-planning",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const planningBody = JSON.parse(String(
      fetchMock.mock.calls.find(([input]) => input === "/api/agent-timeline/story/run-planning")?.[1]?.body ?? "{}",
    )) as {
      settingsSnapshot?: {
        detailers?: {
          faceDetailer?: { enabled?: boolean };
          handDetailer?: { enabled?: boolean };
        };
        img2imgDenoise?: number;
        promptProfile?: string;
        resourceCandidates?: unknown;
      };
    };
    expect(planningBody.settingsSnapshot?.detailers).toMatchObject({
      faceDetailer: { enabled: false },
      handDetailer: { enabled: false },
    });
    expect(planningBody.settingsSnapshot?.img2imgDenoise).toBe(0.72);
    expect(planningBody.settingsSnapshot?.promptProfile).toBe("illustrious");
    expect(planningBody.settingsSnapshot?.resourceCandidates).toBeUndefined();

    const executionButton = container.querySelector('button[data-node-id="shot-graph-execution"]') as HTMLButtonElement | null;

    expect(executionButton?.textContent).toContain("blocked");
  });

  it("passes Story detailer checkboxes without requiring a checkpoint", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const faceDetailerInput = container.querySelector("#story-face-detailer-enabled") as HTMLInputElement | null;
    const handDetailerInput = container.querySelector("#story-hand-detailer-enabled") as HTMLInputElement | null;

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
      faceDetailerInput?.click();
      handDetailerInput?.click();
    });

    expect(container.querySelector("#story-face-detailer-detector-model")).toBeNull();
    const faceSettingsButton = container.querySelector('[data-testid="story-face-detailer-settings"]') as HTMLButtonElement | null;
    expect(faceSettingsButton).not.toBeNull();
    await act(async () => {
      faceSettingsButton?.click();
      await Promise.resolve();
    });

    const faceDetectorInput = document.body.querySelector("#story-face-detailer-detector-model") as HTMLInputElement | null;
    const faceStepsInput = document.body.querySelector("#story-face-detailer-steps") as HTMLInputElement | null;
    const handDetectorInput = container.querySelector("#story-hand-detailer-detector-model") as HTMLInputElement | null;
    const handStepsInput = container.querySelector("#story-hand-detailer-steps") as HTMLInputElement | null;
    expect(faceDetectorInput).not.toBeNull();
    expect(faceStepsInput).not.toBeNull();
    expect(handDetectorInput).toBeNull();
    expect(handStepsInput).toBeNull();
    const advancedDetailerSections = Array.from(document.body.querySelectorAll("details"));
    expect(advancedDetailerSections).toHaveLength(1);
    expect(advancedDetailerSections.every((section) => !section.open)).toBe(true);

    act(() => {
      setNativeInputValue(faceDetectorInput as HTMLInputElement, "bbox/story-face.pt");
      setNativeInputValue(faceStepsInput as HTMLInputElement, "18");
    });
    const faceDoneButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Done",
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      faceDoneButton?.click();
      await Promise.resolve();
    });

    const handSettingsButton = container.querySelector('[data-testid="story-hand-detailer-settings"]') as HTMLButtonElement | null;
    expect(handSettingsButton).not.toBeNull();
    await act(async () => {
      handSettingsButton?.click();
      await Promise.resolve();
    });
    const handModalDetectorInput = document.body.querySelector("#story-hand-detailer-detector-model") as HTMLInputElement | null;
    const handModalStepsInput = document.body.querySelector("#story-hand-detailer-steps") as HTMLInputElement | null;
    expect(handModalDetectorInput).not.toBeNull();
    expect(handModalStepsInput).not.toBeNull();

    act(() => {
      setNativeInputValue(handModalDetectorInput as HTMLInputElement, "bbox/story-hand.pt");
      setNativeInputValue(handModalStepsInput as HTMLInputElement, "19");
    });
    await clickButtonAsync("Start planning");

    const planningBody = JSON.parse(String(
      fetchMock.mock.calls.find(([input]) => input === "/api/agent-timeline/story/run-planning")?.[1]?.body ?? "{}",
    )) as {
      settingsSnapshot?: {
        detailers?: {
          faceDetailer?: { detectorModelName?: string; enabled?: boolean; steps?: number };
          handDetailer?: { detectorModelName?: string; enabled?: boolean; steps?: number };
        };
        stylePalette?: unknown;
      };
    };

    expect(planningBody.settingsSnapshot?.stylePalette).toBeUndefined();
    expect(planningBody.settingsSnapshot?.detailers).toMatchObject({
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/story-face.pt",
        steps: 18,
      },
      handDetailer: {
        enabled: true,
        detectorModelName: "bbox/story-hand.pt",
        steps: 19,
      },
    });
  });

  it("passes selected Story style resources in the planning request", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target.startsWith("/api/civitai-lora-library/selected-resources")) {
        const params = new URLSearchParams(target.split("?")[1] ?? "");
        const loraIds = params.get("loraIds")?.split(",").filter(Boolean) ?? [];

        return {
          ok: true,
          json: async () => ({
            checkpoint: params.get("checkpointId") === selectedCheckpointPreview.id ? selectedCheckpointPreview : null,
            loras: loraIds.includes(selectedLoraPreview.id) ? [selectedLoraPreview] : [],
          }),
        } as Response;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/active-workflow") {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "",
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
    });

    await clickButtonAsync("Select checkpoint");
    await waitForPickerDebounce();
    await clickButtonAsync("Select");
    await waitForPickerDebounce();
    await clickButtonAsync("Add");
    await flushAsyncWork();
    await clickButtonAsync("Start planning");

    const planningBody = JSON.parse(String(
      fetchMock.mock.calls.find(([input]) => input === "/api/agent-timeline/story/run-planning")?.[1]?.body ?? "{}",
    )) as {
      settingsSnapshot?: {
        detailers?: {
          faceDetailer?: { detectorModelName?: string; enabled?: boolean; steps?: number };
          handDetailer?: { detectorModelName?: string; enabled?: boolean; steps?: number };
        };
        stylePalette?: {
          checkpointId?: string;
          loras?: Array<{ id: string; enabled: boolean }>;
        };
      };
    };

    expect(planningBody.settingsSnapshot?.stylePalette).toMatchObject({
      checkpointId: "checkpoint-local",
      loras: [{ id: "lora-local", enabled: true }],
    });
  });

  it("generates Story AI Style Advice from selected resources and passes it to saved parameters", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target.startsWith("/api/civitai-lora-library/selected-resources")) {
        const params = new URLSearchParams(target.split("?")[1] ?? "");

        return {
          ok: true,
          json: async () => ({
            checkpoint: params.get("checkpointId") === selectedCheckpointPreview.id ? selectedCheckpointPreview : null,
            loras: [],
          }),
        } as Response;
      }

      if (target === "/api/llm/chat") {
        return {
          ok: true,
          json: async () => ({
            content: JSON.stringify({
              prompt: "1girl, solo, detailed face",
              parameterSuggestions: {
                steps: 29,
                cfgScale: 5.5,
                sampler: "euler",
                scheduler: "normal",
                resolution: "832x1216",
              },
              parameterSuggestionReason: "Use moderate steps for this checkpoint.",
              overallEffect: "Clean anime rendering.",
            }),
          }),
        } as Response;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/active-workflow") {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "",
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await clickButtonAsync("Select checkpoint");
    await waitForPickerDebounce();
    await clickButtonAsync("Select");
    await flushAsyncWork();
    expect(container.textContent).not.toContain("AI Style Advice");
    await clickButtonAsync("Parameters");
    expect(container.textContent).toContain("parameters-only");
    expect(container.textContent).toContain("AI Style Advice");
    await clickButtonAsync("Generate");
    await flushAsyncWork();

    expect(container.textContent).toContain("Clean anime rendering.");
    expect(container.textContent).toContain("Use moderate steps for this checkpoint.");
    expect(container.textContent).toContain("advice-loaded");

    const chatBody = JSON.parse(String(
      fetchMock.mock.calls.find(([input]) => input === "/api/llm/chat")?.[1]?.body ?? "{}",
    )) as {
      purpose?: string;
      messages?: Array<{ content?: string }>;
    };
    expect(chatBody.purpose).toBe("stable-diffusion-prompt-generation");
    expect(JSON.stringify(chatBody.messages)).toContain("Local Checkpoint");
  });

  it("requires a selected Story checkpoint before saving style parameters", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target.startsWith("/api/civitai-lora-library/selected-resources")) {
        const params = new URLSearchParams(target.split("?")[1] ?? "");

        return {
          ok: true,
          json: async () => ({
            checkpoint: params.get("checkpointId") === selectedCheckpointPreview.id ? selectedCheckpointPreview : null,
            loras: [],
          }),
        } as Response;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/active-workflow") {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "",
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
    });

    const parametersButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Parameters",
    ) as HTMLButtonElement | undefined;
    expect(parametersButton).toBeDefined();
    expect(parametersButton?.disabled).toBe(true);

    await clickButtonAsync("Select checkpoint");
    await waitForPickerDebounce();
    await clickButtonAsync("Select");
    await flushAsyncWork();

    const enabledParametersButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Parameters",
    ) as HTMLButtonElement | undefined;
    expect(enabledParametersButton?.disabled).toBe(false);
    await clickButtonAsync("Parameters");
    expect(container.textContent).toContain("parameters-only");
    expect(dialogProps.at(-1)?.showDetailersInParametersOnly).toBeUndefined();
    await clickButtonAsync("Save mock parameters");
    expect(container.textContent).toContain("Saved parameters: 832x1216, 31 steps, CFG 4.25, euler/normal, fixed seed 98765");
    await clickButtonAsync("Start planning");

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/comfyui"))).toBe(false);
    const planningBody = JSON.parse(String(
      fetchMock.mock.calls.find(([input]) => input === "/api/agent-timeline/story/run-planning")?.[1]?.body ?? "{}",
    )) as {
      settingsSnapshot?: {
        detailers?: {
          faceDetailer?: { detectorModelName?: string; enabled?: boolean; steps?: number };
          handDetailer?: { detectorModelName?: string; enabled?: boolean; steps?: number };
        };
        stylePalette?: {
          checkpointId?: string;
          loras?: Array<{ id: string; enabled: boolean }>;
          parameters?: {
            width?: number;
            height?: number;
            steps?: number;
            cfg?: number;
            samplerName?: string;
            scheduler?: string;
            denoise?: number;
            seed?: number;
          };
        };
      };
    };

    expect(planningBody.settingsSnapshot?.detailers).toMatchObject({
      faceDetailer: {
        enabled: false,
        detectorModelName: "bbox/face_yolov8m.pt",
        steps: 30,
      },
      handDetailer: {
        enabled: false,
        detectorModelName: "bbox/hand_yolov8s.pt",
        steps: 30,
      },
    });
    expect(planningBody.settingsSnapshot?.stylePalette).toEqual({
      checkpointId: "checkpoint-local",
      loras: [],
      parameters: {
        width: 832,
        height: 1216,
        steps: 31,
        cfg: 4.25,
        samplerName: "euler",
        scheduler: "normal",
        denoise: 0.88,
        seed: 98765,
      },
    });
  });

  it("shows compact Visual output by default and keeps Raw JSON available", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
    });
    await clickButtonAsync("Start planning");

    expect(container.querySelector('[data-testid="story-node-output-summary"]')?.textContent).toContain(
      "Generation gate summary",
    );
    expect(container.textContent).toContain("Edit artifact");
    expect(container.textContent).not.toContain('"requestPreview"');

    const rawJsonButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Raw JSON",
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      rawJsonButton?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="story-node-output-summary"]')).toBeNull();
    expect(container.textContent).toContain('"requestPreview"');
  });

  it("passes the selected Story input base model to server-side ranked resource planning", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const baseModelSelect = container.querySelector("select") as HTMLSelectElement | null;

    expect(textarea).not.toBeNull();
    expect(baseModelSelect).not.toBeNull();

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
      setNativeSelectValue(baseModelSelect as HTMLSelectElement, "anima");
    });
    await clickButtonAsync("Start planning");

    const fetchTargets = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(),
    );

    expect(fetchTargets.some((target) => target.includes("/api/civitai-lora-library/resources"))).toBe(false);

    const planningBody = JSON.parse(String(
      fetchMock.mock.calls.find(([input]) => input === "/api/agent-timeline/story/run-planning")?.[1]?.body ?? "{}",
    )) as {
      settingsSnapshot?: {
        promptProfile?: string;
      };
    };

    expect(planningBody.settingsSnapshot?.promptProfile).toBe("anima");
  });

  it("enters the workflow immediately and streams running node updates", async () => {
    const plannedWorkflow = createPlannedWorkflow("A detective follows a signal through a storm-lit city.");
    const runningWorkflow: StoryWorkflowState = {
      ...plannedWorkflow,
      nodes: {
        ...plannedWorkflow.nodes,
        "story-bible": {
          nodeId: "story-bible",
          source: "ai",
          status: "running",
          updatedAt: "2026-06-15T00:00:01.000Z",
        },
      },
      updatedAt: "2026-06-15T00:00:01.000Z",
    };
    const streamResponse = createStoryPlanningStreamResponse();
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return streamResponse.response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Start planning",
    ) as HTMLButtonElement | undefined;

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
    });
    await act(async () => {
      startButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("story-input");

    const readyBibleButton = container.querySelector('button[data-node-id="story-bible"]') as HTMLButtonElement | null;
    const readyBibleTone = readyBibleButton?.querySelector("span");

    expect(readyBibleButton?.textContent).toContain("ready");
    expect(readyBibleTone?.className).toContain("bg-blue-50");
    expect(readyBibleTone?.className).not.toContain("bg-emerald-50");

    await act(async () => {
      streamResponse.write({
        nodeId: "story-bible",
        type: "workflow",
        workflow: runningWorkflow,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const bibleButton = container.querySelector('button[data-node-id="story-bible"]') as HTMLButtonElement | null;
    expect(bibleButton?.textContent).toContain("running");
    expect(bibleButton?.querySelector(".animate-spin")).not.toBeNull();

    await act(async () => {
      streamResponse.write({
        type: "done",
        workflow: plannedWorkflow,
      });
      streamResponse.close();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("does not expose a sample fallback start action", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Load fallback");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/agent-timeline/story/run-planning", expect.anything());
  });

  it("supports Story request suggest and rewrite through the LLM chat boundary", async () => {
    const storyInputSystemPrompts: string[] = [];
    const storyInputRequests: Array<{ temperature?: number }> = [];
    const storyInputPayloads: Array<{ action?: string; currentStoryRequest?: string; promptProfile?: string }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
        ok: true,
        json: async () => ({
          general: {
            nsfw: {
              supportsNsfw: false,
            },
          },
        }),
        } as Response;
      }

      if (target === "/api/llm/chat") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }>; temperature?: number };
        storyInputRequests.push(body);
        const systemContent = body.messages?.[0]?.content;
        if (typeof systemContent === "string") {
          storyInputSystemPrompts.push(systemContent);
        }
        const userContent = body.messages?.[1]?.content ?? "{}";
        const payload = JSON.parse(userContent) as { action?: string; currentStoryRequest?: string; promptProfile?: string };
        storyInputPayloads.push(payload);

        return {
          ok: true,
          json: async () => ({
            role: "assistant",
            content: JSON.stringify({
              storyRequest: payload.action === "rewrite"
                ? "A rewritten observatory story request with clearer continuity."
                : "A suggested observatory story request with three escalating visual beats.",
            }),
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await clickButtonAsync("Suggest");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    expect(textarea?.value).toBe("A suggested observatory story request with three escalating visual beats.");
    expect(storyInputPayloads[0]).toMatchObject({
      action: "suggest",
      currentStoryRequest: "",
      promptProfile: "illustrious",
    });
    expect(storyInputRequests[0]).toMatchObject({
      temperature: 0.75,
    });
    expect(storyInputSystemPrompts[0]).toContain("Selected prompt profile: Illustrious (illustrious)");
    expect(storyInputSystemPrompts[0]).toContain("Japanese illustration / anime-inspired style only");
    expect(storyInputSystemPrompts[0]).toContain("must explicitly include anime-style or Japanese-illustration");
    expect(storyInputSystemPrompts[0]).toContain("Do not add Japanese cultural content unless the user asks");
    expect(storyInputSystemPrompts[0]).toContain("concrete, storyboard-ready Story Graph request");
    expect(storyInputSystemPrompts[0]).toContain("visible age range or role, appearance, clothing");
    expect(storyInputSystemPrompts[0]).toContain("female-led everyday slice-of-life story");
    expect(storyInputSystemPrompts[0]).toContain("school, campus, home, cafe");
    expect(storyInputSystemPrompts[0]).toContain("keep it wholesome and non-sexual by default");
    expect(storyInputSystemPrompts[0]).toContain("3 to 5 sequential visual beats");
    expect(storyInputSystemPrompts[0]).toContain("Do not introduce default rain");
    expect(storyInputSystemPrompts[0]).toContain("yellow raincoats");
    expect(storyInputSystemPrompts[0]).toContain("yellow rain jackets");
    expect(storyInputSystemPrompts[0]).toContain("yellow jackets or coats");
    expect(storyInputSystemPrompts[0]).toContain("rainy courier template");
    expect(storyInputSystemPrompts[0]).toContain("Avoid abstract summaries");
    expect(storyInputSystemPrompts[0]).toContain("Prefer compact storyboard-brief prose");

    await clickButtonAsync("Rewrite");

    expect(textarea?.value).toBe("A rewritten observatory story request with clearer continuity.");
    expect(storyInputPayloads[1]).toMatchObject({
      action: "rewrite",
      currentStoryRequest: "A suggested observatory story request with three escalating visual beats.",
      promptProfile: "illustrious",
    });
    expect(storyInputRequests[1]).toMatchObject({
      temperature: 0.25,
    });
    expect(storyInputSystemPrompts[1]).toContain("keep the request aligned to Japanese illustration / anime-inspired rendering");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("runs Story Graph planning through the server route when shots are omitted", async () => {
    const plannedWorkflow = createPlannedWorkflow("A courier finds an impossible doorway under the city.");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({
            general: {
              nsfw: {
                supportsNsfw: false,
              },
            },
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { rawIntent?: string; targetShotCount?: number };
        expect(body.rawIntent).toBe("A courier finds an impossible doorway under the city.");
        expect(body.targetShotCount).toBeUndefined();
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A courier finds an impossible doorway under the city.");
    });
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("Generation gate summary");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-timeline/story/run-planning",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("shows a clear server planning error when no ranked checkpoint candidates exist", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            error: {
              message: "No ranked local Illustrious checkpoint candidates are available.",
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A courier follows a signal.");
    });
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("No ranked local Illustrious checkpoint candidates are available.");
    expect(fetchMock.mock.calls.some(([input]) => input === "/api/agent-timeline/story/run-planning")).toBe(true);
  });

  it("shows a selected Story node error in Visual mode when planning returns a 200 workflow with a failed node", async () => {
    const plannedWorkflow = createPlannedWorkflow("A courier follows a signal but resource planning fails.");
    const failedWorkflow: StoryWorkflowState = {
      ...plannedWorkflow,
      nodes: {
        ...plannedWorkflow.nodes,
        "resource-plan": {
          ...plannedWorkflow.nodes["resource-plan"],
          error: {
            code: "resource_selection_invalid",
            message: "No ranked local Illustrious checkpoint candidates are available.",
          },
          nodeId: "resource-plan",
          source: "ai",
          status: "error",
          updatedAt: "2026-06-15T00:00:02.000Z",
        },
      },
      updatedAt: "2026-06-15T00:00:02.000Z",
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: failedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A courier follows a signal but resource planning fails.");
    });
    await clickButtonAsync("Start planning");

    const resourcePlanButton = container.querySelector('button[data-node-id="resource-plan"]') as HTMLButtonElement | null;
    act(() => {
      resourcePlanButton?.click();
    });

    const errorNotice = container.querySelector('[data-testid="story-node-error"]');
    expect(errorNotice?.textContent).toContain("Node failed");
    expect(errorNotice?.textContent).toContain("No ranked local Illustrious checkpoint candidates are available.");
    expect(errorNotice?.textContent).toContain("resource_selection_invalid");
    expect(container.textContent).not.toContain("Story Graph planning failed.");
  });

  it("starts generation, renders execution/results, and regenerates a shot", async () => {
    const plannedWorkflow = createPlannedWorkflow("A courier follows a signal through a neon market.");
    const generatedWorkflow = withExecution(plannedWorkflow, "first");
    const regeneratedWorkflow = withExecution(plannedWorkflow, "regen");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/confirm-generation") {
        return {
          ok: true,
          json: async () => ({
            workflow: generatedWorkflow,
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/regenerate-shot") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { shotId?: string };
        expect(body.shotId).toBe("shot-1");
        return {
          ok: true,
          json: async () => ({
            workflow: regeneratedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A courier follows a signal through a neon market.");
    });
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("Step 13 / 15");
    expect(container.textContent).toContain("Start shot generation");

    await clickButtonAsync("Start shot generation");

    expect(container.textContent).toContain("Shot execution");
    expect(Array.from(container.querySelectorAll("img")).some((image) =>
      image.getAttribute("src") === "/api/comfyui/generated-images/first-shot-1.png",
    )).toBe(true);

    const resultButton = container.querySelector('button[data-node-id="story-result-display"]') as HTMLButtonElement | null;
    act(() => {
      (resultButton as HTMLButtonElement).click();
    });

    const resultImage = container.querySelector('img[alt="Generated shot-1"]') as HTMLImageElement | null;
    expect(resultImage?.getAttribute("src")).toBe("/api/comfyui/generated-images/first-shot-1.png");
    expect(resultImage?.getAttribute("src")).not.toContain("comfyui.test/view");
    expect(resultImage?.className).toContain("object-contain");
    expect(resultImage?.className).not.toContain("object-cover");
    expect(resultImage?.closest("a")?.getAttribute("href")).toBe("/api/comfyui/generated-images/first-shot-1.png");

    const executionButton = container.querySelector('button[data-node-id="shot-graph-execution"]') as HTMLButtonElement | null;
    act(() => {
      (executionButton as HTMLButtonElement).click();
    });
    await clickButtonAsync("Regenerate shot");

    expect(Array.from(container.querySelectorAll("img")).some((image) =>
      image.getAttribute("src") === "/api/comfyui/generated-images/regen-shot-1.png",
    )).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-timeline/story/regenerate-shot",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("auto-confirms Story shot generation when workflow auto review is enabled", async () => {
    const plannedWorkflow = createPlannedWorkflow("A courier auto-renders a market sequence.");
    const generatedWorkflow = withExecution(plannedWorkflow, "auto");
    const confirmPayloads: Array<{ workflow?: StoryWorkflowState }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      const resourceResponse = handleStoryResourceListFetch(target);
      if (resourceResponse) {
        return resourceResponse;
      }

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({
            general: {
              nsfw: {
                supportsNsfw: false,
              },
            },
            workflow: {
              autoReview: true,
            },
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/run-planning") {
        return {
          ok: true,
          json: async () => ({
            workflow: plannedWorkflow,
          }),
        } as Response;
      }

      if (target === "/api/agent-timeline/story/confirm-generation") {
        confirmPayloads.push(JSON.parse(String(init?.body ?? "{}")) as { workflow?: StoryWorkflowState });
        return {
          ok: true,
          json: async () => ({
            workflow: generatedWorkflow,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
    });
    await flushAsyncWork();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A courier auto-renders a market sequence.");
    });
    await clickButtonAsync("Start planning");
    await flushAsyncWork();

    expect(confirmPayloads).toHaveLength(1);
    expect(confirmPayloads[0]?.workflow?.workflowId).toBe(plannedWorkflow.workflowId);
    expect(container.textContent).not.toContain("Start shot generation");
    expect(container.textContent).toContain("Shot execution");
    expect(Array.from(container.querySelectorAll("img")).some((image) =>
      image.getAttribute("src") === "/api/comfyui/generated-images/auto-shot-1.png",
    )).toBe(true);
  });
});
