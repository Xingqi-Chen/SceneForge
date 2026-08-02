import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

type TimelineFinalModelContext = Pick<ComfyUiTextToImageRequest, "modelBaseModel"> & { workflowProfile?: string };

export const timelineFinalGenerationPolicy = {
  // Version 2 remains the current ordinary-profile contract. Krea uses its own
  // revision so the second-pass tuning does not invalidate unchanged profiles.
  version: 2,
  krea2Version: 3,
  krea2ReIdVersion: 4,
  resizeMode: "lanczos3-exact",
  defaultPreset: "balanced",
  denoiseByPreset: {
    conservative: {
      illustrious: 0.3,
      anima: 0.35,
      fallback: 0.35,
      krea2: 0.12,
    },
    balanced: {
      illustrious: 0.4,
      anima: 0.45,
      fallback: 0.45,
      krea2: 0.18,
    },
    strong: {
      illustrious: 0.5,
      anima: 0.55,
      fallback: 0.55,
      krea2: 0.28,
    },
  },
  krea2StepsByPreset: {
    conservative: 4,
    balanced: 4,
    strong: 6,
  },
} as const;

export const timelineLegacyKrea2FinalGenerationPolicy = {
  version: 2,
  denoiseByPreset: {
    conservative: 0.35,
    balanced: 0.45,
    strong: 0.55,
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
  if (request.workflowProfile === "krea2") return "krea2";
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

export function getTimelineFinalGenerationPolicyVersion(family: TimelineFinalGenerationFamily) {
  return family === "krea2"
    ? timelineFinalGenerationPolicy.krea2Version
    : timelineFinalGenerationPolicy.version;
}

export function resolveTimelineFinalGenerationPolicy(
  request: TimelineFinalModelContext,
  presetValue: unknown,
  options: { krea2ReId?: boolean } = {},
) {
  const preset = sanitizeTimelineFinalRedrawPreset(presetValue);
  const family = getTimelineFinalGenerationFamily(request);
  return {
    version: family === "krea2" && options.krea2ReId
      ? timelineFinalGenerationPolicy.krea2ReIdVersion
      : getTimelineFinalGenerationPolicyVersion(family),
    resizeMode: timelineFinalGenerationPolicy.resizeMode,
    preset,
    family,
    denoise: timelineFinalGenerationPolicy.denoiseByPreset[preset][family],
    ...(family === "krea2"
      ? { steps: options.krea2ReId ? 8 : timelineFinalGenerationPolicy.krea2StepsByPreset[preset] }
      : {}),
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
