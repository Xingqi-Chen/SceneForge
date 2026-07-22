import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

type TimelineFinalModelContext = Pick<ComfyUiTextToImageRequest, "modelBaseModel"> & { workflowProfile?: string };

export const timelineFinalGenerationPolicy = {
  version: 2,
  resizeMode: "lanczos3-exact",
  defaultPreset: "balanced",
  denoiseByPreset: {
    conservative: {
      illustrious: 0.3,
      anima: 0.35,
      fallback: 0.35,
    },
    balanced: {
      illustrious: 0.4,
      anima: 0.45,
      fallback: 0.45,
    },
    strong: {
      illustrious: 0.5,
      anima: 0.55,
      fallback: 0.55,
    },
  },
} as const;

export type TimelineFinalRedrawPreset = keyof typeof timelineFinalGenerationPolicy.denoiseByPreset;
export type TimelineFinalGenerationFamily = keyof
  (typeof timelineFinalGenerationPolicy.denoiseByPreset)[TimelineFinalRedrawPreset];

export const timelineFinalRedrawPresets = ["conservative", "balanced", "strong"] as const satisfies
  readonly TimelineFinalRedrawPreset[];

export function isTimelineFinalRedrawPreset(value: unknown): value is TimelineFinalRedrawPreset {
  return typeof value === "string" && timelineFinalRedrawPresets.some((preset) => preset === value);
}

export function sanitizeTimelineFinalRedrawPreset(value: unknown): TimelineFinalRedrawPreset {
  return isTimelineFinalRedrawPreset(value)
    ? value
    : timelineFinalGenerationPolicy.defaultPreset;
}

export function getTimelineFinalGenerationFamily(
  request: TimelineFinalModelContext,
): TimelineFinalGenerationFamily {
  const baseModel = request.modelBaseModel?.trim().toLocaleLowerCase() ?? "";
  if (request.workflowProfile === "anima" || baseModel.includes("anima")) return "anima";
  if (baseModel.includes("illustrious")) return "illustrious";
  return "fallback";
}

export function getTimelineFinalDenoise(
  request: TimelineFinalModelContext,
  preset: TimelineFinalRedrawPreset = timelineFinalGenerationPolicy.defaultPreset,
) {
  return timelineFinalGenerationPolicy.denoiseByPreset[preset][getTimelineFinalGenerationFamily(request)];
}

export function resolveTimelineFinalGenerationPolicy(
  request: TimelineFinalModelContext,
  presetValue: unknown,
) {
  const preset = sanitizeTimelineFinalRedrawPreset(presetValue);
  const family = getTimelineFinalGenerationFamily(request);
  return {
    version: timelineFinalGenerationPolicy.version,
    resizeMode: timelineFinalGenerationPolicy.resizeMode,
    preset,
    family,
    denoise: timelineFinalGenerationPolicy.denoiseByPreset[preset][family],
  } as const;
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
