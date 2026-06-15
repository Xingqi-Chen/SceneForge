import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmChatResponse } from "@/features/llm";
import type { StoryShotExecutionAdapter } from "@/features/agent-timeline/story-execution";
import { runStoryPlanning } from "@/features/agent-timeline/story-runner";
import type { StoryShotId } from "@/features/agent-timeline/story-types";

const comfyMocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  createStoryComfyUiExecutionAdapter: vi.fn(),
}));

vi.mock("@/features/agent-timeline/story-comfyui-execution", () => ({
  createStoryComfyUiExecutionAdapter: comfyMocks.createStoryComfyUiExecutionAdapter,
}));

import { POST } from "./route";

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

function response(content: unknown): LlmChatResponse {
  return {
    role: "assistant",
    content: JSON.stringify(content),
  };
}

function planningResponses(shotCount = 2) {
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const order = index + 1;
    return {
      id: `shot-${order}`,
      order,
      title: `Shot ${order}`,
      description: `Description ${order}`,
      beatId: `beat-${order}`,
      locationId: "market",
      characterIds: ["courier"],
      sourceShotIds: order === 2 ? ["shot-1"] : [],
      camera: order === 1 ? "wide" : "close",
      promptIntent: `prompt ${order}`,
      continuityNotes: [],
    };
  });

  return [
    response({
      title: "Signal Market",
      logline: "A courier follows a signal.",
      genre: ["cyberpunk"],
      themes: ["signal"],
      worldSummary: "A neon market.",
      visualStyle: "Cinematic.",
      characters: [{
        id: "courier",
        name: "Courier",
        role: "Lead",
        description: "A focused courier.",
        continuityNotes: [],
        visualAnchors: ["blue jacket"],
      }],
      locations: [{
        id: "market",
        name: "Market",
        description: "A neon market.",
        visualAnchors: ["wet signs"],
      }],
      continuityRules: ["Keep jacket consistent."],
    }),
    response({
      beats: Array.from({ length: shotCount }, (_, index) => ({
        id: `beat-${index + 1}`,
        title: `Beat ${index + 1}`,
        summary: `Beat summary ${index + 1}`,
        order: index + 1,
        characterIds: ["courier"],
      })),
    }),
    response({ shots }),
    response({
      audienceRating: "safe",
      contentWarnings: [],
      blockedContent: [],
      perShotNotes: shots.map((shot) => ({ shotId: shot.id, risks: [], mitigations: [] })),
      nsfwContext: { enabled: false, rationale: "Safe." },
    }),
    response({
      nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
      edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" }],
    }),
    response({
      states: shots.map((shot) => ({
        id: `state-${shot.order}`,
        title: shot.title,
        summary: shot.description,
        shotIds: [shot.id],
      })),
      transitions: [],
    }),
    response({
      appearances: shots.map((shot) => ({
        shotId: shot.id,
        characterId: "courier",
        wardrobe: ["blue jacket"],
        poseOrAction: shot.description,
        expression: "focused",
        continuityNotes: [],
      })),
    }),
    response({
      checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local." },
      loras: [],
      recommendationReason: "Use local checkpoint.",
      overallEffect: "Cinematic continuity.",
      warnings: [],
    }),
    response({
      defaults: {
        width: 1024,
        height: 768,
        steps: 28,
        cfg: 5.5,
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
      },
      perShotOverrides: [],
      warnings: [],
    }),
  ];
}

async function createReadyWorkflow(shotCount = 2) {
  const responses = planningResponses(shotCount);
  return runStoryPlanning({
    rawIntent: "A courier follows a signal through a neon market.",
    targetShotCount: shotCount,
    nsfwEnabled: false,
    settingsSnapshot: {
      resourceCandidates,
    },
  }, {
    now: () => "2026-06-15T00:00:00.000Z",
    completeChat: async () => responses.shift() ?? response({}),
  });
}

function adapterResult(shotId: StoryShotId, promptPrefix = "prompt") {
  return {
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
        url: `/api/comfyui/generated-images/${shotId}.png`,
      },
      promptId: `${promptPrefix}-${shotId}`,
      shotId,
      storedImage: {
        byteLength: 12,
        contentType: "image/png",
        filename: `${shotId}.png`,
        url: `/api/comfyui/generated-images/${shotId}.png`,
      },
      warnings: [],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  comfyMocks.adapter.mockReset();
  comfyMocks.createStoryComfyUiExecutionAdapter.mockClear();
});

describe("POST /api/agent-timeline/story/confirm-generation", () => {
  beforeEach(() => {
    comfyMocks.createStoryComfyUiExecutionAdapter.mockReturnValue(comfyMocks.adapter);
  });

  it("rejects non-story workflows and gates that are not ready", async () => {
    const invalid = await POST(new Request("http://localhost/api/agent-timeline/story/confirm-generation", {
      method: "POST",
      body: JSON.stringify({ workflow: { workflowMode: "single-image" } }),
    }));

    expect(invalid.status).toBe(400);

    const workflow = await createReadyWorkflow();
    workflow.nodes["generation-gate"] = {
      ...workflow.nodes["generation-gate"],
      result: {
        ...(workflow.nodes["generation-gate"].result as Record<string, unknown>),
        ready: false,
      },
    };
    const notReady = await POST(new Request("http://localhost/api/agent-timeline/story/confirm-generation", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }));

    expect(notReady.status).toBe(400);
  });

  it("confirms Story generation and returns completed execution and result display", async () => {
    const workflow = await createReadyWorkflow();
    comfyMocks.adapter.mockImplementation(({ request }: Parameters<StoryShotExecutionAdapter>[0]) =>
      adapterResult(request.shotId),
    );

    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/confirm-generation", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }));
    const payload = await routeResponse.json();

    expect(routeResponse.status).toBe(200);
    expect(payload.workflow.generationConfirmed).toBe(true);
    expect(payload.workflow.nodes["shot-graph-execution"].result.status).toBe("done");
    expect(payload.workflow.nodes["story-result-display"].result).toMatchObject({
      status: "complete",
      finalReferences: [
        { shotId: "shot-1", promptId: "prompt-shot-1" },
        { shotId: "shot-2", promptId: "prompt-shot-2" },
      ],
    });
  });

  it("recomputes render plan resources server-side before execution", async () => {
    const workflow = await createReadyWorkflow();
    const renderPlan = workflow.nodes["story-render-plan"].result as {
      shots: Array<{
        resources: {
          checkpoint: {
            resource: {
              id: string;
              name: string;
              modelFileName: string;
            };
            reason: string;
          };
          loras: unknown[];
        };
      }>;
    };
    renderPlan.shots = renderPlan.shots.map((shot) => ({
      ...shot,
      resources: {
        checkpoint: {
          resource: {
            id: "invented-checkpoint",
            name: "Invented Checkpoint",
            modelFileName: "invented.safetensors",
          },
          reason: "Tampered client render plan.",
        },
        loras: [],
      },
    }));
    const checkpointNames: string[] = [];
    comfyMocks.adapter.mockImplementation(({ request }: Parameters<StoryShotExecutionAdapter>[0]) => {
      checkpointNames.push(request.request.checkpointName ?? "");
      return adapterResult(request.shotId);
    });

    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/confirm-generation", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }));

    expect(routeResponse.status).toBe(200);
    expect(checkpointNames).toEqual(["local.safetensors", "local.safetensors"]);
    expect(checkpointNames).not.toContain("invented.safetensors");
  });

  it("returns partial result state when a downstream shot fails", async () => {
    const workflow = await createReadyWorkflow();
    comfyMocks.adapter.mockImplementation(({ request }: Parameters<StoryShotExecutionAdapter>[0]) => {
      if (request.shotId === "shot-2") {
        throw new Error("ComfyUI rejected shot-2.");
      }

      return adapterResult(request.shotId);
    });

    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/confirm-generation", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }));
    const payload = await routeResponse.json();

    expect(routeResponse.status).toBe(200);
    expect(payload.workflow.nodes["shot-graph-execution"].result.status).toBe("error");
    expect(payload.workflow.nodes["story-result-display"].result).toMatchObject({
      status: "partial",
      finalReferences: [{ shotId: "shot-1", promptId: "prompt-shot-1" }],
      errors: [expect.objectContaining({ message: "ComfyUI rejected shot-2." })],
    });
  });
});
