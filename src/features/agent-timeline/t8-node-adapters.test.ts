import { describe, expect, it, vi } from "vitest";

import {
  confirmTimelineGeneration,
  createConfirmedTimelineComfyUiRequest,
  createTimelineT8NodeAdapters,
  createTimelineFinalRequests,
  createTimelinePreviewRequests,
  createTimelineWorkflowState,
  getTimelinePreviewCandidateCount,
  getTimelinePreviewDimensions,
  retryTimelineGenerationFrom,
  setTimelineNodeManualResult,
  type SceneInputTimelineResult,
} from ".";
import * as timelineExports from ".";
import { deriveTimelineConfirmedReferenceContext } from "./run-reference-context";
import { createTimelineGenerationConfirmationFingerprint } from "./generation-confirmation.server";

function createConfirmedWorkflow(
  imageCount?: number,
  sourceImage?: SceneInputTimelineResult["sourceImage"],
  settingsSnapshot?: NonNullable<Parameters<typeof createTimelineWorkflowState>[0]>["settingsSnapshot"],
) {
  const styleReference = settingsSnapshot?.styleReference;
  const stylePrompt = styleReference?.status === "ready" ? styleReference.analysis?.stylePrompt : undefined;
  let workflow = createTimelineWorkflowState({
    imageCount,
    sceneRequest: "A pilot in a greenhouse",
    settingsSnapshot,
    sourceImage,
    workflowId: "t8-request",
  });

  workflow = setTimelineNodeManualResult(workflow, "scene-prompt", {
    positivePrompt: "glass greenhouse pilot",
  });
  workflow = setTimelineNodeManualResult(workflow, "character-tags", { items: [] });
  workflow = setTimelineNodeManualResult(workflow, "character-action", { action: "checking controls" });
  workflow = setTimelineNodeManualResult(workflow, "canvas-binding", { spatialSummary: "centered character" });
  workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
    checkpoint: {
      resource: {
        baseModel: "Illustrious",
        id: "checkpoint-a",
        modelFileName: "local.safetensors",
        name: "Local checkpoint",
      },
    },
    loras: [],
  });
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
    width: 1024,
    height: 1024,
    steps: 30,
    cfg: 6,
    samplerName: "euler",
    scheduler: "normal",
    denoise: 0.72,
    seedPolicy: { mode: "fixed", seed: 100 },
    requestPreview: {
      batchSize: 4,
      checkpointName: "local.safetensors",
      cfg: 6,
      denoise: 0.72,
      negativePrompt: "low detail",
      positivePrompt: stylePrompt
        ? `glass greenhouse pilot, ${stylePrompt}`
        : "glass greenhouse pilot",
      preview: true,
      steps: 30,
      width: 1024,
      height: 1024,
    },
    ...(styleReference ? { styleReference } : {}),
  });

  return workflow;
}

const readyStyleReference = {
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
    checkpointId: "checkpoint-a",
    modeReason: "Illustrious supports IPAdapter.",
    promptProfile: "illustrious" as const,
    visualStyle: "anime" as const,
  },
};

const readyCharacterReference = {
  status: "ready" as const,
  strength: 0.8,
  metadata: {
    byteLength: 512,
    contentType: "image/png",
    storedFilename: "fedcba9876543210fedcba9876543210.png",
    uploadedAt: "2026-07-19T00:00:00.000Z",
    url: "/api/comfyui/sequence-references/fedcba9876543210fedcba9876543210.png",
  },
};

const readyKrea2ReIdReference = {
  kind: "krea2-reid" as const,
  status: "ready" as const,
  strength: 1,
  metadata: {
    byteLength: 777,
    contentType: "image/png",
    storedFilename: "fedcba9876543210fedcba9876543210.png",
    uploadedAt: "2026-08-02T00:00:03.000Z",
    url: "/api/comfyui/sequence-references/fedcba9876543210fedcba9876543210.png",
  },
  reIdPreparation: {
    choice: "crop" as const,
    detector: "yunet-2023mar-int8" as const,
    detectorSha256: "a".repeat(64),
    faceDetected: true,
    height: 256,
    version: 2 as const,
    width: 256,
  },
};

function createKrea2ReIdWorkflow(
  width: number,
  height: number,
  sourceImage?: SceneInputTimelineResult["sourceImage"],
) {
  let workflow = createConfirmedWorkflow(1, sourceImage, {
    characterReference: readyKrea2ReIdReference,
    detailers: {
      faceDetailer: { enabled: true, detectorModelName: "bbox/face.pt", steps: 19 } as never,
      handDetailer: { enabled: true, detectorModelName: "bbox/hand.pt", steps: 21 } as never,
    },
    finalRedrawPreset: "strong",
    promptProfile: "krea2",
  });
  workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
    checkpoint: { resource: {
      baseModel: "Krea 2",
      id: "checkpoint-krea-reid",
      modelFileName: "RedCraft_v4_fp8_scaled.safetensors",
      modelStorageKind: "diffusion",
      name: "Krea 2 Turbo INT8 ConvRot",
    } },
    loras: [],
  });
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
    ...(workflow.nodes["parameter-recommendation"].result as object),
    characterReference: readyKrea2ReIdReference,
    width,
    height,
    seedPolicy: { mode: "fixed", seed: 700 },
    requestPreview: {
      batchSize: 1,
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
      clipName: "qwen3vl_4b_fp8_scaled.safetensors",
      vaeName: "qwen_image_vae.safetensors",
      unetWeightDtype: "default",
      cfg: 1,
      denoise: 1,
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      negativePrompt: "blur",
      positivePrompt: "glass greenhouse pilot",
      samplerName: "euler",
      scheduler: "simple",
      steps: 8,
      workflowProfile: "krea2",
      width,
      height,
    },
  });
  return workflow;
}

function confirmKrea2ReIdWorkflow(workflow: ReturnType<typeof createKrea2ReIdWorkflow>) {
  return confirmTimelineGeneration(workflow, {
    automaticLocalRepairAuthorized: false,
    confirmationFingerprint: createTimelineGenerationConfirmationFingerprint(workflow),
    confirmationRequired: false,
    confirmed: true,
    finalDenoise: 1,
    finalGenerationFamily: "krea2",
    finalPolicyVersion: 5,
    finalRedrawPreset: "strong",
    finalSteps: 8,
    referenceContext: deriveTimelineConfirmedReferenceContext(workflow) ?? undefined,
    visualStyle: "anime",
  });
}

function createKreaArtStyleWorkflow(positivePrompt: string) {
  const styleReference = {
    ...readyStyleReference,
    analysis: {
      ...readyStyleReference.analysis,
      stylePrompt: "art",
    },
    settingsSnapshot: {
      ...readyStyleReference.settingsSnapshot,
      checkpointBaseModel: "Krea 2",
      promptProfile: "krea2" as const,
    },
  };
  let workflow = createConfirmedWorkflow(1, undefined, {
    promptProfile: "krea2",
    styleReference,
  });
  workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
    checkpoint: { resource: {
      baseModel: "Krea 2",
      id: "checkpoint-a",
      modelFileName: "krea-2-turbo-unet.safetensors",
      modelStorageKind: "diffusion",
      name: "Krea 2 Turbo",
    } },
    loras: [],
  });
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
    ...(workflow.nodes["parameter-recommendation"].result as object),
    styleReference,
    requestPreview: {
      batchSize: 1,
      checkpointName: "krea-2-turbo-unet.safetensors",
      cfg: 1,
      denoise: 1,
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion",
      negativePrompt: "blur",
      positivePrompt,
      samplerName: "euler",
      scheduler: "simple",
      steps: 8,
      workflowProfile: "krea2",
      width: 1024,
      height: 1024,
    },
  });
  return confirmTimelineGeneration(workflow);
}

describe("timeline T8 ComfyUI request conversion", () => {
  it("refuses to construct the ComfyUI request before explicit confirmation", () => {
    const workflow = createConfirmedWorkflow();

    expect(() => createConfirmedTimelineComfyUiRequest(workflow)).toThrow(
      "Confirm generation before constructing or executing a ComfyUI request.",
    );
  });

  it("converts the confirmed parameter preview to a default single-image execution request", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow());

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toEqual({
      batchSize: 1,
      cfg: 6,
      checkpointName: "local.safetensors",
      denoise: 0.72,
      faceDetailer: expect.objectContaining({ enabled: false }),
      handDetailer: expect.objectContaining({ enabled: false }),
      negativePrompt: "low detail",
      positivePrompt: "glass greenhouse pilot",
      preview: false,
      steps: 30,
      width: 1024,
      height: 1024,
    });
  });

  it("keeps each confirmed execution request at batch size one", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(3));

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      batchSize: 1,
      checkpointName: "local.safetensors",
      preview: false,
    });
  });

  it("runs Krea Preview, exact-K scoring, and Final stages through the normal adapters", async () => {
    const sourceImage = {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      filename: "krea-source.png",
      height: 1024,
      mimeType: "image/png" as const,
      uploadedAt: "2026-07-25T00:00:00.000Z",
      width: 1024,
    };
    let workflow = createConfirmedWorkflow(2, sourceImage, {
      promptProfile: "krea2",
      detailers: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/custom-face.pt",
          denoise: 0.42,
          steps: 18,
        } as never,
        handDetailer: {
          enabled: false,
          detectorModelName: "bbox/custom-hand.pt",
          steps: 21,
        } as never,
      },
    });
    workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
      checkpoint: {
        resource: {
          baseModel: "Krea 2",
          id: "checkpoint-krea",
          modelFileName: "krea-2-turbo-unet.safetensors",
          modelStorageKind: "diffusion",
          name: "Krea 2 Turbo",
        },
      },
      loras: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      requestPreview: {
        batchSize: 4,
        checkpointName: "krea-2-turbo-unet.safetensors",
        cfg: 1,
        denoise: 1,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        negativePrompt: "",
        positivePrompt: "a quiet station",
        preview: true,
        samplerName: "euler",
        scheduler: "simple",
        steps: 8,
        workflowProfile: "krea2",
        width: 1024,
        height: 1024,
      },
    });
    workflow = confirmTimelineGeneration(workflow);

    const executePreviews = vi.fn(async (requests) => ({
      baseSeed: requests[0]?.seed,
      candidateCount: requests.length,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 8,
      candidates: [],
      successfulCount: 0,
      warnings: [],
    }));
    const scorePreviews = vi.fn();
    const executeFinals = vi.fn(async (requests) => ({
      completed: true,
      finalCount: requests.length,
      finals: [],
      request: requests[0]?.request,
      warnings: [],
    }));
    const adapters = createTimelineT8NodeAdapters({
      executeFinals,
      executePreviews,
      loadResultDisplay: vi.fn(),
      scorePreviews,
    });
    const context = (nodeId: "preview-execution" | "preview-scoring" | "comfyui-execution") => ({
      dependencies: [],
      nodeId,
      workflow,
    });

    await expect(adapters["preview-execution"]?.(context("preview-execution"))).resolves.toMatchObject({
      source: "system",
      value: { candidateCount: 4, finalCount: 2 },
    });
    expect(executePreviews).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        request: expect.objectContaining({
          batchSize: 1,
          preview: true,
          faceDetailer: expect.objectContaining({ enabled: false, detectorModelName: "bbox/custom-face.pt" }),
          handDetailer: expect.objectContaining({ enabled: false, detectorModelName: "bbox/custom-hand.pt" }),
          sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
          workflowProfile: "krea2",
          width: 768,
          height: 768,
        }),
      }),
    ]), expect.any(Object));
    expect(executePreviews.mock.calls[0]?.[0]).toHaveLength(4);

    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 8,
      candidates: [1, 2, 3, 4].map((number, index) => ({
        candidateId: `preview-${number}`,
        index,
        seed: 99 + number,
        status: "done" as const,
        storedImage: {
          byteLength: number,
          contentType: "image/png",
          filename: `preview-${number}.png`,
          url: `/api/comfyui/generated-images/preview-${number}.png`,
        },
      })),
      successfulCount: 4,
      warnings: [],
    });
    const scoringResult = {
      rubricVersion: 2,
      visualStyle: "anime" as const,
      scores: [1, 2, 3, 4].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 100 - number,
        composition: 100 - number,
        anatomy: 100 - number,
        style: 100 - number,
        technical: 100 - number,
        total: 100 - number,
        criticalDefects: [],
        eligible: true,
        visualStyleMatch: true,
        rank: number,
      })),
      selectedCandidateIds: ["preview-1", "preview-2"],
      selectionSource: "ai",
    };
    scorePreviews.mockResolvedValue(scoringResult);
    await expect(adapters["preview-scoring"]?.(context("preview-scoring"))).resolves.toMatchObject({
      source: "ai",
      value: { selectedCandidateIds: ["preview-1", "preview-2"] },
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", scoringResult);
    await expect(adapters["comfyui-execution"]?.(context("comfyui-execution"))).resolves.toMatchObject({
      source: "system",
      value: { completed: true, finalCount: 2 },
    });

    expect(executeFinals).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        candidateId: "preview-1",
        request: expect.objectContaining({
          cfg: 1,
          denoise: 0.18,
          faceDetailer: expect.objectContaining({
            enabled: true,
            detectorModelName: "bbox/custom-face.pt",
            denoise: 0.42,
            steps: 18,
          }),
          handDetailer: expect.objectContaining({
            enabled: false,
            detectorModelName: "bbox/custom-hand.pt",
            steps: 21,
          }),
          sourceImageDataUrl: undefined,
          samplerName: "euler",
          scheduler: "simple",
          seed: 100,
          steps: 4,
          workflowProfile: "krea2",
          width: 1024,
          height: 1024,
        }),
        storedPreview: expect.objectContaining({ filename: "preview-1.png" }),
        finalPolicy: {
          denoise: 0.18,
          family: "krea2",
          preset: "balanced",
          resizeMode: "lanczos3-exact",
          steps: 4,
          version: 3,
        },
      }),
    ]), expect.any(Object), undefined);
    expect(executeFinals.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it.each([
    [1, 4],
    [2, 4],
    [3, 6],
    [4, 8],
  ])("maps Krea K=%i to %i individually queued aligned previews", (imageCount, candidateCount) => {
    let workflow = createConfirmedWorkflow(imageCount, undefined, { promptProfile: "krea2" });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      requestPreview: {
        batchSize: 1,
        checkpointName: "krea-2-turbo-unet.safetensors",
        cfg: 1,
        denoise: 1,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        negativePrompt: "",
        positivePrompt: "a quiet station",
        samplerName: "euler",
        scheduler: "simple",
        steps: 8,
        workflowProfile: "krea2",
        width: 1024,
        height: 1024,
      },
    });

    const previews = createTimelinePreviewRequests(confirmTimelineGeneration(workflow));

    expect(previews).toHaveLength(candidateCount);
    expect(previews.map(({ request }) => request.batchSize)).toEqual(Array(candidateCount).fill(1));
    expect(previews.every(({ request }) =>
      request.preview === true && request.width === 768 && request.height === 768 &&
      request.width % 16 === 0 && request.height % 16 === 0,
    )).toBe(true);
  });

  it.each([
    {
      label: "settings profile with a missing request profile",
      settingsSnapshot: { promptProfile: "krea2" as const },
      requestProfile: undefined,
      modelBaseModel: "Unknown",
      modelStorageKind: "checkpoint" as const,
    },
    {
      label: "settings profile with a tampered default request profile",
      settingsSnapshot: { promptProfile: "krea2" as const },
      requestProfile: "default" as const,
      modelBaseModel: "Unknown",
      modelStorageKind: "checkpoint" as const,
    },
    {
      label: "Krea diffusion metadata with a tampered default request profile",
      settingsSnapshot: undefined,
      requestProfile: "default" as const,
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
    },
  ])("re-locks $label for confirmed, Preview, and Final requests", ({
    settingsSnapshot,
    requestProfile,
    modelBaseModel,
    modelStorageKind,
  }) => {
    let workflow = createConfirmedWorkflow(1, undefined, settingsSnapshot);
    const parameters = workflow.nodes["parameter-recommendation"].result as {
      requestPreview: Record<string, unknown>;
    } & Record<string, unknown>;
    const requestPreview: Record<string, unknown> = {
      ...parameters.requestPreview,
      checkpointName: modelBaseModel === "Krea 2"
        ? "krea-2-turbo-unet.safetensors"
        : "restored-model.safetensors",
      modelBaseModel,
      modelStorageKind,
      steps: 77,
      cfg: 9,
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
    };
    if (requestProfile === undefined) {
      delete requestPreview.workflowProfile;
    } else {
      requestPreview.workflowProfile = requestProfile;
    }
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...parameters,
      steps: 91,
      cfg: 12,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      requestPreview,
    });
    workflow = confirmTimelineGeneration(workflow);

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      workflowProfile: "krea2",
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      batchSize: 1,
      preview: false,
    });
    const previews = createTimelinePreviewRequests(workflow);
    expect(previews.every(({ request }) => (
      request.steps === 8
      && request.cfg === 1
      && request.samplerName === "euler"
      && request.scheduler === "simple"
      && request.batchSize === 1
      && request.preview === true
    ))).toBe(true);

    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: previews[0]?.seed,
      candidateCount: previews.length,
      finalCount: 1,
      previewHeight: previews[0]?.request.height,
      previewWidth: previews[0]?.request.width,
      previewSteps: 8,
      candidates: previews.map(({ candidateId, index, seed }) => ({
        candidateId,
        index,
        seed,
        status: "done" as const,
        storedImage: {
          byteLength: index + 1,
          contentType: "image/png",
          filename: `${candidateId}.png`,
          url: `/api/comfyui/generated-images/${candidateId}.png`,
        },
      })),
      successfulCount: previews.length,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: previews.map(({ candidateId, index }) => ({
        candidateId,
        adherence: 100 - index,
        composition: 100 - index,
        anatomy: 100 - index,
        style: 100 - index,
        technical: 100 - index,
        total: 100 - index,
        criticalDefects: [],
        eligible: true,
        visualStyleMatch: true,
        rank: index + 1,
      })),
      selectedCandidateIds: ["preview-1"],
      selectionSource: "ai",
    });
    expect(createTimelineFinalRequests(workflow)).toMatchObject([{
      request: {
        workflowProfile: "krea2",
        steps: 4,
        denoise: 0.18,
        cfg: 1,
        samplerName: "euler",
        scheduler: "simple",
        batchSize: 1,
        preview: false,
      },
    }]);
  });

  it("does not apply Krea sampling locks to an ordinary default diffusion request", () => {
    let workflow = createConfirmedWorkflow(1);
    const parameters = workflow.nodes["parameter-recommendation"].result as {
      requestPreview: Record<string, unknown>;
    } & Record<string, unknown>;
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...parameters,
      steps: 77,
      cfg: 9,
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
      requestPreview: {
        ...parameters.requestPreview,
        workflowProfile: "default",
        modelBaseModel: "FLUX.1 Dev",
        modelStorageKind: "diffusion",
        steps: 77,
        cfg: 9,
        samplerName: "uni_pc",
        scheduler: "sgm_uniform",
      },
    });
    workflow = confirmTimelineGeneration(workflow);

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      workflowProfile: "default",
      modelBaseModel: "FLUX.1 Dev",
      modelStorageKind: "diffusion",
      steps: 77,
      cfg: 9,
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
    });
    expect(createTimelinePreviewRequests(workflow).every(({ request }) => (
      request.steps !== 8
      && request.cfg === 9
      && request.samplerName === "uni_pc"
      && request.scheduler === "sgm_uniform"
      && request.workflowProfile === "default"
    ))).toBe(true);
  });

  it("keeps authorized Krea repair separate from Preview and Final queue construction", async () => {
    let workflow = createConfirmedWorkflow(1, undefined, {
      automaticLocalRepair: true,
      promptProfile: "krea2",
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      requestPreview: {
        batchSize: 1,
        checkpointName: "krea-2-turbo-unet.safetensors",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "a quiet station",
        samplerName: "euler",
        scheduler: "simple",
        workflowProfile: "krea2",
        width: 1024,
        height: 1024,
      },
    });
    workflow = confirmTimelineGeneration(workflow);
    const executeDirectFinal = vi.fn();
    const executeFinals = vi.fn();
    const adapters = createTimelineT8NodeAdapters({
      executeDirectFinal,
      executeFinals,
      executePreviews: vi.fn(),
      loadResultDisplay: vi.fn(),
      scorePreviews: vi.fn(),
    });

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      batchSize: 1,
      faceDetailer: { enabled: false },
      handDetailer: { enabled: false },
      workflowProfile: "krea2",
    });
    await expect(adapters["comfyui-execution"]?.({
      dependencies: [],
      nodeId: "comfyui-execution",
      workflow,
    })).rejects.toThrow("Preview results are required");
    expect(executeDirectFinal).not.toHaveBeenCalled();
    expect(executeFinals).not.toHaveBeenCalled();
  });

  it("carries independent Run detailers into the confirmed ComfyUI request", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(undefined, undefined, {
      detailers: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/custom-face.pt",
          steps: 18,
          denoise: 0.42,
        } as never,
        handDetailer: {
          enabled: false,
          detectorModelName: "bbox/custom-hand.pt",
          steps: 21,
        } as never,
      },
    }));

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/custom-face.pt",
        steps: 18,
        denoise: 0.42,
      },
      handDetailer: {
        enabled: false,
        detectorModelName: "bbox/custom-hand.pt",
        steps: 21,
      },
    });
  });

  it("forces confirmed img2img requests to a single image with source metadata", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(3, {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      filename: "source.png",
      height: 768,
      mimeType: "image/png",
      uploadedAt: "2026-06-07T00:00:00.000Z",
      width: 1024,
    }));

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      batchSize: 1,
      sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      imageWidth: 1024,
      imageHeight: 768,
      preview: false,
    });
  });

  it("preserves preview/confirmed parity for a reviewed Run style reference", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(4, undefined, {
      promptProfile: "illustrious",
      styleReference: readyStyleReference,
    }));

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      batchSize: 1,
      positivePrompt: "glass greenhouse pilot, soft gouache, cobalt shadows",
      preview: false,
    });
  });

  it("keeps a preflight-approved Krea style prompt exactly once in every Preview and Final request", () => {
    const kreaStyleReference = {
      ...readyStyleReference,
      settingsSnapshot: {
        ...readyStyleReference.settingsSnapshot,
        checkpointBaseModel: "Krea 2",
        promptProfile: "krea2" as const,
      },
    };
    let workflow = createConfirmedWorkflow(1, undefined, {
      promptProfile: "krea2",
      styleReference: kreaStyleReference,
    });
    workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
      checkpoint: { resource: {
        baseModel: "Krea 2", id: "checkpoint-a", modelFileName: "krea-2-turbo-unet.safetensors",
        modelStorageKind: "diffusion", name: "Krea 2 Turbo",
      } },
      loras: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      styleReference: kreaStyleReference,
      requestPreview: {
        batchSize: 1, checkpointName: "krea-2-turbo-unet.safetensors", cfg: 1, denoise: 1,
        modelBaseModel: "Krea 2", modelStorageKind: "diffusion", negativePrompt: "blur",
        positivePrompt: "glass greenhouse pilot. soft gouache, cobalt shadows", samplerName: "euler",
        scheduler: "simple", steps: 8, workflowProfile: "krea2", width: 1024, height: 1024,
      },
    });
    const duplicateStyleWorkflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      styleReference: kreaStyleReference,
      requestPreview: {
        ...((workflow.nodes["parameter-recommendation"].result as {
          requestPreview: Record<string, unknown>;
        }).requestPreview),
        positivePrompt:
          "soft gouache, cobalt shadows. glass greenhouse pilot. soft gouache, cobalt shadows",
      },
    });
    expect(() => createConfirmedTimelineComfyUiRequest(
      confirmTimelineGeneration(duplicateStyleWorkflow),
    )).toThrow("complete style prompt exactly once at the tail");
    workflow = confirmTimelineGeneration(workflow);

    const previews = createTimelinePreviewRequests(workflow);
    expect(previews).toHaveLength(4);
    for (const preview of previews) {
      expect(preview.request.positivePrompt.match(/soft gouache, cobalt shadows/g)).toHaveLength(1);
      expect(preview.request.positivePrompt).not.toMatch(/\.\s*,|,,|;\s*,|\s+[,.!?;:]/u);
    }

    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100, candidateCount: 4, finalCount: 1, previewWidth: 768, previewHeight: 768, previewSteps: 8,
      candidates: previews.map((preview) => ({
        candidateId: preview.candidateId, index: preview.index, seed: preview.seed, status: "done" as const,
        storedImage: { byteLength: 1, contentType: "image/png", filename: `${preview.candidateId}.png`, url: `/generated/${preview.candidateId}.png` },
      })),
      successfulCount: 4, warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: previews.map((preview, index) => ({
        candidateId: preview.candidateId, adherence: 100 - index, composition: 100, anatomy: 100, style: 100,
        technical: 100, total: 100 - index, criticalDefects: [], eligible: true, visualStyleMatch: true, rank: index + 1,
      })),
      selectedCandidateIds: ["preview-1"], selectionSource: "ai",
    });

    const finals = createTimelineFinalRequests(workflow);
    expect(finals).toHaveLength(1);
    expect(finals[0]?.request.positivePrompt.match(/soft gouache, cobalt shadows/g)).toHaveLength(1);
    expect(finals[0]?.request.positivePrompt).toBe(
      "glass greenhouse pilot. soft gouache, cobalt shadows",
    );
    expect(finals[0]?.request.krea2StyleReference).toBeUndefined();
  });

  it.each([
    ["missing", undefined],
    ["defaulted", "default" as const],
    ["spoofed non-Krea", "anima" as const],
  ])(
    "uses authoritative Krea settings/model validation when workflowProfile is %s",
    async (_label, requestProfile) => {
      const kreaStyleReference = {
        ...readyStyleReference,
        settingsSnapshot: {
          ...readyStyleReference.settingsSnapshot,
          checkpointBaseModel: "Krea 2",
          promptProfile: "krea2" as const,
        },
      };
      let workflow = createConfirmedWorkflow(1, undefined, {
        promptProfile: "krea2",
        styleReference: kreaStyleReference,
      });
      workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
        checkpoint: { resource: {
          baseModel: "Krea 2",
          id: "checkpoint-a",
          modelFileName: "krea-2-turbo-unet.safetensors",
          modelStorageKind: "diffusion",
          name: "Krea 2 Turbo",
        } },
        loras: [],
      });
      const requestPreview: Record<string, unknown> = {
        batchSize: 1,
        checkpointName: "krea-2-turbo-unet.safetensors",
        cfg: 1,
        denoise: 1,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        negativePrompt: "blur",
        positivePrompt:
          "intro, soft gouache, cobalt shadows — bridge, soft gouache, cobalt shadows",
        samplerName: "euler",
        scheduler: "simple",
        steps: 8,
        width: 1024,
        height: 1024,
      };
      if (requestProfile !== undefined) {
        requestPreview.workflowProfile = requestProfile;
      }
      workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
        ...(workflow.nodes["parameter-recommendation"].result as object),
        styleReference: kreaStyleReference,
        requestPreview,
      });
      workflow = confirmTimelineGeneration(workflow);

      const executePreviews = vi.fn();
      const adapters = createTimelineT8NodeAdapters({
        executeFinals: vi.fn(),
        executePreviews,
        loadResultDisplay: vi.fn(),
        scorePreviews: vi.fn(),
      });

      await expect(adapters["preview-execution"]?.({
        dependencies: [],
        nodeId: "preview-execution",
        workflow,
      })).rejects.toThrow("complete style prompt exactly once at the tail");
      expect(executePreviews).not.toHaveBeenCalled();
    },
  );

  it.each([
    "art_style portrait, art",
    "art-based portrait, art",
    "art_style and art-based portrait, art",
  ])("accepts standalone art at the tail when earlier content contains only compounds: %s", (positivePrompt) => {
    expect(createConfirmedTimelineComfyUiRequest(
      createKreaArtStyleWorkflow(positivePrompt),
    )).toMatchObject({
      positivePrompt,
      workflowProfile: "krea2",
    });
  });

  it.each([
    ["double hyphen", " -- "],
    ["em dash", " — "],
    ["pipe", " | "],
    ["CJK full stop", "。 "],
    ["CJK comma", "、 "],
    ["parentheses", " (bridge) "],
    ["brackets", " [bridge] "],
  ])(
    "rejects prior standalone art across %s before any Preview execution",
    async (_label, separator) => {
      const workflow = createKreaArtStyleWorkflow(
        `art${separator}main subject, art`,
      );
      const executePreviews = vi.fn();
      const adapters = createTimelineT8NodeAdapters({
        executeFinals: vi.fn(),
        executePreviews,
        loadResultDisplay: vi.fn(),
        scorePreviews: vi.fn(),
      });

      await expect(adapters["preview-execution"]?.({
        dependencies: [],
        nodeId: "preview-execution",
        workflow,
      })).rejects.toThrow("complete style prompt exactly once at the tail");
      expect(executePreviews).not.toHaveBeenCalled();
    },
  );

  it.each([
    "cartoon portrait, art",
    "martial pose, art",
  ])("allows a short opaque style prompt exactly once at the canonical tail: %s", (positivePrompt) => {
    const artStyleReference = {
      ...readyStyleReference,
      analysis: {
        ...readyStyleReference.analysis,
        stylePrompt: "art",
      },
    };
    let workflow = createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      styleReference: artStyleReference,
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      requestPreview: {
        ...((workflow.nodes["parameter-recommendation"].result as { requestPreview: object }).requestPreview),
        positivePrompt,
      },
      styleReference: artStyleReference,
    });

    expect(createConfirmedTimelineComfyUiRequest(confirmTimelineGeneration(workflow))).toMatchObject({
      positivePrompt,
    });
  });

  it("rejects a Run style reference removed after parameter review", () => {
    const reviewed = confirmTimelineGeneration(createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      styleReference: readyStyleReference,
    }));
    const removed = {
      ...reviewed,
      nodes: {
        ...reviewed.nodes,
        "scene-input": {
          ...reviewed.nodes["scene-input"],
          result: {
            ...(reviewed.nodes["scene-input"].result as object),
            settingsSnapshot: { promptProfile: "illustrious" as const },
          },
        },
      },
    };

    expect(() => createConfirmedTimelineComfyUiRequest(removed)).toThrow(
      "changed after parameter review",
    );
  });

  it("rejects a tampered confirmed character-reference context before any preview queue provider runs", async () => {
    let workflow = createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      characterReference: readyCharacterReference,
    });
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      characterReference: readyCharacterReference,
    });
    const referenceContext = deriveTimelineConfirmedReferenceContext(workflow);
    if (!referenceContext) throw new Error("Expected a reference context.");
    workflow = confirmTimelineGeneration(workflow, {
      confirmationRequired: false,
      confirmed: true,
      referenceContext,
    });
    const tampered = structuredClone(workflow);
    const gate = tampered.nodes["generation-gate"].result as {
      referenceContext: { references: Array<{ strength: number }> };
    };
    gate.referenceContext.references[0]!.strength = 0.2;
    const executePreviews = vi.fn();
    const adapters = createTimelineT8NodeAdapters({
      executeFinals: vi.fn(),
      executePreviews,
      loadResultDisplay: vi.fn(),
      scorePreviews: vi.fn(),
    });

    await expect(adapters["preview-execution"]?.({
      dependencies: [],
      nodeId: "preview-execution",
      workflow: tampered,
    })).rejects.toThrow("reference settings changed after confirmation");
    expect(executePreviews).not.toHaveBeenCalled();
  });

  it("rejects a selected character reference missing from parameter review before building a queue request", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      characterReference: readyCharacterReference,
    }));

    expect(() => createConfirmedTimelineComfyUiRequest(workflow)).toThrow(
      "Run character reference changed after parameter review",
    );
  });

  it.each([
    ["missing", undefined],
    ["legacy string", "local.safetensors"],
    ["malformed", { resource: { baseModel: "Illustrious", id: "", modelFileName: "" } }],
  ])("rejects a %s checkpoint recommendation when a Run style reference is active", (_label, checkpoint) => {
    let workflow = createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      styleReference: readyStyleReference,
    });
    workflow = setTimelineNodeManualResult(workflow, "resource-recommendation", {
      checkpoint,
      loras: [],
    });

    expect(() => createConfirmedTimelineComfyUiRequest(confirmTimelineGeneration(workflow))).toThrow(
      "validated checkpoint recommendation",
    );
  });

  it("blocks confirmed execution for pending, failed, invalid, mismatch, changed, or malformed prompt state", () => {
    for (const status of ["pending", "failed", "invalid", "mismatch"] as const) {
      const styleReference = {
        ...readyStyleReference,
        status,
        error: `${status} Run style reference`,
      };
      const workflow = confirmTimelineGeneration(createConfirmedWorkflow(1, undefined, {
        promptProfile: "illustrious",
        styleReference,
      }));
      expect(() => createConfirmedTimelineComfyUiRequest(workflow)).toThrow(`${status} Run style reference`);
    }

    const reviewed = confirmTimelineGeneration(createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      styleReference: readyStyleReference,
    }));
    const changed = {
      ...reviewed,
      nodes: {
        ...reviewed.nodes,
        "scene-input": {
          ...reviewed.nodes["scene-input"],
          result: {
            ...(reviewed.nodes["scene-input"].result as object),
            settingsSnapshot: {
              promptProfile: "illustrious",
              styleReference: {
                ...readyStyleReference,
                ipAdapter: { weight: 0.7, startPercent: 0, endPercent: 1 },
              },
            },
          },
        },
      },
    };
    expect(() => createConfirmedTimelineComfyUiRequest(changed)).toThrow(
      "changed after parameter review",
    );

    let malformedPrompt = createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      styleReference: readyStyleReference,
    });
    malformedPrompt = setTimelineNodeManualResult(malformedPrompt, "parameter-recommendation", {
      ...(malformedPrompt.nodes["parameter-recommendation"].result as object),
      styleReference: readyStyleReference,
      requestPreview: {
        ...((malformedPrompt.nodes["parameter-recommendation"].result as { requestPreview: object }).requestPreview),
        positivePrompt: "soft gouache, cobalt shadows, subject, soft gouache, cobalt shadows",
      },
    });
    malformedPrompt = confirmTimelineGeneration(malformedPrompt);
    expect(() => createConfirmedTimelineComfyUiRequest(malformedPrompt)).toThrow(
      "complete style prompt exactly once",
    );

    let duplicatedShortPrompt = createConfirmedWorkflow(1, undefined, {
      promptProfile: "illustrious",
      styleReference: {
        ...readyStyleReference,
        analysis: { ...readyStyleReference.analysis, stylePrompt: "art" },
      },
    });
    duplicatedShortPrompt = setTimelineNodeManualResult(duplicatedShortPrompt, "parameter-recommendation", {
      ...(duplicatedShortPrompt.nodes["parameter-recommendation"].result as object),
      styleReference: {
        ...readyStyleReference,
        analysis: { ...readyStyleReference.analysis, stylePrompt: "art" },
      },
      requestPreview: {
        ...((duplicatedShortPrompt.nodes["parameter-recommendation"].result as { requestPreview: object }).requestPreview),
        positivePrompt: "art, subject, art",
      },
    });
    expect(() => createConfirmedTimelineComfyUiRequest(confirmTimelineGeneration(duplicatedShortPrompt))).toThrow(
      "complete style prompt exactly once",
    );
  });

  it.each([
    [1, 4],
    [2, 4],
    [3, 6],
    [4, 8],
  ])("maps K=%i to %i preview candidates", (finalCount, candidateCount) => {
    expect(getTimelinePreviewCandidateCount(finalCount)).toBe(candidateCount);
  });

  it.each([
    [832, 1216, 520, 760],
    [1216, 832, 760, 520],
    [1024, 1024, 768, 768],
    [1024, 576, 768, 432],
    [576, 1024, 432, 768],
    [1536, 1024, 768, 512],
    [1024, 1536, 512, 768],
    [768, 1344, 416, 728],
    [1344, 768, 728, 416],
    [1920, 800, 768, 320],
    [800, 1920, 320, 768],
    [4096, 128, 768, 24],
    [128, 4096, 24, 768],
    [500, 257, 500, 257],
    [768, 513, 768, 513],
    [63, 31, 63, 31],
  ])("scales %ix%i previews to exactly %ix%i", (width, height, previewWidth, previewHeight) => {
    const preview = getTimelinePreviewDimensions(width, height);
    expect(preview).toEqual({
      width: previewWidth,
      height: previewHeight,
    });
    expect(preview.width * height).toBe(preview.height * width);
    expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(768);
    if (Math.max(width, height) > 768) {
      expect(preview.width % 8).toBe(0);
      expect(preview.height % 8).toBe(0);
    } else {
      expect(preview).toEqual({ width, height });
    }
  });

  it.each([
    [997, 991],
    [991, 997],
    [10_000, 1],
    [1, 10_000],
  ])("fails closed when pathological %ix%i cannot be exactly ratio-preserved and 8-aligned", (width, height) => {
    expect(() => getTimelinePreviewDimensions(width, height)).toThrow(/exact-aspect.*8-pixel-aligned/i);
    try {
      getTimelinePreviewDimensions(width, height);
    } catch (error) {
      expect(error).toMatchObject({
        code: "comfyui_request_invalid",
        details: { width, height, longestEdge: 768 },
      });
    }
  });

  it.each([
    [1024, 1536, 832, 1248],
    [1536, 1024, 1248, 832],
    [1024, 1024, 1024, 1024],
    [768, 768, 768, 768],
  ])("uses the ReID one-megapixel exact-aspect aligned16 envelope for %ix%i", (
    width,
    height,
    previewWidth,
    previewHeight,
  ) => {
    const getTimelineReIdPreviewDimensions = (
      timelineExports as unknown as {
        getTimelineReIdPreviewDimensions: (width: number, height: number) => { width: number; height: number };
      }
    ).getTimelineReIdPreviewDimensions;
    const dimensions = getTimelineReIdPreviewDimensions(width, height);

    expect(dimensions).toEqual({ width: previewWidth, height: previewHeight });
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(1_048_576);
    expect(dimensions.width * height).toBe(dimensions.height * width);
    expect(dimensions.width % 16).toBe(0);
    expect(dimensions.height % 16).toBe(0);
  });

  it("creates 832x1248 ReID previews and formal same-seed txt2img Final with FaceDetailer paused", () => {
    let workflow = confirmKrea2ReIdWorkflow(createKrea2ReIdWorkflow(1024, 1536));
    const previews = createTimelinePreviewRequests(workflow);

    expect(previews).toHaveLength(4);
    expect(previews.map(({ request }) => [request.width, request.height])).toEqual([
      [832, 1248], [832, 1248], [832, 1248], [832, 1248],
    ]);
    expect(previews.map(({ seed }) => seed)).toEqual([700, 701, 702, 703]);
    expect(previews.every(({ request }) =>
      request.denoise === 1 &&
      request.sourceImageDataUrl === undefined &&
      request.faceDetailer?.enabled === false &&
      request.handDetailer?.enabled === false
    )).toBe(true);

    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 700,
      candidateCount: 4,
      finalCount: 1,
      previewHeight: 1248,
      previewWidth: 832,
      previewSteps: 8,
      candidates: previews.map(({ candidateId, index, seed }) => ({
        candidateId,
        index,
        seed,
        status: "done" as const,
        storedImage: {
          byteLength: index + 1,
          contentType: "image/png",
          filename: `${candidateId}.png`,
          url: `/api/comfyui/generated-images/${candidateId}.png`,
        },
      })),
      successfulCount: 4,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: previews.map(({ candidateId, index }) => ({
        candidateId,
        adherence: 100 - index,
        composition: 100 - index,
        anatomy: 100 - index,
        style: 100 - index,
        technical: 100 - index,
        total: 100 - index,
        criticalDefects: [],
        eligible: true,
        visualStyleMatch: true,
        rank: index + 1,
      })),
      selectedCandidateIds: ["preview-1"],
      selectionSource: "ai",
    });

    const [final] = createTimelineFinalRequests(workflow);
    expect(final).toMatchObject({
      candidateId: "preview-1",
      seed: 700,
      storedPreview: { filename: "preview-1.png" },
      finalPolicy: {
        version: 5,
        family: "krea2",
        steps: 8,
        denoise: 1,
      },
      request: {
        width: 1024,
        height: 1536,
        imageWidth: 1024,
        imageHeight: 1536,
        seed: 700,
        steps: 8,
        denoise: 1,
        preview: false,
        sourceImageDataUrl: undefined,
        imageName: undefined,
        faceDetailer: { enabled: false, detectorModelName: "bbox/face.pt", steps: 19 },
        handDetailer: { enabled: true, detectorModelName: "bbox/hand.pt", steps: 21 },
      },
    });
    expect(final?.request).not.toHaveProperty("sourceImage");

    const settings = (workflow.nodes["scene-input"].result as {
      settingsSnapshot: { detailers: { faceDetailer: { enabled: boolean }; handDetailer: { enabled: boolean } } };
    }).settingsSnapshot;
    expect(settings.detailers.faceDetailer.enabled).toBe(true);
    expect(settings.detailers.handDetailer.enabled).toBe(true);
  });

  it("blocks active ReID with Composer source img2img before constructing any request", () => {
    const sourceImage = {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      filename: "composer-source.png",
      height: 1536,
      mimeType: "image/png" as const,
      uploadedAt: "2026-08-02T00:00:00.000Z",
      width: 1024,
    };
    const workflow = confirmKrea2ReIdWorkflow(createKrea2ReIdWorkflow(1024, 1536, sourceImage));

    expect(() => createConfirmedTimelineComfyUiRequest(workflow)).toThrow(/ReID.*img2img|img2img.*ReID/i);
    expect(() => createTimelinePreviewRequests(workflow)).toThrow(/ReID.*img2img|img2img.*ReID/i);
  });

  it.each([1, 2, 3, 4])("creates deterministic independent preview requests for txt2img K=%i", (imageCount) => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(imageCount));
    const requests = createTimelinePreviewRequests(workflow);

    expect(requests).toHaveLength(getTimelinePreviewCandidateCount(imageCount));
    expect(requests.map((item) => item.seed)).toEqual(
      Array.from({ length: requests.length }, (_, index) => 100 + index),
    );
    expect(requests.every(({ request }) =>
      request.batchSize === 1 &&
      request.steps === 20 &&
      request.width === 768 &&
      request.height === 768 &&
      request.preview === true &&
      request.faceDetailer?.enabled === false &&
      request.handDetailer?.enabled === false
    )).toBe(true);
    expect((workflow.nodes["parameter-recommendation"].result as { requestPreview: { batchSize: number; steps: number } }).requestPreview)
      .toMatchObject({ batchSize: 4, steps: 30 });
  });

  it("materializes one random base seed per preview round", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    let workflow = createConfirmedWorkflow(2);
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      seedPolicy: { mode: "random" },
    });
    const requests = createTimelinePreviewRequests(confirmTimelineGeneration(workflow));

    expect(random).toHaveBeenCalledTimes(1);
    expect(requests.map((item) => item.seed)).toEqual(
      requests.map((_, index) => requests[0]!.seed + index),
    );
  });

  it("advances a fixed seed range on explicit preview retries and keeps consecutive ranges disjoint", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 20,
      candidates: [],
      successfulCount: 0,
      warnings: [],
    });

    const firstRetry = retryTimelineGenerationFrom(workflow, "preview-execution");
    expect(firstRetry.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");
    expect(createTimelinePreviewRequests(firstRetry).map((item) => item.seed)).toEqual([100, 101, 102, 103]);
    expect(createTimelinePreviewRequests(firstRetry, { advancePreviewSeedOnRetry: true })
      .map((item) => item.seed)).toEqual([104, 105, 106, 107]);

    workflow = setTimelineNodeManualResult(firstRetry, "preview-execution", {
      ...(firstRetry.nodes["preview-execution"].result as object),
      baseSeed: 104,
    });
    const secondRetry = retryTimelineGenerationFrom(workflow, "preview-execution");
    expect(createTimelinePreviewRequests(secondRetry, { advancePreviewSeedOnRetry: true })
      .map((item) => item.seed)).toEqual([108, 109, 110, 111]);
  });

  it("wraps an explicitly retried fixed preview range to zero at MAX_SAFE_INTEGER", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: Number.MAX_SAFE_INTEGER - 3,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 20,
      candidates: [],
      successfulCount: 0,
      warnings: [],
    });

    const retried = retryTimelineGenerationFrom(workflow, "preview-execution");
    expect(createTimelinePreviewRequests(retried).map((item) => item.seed)).toEqual([100, 101, 102, 103]);
    expect(createTimelinePreviewRequests(retried, { advancePreviewSeedOnRetry: true })
      .map((item) => item.seed)).toEqual([0, 1, 2, 3]);
  });

  it("does not advance a retained fixed seed during inspection or ordinary upstream stale/reconfirmation", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 20,
      candidates: [],
      successfulCount: 0,
      warnings: [],
    });
    expect(createTimelinePreviewRequests(workflow).map((item) => item.seed)).toEqual([100, 101, 102, 103]);

    workflow = setTimelineNodeManualResult(workflow, "scene-prompt", { positivePrompt: "revised greenhouse pilot" });
    workflow = confirmTimelineGeneration(workflow);
    expect(workflow.nodes["preview-execution"].result).not.toMatchObject({ advanceSeedOnRetry: true });
    expect(createTimelinePreviewRequests(workflow).map((item) => item.seed)).toEqual([100, 101, 102, 103]);
  });

  it("uses a newly reviewed fixed seed after upstream staleness and strips a forged legacy retry marker", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      advanceSeedOnRetry: true,
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 20,
      candidates: [],
      successfulCount: 0,
      warnings: [],
    });
    const parameters = workflow.nodes["parameter-recommendation"].result as Record<string, unknown>;
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...parameters,
      seedPolicy: { mode: "fixed", seed: 500 },
    });

    expect(workflow.nodes["preview-execution"].status).toBe("stale");
    expect(workflow.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");
    workflow = confirmTimelineGeneration(workflow);
    expect(createTimelinePreviewRequests(workflow).map((item) => item.seed)).toEqual([500, 501, 502, 503]);
  });

  it("materializes a fresh random seed instead of advancing retained retry state", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    let workflow = createConfirmedWorkflow(2);
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...(workflow.nodes["parameter-recommendation"].result as object),
      seedPolicy: { mode: "random" },
    });
    workflow = confirmTimelineGeneration(workflow);
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 768,
      previewWidth: 768,
      previewSteps: 20,
      candidates: [],
      successfulCount: 0,
      warnings: [],
    });
    workflow = retryTimelineGenerationFrom(workflow, "preview-execution");
    expect(workflow.nodes["preview-execution"].result).not.toHaveProperty("advanceSeedOnRetry");

    random.mockClear();
    const seeds = createTimelinePreviewRequests(workflow, { advancePreviewSeedOnRetry: true })
      .map((item) => item.seed);
    expect(random).toHaveBeenCalledTimes(1);
    expect(seeds[0]).toBe(Math.floor(0.5 * (Number.MAX_SAFE_INTEGER - 4)));
    expect(seeds).not.toEqual([104, 105, 106, 107]);
  });

  it("keeps source-img2img K and source denoise for previews", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(4, {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      filename: "source.png",
      height: 768,
      mimeType: "image/png",
      uploadedAt: "2026-07-20T00:00:00.000Z",
      width: 1024,
    }));
    const requests = createTimelinePreviewRequests(workflow);

    expect(requests).toHaveLength(8);
    expect(requests.every(({ request }) =>
      request.sourceImageDataUrl === "data:image/png;base64,aGVsbG8=" && request.denoise === 0.72
    )).toBe(true);
  });

  it.each([
    ["conservative", 4, 0.12],
    ["balanced", 4, 0.18],
    ["strong", 6, 0.28],
  ] as const)(
    "uses the Krea v3 %s Final preset while keeping formal and Preview sampling fixed",
    (finalRedrawPreset, finalSteps, finalDenoise) => {
      let workflow = createConfirmedWorkflow(1, {
        dataUrl: "data:image/png;base64,aGVsbG8=",
        filename: "krea-composer-source.png",
        height: 1024,
        mimeType: "image/png",
        uploadedAt: "2026-07-26T00:00:00.000Z",
        width: 1536,
      }, {
        finalRedrawPreset,
        promptProfile: "krea2",
      });
      (workflow.nodes["scene-input"].result as SceneInputTimelineResult).sourceDenoise = 0.62;
      const parameters = workflow.nodes["parameter-recommendation"].result as {
        requestPreview: Record<string, unknown>;
      } & Record<string, unknown>;
      workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
        ...parameters,
        width: 1536,
        height: 1024,
        steps: 77,
        cfg: 9,
        samplerName: "uni_pc",
        scheduler: "karras",
        denoise: 0.62,
        seedPolicy: { mode: "fixed", seed: 700 },
        requestPreview: {
          ...parameters.requestPreview,
          checkpointName: "krea-2-turbo-unet.safetensors",
          modelBaseModel: "Krea 2",
          modelStorageKind: "diffusion",
          workflowProfile: "krea2",
          width: 1536,
          height: 1024,
          steps: 77,
          cfg: 9,
          samplerName: "uni_pc",
          scheduler: "karras",
          denoise: 0.62,
        },
      });
      workflow = confirmTimelineGeneration(workflow);

      expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
        width: 1536,
        height: 1024,
        steps: 8,
        cfg: 1,
        samplerName: "euler",
        scheduler: "simple",
      });
      const previews = createTimelinePreviewRequests(workflow);
      expect(previews).toHaveLength(4);
      expect(previews.every(({ request }) =>
        request.steps === 8 &&
        request.cfg === 1 &&
        request.samplerName === "euler" &&
        request.scheduler === "simple" &&
        request.denoise === 0.62 &&
        request.sourceImageDataUrl === "data:image/png;base64,aGVsbG8="
      )).toBe(true);

      workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
        baseSeed: 700,
        candidateCount: 4,
        finalCount: 1,
        previewHeight: previews[0]?.request.height,
        previewWidth: previews[0]?.request.width,
        previewSteps: 8,
        candidates: previews.map(({ candidateId, index, seed }) => ({
          candidateId,
          index,
          seed,
          status: "done" as const,
          storedImage: {
            byteLength: index + 1,
            contentType: "image/png",
            filename: `${candidateId}.png`,
            url: `/api/comfyui/generated-images/${candidateId}.png`,
          },
        })),
        successfulCount: 4,
        warnings: [],
      });
      workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
        rubricVersion: 2,
        visualStyle: "anime",
        scores: previews.map(({ candidateId, index }) => ({
          candidateId,
          adherence: 100 - index,
          composition: 100 - index,
          anatomy: 100 - index,
          style: 100 - index,
          technical: 100 - index,
          total: 100 - index,
          criticalDefects: [],
          eligible: true,
          visualStyleMatch: true,
          rank: index + 1,
        })),
        selectedCandidateIds: ["preview-1"],
        selectionSource: "ai",
      });

      expect(createTimelineFinalRequests(workflow)).toMatchObject([{
        candidateId: "preview-1",
        seed: 700,
        storedPreview: { filename: "preview-1.png" },
        finalPolicy: {
          version: 3,
          preset: finalRedrawPreset,
          family: "krea2",
          steps: finalSteps,
          denoise: finalDenoise,
        },
        request: {
          width: 1536,
          height: 1024,
          steps: finalSteps,
          cfg: 1,
          samplerName: "euler",
          scheduler: "simple",
          denoise: finalDenoise,
          preview: false,
          sourceImageDataUrl: undefined,
        },
      }]);
    },
  );

  it.each([
    ["Illustrious", "illustrious", 20, 0.4],
    ["Anima", "anima", 20, 0.45],
    ["Future XL", "future-profile", 20, 0.45],
  ] as const)(
    "applies balanced %s preview/final quality while inheriting formal sampler settings",
    (modelBaseModel, promptProfile, previewSteps, finalDenoise) => {
      let workflow = createConfirmedWorkflow(1, undefined, {
        promptProfile: promptProfile as never,
        detailers: {
          faceDetailer: { enabled: true, detectorModelName: "bbox/face.pt", steps: 19 } as never,
          handDetailer: { enabled: true, detectorModelName: "bbox/hand.pt", steps: 21 } as never,
        },
      });
      const parameters = workflow.nodes["parameter-recommendation"].result as {
        requestPreview: Record<string, unknown>;
      } & Record<string, unknown>;
      workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
        ...parameters,
        width: 1536,
        height: 1024,
        steps: 30,
        cfg: 7.25,
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        seedPolicy: { mode: "fixed", seed: 321 },
        requestPreview: {
          ...parameters.requestPreview,
          modelBaseModel,
          width: 1536,
          height: 1024,
          steps: 30,
          cfg: 7.25,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
        },
      });
      workflow = confirmTimelineGeneration(workflow);

      const previewRequests = createTimelinePreviewRequests(workflow);
      expect(previewRequests).toHaveLength(4);
      expect(previewRequests.map((item) => item.seed)).toEqual([321, 322, 323, 324]);
      expect(previewRequests.every(({ request }) =>
        request.width === 768 && request.height === 512 && request.steps === previewSteps &&
        request.cfg === 7.25 && request.samplerName === "dpmpp_2m" && request.scheduler === "karras" &&
        request.faceDetailer?.enabled === false && request.handDetailer?.enabled === false
      )).toBe(true);

      workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
        baseSeed: 321,
        candidateCount: 4,
        finalCount: 1,
        previewHeight: 512,
        previewWidth: 768,
        previewSteps,
        candidates: previewRequests.map((item) => ({
          candidateId: item.candidateId,
          index: item.index,
          seed: item.seed,
          status: "done" as const,
          storedImage: {
            byteLength: item.index + 1,
            contentType: "image/png",
            filename: `preview-${item.index + 1}.png`,
            url: `/api/comfyui/generated-images/preview-${item.index + 1}.png`,
          },
        })),
        successfulCount: 4,
        warnings: [],
      });
      workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
        rubricVersion: 2,
        visualStyle: "anime",
        scores: previewRequests.map((item) => ({
          candidateId: item.candidateId,
          adherence: 100 - item.index,
          composition: 100 - item.index,
          anatomy: 100 - item.index,
          style: 100 - item.index,
          technical: 100 - item.index,
          total: 100 - item.index,
          criticalDefects: [],
          eligible: true,
          visualStyleMatch: true,
          rank: item.index + 1,
        })),
        selectedCandidateIds: ["preview-1"],
        selectionSource: "ai",
      });

      expect(createTimelineFinalRequests(workflow)).toMatchObject([{
        candidateId: "preview-1",
        seed: 321,
        request: {
          width: 1536,
          height: 1024,
          steps: 30,
          cfg: 7.25,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: finalDenoise,
          faceDetailer: { enabled: true, detectorModelName: "bbox/face.pt", steps: 19 },
          handDetailer: { enabled: true, detectorModelName: "bbox/hand.pt", steps: 21 },
          preview: false,
        },
      }]);
    },
  );

  it("builds ranked Top-K final img2img requests from stored previews with formal settings", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 512,
      previewWidth: 512,
      previewSteps: 10,
      candidates: [1, 2, 3, 4].map((number, index) => ({
        candidateId: `preview-${number}`,
        index,
        seed: 99 + number,
        status: "done" as const,
        storedImage: {
          byteLength: number,
          contentType: "image/png",
          filename: `preview-${number}.png`,
          url: `/api/comfyui/generated-images/preview-${number}.png`,
        },
      })),
      successfulCount: 4,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: [
        { candidateId: "preview-3", adherence: 90, composition: 91, anatomy: 92, style: 93, technical: 94, total: 91.5, criticalDefects: [], eligible: true, visualStyleMatch: true, rank: 1 },
        { candidateId: "preview-1", adherence: 80, composition: 81, anatomy: 82, style: 83, technical: 84, total: 81.5, criticalDefects: [], eligible: true, visualStyleMatch: true, rank: 2 },
      ],
      selectedCandidateIds: ["preview-3", "preview-1"],
      selectionSource: "ai",
    });

    expect(createTimelineFinalRequests(workflow)).toMatchObject([
      {
        candidateId: "preview-3",
        rank: 1,
        seed: 102,
        storedPreview: { filename: "preview-3.png" },
        request: { batchSize: 1, denoise: 0.45, height: 1024, preview: false, seed: 102, steps: 30, width: 1024 },
      },
      {
        candidateId: "preview-1",
        rank: 2,
        seed: 100,
        storedPreview: { filename: "preview-1.png" },
        request: { batchSize: 1, denoise: 0.45, height: 1024, preview: false, seed: 100, steps: 30, width: 1024 },
      },
    ]);
  });

  it("uses the T7 source-img2img dimension precedence as the confirmed formal Final size", () => {
    const sourceImage = {
      dataUrl: "data:image/png;base64,aGVsbG8=",
      filename: "portrait-source.png",
      height: 1216,
      mimeType: "image/png" as const,
      uploadedAt: "2026-07-20T00:00:00.000Z",
      width: 832,
    };
    let workflow = createConfirmedWorkflow(1, sourceImage);
    const parameters = workflow.nodes["parameter-recommendation"].result as {
      requestPreview: Record<string, unknown>;
    } & Record<string, unknown>;
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...parameters,
      width: 2048,
      height: 512,
      requestPreview: {
        ...parameters.requestPreview,
        width: 2048,
        height: 512,
        imageWidth: 2048,
        imageHeight: 512,
      },
    });
    workflow = confirmTimelineGeneration(workflow);
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 1,
      previewHeight: 760,
      previewWidth: 520,
      previewSteps: 20,
      candidates: [1, 2, 3, 4].map((number, index) => ({
        candidateId: `preview-${number}`,
        index,
        seed: 99 + number,
        status: "done" as const,
        storedImage: {
          byteLength: number,
          contentType: "image/png",
          filename: `preview-${number}.png`,
          url: `/api/comfyui/generated-images/preview-${number}.png`,
        },
      })),
      successfulCount: 4,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: [1, 2, 3, 4].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 100 - number,
        composition: 100 - number,
        anatomy: 100 - number,
        style: 100 - number,
        technical: 100 - number,
        total: 100 - number,
        criticalDefects: [],
        eligible: true,
        visualStyleMatch: true,
        rank: number,
      })),
      selectedCandidateIds: ["preview-1"],
      selectionSource: "ai",
    });

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      width: 2048,
      height: 512,
      imageWidth: 832,
      imageHeight: 1216,
    });
    expect(createTimelineFinalRequests(workflow)).toMatchObject([{
      formalWidth: 832,
      formalHeight: 1216,
      request: {
        width: 832,
        height: 1216,
        imageWidth: 832,
        imageHeight: 1216,
        sourceImageDataUrl: undefined,
      },
    }]);
  });

  it("preserves global scoring ranks when Detailed mode manually selects ranks 1 and 3 for K=2", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 512,
      previewWidth: 512,
      previewSteps: 10,
      candidates: [1, 2, 3, 4].map((number, index) => ({
        candidateId: `preview-${number}`,
        index,
        seed: 99 + number,
        status: "done" as const,
        storedImage: {
          byteLength: number,
          contentType: "image/png",
          filename: `preview-${number}.png`,
          url: `/api/comfyui/generated-images/preview-${number}.png`,
        },
      })),
      successfulCount: 4,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: [1, 2, 3, 4].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 100 - number,
        composition: 100 - number,
        anatomy: 100 - number,
        style: 100 - number,
        technical: 100 - number,
        total: 100 - number,
        criticalDefects: [],
        eligible: true,
        visualStyleMatch: true,
        rank: number,
      })),
      selectedCandidateIds: ["preview-1", "preview-3"],
      selectionSource: "manual",
    });

    expect(createTimelineFinalRequests(workflow)).toMatchObject([
      { candidateId: "preview-1", rank: 1, seed: 100 },
      { candidateId: "preview-3", rank: 3, seed: 102 },
    ]);
  });

  it.each([
    ["too few", ["preview-1"], /requires exactly 2/i],
    ["duplicate", ["preview-1", "preview-1"], /requires exactly 2/i],
    ["unknown", ["preview-1", "preview-9"], /visual-style-verified Preview scoring is required/i],
  ])("rejects a persisted/manual %s Top-K selection server-side", (_case, selectedCandidateIds, expectedError) => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(2));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 2,
      previewHeight: 512,
      previewWidth: 512,
      previewSteps: 10,
      candidates: [1, 2].map((number, index) => ({
        candidateId: `preview-${number}`,
        index,
        seed: 99 + number,
        status: "done" as const,
        storedImage: {
          byteLength: number,
          contentType: "image/png",
          filename: `preview-${number}.png`,
          url: `/api/comfyui/generated-images/preview-${number}.png`,
        },
      })),
      successfulCount: 2,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: [1, 2].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 100,
        composition: 100,
        anatomy: 100,
        style: 100,
        technical: 100,
        total: 100,
        criticalDefects: [],
        eligible: true,
        visualStyleMatch: true,
        rank: number,
      })),
      selectedCandidateIds,
      selectionSource: "manual",
    });

    expect(() => createTimelineFinalRequests(workflow)).toThrow(expectedError);
  });

  it("accepts an ineligible fallback in a manual exact-K selection and rejects forged fallback metadata", () => {
    let workflow = confirmTimelineGeneration(createConfirmedWorkflow(1));
    workflow = setTimelineNodeManualResult(workflow, "preview-execution", {
      baseSeed: 100,
      candidateCount: 4,
      finalCount: 1,
      previewHeight: 512,
      previewWidth: 512,
      previewSteps: 20,
      candidates: [{
        candidateId: "preview-1",
        index: 0,
        seed: 100,
        status: "done",
        storedImage: { byteLength: 1, contentType: "image/png", filename: "preview-1.png", url: "/api/comfyui/generated-images/preview-1.png" },
      }],
      successfulCount: 1,
      warnings: [],
    });
    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      rubricVersion: 2,
      visualStyle: "anime",
      scores: [{
        candidateId: "preview-1",
        adherence: 100,
        composition: 100,
        anatomy: 100,
        style: 100,
        technical: 100,
        total: 100,
        criticalDefects: [{ category: "anatomy_or_structure", description: "missing hand" }],
        eligible: false,
        visualStyleMatch: true,
        rank: 1,
      }],
      selectedCandidateIds: ["preview-1"],
      selectionSource: "manual",
      eligibleCount: 0,
      fallbackCandidateIds: ["preview-1"],
      selectionWarning: "Only 0 preview candidates passed blocking-defect checks; 1 annotated fallback candidate was selected. Review the preserved defect annotations before final use.",
    });

    expect(createTimelineFinalRequests(workflow)).toMatchObject([
      { candidateId: "preview-1", rank: 1, seed: 100 },
    ]);

    workflow = setTimelineNodeManualResult(workflow, "preview-scoring", {
      ...(workflow.nodes["preview-scoring"].result as object),
      eligibleCount: 1,
    });
    expect(() => createTimelineFinalRequests(workflow)).toThrow(/requires exactly 1/i);
  });

  it("allows final steps below 20 without increasing the preview step count", () => {
    let workflow = createConfirmedWorkflow(1);
    const parameters = workflow.nodes["parameter-recommendation"].result as {
      requestPreview: Record<string, unknown>;
    } & Record<string, unknown>;
    workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
      ...parameters,
      steps: 12,
      requestPreview: { ...parameters.requestPreview, steps: 12 },
    });

    const requests = createTimelinePreviewRequests(confirmTimelineGeneration(workflow));
    expect(requests.every(({ request }) => request.steps === 12)).toBe(true);
  });
});
