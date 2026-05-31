import { describe, expect, it } from "vitest";

import {
  COMFYUI_PREVIEW_STEPS,
  createComfyUiTextToImagePreviewRequest,
} from "./preview";

describe("ComfyUI preview request transform", () => {
  it("keeps dimensions, disables detailers, limits batch size, and uses preview steps", () => {
    const request = createComfyUiTextToImagePreviewRequest({
      checkpointName: "model.safetensors",
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

  it("sets preview steps even when the original request does not include steps", () => {
    const request = createComfyUiTextToImagePreviewRequest({
      checkpointName: "model.safetensors",
      positivePrompt: "a scene",
    });

    expect(request.steps).toBe(COMFYUI_PREVIEW_STEPS);
  });
});
