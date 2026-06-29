import { describe, expect, it, vi, afterEach } from "vitest";

import { startStoryGraphWorkflow } from "@/features/agent-timeline/story-input";
import type { StoryReferenceAssetPlan } from "@/features/agent-timeline/story-types";

const generationMocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  createStoryReferenceComfyUiGenerationAdapter: vi.fn(),
}));

vi.mock("@/features/agent-timeline/story-reference-comfyui", () => ({
  createStoryReferenceComfyUiGenerationAdapter: generationMocks.createStoryReferenceComfyUiGenerationAdapter,
}));

import { POST } from "./route";

function createWorkflow() {
  return startStoryGraphWorkflow({
    rawIntent: "A two-shot courier story through a neon market.",
    targetShotCount: 2,
    storyId: "story-reference-generate-route",
    workflowId: "workflow-reference-generate-route",
    now: () => "2026-06-29T00:00:00.000Z",
    settingsSnapshot: {
      resourceCandidates: {
        checkpoints: [
          {
            id: "checkpoint-anima",
            name: "Anima Checkpoint",
            baseModel: "Anima",
            modelBaseModel: "Anima",
            modelFileName: "anima.safetensors",
          },
        ],
        loras: [],
      },
    },
  });
}

afterEach(() => {
  generationMocks.adapter.mockReset();
  generationMocks.createStoryReferenceComfyUiGenerationAdapter.mockReset();
});

describe("POST /api/agent-timeline/story/reference-assets/generate", () => {
  it("records a recoverable failed reference state when ComfyUI generation fails", async () => {
    generationMocks.adapter.mockRejectedValue(
      Object.assign(new Error("ComfyUI rejected the reference plate."), { code: "comfyui_execution_failed" }),
    );
    generationMocks.createStoryReferenceComfyUiGenerationAdapter.mockReturnValue(generationMocks.adapter);

    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/reference-assets/generate", {
      method: "POST",
      body: JSON.stringify({
        workflow: createWorkflow(),
        referenceId: "character-face:main-character",
      }),
    }));
    const payload = await routeResponse.json();
    const plan = payload.workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    const asset = plan.assets.find((candidate) => candidate.id === "character-face:main-character");

    expect(routeResponse.status).toBe(200);
    expect(generationMocks.createStoryReferenceComfyUiGenerationAdapter).toHaveBeenCalledTimes(1);
    expect(generationMocks.adapter).toHaveBeenCalledTimes(1);
    expect(asset).toMatchObject({
      resolutionState: "failed",
      failure: {
        code: "comfyui_execution_failed",
        message: "ComfyUI rejected the reference plate.",
        recoverableActions: ["reroll", "upload", "prompt-only"],
      },
    });
  });
});
