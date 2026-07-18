import {
  COMFYUI_FACE_DETAILER_DEFAULTS,
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
  type ComfyUiFaceDetailerConfig,
  type ComfyUiHandDetailerConfig,
} from "@/features/comfyui";

export type GenerationDetailerConfig = ComfyUiFaceDetailerConfig & {
  enabled: boolean;
};

export type GenerationDetailerSettingsSnapshot = {
  faceDetailer: GenerationDetailerConfig;
  handDetailer: GenerationDetailerConfig;
};

const defaultDetailerSamplerName = "euler";
const defaultDetailerScheduler = "normal";
const defaultDetailerSteps = 30;
const defaultDetailerCfg = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberInRange(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function integerInRange(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  return rounded >= min && rounded <= max ? rounded : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function trimmedString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function literalString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function detailerOption<T extends string>(
  value: unknown,
  fallback: T,
  options: readonly { value: T }[],
) {
  return options.find((option) => option.value === value)?.value ?? fallback;
}

function createDefaultGenerationDetailer(
  detectorModelName: string,
  enabled = false,
): GenerationDetailerConfig {
  return {
    ...COMFYUI_FACE_DETAILER_DEFAULTS,
    cfg: defaultDetailerCfg,
    enabled,
    detectorModelName,
    samplerName: defaultDetailerSamplerName,
    scheduler: defaultDetailerScheduler,
    steps: defaultDetailerSteps,
  };
}

function sanitizeGenerationDetailer(
  rawValue: unknown,
  detectorModelName: string,
  enabled: boolean,
): GenerationDetailerConfig {
  const fallback = createDefaultGenerationDetailer(detectorModelName, enabled) as Required<GenerationDetailerConfig>;
  const raw = isRecord(rawValue) ? rawValue : {};

  return {
    bboxCropFactor: numberInRange(raw.bboxCropFactor, 1, 10, fallback.bboxCropFactor),
    bboxDilation: integerInRange(raw.bboxDilation, -512, 512, fallback.bboxDilation),
    bboxThreshold: numberInRange(raw.bboxThreshold, 0, 1, fallback.bboxThreshold),
    cfg: finiteNumber(raw.cfg, fallback.cfg ?? defaultDetailerCfg),
    cycle: integerInRange(raw.cycle, 1, 10, fallback.cycle),
    denoise: numberInRange(raw.denoise, 0, 1, fallback.denoise),
    enabled,
    detectorModelName: trimmedString(raw.detectorModelName, fallback.detectorModelName ?? detectorModelName),
    dropSize: integerInRange(raw.dropSize, 1, 16384, fallback.dropSize),
    feather: integerInRange(raw.feather, 0, 100, fallback.feather),
    forceInpaint: booleanValue(raw.forceInpaint, fallback.forceInpaint),
    guideSize: positiveInteger(raw.guideSize, fallback.guideSize),
    guideSizeFor: booleanValue(raw.guideSizeFor, fallback.guideSizeFor),
    maxSize: positiveInteger(raw.maxSize, fallback.maxSize),
    noiseMask: booleanValue(raw.noiseMask, fallback.noiseMask),
    samBBoxExpansion: integerInRange(raw.samBBoxExpansion, 0, 1000, fallback.samBBoxExpansion),
    samDetectionHint: detailerOption(
      raw.samDetectionHint,
      fallback.samDetectionHint,
      COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
    ),
    samDilation: integerInRange(raw.samDilation, -512, 512, fallback.samDilation),
    samMaskHintThreshold: numberInRange(raw.samMaskHintThreshold, 0, 1, fallback.samMaskHintThreshold),
    samMaskHintUseNegative: detailerOption(
      raw.samMaskHintUseNegative,
      fallback.samMaskHintUseNegative,
      COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
    ),
    samThreshold: numberInRange(raw.samThreshold, 0, 1, fallback.samThreshold),
    samplerName: trimmedString(raw.samplerName, fallback.samplerName ?? defaultDetailerSamplerName),
    scheduler: trimmedString(raw.scheduler, fallback.scheduler ?? defaultDetailerScheduler),
    steps: positiveInteger(raw.steps, fallback.steps ?? defaultDetailerSteps),
    wildcard: literalString(raw.wildcard, fallback.wildcard),
  };
}

function detailerEnabled(rawValue: unknown) {
  return isRecord(rawValue) && rawValue.enabled === true;
}

export function createGenerationDetailerSettingsSnapshot(
  value?: Partial<GenerationDetailerSettingsSnapshot>,
): GenerationDetailerSettingsSnapshot {
  return sanitizeGenerationDetailerSettingsSnapshot(value);
}

export function sanitizeGenerationDetailerSettingsSnapshot(
  value: unknown,
): GenerationDetailerSettingsSnapshot {
  const raw = isRecord(value) ? value : {};

  return {
    faceDetailer: sanitizeGenerationDetailer(
      raw.faceDetailer,
      DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
      detailerEnabled(raw.faceDetailer),
    ),
    handDetailer: sanitizeGenerationDetailer(
      raw.handDetailer,
      DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
      detailerEnabled(raw.handDetailer),
    ) as ComfyUiHandDetailerConfig & { enabled: boolean },
  };
}

export function getGenerationInputDetailers(input: { settingsSnapshot?: unknown }) {
  const settingsSnapshot = isRecord(input.settingsSnapshot) ? input.settingsSnapshot : {};
  return sanitizeGenerationDetailerSettingsSnapshot(settingsSnapshot.detailers);
}
