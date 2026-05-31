import type { ComfyUiInpaintRequest, ComfyUiTextToImageRequest } from "./types";

export const COMFYUI_PREVIEW_STEPS = 10;

export function getComfyUiPreviewSteps(steps: number | undefined) {
  return typeof steps === "number" && Number.isFinite(steps) && steps > 0
    ? Math.min(steps, COMFYUI_PREVIEW_STEPS)
    : COMFYUI_PREVIEW_STEPS;
}

export function createComfyUiTextToImagePreviewRequest(
  request: ComfyUiTextToImageRequest,
): ComfyUiTextToImageRequest {
  return {
    ...request,
    batchSize: 1,
    faceDetailer: {
      ...request.faceDetailer,
      enabled: false,
    },
    handDetailer: {
      ...request.handDetailer,
      enabled: false,
    },
    preview: true,
    steps: getComfyUiPreviewSteps(request.steps),
  };
}

export function createComfyUiInpaintPreviewRequest(
  request: ComfyUiInpaintRequest,
): ComfyUiInpaintRequest {
  return {
    ...request,
    faceDetailer: {
      ...request.faceDetailer,
      enabled: false,
    },
    handDetailer: {
      ...request.handDetailer,
      enabled: false,
    },
    preview: true,
    steps: getComfyUiPreviewSteps(request.steps),
  };
}
