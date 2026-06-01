import { describe, expect, it } from "vitest";

import {
  COMFYUI_PREVIEW_STEPS,
  createComfyUiInpaintPreviewRequest,
  createComfyUiTextToImagePreviewRequest,
  getComfyUiPreviewSteps,
} from "./preview";

describe("ComfyUI preview request transform", () => {
  it("caps text-to-image steps, keeps dimensions, disables detailers, and limits batch size", () => {
    const request = createComfyUiTextToImagePreviewRequest({
      checkpointName: "model.safetensors",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      clipName: "anima-clip.safetensors",
      clipDevice: "cpu",
      vaeName: "anima-vae.safetensors",
      unetWeightDtype: "fp8_e4m3fn",
      positivePrompt: "a scene",
      width: 1024,
      height: 768,
      steps: 30,
      batchSize: 4,
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/face_yolov8s.pt",
      },
      handDetailer: {
        enabled: true,
      },
    });

    expect(request).toMatchObject({
      width: 1024,
      height: 768,
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      clipName: "anima-clip.safetensors",
      clipDevice: "cpu",
      vaeName: "anima-vae.safetensors",
      unetWeightDtype: "fp8_e4m3fn",
      steps: COMFYUI_PREVIEW_STEPS,
      batchSize: 1,
      preview: true,
      faceDetailer: {
        enabled: false,
        detectorModelName: "bbox/face_yolov8s.pt",
      },
      handDetailer: {
        enabled: false,
      },
    });
  });

  it("does not increase low-step preview requests", () => {
    expect(getComfyUiPreviewSteps(6)).toBe(6);
    expect(getComfyUiPreviewSteps(10)).toBe(10);
    expect(getComfyUiPreviewSteps(30)).toBe(COMFYUI_PREVIEW_STEPS);
  });

  it("uses default preview steps when the original request does not include steps", () => {
    const request = createComfyUiTextToImagePreviewRequest({
      checkpointName: "model.safetensors",
      positivePrompt: "a scene",
    });

    expect(request.steps).toBe(COMFYUI_PREVIEW_STEPS);
  });

  it("caps inpaint steps and disables detailers without changing image inputs", () => {
    const request = createComfyUiInpaintPreviewRequest({
      checkpointName: "model.safetensors",
      positivePrompt: "repair the scene",
      sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      maskDataUrl: "data:image/png;base64,aGVsbG8=",
      steps: 30,
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/face_yolov8s.pt",
      },
      handDetailer: {
        enabled: true,
      },
    });

    expect(request).toMatchObject({
      sourceImageDataUrl: "data:image/png;base64,aGVsbG8=",
      maskDataUrl: "data:image/png;base64,aGVsbG8=",
      steps: COMFYUI_PREVIEW_STEPS,
      preview: true,
      faceDetailer: {
        enabled: false,
        detectorModelName: "bbox/face_yolov8s.pt",
      },
      handDetailer: {
        enabled: false,
      },
    });
  });
});
