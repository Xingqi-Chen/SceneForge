import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmChatResponse } from "@/features/llm";
import { confirmAndExecuteStoryGeneration } from "@/features/agent-timeline/story-api";
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

function planningResponses() {
  const shots = [
    {
      id: "shot-1",
      order: 1,
      title: "Shot 1",
      description: "Opening.",
      beatId: "beat-1",
      locationId: "market",
      characterIds: ["courier"],
      sourceShotIds: [],
      camera: "wide",
      promptIntent: "opening prompt",
      continuityNotes: [],
    },
    {
      id: "shot-2",
      order: 2,
      title: "Shot 2",
      description: "Dependent shot.",
      beatId: "beat-2",
      locationId: "market",
      characterIds: ["courier"],
      sourceShotIds: ["shot-1"],
      camera: "close",
      promptIntent: "dependent prompt",
      continuityNotes: [],
    },
    {
      id: "shot-3",
      order: 3,
      title: "Shot 3",
      description: "Unrelated cutaway.",
      beatId: "beat-3",
      locationId: "market",
      characterIds: ["courier"],
      sourceShotIds: [],
      camera: "wide",
      promptIntent: "cutaway prompt",
      continuityNotes: [],
    },
  ];

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
      beats: shots.map((shot) => ({
        id: shot.beatId,
        title: shot.title,
        summary: shot.description,
        order: shot.order,
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

function adapterResult(shotId: StoryShotId, prefix: string) {
  return {
    queueMetadata: {
      outputNodeId: "9",
      promptId: `${prefix}-${shotId}`,
      warnings: [],
    },
    resultReference: {
      completed: true,
      image: {
        filename: `${shotId}.png`,
        nodeId: "9",
        type: "output",
        url: `/api/comfyui/generated-images/${prefix}-${shotId}.png`,
      },
      promptId: `${prefix}-${shotId}`,
      shotId,
      storedImage: {
        byteLength: 12,
        contentType: "image/png",
        filename: `${shotId}.png`,
        url: `/api/comfyui/generated-images/${prefix}-${shotId}.png`,
      },
      warnings: [],
    },
  };
}

async function createExecutedWorkflow() {
  const responses = planningResponses();
  const planned = await runStoryPlanning({
    rawIntent: "A courier follows a signal through a neon market.",
    targetShotCount: 3,
    nsfwEnabled: false,
    settingsSnapshot: {
      resourceCandidates,
    },
  }, {
    now: () => "2026-06-15T00:00:00.000Z",
    completeChat: async () => responses.shift() ?? response({}),
  });

  return confirmAndExecuteStoryGeneration({
    workflow: planned,
    now: () => "2026-06-15T00:00:01.000Z",
    executeShot: ({ request }) => adapterResult(request.shotId, "first"),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  comfyMocks.adapter.mockReset();
  comfyMocks.createStoryComfyUiExecutionAdapter.mockClear();
});

describe("POST /api/agent-timeline/story/regenerate-shot", () => {
  beforeEach(() => {
    comfyMocks.createStoryComfyUiExecutionAdapter.mockReturnValue(comfyMocks.adapter);
  });

  it("reruns only the selected shot and downstream dependent shots", async () => {
    const workflow = await createExecutedWorkflow();
    const executed = workflow.nodes["shot-graph-execution"].result as {
      shots: Array<{ shotId: string; resultReference?: { promptId: string } }>;
    };

    expect(executed.shots.map((shot) => shot.resultReference?.promptId)).toEqual([
      "first-shot-1",
      "first-shot-2",
      "first-shot-3",
    ]);

    const calls: Array<{ shotId: string; sourcePromptIds: string[] }> = [];
    comfyMocks.adapter.mockImplementation(({ request, sourceResults }: Parameters<StoryShotExecutionAdapter>[0]) => {
      calls.push({
        shotId: request.shotId,
        sourcePromptIds: Object.values(sourceResults).map((reference) => reference.promptId),
      });
      return adapterResult(request.shotId, "regen");
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/story/regenerate-shot", {
      method: "POST",
      body: JSON.stringify({ workflow, shotId: "shot-1" }),
    }));
    const payload = await response.json();
    const nextExecution = payload.workflow.nodes["shot-graph-execution"].result;

    expect(response.status).toBe(200);
    expect(comfyMocks.adapter).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      { shotId: "shot-1", sourcePromptIds: [] },
      { shotId: "shot-2", sourcePromptIds: ["regen-shot-1"] },
    ]);
    expect(nextExecution.shots.map((shot: { resultReference?: { promptId: string } }) => shot.resultReference?.promptId)).toEqual([
      "regen-shot-1",
      "regen-shot-2",
      "first-shot-3",
    ]);
    expect(payload.workflow.nodes["story-result-display"].result.finalReferences).toEqual([
      expect.objectContaining({ shotId: "shot-1", promptId: "regen-shot-1" }),
      expect.objectContaining({ shotId: "shot-2", promptId: "regen-shot-2" }),
      expect.objectContaining({ shotId: "shot-3", promptId: "first-shot-3" }),
    ]);
  });

  it("recomputes render plan resources before a scoped regeneration rerun", async () => {
    const workflow = await createExecutedWorkflow();
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
      return adapterResult(request.shotId, "regen");
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/story/regenerate-shot", {
      method: "POST",
      body: JSON.stringify({ workflow, shotId: "shot-1" }),
    }));

    expect(response.status).toBe(200);
    expect(checkpointNames).toEqual(["local.safetensors", "local.safetensors"]);
    expect(checkpointNames).not.toContain("invented.safetensors");
  });

  it("rejects missing shot ids", async () => {
    const workflow = await createExecutedWorkflow();
    const response = await POST(new Request("http://localhost/api/agent-timeline/story/regenerate-shot", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }));

    expect(response.status).toBe(400);
  });
});
