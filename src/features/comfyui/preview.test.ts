import { describe, expect, it } from "vitest";

import {
  COMFYUI_PREVIEW_MAX_SIDE,
  createComfyUiTextToImagePreviewRequest,
  getComfyUiPreviewDimensions,
} from "./preview";

describe("ComfyUI preview request transform", () => {
  it("reduces dimensions while preserving the original aspect ratio", () => {
    const dimensions = getComfyUiPreviewDimensions({ width: 2048, height: 1024 });

    expect(dimensions).toEqual({ width: 512, height: 256 });
    expect(dimensions.width / dimensions.height).toBeCloseTo(2, 5);
  });

  it("keeps preview dimensions compatible with ComfyUI latent constraints", () => {
    const dimensions = getComfyUiPreviewDimensions({ width: 1000, height: 600 });

    expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(COMFYUI_PREVIEW_MAX_SIDE);
    expect(dimensions.width).toBeGreaterThanOrEqual(16);
    expect(dimensions.height).toBeGreaterThanOrEqual(16);
    expect(dimensions.width % 8).toBe(0);
    expect(dimensions.height % 8).toBe(0);
    expect(dimensions.width / dimensions.height).toBeCloseTo(1000 / 600, 1);
  });

  it("does not upscale requests that are already at preview size", () => {
    expect(getComfyUiPreviewDimensions({ width: 320, height: 256 })).toEqual({
      width: 320,
      height: 256,
    });
  });

  it("uses safe default source dimensions when width or height are omitted", () => {
    expect(getComfyUiPreviewDimensions({})).toEqual({
      width: 512,
      height: 512,
    });
  });

  it("disables detailers and limits the batch to one image", () => {
    const request = createComfyUiTextToImagePreviewRequest({
      checkpointName: "model.safetensors",
      positivePrompt: "a scene",
      width: 1024,
      height: 768,
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
      width: 512,
      height: 384,
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
});
