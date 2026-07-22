import { describe, expect, it, vi, afterEach } from "vitest";

const comfyUiMocks = vi.hoisted(() => ({
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
  confirmTimelineGeneration,
  createTimelineWorkflowState,
  type TimelineWorkflowState,
} from "@/features/agent-timeline";
import { createTimelineGenerationConfirmationFingerprint } from "@/features/agent-timeline/generation-confirmation.server";
import {
  resolveTimelineFinalGenerationPolicy,
  timelineFinalGenerationPolicy,
} from "@/features/agent-timeline/final-generation-policy";

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
        checkpointName: "missing.safetensors",
        positivePrompt: "glass greenhouse pilot",
        preview: true,
      },
    },
    "system",
  );

  return workflow;
}

function createSignedConfirmedWorkflow() {
  const workflow = createGateReadyWorkflow();
  const finalPolicy = resolveTimelineFinalGenerationPolicy({}, "balanced");
  return confirmTimelineGeneration(workflow, {
    confirmationRequired: false,
    confirmed: true,
    confirmationFingerprint: createTimelineGenerationConfirmationFingerprint(workflow),
    finalPolicyVersion: timelineFinalGenerationPolicy.version,
    finalRedrawPreset: finalPolicy.preset,
    finalGenerationFamily: finalPolicy.family,
    finalDenoise: finalPolicy.denoise,
  });
}

function createSignedWorkflowWithCompletedPreviews(finalCount = 1) {
  let workflow = createSignedConfirmedWorkflow();
  const candidateCount = Math.min(8, Math.max(4, finalCount * 2));
  const candidates = Array.from({ length: candidateCount }, (_, index) => {
    const number = index + 1;
    const filename = `${number.toString(16).repeat(32)}.png`;
    return {
      candidateId: `preview-${number}`,
      index,
      seed: 99 + number,
      status: "done" as const,
      promptId: `preview-prompt-${number}`,
      sourceImage: { filename: `preview-output-${number}.png`, nodeId: "9", type: "output" },
      storedImage: {
        byteLength: number,
        contentType: "image/png",
        filename,
        url: `/api/comfyui/generated-images/${filename}`,
      },
    };
  });
  workflow = completeTimelineNode(workflow, "preview-execution", {
    baseSeed: 100,
    candidateCount,
    finalCount,
    previewHeight: 768,
    previewWidth: 768,
    previewSteps: 20,
    candidates,
    successfulCount: candidateCount,
    warnings: [],
  }, "system");
  return workflow;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  storeGeneratedImageMock.mockReset();
  Object.values(comfyUiMocks).forEach((mock) => {
    if (typeof mock === "function" && "mockReset" in mock) {
      mock.mockReset();
    }
  });
});

describe("POST /api/agent-timeline/confirm-generation", () => {
  it("returns confirmed workflow object_info mismatch details from the preview phase", async () => {
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
    expect(payload.workflow.nodes["generation-gate"]).toMatchObject({
      status: "manual",
      result: {
        finalPolicyVersion: 2,
        finalRedrawPreset: "balanced",
        finalGenerationFamily: "fallback",
        finalDenoise: 0.45,
      },
    });
    expect(payload.workflow.nodes["preview-execution"]).toMatchObject({
      status: "error",
      error: {
        details: {
          recoverable: true,
          partialResult: {
            successfulCount: 0,
            candidates: expect.arrayContaining([
              expect.objectContaining({
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
              }),
            ]),
          },
        },
      },
    });
    expect(payload.workflow.nodes["preview-scoring"].status).toBe("blocked");
    expect(payload.workflow.nodes["comfyui-execution"].status).toBe("blocked");
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

  it("rejects Story Graph workflow payloads on the single-image confirmation endpoint", async () => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        workflow: {
          workflowId: "story-confirm-route",
          workflowMode: "story-graph",
          storyId: "story-confirm-route",
          createdAt: "2026-06-15T00:00:00.000Z",
          updatedAt: "2026-06-15T00:00:00.000Z",
          generationConfirmed: false,
          nodes: {},
        },
      }),
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("Single-image generation requires a single-image timeline workflow.");
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it("rejects unknown retry phases", async () => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "retry",
        retryNodeId: "result-display",
        workflow: createGateReadyWorkflow(),
      }),
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("retryNodeId") },
    });
  });

  it("rejects phase retries when generation is no longer confirmed", async () => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "retry",
        retryNodeId: "preview-scoring",
        workflow: createGateReadyWorkflow(),
      }),
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Generation must remain confirmed before retrying a generation phase." },
    });
  });

  it("advances the retained fixed preview seed only for an authorized preview-execution retry", async () => {
    const observedSeeds: number[] = [];
    comfyUiMocks.createComfyUiClient.mockReturnValue({
      getObjectInfo: vi.fn().mockResolvedValue({ CheckpointLoaderSimple: {} }),
    });
    comfyUiMocks.validateComfyUiTextToImageRequest.mockImplementation((request: { seed?: number }) => {
      if (typeof request.seed === "number") observedSeeds.push(request.seed);
      return {
        ok: false,
        message: "Stop after observing the authorized request-local seed.",
        details: { recoverable: true },
      };
    });

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "retry",
        retryNodeId: "preview-execution",
        workflow: createSignedWorkflowWithCompletedPreviews(2),
      }),
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(observedSeeds).toEqual([104, 105, 106, 107]);
    expect(payload.workflow.nodes["preview-execution"].result).toMatchObject({ baseSeed: 104 });
    expect(payload.workflow.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");
  });

  it.each([
    ["prompt", (workflow: TimelineWorkflowState) => {
      workflow.nodes["scene-prompt"].result = { positivePrompt: "tampered prompt" };
    }],
    ["resource", (workflow: TimelineWorkflowState) => {
      workflow.nodes["resource-recommendation"].result = { checkpoint: "tampered.safetensors", loras: [] };
    }],
    ["parameter", (workflow: TimelineWorkflowState) => {
      const result = workflow.nodes["parameter-recommendation"].result as { requestPreview: Record<string, unknown> };
      result.requestPreview.cfg = 99;
    }],
    ["source", (workflow: TimelineWorkflowState) => {
      workflow.nodes["scene-input"].result = {
        ...(workflow.nodes["scene-input"].result as object),
        sourceDenoise: 0.4,
        sourceImage: {
          dataUrl: "data:image/png;base64,aGVsbG8=",
          filename: "tampered.png",
          height: 512,
          mimeType: "image/png",
          uploadedAt: "2026-07-20T00:00:00.000Z",
          width: 512,
        },
      };
    }],
    ["K", (workflow: TimelineWorkflowState) => {
      workflow.nodes["scene-input"].result = {
        ...(workflow.nodes["scene-input"].result as object),
        imageCount: 4,
      };
    }],
    ["NSFW", (workflow: TimelineWorkflowState) => {
      workflow.nodes["scene-input"].result = {
        ...(workflow.nodes["scene-input"].result as object),
        nsfw: true,
      };
    }],
  ] as const)("rejects retry when the signed %s contract is tampered", async (_case, mutate) => {
    const workflow = JSON.parse(JSON.stringify(createSignedConfirmedWorkflow())) as TimelineWorkflowState;
    mutate(workflow);

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "retry",
        retryNodeId: "preview-execution",
        workflow,
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("contract changed"),
        details: { code: "confirmation_required" },
      },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
    expect(comfyUiMocks.validateComfyUiTextToImageRequest).not.toHaveBeenCalled();
  });

  it("rejects a valid signed confirmation replayed onto a different workflow id", async () => {
    const workflow = JSON.parse(JSON.stringify(createSignedConfirmedWorkflow())) as TimelineWorkflowState;
    workflow.workflowId = "timeline-confirm-api-replayed";

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "retry",
        retryNodeId: "preview-execution",
        stage: "preview-execution",
        workflow,
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("contract changed"),
        details: { code: "confirmation_required" },
      },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it("rejects a staged confirmation that tries to start after preview execution", async () => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "confirm",
        stage: "preview-scoring",
        workflow: createGateReadyWorkflow(),
      }),
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("must start with preview execution") },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it("rejects a continuation that skips incomplete generation dependencies", async () => {
    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "continue",
        stage: "comfyui-execution",
        workflow: createSignedConfirmedWorkflow(),
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("dependencies are complete"),
        details: { code: "timeline_node_blocked" },
      },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it("does not let a staged continuation bypass confirmation fingerprint validation", async () => {
    const workflow = JSON.parse(JSON.stringify(createSignedConfirmedWorkflow())) as TimelineWorkflowState;
    workflow.nodes["scene-prompt"].result = { positivePrompt: "tampered staged prompt" };

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "continue",
        stage: "preview-scoring",
        workflow,
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { code: "confirmation_required" } },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["altered", 999],
  ] as const)("rejects an otherwise signed continuation when Final policy version data is %s", async (_case, version) => {
    const workflow = JSON.parse(JSON.stringify(createSignedConfirmedWorkflow())) as TimelineWorkflowState;
    const gate = workflow.nodes["generation-gate"].result as { finalPolicyVersion?: number };
    if (version === undefined) delete gate.finalPolicyVersion;
    else gate.finalPolicyVersion = version;

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "continue",
        stage: "preview-scoring",
        workflow,
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { code: "confirmation_required" } },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it.each([
    ["preset", (gate: Record<string, unknown>) => { gate.finalRedrawPreset = "strong"; }],
    ["family", (gate: Record<string, unknown>) => { gate.finalGenerationFamily = "illustrious"; }],
    ["denoise", (gate: Record<string, unknown>) => { gate.finalDenoise = 0.99; }],
  ] as const)("rejects retry when signed Final policy %s metadata is tampered", async (_case, mutate) => {
    const workflow = JSON.parse(JSON.stringify(createSignedConfirmedWorkflow())) as TimelineWorkflowState;
    mutate(workflow.nodes["generation-gate"].result as Record<string, unknown>);

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "retry",
        retryNodeId: "preview-execution",
        workflow,
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("contract changed"),
        details: { code: "confirmation_required" },
      },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it("blocks final-stage continuation after semantically swapped scoring ranks are sanitized", async () => {
    let workflow = createSignedWorkflowWithCompletedPreviews(2);
    workflow = completeTimelineNode(workflow, "preview-scoring", {
      rubricVersion: 2,
      scores: [1, 2, 3, 4].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 90,
        composition: 90,
        anatomy: 90,
        style: 90,
        technical: 90,
        total: 90,
        criticalDefects: [],
        eligible: true,
        rank: number === 1 ? 2 : number === 2 ? 1 : number,
      })),
      selectedCandidateIds: ["preview-1", "preview-2"],
      selectionSource: "ai",
    }, "ai");

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "continue",
        stage: "comfyui-execution",
        workflow,
      }),
      method: "POST",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("dependencies are complete"),
        details: {
          code: "timeline_node_blocked",
          dependencies: expect.arrayContaining([
            { nodeId: "preview-scoring", status: "error" },
          ]),
        },
      },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });

  it("continues scoring without invalidating a real temp preview whose ComfyUI subfolder is empty", async () => {
    vi.stubEnv("LITELLM_VISION_MODEL", "");
    vi.stubEnv("LITELLM_DEFAULT_MODEL", "");
    const workflow = createSignedWorkflowWithCompletedPreviews(1);
    const preview = workflow.nodes["preview-execution"].result as {
      candidates: Array<Record<string, unknown>>;
    };
    preview.candidates[0]!.sourceImage = {
      filename: "ComfyUI_temp_00001_.png",
      subfolder: "",
      type: "temp",
      nodeId: "23",
    };

    const response = await POST(new Request("http://localhost/api/agent-timeline/confirm-generation", {
      body: JSON.stringify({
        action: "continue",
        stage: "preview-scoring",
        workflow,
      }),
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.nodes["preview-execution"]).toMatchObject({
      status: "done",
      result: {
        successfulCount: 4,
        previewWidth: 768,
        previewHeight: 768,
        previewSteps: 20,
        candidates: expect.arrayContaining([
          expect.objectContaining({
            candidateId: "preview-1",
            status: "done",
            sourceImage: {
              filename: "ComfyUI_temp_00001_.png",
              type: "temp",
              nodeId: "23",
            },
          }),
        ]),
      },
    });
    expect(payload.workflow.nodes["preview-scoring"]).toMatchObject({
      status: "error",
      error: { code: "llm_config" },
    });
    expect(comfyUiMocks.createComfyUiClient).not.toHaveBeenCalled();
  });
});
