import { describe, expect, it } from "vitest";

import {
  confirmTimelineGeneration,
  createConfirmedTimelineComfyUiRequest,
  createTimelineWorkflowState,
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
    requestPreview: {
      batchSize: 4,
      checkpointName: "local.safetensors",
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
      checkpointName: "local.safetensors",
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

  it("uses the T1 image count as the confirmed execution batch size", () => {
    const workflow = confirmTimelineGeneration(createConfirmedWorkflow(3));

    expect(createConfirmedTimelineComfyUiRequest(workflow)).toMatchObject({
      batchSize: 3,
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
      batchSize: 4,
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
      "complete style reference prompt exactly once",
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
      "complete style reference prompt exactly once",
    );
  });
});
