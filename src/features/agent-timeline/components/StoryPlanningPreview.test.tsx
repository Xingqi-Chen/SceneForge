import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTimelineWorkflowRecord,
  startStoryGraphWorkflow,
  type StoryWorkflowState,
} from "@/features/agent-timeline";

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
  vi.restoreAllMocks();
});

describe("StoryPlanningPreview", () => {
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

    expect(container.textContent).toContain("A brand new story request.");

    await act(async () => {
      resolveActiveWorkflow?.({
        ok: true,
        json: async () => oldRecord,
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("A brand new story request.");
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
      expect(container.textContent).toContain("restored-shot-1");
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
    expect(container.textContent).toContain("Start Story Graph");
    expect(container.textContent).not.toContain("Rain Station Signal");
    expect(container.textContent).not.toContain("Audience rating follows Settings NSFW");
    expect(container.textContent).not.toContain("Title");
    expect(container.textContent).not.toContain("Content warnings");
    expect(container.textContent).not.toContain("NSFW context");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const shotsInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.getAttribute("type") === "number",
    ) as HTMLInputElement | undefined;

    expect(textarea).not.toBeNull();
    expect(shotsInput).toBeDefined();
    const baseModelSelect = container.querySelector("select") as HTMLSelectElement | null;

    expect(baseModelSelect).not.toBeNull();
    expect(baseModelSelect?.value).toBe("illustrious");

    act(() => {
      setNativeInputValue(textarea as HTMLTextAreaElement, "A detective follows a signal through a storm-lit city.");
      setNativeInputValue(shotsInput as HTMLInputElement, "4");
    });
    await clickButtonAsync("Start planning");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("15 steps");
    expect(container.textContent).toContain("story-input");
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
        resourceCandidates?: {
          checkpoints?: Array<{ id: string; modelFileName?: string }>;
          loras?: Array<{ id: string; modelFileName?: string; trainedWords?: string[] }>;
        };
      };
    };
    expect(planningBody.settingsSnapshot?.resourceCandidates?.checkpoints).toEqual([
      expect.objectContaining({
        id: "checkpoint-local",
        modelFileName: "Local Checkpoint__v1__mv101__101.safetensors",
      }),
    ]);
    expect(planningBody.settingsSnapshot?.resourceCandidates?.loras).toEqual([
      expect.objectContaining({
        id: "lora-local",
        modelFileName: "Local LoRA__v1__mv202__202.safetensors",
        trainedWords: ["neon market"],
      }),
    ]);

    const executionButton = container.querySelector('button[data-node-id="shot-graph-execution"]') as HTMLButtonElement | null;

    expect(executionButton?.textContent).toContain("blocked");
  });

  it("uses the selected Story input base model to scope checkpoint and LoRA candidates", async () => {
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

    expect(fetchTargets).toContain(
      "/api/civitai-lora-library/resources?resourceType=model&category=all&downloaded=ready&promptProfile=anima",
    );
    expect(fetchTargets).toContain(
      "/api/civitai-lora-library/resources?resourceType=lora&category=all&downloaded=ready&promptProfile=anima",
    );

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

  it("keeps sample content behind a fallback start action", async () => {
    const fallbackWorkflow = createPlannedWorkflow("A traveler in a blue raincoat enters a rain-washed elevated station.");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
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
              workflow: fallbackWorkflow,
            }),
          } as Response;
        }

        throw new Error(`Unexpected fetch ${target}`);
      }),
    );

    await act(async () => {
      root.render(<StoryPlanningPreview />);
      await Promise.resolve();
    });

    await clickButtonAsync("Load fallback");

    expect(container.textContent).toContain("User-started planning workflow");
    expect(container.textContent).toContain("blue raincoat");

    const resourceButton = container.querySelector('button[data-node-id="resource-plan"]') as HTMLButtonElement | null;

    expect(resourceButton).not.toBeNull();

    act(() => {
      (resourceButton as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("Local Checkpoint");
  });

  it("supports Story request suggest and rewrite through the LLM chat boundary", async () => {
    const storyInputSystemPrompts: string[] = [];
    const storyInputPayloads: Array<{ action?: string; currentStoryRequest?: string }> = [];
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
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
        const systemContent = body.messages?.[0]?.content;
        if (typeof systemContent === "string") {
          storyInputSystemPrompts.push(systemContent);
        }
        const userContent = body.messages?.[1]?.content ?? "{}";
        const payload = JSON.parse(userContent) as { action?: string; currentStoryRequest?: string };
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
    });
    expect(storyInputSystemPrompts[0]).toContain("concrete, storyboard-ready Story Graph request");
    expect(storyInputSystemPrompts[0]).toContain("visible age range or role, appearance, clothing");
    expect(storyInputSystemPrompts[0]).toContain("3 to 5 sequential visual beats");
    expect(storyInputSystemPrompts[0]).toContain("Avoid abstract summaries");
    expect(storyInputSystemPrompts[0]).toContain("Prefer compact storyboard-brief prose");

    await clickButtonAsync("Rewrite");

    expect(textarea?.value).toBe("A rewritten observatory story request with clearer continuity.");
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
    expect(container.textContent).toContain("impossible doorway");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-timeline/story/run-planning",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("shows a clear error and skips planning when no downloaded checkpoint candidates exist", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (target === "/api/settings") {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (target.includes("/api/civitai-lora-library/resources?resourceType=model")) {
        return {
          ok: true,
          json: async () => ({
            items: [],
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

    expect(container.textContent).toContain("Story Graph needs at least one downloaded local checkpoint");
    expect(fetchMock.mock.calls.some(([input]) => input === "/api/agent-timeline/story/run-planning")).toBe(false);
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

    expect(container.textContent).toContain("Start shot generation");

    await clickButtonAsync("Start shot generation");

    expect(container.textContent).toContain("Shot execution");
    expect(container.textContent).toContain("first-shot-1");

    const resultButton = container.querySelector('button[data-node-id="story-result-display"]') as HTMLButtonElement | null;
    act(() => {
      (resultButton as HTMLButtonElement).click();
    });

    const resultImage = container.querySelector('img[alt="Generated shot-1"]') as HTMLImageElement | null;
    expect(resultImage?.getAttribute("src")).toBe("/api/comfyui/generated-images/first-shot-1.png");
    expect(resultImage?.getAttribute("src")).not.toContain("comfyui.test/view");

    const executionButton = container.querySelector('button[data-node-id="shot-graph-execution"]') as HTMLButtonElement | null;
    act(() => {
      (executionButton as HTMLButtonElement).click();
    });
    await clickButtonAsync("Regenerate shot");

    expect(container.textContent).toContain("regen-shot-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-timeline/story/regenerate-shot",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
