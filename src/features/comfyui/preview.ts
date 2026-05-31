import type { ComfyUiTextToImageRequest } from "./types";

export const COMFYUI_PREVIEW_MAX_SIDE = 512;
export const COMFYUI_PREVIEW_DIMENSION_STEP = 8;
export const COMFYUI_PREVIEW_MIN_DIMENSION = 16;
export const COMFYUI_PREVIEW_DEFAULT_WIDTH = 1024;
export const COMFYUI_PREVIEW_DEFAULT_HEIGHT = 1024;

export type ComfyUiPreviewDimensions = {
  height: number;
  width: number;
};

function isUsableDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function alignComfyUiPreviewDimension(value: number) {
  const aligned = Math.round(value / COMFYUI_PREVIEW_DIMENSION_STEP) * COMFYUI_PREVIEW_DIMENSION_STEP;

  return Math.max(COMFYUI_PREVIEW_MIN_DIMENSION, aligned);
}

export function getComfyUiPreviewDimensions({
  height,
  width,
}: Partial<ComfyUiPreviewDimensions>): ComfyUiPreviewDimensions {
  const sourceWidth = isUsableDimension(width) ? width : COMFYUI_PREVIEW_DEFAULT_WIDTH;
  const sourceHeight = isUsableDimension(height) ? height : COMFYUI_PREVIEW_DEFAULT_HEIGHT;
  const scale = Math.min(1, COMFYUI_PREVIEW_MAX_SIDE / Math.max(sourceWidth, sourceHeight));

  return {
    height: alignComfyUiPreviewDimension(sourceHeight * scale),
    width: alignComfyUiPreviewDimension(sourceWidth * scale),
  };
}

export function createComfyUiTextToImagePreviewRequest(
  request: ComfyUiTextToImageRequest,
): ComfyUiTextToImageRequest {
  const dimensions = getComfyUiPreviewDimensions({
    height: request.height,
    width: request.width,
  });

  return {
    ...request,
    ...dimensions,
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
  };
}
