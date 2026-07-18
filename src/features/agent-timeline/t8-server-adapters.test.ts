import { afterEach, describe, expect, it, vi } from "vitest";

const comfyUiMocks = vi.hoisted(() => {
  class MockComfyUiApiError extends Error {
    readonly statusCode?: number;
    readonly details?: unknown;

    constructor(message: string, options: { details?: unknown; statusCode?: number } = {}) {
      super(message);
      this.name = "ComfyUiApiError";
      this.details = options.details;
      this.statusCode = options.statusCode;
    }
  }

  return {
    COMFYUI_FACE_DETAILER_DEFAULTS: {
      bboxCropFactor: 3,
      bboxDilation: 10,
      bboxThreshold: 0.5,
      cycle: 1,
      denoise: 0.5,
      dropSize: 10,
      feather: 5,
      forceInpaint: true,
      guideSize: 512,
      guideSizeFor: true,
      maxSize: 1024,
      noiseMask: true,
      samBBoxExpansion: 0,
      samDetectionHint: "center-1",
      samDilation: 0,
      samMaskHintThreshold: 0.7,
      samMaskHintUseNegative: "False",
      samThreshold: 0.93,
      wildcard: "",
    },
    COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS: [{ label: "center-1", value: "center-1" }],
    COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS: [{ label: "False", value: "False" }],
    DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL: "bbox/face_yolov8m.pt",
    DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL: "bbox/hand_yolov8s.pt",
    ComfyUiApiError: MockComfyUiApiError,
    createComfyUiClient: vi.fn(),
    extractComfyUiHistoryImages: vi.fn(),
    isComfyUiPromptHistoryComplete: vi.fn(),
    summarizeComfyUiErrorDetails: vi.fn(),
    validateComfyUiRequestAgainstObjectInfo: vi.fn(),
    validateComfyUiTextToImageRequest: vi.fn(),
  };
});

const storeGeneratedImageMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/comfyui", () => comfyUiMocks);

vi.mock("@/features/comfyui/generated-image-storage", () => ({
  storeGeneratedImage: storeGeneratedImageMock,
}));

import {
  completeTimelineNode,
  confirmTimelineGeneration,
  createTimelineWorkflowState,
  executeTimelineGraph,
  setTimelineNodeManualResult,
} from ".";
import { createTimelineT8ServerNodeAdapters } from "./t8-server-adapters";
import type { TimelineWorkflowState } from "./types";

function createClock() {
  let tick = 0;

  return () => {
    tick += 1;
    return `2026-06-02T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

function createGateReadyWorkflow(clock = createClock(), imageCount = 1) {
  let workflow = createTimelineWorkflowState({
    imageCount,
    sceneRequest: "A pilot in a greenhouse",
    workflowId: "timeline-t8-server",
    now: clock,
  });

  workflow = completeTimelineNode(workflow, "scene-prompt", { positivePrompt: "glass greenhouse pilot" }, "ai", {
    now: clock,
  });
  workflow = completeTimelineNode(workflow, "character-tags", { items: [] }, "ai", { now: clock });
  workflow = completeTimelineNode(workflow, "character-action", { action: "checking controls" }, "ai", {
    now: clock,
  });
  workflow = completeTimelineNode(
    workflow,
    "canvas-binding",
    { spatialSummary: "centered character" },
    "system",
    { now: clock },
  );
  workflow = completeTimelineNode(
    workflow,
    "resource-recommendation",
    { checkpoint: "local.safetensors", loras: [] },
    "ai",
    { now: clock },
  );
  workflow = completeTimelineNode(
    workflow,
    "parameter-recommendation",
    {
      requestPreview: {
        batchSize: 4,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: true,
        samplerName: "euler",
        scheduler: "normal",
        steps: 28,
        width: 1024,
        height: 1024,
      },
    },
    "system",
    { now: clock },
  );

  return workflow;
}

function confirmWorkflow(workflow: TimelineWorkflowState, clock = createClock()) {
  return confirmTimelineGeneration(workflow, undefined, { now: clock });
}

afterEach(() => {
  vi.restoreAllMocks();
  storeGeneratedImageMock.mockReset();
  Object.values(comfyUiMocks).forEach((mock) => {
    if (typeof mock === "function" && "mockReset" in mock) {
      mock.mockReset();
    }
  });
});

describe("timeline T8 server adapters", () => {
  it("does not construct, validate, queue, poll, view, or store before confirmation", async () => {
    const workflow = createGateReadyWorkflow();

    const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());

    expect(result.nodes["generation-gate"].error).toMatchObject({
      code: "confirmation_required",
    });
    expect(result.nodes["comfyui-execution"].status).toBe("blocked");
    expect(comfyUiMocks.validateComfyUiTextToImageRequest).not.toHaveBeenCalled();
    expect(comfyUiMocks.validateComfyUiRequestAgainstObjectInfo).not.toHaveBeenCalled();
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
    expect(storeGeneratedImageMock).not.toHaveBeenCalled();
  });

  it("validates, queues, polls history, reads the image, and stores the result after confirmation", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    const generateImage = vi.fn().mockResolvedValue({
      nodeErrors: {},
      nodeIds: { sampler: "3" },
      number: 7,
      outputNodeId: "9",
      promptId: "prompt-confirmed",
      request: {
        batchSize: 1,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
      workflow: { "9": { class_type: "SaveImage", inputs: {} } },
    });
    const getHistory = vi.fn().mockResolvedValue({ prompt: "history" });
    const buildViewUrl = vi.fn().mockReturnValue("http://127.0.0.1:8188/view?filename=output.png&type=output");
    comfyUiMocks.createComfyUiClient.mockReturnValue({
      buildViewUrl,
      generateImage,
      getHistory,
      getObjectInfo,
    });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockReturnValue({
      ok: true,
      request: {
        batchSize: 1,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
    });
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
      errors: [],
      request: {
        batchSize: 1,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
      warnings: ["using default VAE"],
    });
    comfyUiMocks.extractComfyUiHistoryImages.mockReturnValue([
      {
        filename: "output.png",
        nodeId: "9",
        type: "output",
      },
    ]);
    comfyUiMocks.isComfyUiPromptHistoryComplete.mockReturnValue(true);
    storeGeneratedImageMock.mockResolvedValue({
      byteLength: 3,
      contentType: "image/png",
      filename: "stored.png",
      url: "/api/comfyui/generated-images/stored.png",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-type": "image/png",
      },
      status: 200,
    }));

    try {
      const workflow = confirmWorkflow(createGateReadyWorkflow());
      const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());

      expect(comfyUiMocks.validateComfyUiTextToImageRequest).toHaveBeenCalledWith(expect.objectContaining({
        batchSize: 1,
        checkpointName: "local.safetensors",
        faceDetailer: expect.objectContaining({ enabled: false }),
        handDetailer: expect.objectContaining({ enabled: false }),
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
        samplerName: "euler",
        scheduler: "normal",
        steps: 28,
        width: 1024,
        height: 1024,
      }));
      expect(getObjectInfo).toHaveBeenCalledTimes(1);
      expect(comfyUiMocks.validateComfyUiRequestAgainstObjectInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          batchSize: 1,
          preview: false,
        }),
        { CheckpointLoaderSimple: {} },
      );
      expect(generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          batchSize: 1,
          checkpointName: "local.safetensors",
          preview: false,
        }),
        { clientId: "timeline-timeline-t8-server" },
      );
      expect(getHistory).toHaveBeenCalledWith("prompt-confirmed");
      expect(buildViewUrl).toHaveBeenCalledWith({
        filename: "output.png",
        nodeId: "9",
        type: "output",
      });
      expect(globalThis.fetch).toHaveBeenCalledWith("http://127.0.0.1:8188/view?filename=output.png&type=output", {
        cache: "no-store",
        headers: {
          accept: "image/*",
        },
      });
      expect(storeGeneratedImageMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "image/png");
      expect(result.nodes["comfyui-execution"]).toMatchObject({
        status: "done",
        result: {
          promptId: "prompt-confirmed",
          request: {
            batchSize: 1,
            preview: false,
          },
        },
      });
      expect(result.nodes["result-display"]).toMatchObject({
        status: "done",
        result: {
          image: {
            url: "/api/comfyui/generated-images/stored.png",
          },
          warnings: ["using default VAE"],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores every image returned for a multi-image confirmed render", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    const generateImage = vi.fn().mockResolvedValue({
      nodeErrors: {},
      nodeIds: { sampler: "3" },
      outputNodeId: "9",
      promptId: "prompt-four-images",
      request: {
        batchSize: 4,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
    });
    const getHistory = vi.fn().mockResolvedValue({ prompt: "history" });
    const buildViewUrl = vi.fn((image: { filename: string }) =>
      `http://127.0.0.1:8188/view?filename=${image.filename}&type=output`,
    );
    comfyUiMocks.createComfyUiClient.mockReturnValue({
      buildViewUrl,
      generateImage,
      getHistory,
      getObjectInfo,
    });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockReturnValue({
      ok: true,
      request: {
        batchSize: 4,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
    });
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
      errors: [],
      request: {
        batchSize: 4,
        checkpointName: "local.safetensors",
        negativePrompt: "low detail",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
      warnings: [],
    });
    comfyUiMocks.extractComfyUiHistoryImages.mockReturnValue([1, 2, 3, 4].map((index) => ({
      filename: `output-${index}.png`,
      nodeId: "9",
      type: "output",
    })));
    comfyUiMocks.isComfyUiPromptHistoryComplete.mockReturnValue(true);
    [1, 2, 3, 4].forEach((index) => {
      storeGeneratedImageMock.mockResolvedValueOnce({
        byteLength: index,
        contentType: "image/png",
        filename: `stored-${index}.png`,
        url: `/api/comfyui/generated-images/stored-${index}.png`,
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1]), {
      headers: {
        "content-type": "image/png",
      },
      status: 200,
    }));

    try {
      const workflow = confirmWorkflow(createGateReadyWorkflow(createClock(), 4));
      const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());

      expect(generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          batchSize: 4,
          preview: false,
        }),
        { clientId: "timeline-timeline-t8-server" },
      );
      expect(buildViewUrl).toHaveBeenCalledTimes(4);
      expect(globalThis.fetch).toHaveBeenCalledTimes(4);
      expect(storeGeneratedImageMock).toHaveBeenCalledTimes(4);
      expect(result.nodes["result-display"]).toMatchObject({
        status: "done",
        result: {
          image: {
            filename: "output-1.png",
            url: "/api/comfyui/generated-images/stored-1.png",
          },
          images: [
            { filename: "output-1.png", url: "/api/comfyui/generated-images/stored-1.png" },
            { filename: "output-2.png", url: "/api/comfyui/generated-images/stored-2.png" },
            { filename: "output-3.png", url: "/api/comfyui/generated-images/stored-3.png" },
            { filename: "output-4.png", url: "/api/comfyui/generated-images/stored-4.png" },
          ],
          storedImage: {
            filename: "stored-1.png",
          },
          storedImages: [
            { filename: "stored-1.png" },
            { filename: "stored-2.png" },
            { filename: "stored-3.png" },
            { filename: "stored-4.png" },
          ],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps ComfyUI API errors to timeline node errors", async () => {
    const upstreamDetails = {
      error: {
        message: "checkpoint missing",
      },
    };
    const getObjectInfo = vi.fn().mockRejectedValue(
      new comfyUiMocks.ComfyUiApiError("ComfyUI request failed.", {
        details: upstreamDetails,
        statusCode: 502,
      }),
    );
    comfyUiMocks.createComfyUiClient.mockReturnValue({
      getObjectInfo,
    });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockReturnValue({
      ok: true,
      request: {
        batchSize: 1,
        checkpointName: "local.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: false,
      },
    });
    comfyUiMocks.summarizeComfyUiErrorDetails.mockReturnValue(["checkpoint missing"]);

    const workflow = confirmWorkflow(createGateReadyWorkflow());
    const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());

    expect(result.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: {
        code: "comfyui_upstream",
        message: "ComfyUI prompt validation failed: checkpoint missing",
        details: {
          details: upstreamDetails,
          statusCode: 502,
        },
      },
    });
    expect(result.nodes["result-display"].status).toBe("blocked");
    expect(storeGeneratedImageMock).not.toHaveBeenCalled();
  });

  it("preserves object_info validation errors in the timeline node message", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    comfyUiMocks.createComfyUiClient.mockReturnValue({
      getObjectInfo,
    });
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

    const workflow = confirmWorkflow(createGateReadyWorkflow());
    const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());

    expect(result.nodes["comfyui-execution"]).toMatchObject({
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

  it("invalidates confirmed execution and result nodes after an upstream manual edit", async () => {
    let workflow = confirmWorkflow(createGateReadyWorkflow());
    workflow = completeTimelineNode(
      workflow,
      "comfyui-execution",
      {
        nodeIds: {},
        outputNodeId: "9",
        promptId: "prompt-old",
        request: {
          batchSize: 1,
          checkpointName: "local.safetensors",
          positivePrompt: "glass greenhouse pilot",
          preview: false,
        },
        warnings: [],
      },
      "system",
    );
    workflow = completeTimelineNode(
      workflow,
      "result-display",
      {
        completed: true,
        image: {
          filename: "old.png",
          nodeId: "9",
          url: "/api/comfyui/generated-images/old.png",
        },
        promptId: "prompt-old",
        sourceImage: {
          filename: "old.png",
          nodeId: "9",
        },
        storedImage: {
          byteLength: 1,
          contentType: "image/png",
          filename: "old.png",
          url: "/api/comfyui/generated-images/old.png",
        },
        warnings: [],
      },
      "system",
    );

    const edited = setTimelineNodeManualResult(workflow, "scene-prompt", {
      positivePrompt: "rainy greenhouse pilot",
    });

    expect(edited.generationConfirmed).toBe(false);
    expect(edited.nodes["generation-gate"].status).toBe("stale");
    expect(edited.nodes["comfyui-execution"].status).toBe("stale");
    expect(edited.nodes["result-display"].status).toBe("stale");
  });
});
