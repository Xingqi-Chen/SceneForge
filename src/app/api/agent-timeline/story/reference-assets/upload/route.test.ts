import { describe, expect, it, vi, afterEach } from "vitest";

import { startStoryGraphWorkflow } from "@/features/agent-timeline/story-input";
import { ComfyUiSequenceReferenceStorageError } from "@/features/comfyui/sequence-reference-storage";
import type { StoryReferenceAssetPlan } from "@/features/agent-timeline/story-types";

const storageMocks = vi.hoisted(() => ({
  storeSequenceReferenceImage: vi.fn(),
}));

vi.mock("@/features/comfyui/sequence-reference-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/comfyui/sequence-reference-storage")>();

  return {
    ...actual,
    storeSequenceReferenceImage: storageMocks.storeSequenceReferenceImage,
  };
});

import { POST } from "./route";

function createWorkflow() {
  return startStoryGraphWorkflow({
    rawIntent: "A two-shot courier story through a neon market.",
    targetShotCount: 2,
    storyId: "story-reference-upload-route",
    workflowId: "workflow-reference-upload-route",
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
  storageMocks.storeSequenceReferenceImage.mockReset();
});

describe("POST /api/agent-timeline/story/reference-assets/upload", () => {
  it("stores an uploaded reference candidate and can approve it directly", async () => {
    storageMocks.storeSequenceReferenceImage.mockResolvedValue({
      byteLength: 14,
      contentType: "image/png",
      filename: "stored-upload.png",
      url: "/api/comfyui/sequence-references/stored-upload.png",
    });
    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/reference-assets/upload", {
      method: "POST",
      body: JSON.stringify({
        workflow: createWorkflow(),
        referenceId: "character-face:main-character",
        dataUrl: "data:image/png;base64,ZmFrZQ==",
        approve: true,
      }),
    }));
    const payload = await routeResponse.json();
    const plan = payload.workflow.nodes["reference-asset-plan"].result as StoryReferenceAssetPlan;
    const asset = plan.assets.find((candidate) => candidate.id === "character-face:main-character");

    expect(routeResponse.status).toBe(200);
    expect(storageMocks.storeSequenceReferenceImage).toHaveBeenCalledWith("data:image/png;base64,ZmFrZQ==");
    expect(asset).toMatchObject({
      resolutionState: "approved",
      approval: {
        approvedBy: "user",
        source: "uploaded",
      },
      approvedAssetReference: {
        byteLength: 14,
        contentType: "image/png",
        filename: "stored-upload.png",
        source: "uploaded",
      },
    });
  });

  it("rejects invalid uploads before changing workflow state", async () => {
    storageMocks.storeSequenceReferenceImage.mockRejectedValue(
      new ComfyUiSequenceReferenceStorageError("Reference image must be a PNG, JPEG, or WEBP data URL.", 400),
    );
    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/reference-assets/upload", {
      method: "POST",
      body: JSON.stringify({
        workflow: createWorkflow(),
        referenceId: "character-face:main-character",
        dataUrl: "data:text/plain;base64,ZmFrZQ==",
      }),
    }));
    const payload = await routeResponse.json();

    expect(routeResponse.status).toBe(400);
    expect(payload.error.message).toBe("Reference image must be a PNG, JPEG, or WEBP data URL.");
  });

  it("validates the reference target before storing upload bytes", async () => {
    const routeResponse = await POST(new Request("http://localhost/api/agent-timeline/story/reference-assets/upload", {
      method: "POST",
      body: JSON.stringify({
        workflow: createWorkflow(),
        referenceId: "character-face:missing-character",
        dataUrl: "data:image/png;base64,ZmFrZQ==",
      }),
    }));
    const payload = await routeResponse.json();

    expect(routeResponse.status).toBe(404);
    expect(payload.error.message).toBe('Story reference "character-face:missing-character" was not found.');
    expect(storageMocks.storeSequenceReferenceImage).not.toHaveBeenCalled();
  });
});
