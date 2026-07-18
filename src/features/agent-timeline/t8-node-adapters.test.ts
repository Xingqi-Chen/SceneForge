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
    checkpoint: "local.safetensors",
    loras: [],
  });
  workflow = setTimelineNodeManualResult(workflow, "parameter-recommendation", {
    requestPreview: {
      batchSize: 4,
      checkpointName: "local.safetensors",
      negativePrompt: "low detail",
      positivePrompt: "glass greenhouse pilot",
      preview: true,
      steps: 30,
      width: 1024,
      height: 1024,
    },
  });

  return workflow;
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
});
