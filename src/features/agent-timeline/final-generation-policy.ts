import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

export const timelineFinalGenerationPolicy = {
  version: 1,
  resizeMode: "lanczos3-exact",
  denoiseByFamily: {
    illustrious: 0.3,
    anima: 0.35,
    fallback: 0.35,
  },
} as const;

export type TimelineFinalGenerationFamily = keyof typeof timelineFinalGenerationPolicy.denoiseByFamily;

export function getTimelineFinalGenerationFamily(
  request: Pick<ComfyUiTextToImageRequest, "modelBaseModel" | "workflowProfile">,
): TimelineFinalGenerationFamily {
  const baseModel = request.modelBaseModel?.trim().toLocaleLowerCase() ?? "";
  if (request.workflowProfile === "anima" || baseModel.includes("anima")) return "anima";
  if (baseModel.includes("illustrious")) return "illustrious";
  return "fallback";
}

export function getTimelineFinalDenoise(
  request: Pick<ComfyUiTextToImageRequest, "modelBaseModel" | "workflowProfile">,
) {
  return timelineFinalGenerationPolicy.denoiseByFamily[getTimelineFinalGenerationFamily(request)];
}

type TimelineFinalDimensionSource = {
  request: Pick<ComfyUiTextToImageRequest, "width" | "height">;
  sourceImage?: { width: number; height: number };
};

export function resolveTimelineFinalDimensions({ request, sourceImage }: TimelineFinalDimensionSource) {
  const width = sourceImage?.width ?? request.width;
  const height = sourceImage?.height ?? request.height;
  return Number.isSafeInteger(width) && (width ?? 0) > 0 &&
      Number.isSafeInteger(height) && (height ?? 0) > 0
    ? { width: width as number, height: height as number }
    : null;
}
