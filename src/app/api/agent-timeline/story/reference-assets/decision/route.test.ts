import { describe, expect, it } from "vitest";

import {
  uploadStoryReferenceAsset,
} from "@/features/agent-timeline/story-api";
import { startStoryGraphWorkflow } from "@/features/agent-timeline/story-input";
import type { StoryReferenceAssetPlan } from "@/features/agent-timeline/story-types";

import { POST } from "./route";

function createWorkflow() {
  return startStoryGraphWorkflow({
    rawIntent: "A two-shot courier story through a neon market.",
    targetShotCount: 2,
    storyId: "story-reference-decision-route",
    workflowId: "workflow-reference-decision-route",
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

function getReferenceAsset(payload: unknown, referenceId: string) {
  const workflow = (payload as { workflow: { nodes: Record<string, { result: unknown }> } }).workflow;
  const plan = workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;

  return plan.assets.find((asset) => asset.id === referenceId);
}

describe("POST /api/agent-timeline/story/reference-assets/decision", () => {
  it("approves the latest uploaded reference candidate", async () => {
    const referenceId = "character-face:main-character";
    const workflow = uploadStoryReferenceAsset({
      workflow: createWorkflow(),
      referenceId,
      now: () => "2026-06-29T00:01:00.000Z",
      assetReference: {
        filename: "uploaded-face.png",
        source: "uploaded",
        url: "/api/comfyui/sequence-references/uploaded-face.png",
      },
    });

    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/reference-assets/decision", {
      method: "POST",
      body: JSON.stringify({
        workflow,
        referenceId,
        action: "approve",
      }),
    }));
    const payload = await routeResponse.json();

    expect(routeResponse.status).toBe(200);
    expect(getReferenceAsset(payload, referenceId)).toMatchObject({
      resolutionState: "approved",
      approval: {
        approvedBy: "user",
        source: "uploaded",
      },
      approvedAssetReference: {
        filename: "uploaded-face.png",
        source: "uploaded",
      },
    });
  });

  it("rejects prompt-only fallback decisions without a user reason", async () => {
    const referenceId = "character-face:main-character";
    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/reference-assets/decision", {
      method: "POST",
      body: JSON.stringify({
        workflow: createWorkflow(),
        referenceId,
        action: "prompt-only",
        reason: "",
      }),
    }));
    const payload = await routeResponse.json();

    expect(routeResponse.status).toBe(400);
    expect(payload.error.message).toBe("Prompt-only fallback requires a user-provided reason.");
  });
});
