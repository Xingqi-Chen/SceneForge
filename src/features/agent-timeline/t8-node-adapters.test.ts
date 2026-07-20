import { describe, expect, it, vi } from "vitest";

import {
  confirmTimelineGeneration,
  createConfirmedTimelineComfyUiRequest,
  createTimelineFinalRequests,
  createTimelinePreviewRequests,
  createTimelineWorkflowState,
  getTimelinePreviewCandidateCount,
  getTimelinePreviewDimensions,
  setTimelineNodeManualResult,
  type SceneInputTimelineResult,
} from ".";

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
  },
};

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
    [1024, 1024, 768, 768],
    [1536, 1024, 768, 512],
    [1024, 1536, 512, 768],
    [768, 1344, 384, 768],
    [4096, 128, 768, 64],
    [500, 257, 500, 257],
    [63, 31, 63, 31],
  ])("scales %ix%i previews to exactly %ix%i", (width, height, previewWidth, previewHeight) => {
    expect(getTimelinePreviewDimensions(width, height)).toEqual({
      width: previewWidth,
      height: previewHeight,
    });
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
      request.steps === 16 &&
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
    ["Illustrious", "illustrious", 16, 0.6],
    ["Anima", "anima", 18, 0.65],
    ["Future XL", "future-profile", 16, 0.65],
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
        rubricVersion: 1,
        scores: previewRequests.map((item) => ({
          candidateId: item.candidateId,
          adherence: 100 - item.index,
          composition: 100 - item.index,
          anatomy: 100 - item.index,
          style: 100 - item.index,
          technical: 100 - item.index,
          total: 100 - item.index,
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
      rubricVersion: 1,
      scores: [
        { candidateId: "preview-3", adherence: 90, composition: 91, anatomy: 92, style: 93, technical: 94, total: 91.5, rank: 1 },
        { candidateId: "preview-1", adherence: 80, composition: 81, anatomy: 82, style: 83, technical: 84, total: 81.5, rank: 2 },
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
        request: { batchSize: 1, denoise: 0.65, height: 1024, preview: false, seed: 102, steps: 30, width: 1024 },
      },
      {
        candidateId: "preview-1",
        rank: 2,
        seed: 100,
        storedPreview: { filename: "preview-1.png" },
        request: { batchSize: 1, denoise: 0.65, height: 1024, preview: false, seed: 100, steps: 30, width: 1024 },
      },
    ]);
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
      rubricVersion: 1,
      scores: [1, 2, 3, 4].map((number) => ({
        candidateId: `preview-${number}`,
        adherence: 100 - number,
        composition: 100 - number,
        anatomy: 100 - number,
        style: 100 - number,
        technical: 100 - number,
        total: 100 - number,
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
    ["too few", ["preview-1"]],
    ["duplicate", ["preview-1", "preview-1"]],
    ["unknown", ["preview-1", "preview-9"]],
  ])("rejects a persisted/manual %s Top-K selection server-side", (_case, selectedCandidateIds) => {
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
      rubricVersion: 1,
      scores: [],
      selectedCandidateIds,
      selectionSource: "manual",
    });

    expect(() => createTimelineFinalRequests(workflow)).toThrow(/requires exactly 2/i);
  });
});
