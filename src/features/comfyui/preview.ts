import type { ComfyUiTextToImageRequest } from "./types";

export const COMFYUI_PREVIEW_STEPS = 10;

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
    steps: COMFYUI_PREVIEW_STEPS,
  };
}
