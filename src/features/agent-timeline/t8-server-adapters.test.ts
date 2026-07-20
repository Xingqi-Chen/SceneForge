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
    buildComfyUiSequenceCharacterReference: vi.fn(),
    createComfyUiClient: vi.fn(),
    extractComfyUiHistoryImages: vi.fn(),
    isComfyUiPromptHistoryComplete: vi.fn(),
    summarizeComfyUiErrorDetails: vi.fn(),
    validateComfyUiRequestAgainstObjectInfo: vi.fn(),
    validateComfyUiTextToImageRequest: vi.fn(),
  };
});

const storeGeneratedImageMock = vi.hoisted(() => vi.fn());
const uploadSequenceCharacterReferencesMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7])));
const uploadSourceImageMock = vi.hoisted(() => vi.fn((_client: unknown, request: unknown) => request));

vi.mock("node:fs/promises", () => ({ default: { readFile: readFileMock } }));

vi.mock("@/features/comfyui", () => comfyUiMocks);

vi.mock("@/features/comfyui/generated-image-storage", () => ({
  getGeneratedImageContentType: vi.fn(() => "image/png"),
  getGeneratedImagePath: vi.fn((filename: string) => `C:\\safe\\${filename}`),
  storeGeneratedImage: storeGeneratedImageMock,
}));

vi.mock("@/features/comfyui/source-image-upload", () => ({
  uploadComfyUiTextToImageSourceImage: uploadSourceImageMock,
}));

vi.mock("@/features/comfyui/sequence-reference-upload", () => ({
  uploadSequenceCharacterReferences: uploadSequenceCharacterReferencesMock,
}));

import {
  completeTimelineNode,
  confirmTimelineGeneration,
  createTimelineWorkflowState,
  executeTimelineGraph,
  retryTimelineGenerationFrom,
  setTimelineNodeManualResult,
} from ".";
import { ComfyUiSequenceReferenceStorageError } from "@/features/comfyui/sequence-reference-storage";
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
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 6,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 1,
      seedPolicy: { mode: "fixed", seed: 100 },
      requestPreview: {
        batchSize: 1,
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
  let confirmed = confirmTimelineGeneration(workflow, undefined, { now: clock });
  const sceneInput = confirmed.nodes["scene-input"].result as { imageCount?: number };
  const finalCount = Math.min(4, Math.max(1, Math.round(sceneInput.imageCount ?? 1)));
  const candidateCount = Math.min(8, Math.max(4, finalCount * 2));
  const candidates = Array.from({ length: candidateCount }, (_, index) => ({
    candidateId: `preview-${index + 1}`,
    index,
    seed: 100 + index,
    status: "done" as const,
    storedImage: {
      byteLength: index + 1,
      contentType: "image/png",
      filename: `preview-${index + 1}.png`,
      url: `/api/comfyui/generated-images/preview-${index + 1}.png`,
    },
  }));
  confirmed = completeTimelineNode(confirmed, "preview-execution", {
    baseSeed: 100,
    candidateCount,
    finalCount,
    previewHeight: 768,
    previewWidth: 768,
    previewSteps: 16,
    candidates,
    successfulCount: candidateCount,
    warnings: [],
  }, "system", { now: clock });
  confirmed = completeTimelineNode(confirmed, "preview-scoring", {
    rubricVersion: 1,
    scores: candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      adherence: 100 - index,
      composition: 100 - index,
      anatomy: 100 - index,
      style: 100 - index,
      technical: 100 - index,
      total: 100 - index,
      rank: index + 1,
    })),
    selectedCandidateIds: candidates.slice(0, finalCount).map((candidate) => candidate.candidateId),
    selectionSource: "ai",
  }, "ai", { now: clock });
  return confirmed;
}

function createStyleReferenceWorkflow({
  baseModel = "Illustrious",
  mode = "ipadapter",
  modelFileName = "illustrious.safetensors",
  name = "Illustrious checkpoint",
  promptProfile = "illustrious",
}: {
  baseModel?: string;
  mode?: "ipadapter" | "prompt-only";
  modelFileName?: string;
  name?: string;
  promptProfile?: "anima" | "illustrious";
} = {}) {
  const styleReference = {
    status: "ready" as const,
    mode,
    metadata: {
      byteLength: 512,
      contentType: "image/png",
      filename: "style.png",
      storedFilename: "0123456789abcdef0123456789abcdef.png",
      uploadedAt: "2026-07-19T00:00:00.000Z",
      url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
    },
    analysis: {
      analyzedAt: "2026-07-19T00:00:01.000Z",
      stylePrompt: "soft gouache, cobalt shadows",
      summary: "Soft gouache.",
    },
    ipAdapter: { weight: 0.45, startPercent: 0, endPercent: 1 },
    settingsSnapshot: {
      capturedAt: "2026-07-19T00:00:02.000Z",
      checkpointBaseModel: baseModel,
      checkpointId: "checkpoint-a",
      modeReason: "Reviewed style-reference capability.",
      promptProfile,
    },
  };
  const base = createGateReadyWorkflow();

  return confirmWorkflow({
    ...base,
    nodes: {
      ...base.nodes,
      "scene-input": {
        ...base.nodes["scene-input"],
        result: {
          ...(base.nodes["scene-input"].result as object),
          settingsSnapshot: {
            promptProfile,
            styleReference,
          },
        },
      },
      "resource-recommendation": {
        ...base.nodes["resource-recommendation"],
        result: {
          checkpoint: {
            resource: {
              baseModel,
              id: "checkpoint-a",
              modelFileName,
              name,
            },
          },
          loras: [],
        },
      },
      "parameter-recommendation": {
        ...base.nodes["parameter-recommendation"],
        result: {
          ...(base.nodes["parameter-recommendation"].result as object),
          styleReference,
          requestPreview: {
            ...((base.nodes["parameter-recommendation"].result as { requestPreview: object }).requestPreview),
            checkpointName: modelFileName,
            positivePrompt: "glass greenhouse pilot, soft gouache, cobalt shadows",
          },
        },
      },
    },
  });
}

function prepareStyleReferenceValidation() {
  const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
  comfyUiMocks.createComfyUiClient.mockReturnValue({ getObjectInfo });
  comfyUiMocks.validateComfyUiTextToImageRequest.mockImplementation((request: unknown) => ({
    ok: true,
    request,
  }));
  comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
    errors: ["Stop before queueing."],
    request: {},
    warnings: [],
  });

  return getObjectInfo;
}

function prepareFinalExecutionHarness({
  images,
  outputNodeId = "9",
  storedFilename = "fresh-final.png",
}: {
  images: Array<{ filename: string; nodeId: string; type: string }>;
  outputNodeId?: string;
  storedFilename?: string;
}) {
  const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
  const generateImage = vi.fn().mockResolvedValue({ outputNodeId, promptId: "prompt-target-output" });
  const getHistory = vi.fn().mockResolvedValue({ prompt: "history" });
  const buildViewUrl = vi.fn((image: { filename: string }) =>
    `http://127.0.0.1:8188/view?filename=${image.filename}&type=output`,
  );
  comfyUiMocks.createComfyUiClient.mockReturnValue({ buildViewUrl, generateImage, getHistory, getObjectInfo });
  comfyUiMocks.validateComfyUiTextToImageRequest.mockImplementation((request: unknown) => ({ ok: true, request }));
  comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockImplementation((request: unknown) => ({
    errors: [], request, warnings: [],
  }));
  comfyUiMocks.extractComfyUiHistoryImages.mockReturnValue(images);
  comfyUiMocks.isComfyUiPromptHistoryComplete.mockReturnValue(true);
  storeGeneratedImageMock.mockResolvedValue({
    byteLength: 3,
    contentType: "image/png",
    filename: storedFilename,
    url: `/api/comfyui/generated-images/${storedFilename}`,
  });
  globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "image/png" },
    status: 200,
  }));
  return { buildViewUrl, generateImage };
}

afterEach(() => {
  vi.restoreAllMocks();
  storeGeneratedImageMock.mockReset();
  uploadSequenceCharacterReferencesMock.mockReset();
  readFileMock.mockClear();
  uploadSourceImageMock.mockClear();
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
        { clientId: "timeline-timeline-t8-server-final-preview-1" },
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
          completed: true,
          finals: [expect.objectContaining({ candidateId: "preview-1", promptId: "prompt-confirmed" })],
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

  it("selects the queued output node when history contains images from multiple output nodes", async () => {
    const originalFetch = globalThis.fetch;
    const target = { filename: "target.png", nodeId: "9", type: "output" };
    const decoy = { filename: "decoy.png", nodeId: "5", type: "output" };
    const { buildViewUrl } = prepareFinalExecutionHarness({ images: [decoy, target] });

    try {
      const result = await executeTimelineGraph(
        confirmWorkflow(createGateReadyWorkflow()),
        createTimelineT8ServerNodeAdapters(),
      );

      expect(buildViewUrl).toHaveBeenCalledTimes(1);
      expect(buildViewUrl).toHaveBeenCalledWith(target);
      expect(buildViewUrl).not.toHaveBeenCalledWith(decoy);
      expect(result.nodes["comfyui-execution"].status).toBe("done");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails when completed history has images but none from the queued output node", async () => {
    const originalFetch = globalThis.fetch;
    const { buildViewUrl } = prepareFinalExecutionHarness({
      images: [{ filename: "decoy.png", nodeId: "5", type: "output" }],
      outputNodeId: "9",
    });

    try {
      const result = await executeTimelineGraph(
        confirmWorkflow(createGateReadyWorkflow()),
        createTimelineT8ServerNodeAdapters(),
      );
      const partial = (result.nodes["comfyui-execution"].error?.details as {
        partialResult?: { finals: Array<{ error?: unknown }> };
      }).partialResult;

      expect(result.nodes["comfyui-execution"]).toMatchObject({
        status: "error",
        error: { details: { recoverable: true } },
      });
      expect(partial?.finals[0]).toMatchObject({
        status: "error",
        error: {
          code: "comfyui_execution_failed",
          message: "ComfyUI completed without an image from the expected output node.",
          details: { outputNodeId: "9", promptId: "prompt-target-output" },
        },
      });
      expect(buildViewUrl).not.toHaveBeenCalled();
      expect(storeGeneratedImageMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    ["identical filename", "preview-1.png", "preview-1.png"],
    ["identical managed content hash", `${"a".repeat(32)}.png`, `${"a".repeat(32)}.webp`],
  ])("fails closed for a fresh final with %s and succeeds when retried with changed content", async (
    _case,
    previewFilename,
    noOpFinalFilename,
  ) => {
    const originalFetch = globalThis.fetch;
    const { generateImage } = prepareFinalExecutionHarness({
      images: [{ filename: "final-output.png", nodeId: "9", type: "output" }],
      storedFilename: noOpFinalFilename,
    });
    const workflow = confirmWorkflow(createGateReadyWorkflow());
    const preview = workflow.nodes["preview-execution"].result as {
      candidates: Array<{ storedImage?: { filename: string; url: string } }>;
    };
    preview.candidates[0]!.storedImage = {
      ...preview.candidates[0]!.storedImage!,
      filename: previewFilename,
      url: `/api/comfyui/generated-images/${previewFilename}`,
    };

    try {
      const first = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());
      const partial = (first.nodes["comfyui-execution"].error?.details as {
        partialResult?: { finals: Array<{ error?: unknown }> };
      }).partialResult;
      expect(first.nodes["comfyui-execution"]).toMatchObject({
        status: "error",
        error: { details: { recoverable: true } },
      });
      expect(partial?.finals[0]).toMatchObject({
        status: "error",
        error: {
          code: "comfyui_execution_failed",
          message: "Final generation returned the unchanged preview image. Retry this selection.",
          details: {
            candidateId: "preview-1",
            noOp: true,
            previewFilename,
            recoverable: true,
          },
        },
      });

      generateImage.mockClear();
      storeGeneratedImageMock.mockReset().mockResolvedValue({
        byteLength: 4,
        contentType: "image/png",
        filename: "changed-final.png",
        url: "/api/comfyui/generated-images/changed-final.png",
      });
      const retried = retryTimelineGenerationFrom(first, "comfyui-execution");
      const second = await executeTimelineGraph(retried, createTimelineT8ServerNodeAdapters());

      expect(generateImage).toHaveBeenCalledTimes(1);
      expect(second.nodes["comfyui-execution"]).toMatchObject({
        status: "done",
        result: { finals: [expect.objectContaining({ candidateId: "preview-1", status: "done" })] },
      });
      expect(second.nodes["result-display"].status).toBe("done");
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
        batchSize: 1,
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
      warnings: [],
    });
    let extractedImageIndex = 0;
    comfyUiMocks.extractComfyUiHistoryImages.mockImplementation(() => {
      extractedImageIndex += 1;
      return [{
        filename: `output-${extractedImageIndex}.png`,
        nodeId: "9",
        type: "output",
      }];
    });
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
          batchSize: 1,
          preview: false,
        }),
        { clientId: "timeline-timeline-t8-server-final-preview-1" },
      );
      expect(generateImage).toHaveBeenCalledTimes(4);
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
        message: "ComfyUI request failed: checkpoint missing",
        details: {
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
        details: {
          recoverable: true,
          partialResult: {
            finals: [expect.objectContaining({
              status: "error",
              error: {
                code: "comfyui_object_info_mismatch",
                message: "ComfyUI request does not match current model/node options. Checkpoint is not available in ComfyUI: missing.safetensors LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
                details: {
                  errors: [
                    "Checkpoint is not available in ComfyUI: missing.safetensors",
                    "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
                  ],
                  warnings: ["using default sampler"],
                },
              },
            })],
          },
        },
      },
    });
  });

  it("injects one Illustrious Run style reference before object_info validation and queueing", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {}, IPAdapterAdvanced: {} });
    comfyUiMocks.createComfyUiClient.mockReturnValue({ getObjectInfo });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockImplementation((request: unknown) => ({
      ok: true,
      request,
    }));
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockReturnValue({
      errors: ["IPAdapter model file is unavailable."],
      request: {},
      warnings: [],
    });
    uploadSequenceCharacterReferencesMock.mockResolvedValue([{
      id: "run-style-reference",
      name: "Run style reference",
      prompt: "soft gouache, cobalt shadows",
      enabled: true,
      mode: "ipadapter",
      references: [{
        id: "run-style-reference-image",
        imageName: "sceneforge-style.png",
        storedFilename: "0123456789abcdef0123456789abcdef.png",
        weight: 0.45,
      }],
      weight: 0.45,
      startPercent: 0,
      endPercent: 1,
    }]);
    comfyUiMocks.buildComfyUiSequenceCharacterReference.mockReturnValue({
      id: "run-style-reference",
      name: "Run style reference",
      referenceImages: [{ imageName: "sceneforge-style.png", weight: 0.45 }],
      weight: 0.45,
      startPercent: 0,
      endPercent: 1,
    });

    const styleReference = {
      status: "ready" as const,
      mode: "ipadapter" as const,
      metadata: {
        byteLength: 512,
        contentType: "image/png",
        filename: "style.png",
        storedFilename: "0123456789abcdef0123456789abcdef.png",
        uploadedAt: "2026-07-19T00:00:00.000Z",
        url: "/api/comfyui/sequence-references/0123456789abcdef0123456789abcdef.png",
      },
      analysis: {
        analyzedAt: "2026-07-19T00:00:01.000Z",
        stylePrompt: "soft gouache, cobalt shadows",
        summary: "Soft gouache.",
      },
      ipAdapter: { weight: 0.45, startPercent: 0, endPercent: 1 },
      settingsSnapshot: {
        capturedAt: "2026-07-19T00:00:02.000Z",
        checkpointBaseModel: "Illustrious",
        modeReason: "Illustrious supports IPAdapter.",
        promptProfile: "illustrious" as const,
      },
    };
    const base = createGateReadyWorkflow();
    const workflow = confirmWorkflow({
      ...base,
      nodes: {
        ...base.nodes,
        "scene-input": {
          ...base.nodes["scene-input"],
          result: {
            ...(base.nodes["scene-input"].result as object),
            settingsSnapshot: {
              detailers: {
                faceDetailer: { enabled: false },
                handDetailer: { enabled: false },
              },
              promptProfile: "illustrious",
              styleReference,
            },
          },
        },
        "resource-recommendation": {
          ...base.nodes["resource-recommendation"],
          result: {
            checkpoint: {
              resource: {
                id: "checkpoint-a",
                name: "Illustrious checkpoint",
                baseModel: "Illustrious",
                modelFileName: "illustrious.safetensors",
              },
            },
            loras: [],
          },
        },
        "parameter-recommendation": {
          ...base.nodes["parameter-recommendation"],
          result: {
            ...(base.nodes["parameter-recommendation"].result as object),
            styleReference,
            requestPreview: {
              ...((base.nodes["parameter-recommendation"].result as { requestPreview: object }).requestPreview),
              checkpointName: "illustrious.safetensors",
              positivePrompt: "glass greenhouse pilot, soft gouache, cobalt shadows",
            },
          },
        },
      },
    });

    const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());

    expect(uploadSequenceCharacterReferencesMock).toHaveBeenCalledWith(
      expect.anything(),
      "run-timeline-t8-server",
      [expect.objectContaining({
        id: "run-style-reference",
        mode: "ipadapter",
        weight: 0.45,
        startPercent: 0,
        endPercent: 1,
      })],
    );
    expect(comfyUiMocks.validateComfyUiRequestAgainstObjectInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        characterReferences: [expect.objectContaining({ id: "run-style-reference" })],
      }),
      expect.anything(),
    );
    expect(result.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: {
        details: {
          partialResult: {
            finals: [expect.objectContaining({
              error: expect.objectContaining({
                code: "comfyui_object_info_mismatch",
                message: expect.stringContaining("IPAdapter model file is unavailable"),
              }),
            })],
          },
        },
      },
    });
  });

  it.each([
    ["Anima", "Anima", "anima.safetensors", "Anima checkpoint", "anima"],
    ["unsupported", "SDXL", "sdxl.safetensors", "SDXL checkpoint", "illustrious"],
    ["unknown", "Custom", "mystery.safetensors", "Mystery checkpoint", "illustrious"],
  ] as const)("keeps %s style references prompt-only without upload or IPAdapter injection", async (
    _label,
    baseModel,
    modelFileName,
    name,
    promptProfile,
  ) => {
    prepareStyleReferenceValidation();

    const result = await executeTimelineGraph(createStyleReferenceWorkflow({
      baseModel,
      mode: "ipadapter",
      modelFileName,
      name,
      promptProfile,
    }), createTimelineT8ServerNodeAdapters());

    expect(uploadSequenceCharacterReferencesMock).not.toHaveBeenCalled();
    expect(comfyUiMocks.buildComfyUiSequenceCharacterReference).not.toHaveBeenCalled();
    expect(comfyUiMocks.validateComfyUiRequestAgainstObjectInfo).toHaveBeenCalledWith(
      expect.not.objectContaining({ characterReferences: expect.anything() }),
      expect.anything(),
    );
    expect(result.nodes["comfyui-execution"].status).toBe("error");
  });

  it.each([
    [404, "Stored Run style reference was not found. Retry analysis, replace it, or disable IPAdapter."],
    [500, "Run style reference could not be prepared. Retry analysis, replace it, or disable IPAdapter."],
  ])("redacts storage diagnostics from the client-visible error for status %i", async (statusCode, expectedMessage) => {
    prepareStyleReferenceValidation();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveDiagnostic = "C:\\private\\style.png token=secret-value raw upstream diagnostics";
    uploadSequenceCharacterReferencesMock.mockRejectedValue(
      new ComfyUiSequenceReferenceStorageError(sensitiveDiagnostic, statusCode),
    );

    const result = await executeTimelineGraph(
      createStyleReferenceWorkflow(),
      createTimelineT8ServerNodeAdapters(),
    );
    const serializedResult = JSON.stringify(result.nodes["comfyui-execution"]);

    expect(result.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: {
        details: {
          partialResult: {
            finals: [expect.objectContaining({
              error: expect.objectContaining({
                code: "comfyui_request_invalid",
                message: expectedMessage,
              }),
            })],
          },
        },
      },
    });
    expect(serializedResult).not.toContain("C:\\private");
    expect(serializedResult).not.toContain("secret-value");
    expect(serializedResult).not.toContain("raw upstream diagnostics");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("redacts sensitive upload error names and messages from the client result and fixed console log", async () => {
    prepareStyleReferenceValidation();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveMessage = "C:\\private\\style.png token=secret-message raw upstream message diagnostics";
    const sensitiveName = "C:\\private\\CustomError token=secret-name raw upstream name diagnostics";
    const sensitiveError = new Error(sensitiveMessage);
    sensitiveError.name = sensitiveName;
    uploadSequenceCharacterReferencesMock.mockRejectedValue(sensitiveError);

    const result = await executeTimelineGraph(
      createStyleReferenceWorkflow(),
      createTimelineT8ServerNodeAdapters(),
    );
    const serializedResult = JSON.stringify(result.nodes["comfyui-execution"]);
    const serializedLogArguments = JSON.stringify(consoleError.mock.calls);

    expect(result.nodes["comfyui-execution"]).toMatchObject({
      status: "error",
      error: {
        details: {
          partialResult: {
            finals: [expect.objectContaining({
              error: expect.objectContaining({
                code: "comfyui_request_invalid",
                message: "Run style reference could not be prepared. Retry analysis, replace it, or disable IPAdapter.",
              }),
            })],
          },
        },
      },
    });
    expect(serializedResult).not.toContain("C:\\private");
    expect(serializedResult).not.toContain("secret-message");
    expect(serializedResult).not.toContain("secret-name");
    expect(serializedResult).not.toContain("raw upstream message diagnostics");
    expect(serializedResult).not.toContain("raw upstream name diagnostics");
    expect(consoleError).not.toHaveBeenCalled();
    expect(serializedLogArguments).not.toContain("C:\\private");
    expect(serializedLogArguments).not.toContain("secret-message");
    expect(serializedLogArguments).not.toContain("secret-name");
    expect(serializedLogArguments).not.toContain("raw upstream message diagnostics");
    expect(serializedLogArguments).not.toContain("raw upstream name diagnostics");
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

  it("preserves successful finals and retries only the missing selection", async () => {
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    const generateImage = vi.fn()
      .mockResolvedValueOnce({ outputNodeId: "9", promptId: "final-1" })
      .mockResolvedValueOnce({ outputNodeId: "9", promptId: "final-2" });
    const getHistory = vi.fn().mockResolvedValue({ prompt: "history" });
    const buildViewUrl = vi.fn().mockReturnValue("http://127.0.0.1:8188/view?filename=final.png&type=output");
    comfyUiMocks.createComfyUiClient.mockReturnValue({ buildViewUrl, generateImage, getHistory, getObjectInfo });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockImplementation((request: unknown) => ({ ok: true, request }));
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockImplementation((request: unknown) => ({
      errors: [], request, warnings: [],
    }));
    comfyUiMocks.extractComfyUiHistoryImages.mockReturnValue([{ filename: "final.png", nodeId: "9", type: "output" }]);
    comfyUiMocks.isComfyUiPromptHistoryComplete.mockReturnValue(true);
    storeGeneratedImageMock
      .mockResolvedValueOnce({
        byteLength: 3,
        contentType: "image/png",
        filename: "stored-final.png",
        url: "/api/comfyui/generated-images/stored-final.png",
      })
      .mockResolvedValueOnce({
        byteLength: 3,
        contentType: "image/png",
        filename: "preview-2.png",
        url: "/api/comfyui/generated-images/preview-2.png",
      });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" }, status: 200,
    }));

    try {
      const first = await executeTimelineGraph(
        confirmWorkflow(createGateReadyWorkflow(createClock(), 2)),
        createTimelineT8ServerNodeAdapters(),
      );
      expect(first.nodes["comfyui-execution"]).toMatchObject({
        status: "error",
        error: {
          details: {
            recoverable: true,
            partialResult: {
              completed: false,
              finals: [
                expect.objectContaining({ candidateId: "preview-1", status: "done" }),
                expect.objectContaining({
                  candidateId: "preview-2",
                  status: "error",
                  error: expect.objectContaining({
                    details: expect.objectContaining({ noOp: true, recoverable: true }),
                  }),
                }),
              ],
            },
          },
        },
      });

      generateImage.mockReset().mockResolvedValue({ outputNodeId: "9", promptId: "final-2" });
      storeGeneratedImageMock.mockReset().mockResolvedValue({
        byteLength: 4,
        contentType: "image/png",
        filename: "stored-final-2.png",
        url: "/api/comfyui/generated-images/stored-final-2.png",
      });
      const retried = retryTimelineGenerationFrom(first, "comfyui-execution");
      const second = await executeTimelineGraph(retried, createTimelineT8ServerNodeAdapters());

      expect(generateImage).toHaveBeenCalledTimes(1);
      expect(generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ seed: 101, batchSize: 1, denoise: 0.65 }),
        { clientId: "timeline-timeline-t8-server-final-preview-2" },
      );
      expect(storeGeneratedImageMock).toHaveBeenCalledTimes(1);
      expect(second.nodes["comfyui-execution"]).toMatchObject({
        status: "done",
        result: {
          completed: true,
          finalCount: 2,
          finals: [
            expect.objectContaining({ candidateId: "preview-1", status: "done" }),
            expect.objectContaining({ candidateId: "preview-2", status: "done" }),
          ],
        },
      });
      expect(second.nodes["result-display"].status).toBe("done");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    [2, "done"],
    [1, "error"],
  ] as const)("retains partial previews when %i of K=2 candidates succeed", async (successLimit, expectedStatus) => {
    delete process.env.LITELLM_VISION_MODEL;
    delete process.env.LITELLM_DEFAULT_MODEL;
    const getObjectInfo = vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} });
    let queueCount = 0;
    const generateImage = vi.fn().mockImplementation(() => {
      queueCount += 1;
      return queueCount <= successLimit
        ? Promise.resolve({ outputNodeId: "9", promptId: `preview-${queueCount}` })
        : Promise.reject(new Error("preview failed"));
    });
    const getHistory = vi.fn().mockResolvedValue({ prompt: "history" });
    const buildViewUrl = vi.fn().mockReturnValue("http://127.0.0.1:8188/view?filename=preview.png&type=output");
    comfyUiMocks.createComfyUiClient.mockReturnValue({ buildViewUrl, generateImage, getHistory, getObjectInfo });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockImplementation((request: unknown) => ({ ok: true, request }));
    comfyUiMocks.validateComfyUiRequestAgainstObjectInfo.mockImplementation((request: unknown) => ({
      errors: [], request, warnings: [],
    }));
    comfyUiMocks.extractComfyUiHistoryImages.mockReturnValue([{ filename: "preview.png", nodeId: "9", type: "output" }]);
    comfyUiMocks.isComfyUiPromptHistoryComplete.mockReturnValue(true);
    storeGeneratedImageMock.mockResolvedValue({
      byteLength: 3,
      contentType: "image/png",
      filename: "stored-preview.png",
      url: "/api/comfyui/generated-images/stored-preview.png",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" }, status: 200,
    }));

    try {
      const workflow = confirmTimelineGeneration(createGateReadyWorkflow(createClock(), 2));
      const result = await executeTimelineGraph(workflow, createTimelineT8ServerNodeAdapters());
      const previewNode = result.nodes["preview-execution"];
      const partial = expectedStatus === "done"
        ? previewNode.result
        : (previewNode.error?.details as { partialResult?: unknown } | undefined)?.partialResult;

      expect(previewNode.status).toBe(expectedStatus);
      expect(partial).toMatchObject({
        candidateCount: 4,
        finalCount: 2,
        successfulCount: successLimit,
        candidates: expect.arrayContaining([
          expect.objectContaining({ status: "done", storedImage: expect.objectContaining({ filename: "stored-preview.png" }) }),
          expect.objectContaining({ status: "error" }),
        ]),
      });
      if (expectedStatus === "done") {
        expect(result.nodes["preview-scoring"]).toMatchObject({ status: "error", error: { code: "llm_config" } });
      } else {
        expect(result.nodes["preview-scoring"].status).toBe("blocked");
      }
      expect(result.nodes["comfyui-execution"].status).toBe("blocked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
