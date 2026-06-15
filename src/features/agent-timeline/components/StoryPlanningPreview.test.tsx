import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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
    expect(container.querySelector("select")).toBeNull();

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
        const userContent = body.messages?.[1]?.content ?? "{}";
        const payload = JSON.parse(userContent) as { action?: string };

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
