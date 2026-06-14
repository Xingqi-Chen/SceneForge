import { describe, expect, it, vi, afterEach } from "vitest";

const comfyUiMocks = vi.hoisted(() => ({
  createComfyUiClient: vi.fn(),
  extractComfyUiHistoryImages: vi.fn(),
  isComfyUiPromptHistoryComplete: vi.fn(),
  validateComfyUiRequestAgainstObjectInfo: vi.fn(),
  validateComfyUiTextToImageRequest: vi.fn(),
}));

const storeGeneratedImageMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/comfyui", () => comfyUiMocks);

vi.mock("@/features/comfyui/generated-image-storage", () => ({
  storeGeneratedImage: storeGeneratedImageMock,
}));

import {
  completeTimelineNode,
  createTimelineWorkflowState,
  type TimelineWorkflowState,
} from "@/features/agent-timeline";

import { POST } from "./route";

function createGateReadyWorkflow() {
  let workflow: TimelineWorkflowState = createTimelineWorkflowState({
    sceneRequest: "A pilot in a greenhouse",
    workflowId: "timeline-confirm-api",
    now: () => "2026-06-02T00:00:00.000Z",
  });

  workflow = completeTimelineNode(workflow, "scene-prompt", { positivePrompt: "glass greenhouse pilot" }, "ai");
  workflow = completeTimelineNode(workflow, "character-tags", { items: [] }, "ai");
  workflow = completeTimelineNode(workflow, "character-action", { action: "checking controls" }, "ai");
  workflow = completeTimelineNode(
    workflow,
    "canvas-binding",
    { spatialSummary: "centered character" },
    "system",
  );
  workflow = completeTimelineNode(
    workflow,
    "resource-recommendation",
    { checkpoint: "local.safetensors", loras: [] },
    "ai",
  );
  workflow = completeTimelineNode(
    workflow,
    "parameter-recommendation",
    {
      requestPreview: {
        batchSize: 1,
        checkpointName: "missing.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: true,
      },
    },
    "system",
  );

  return workflow;
}

afterEach(() => {
  vi.restoreAllMocks();
  storeGeneratedImageMock.mockReset();
  Object.values(comfyUiMocks).forEach((mock) => mock.mockReset());
});

describe("POST /api/agent-timeline/confirm-generation", () => {
  it("returns confirmed workflow object_info mismatch details from the execution node", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    comfyUiMocks.createComfyUiClient.mockReturnValue({ getObjectInfo });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockReturnValue({
      ok: true,
      request: {
        batchSize: 1,
        checkpointName: "missing.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
    });
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
      errors: [
        "Checkpoint is not available in ComfyUI: missing.safetensors",
        "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
      ],
      request: {
        batchSize: 1,
        checkpointName: "missing.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
      warnings: ["using default sampler"],
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({ workflow: createGateReadyWorkflow() }),
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: {
        code: "comfyui_object_info_mismatch",
        message: "ComfyUI request does not match the current ComfyUI model/node options. Checkpoint is not available in ComfyUI: missing.safetensors LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
        details: {
          errors: [
            "Checkpoint is not available in ComfyUI: missing.safetensors",
            "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
          ],
          warnings: ["using default sampler"],
        },
      },
    });
  });

  it("accepts legacy workflow payloads without workflow mode as single-image", async () => {
    const workflow = createGateReadyWorkflow();
    const legacyWorkflow = { ...workflow } as Partial<TimelineWorkflowState>;
    delete legacyWorkflow.workflowMode;
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    comfyUiMocks.createComfyUiClient.mockReturnValue({ getObjectInfo });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockReturnValue({
      ok: true,
      request: {
        batchSize: 1,
        checkpointName: "local.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
    });
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
      errors: [],
      request: {
        batchSize: 1,
        checkpointName: "local.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
      warnings: [],
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({ workflow: legacyWorkflow }),
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.workflowMode).toBe("single-image");
    expect(payload.workflow.nodes["generation-gate"]).toMatchObject({
      status: "manual",
      result: {
        confirmed: true,
      },
    });
  });
});
