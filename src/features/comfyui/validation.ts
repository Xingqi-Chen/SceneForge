import type {
  ComfyUiControlNetConfig,
  ComfyUiControlNetType,
  ComfyUiControlNetUnitConfig,
  ComfyUiCharacterReferenceConfig,
  ComfyUiIpAdapterCombineEmbeds,
  ComfyUiIpAdapterReferenceMode,
  ComfyUiFaceDetailerConfig,
  ComfyUiInpaintLocalRegionConfig,
  ComfyUiInpaintLocalRegionSource,
  ComfyUiInpaintRequest,
  ComfyUiInpaintUpscaleConfig,
  ComfyUiInpaintUpscaleMode,
  ComfyUiInpaintUpscaleStrategy,
  ComfyUiLoraInput,
  ComfyUiModelStorageKind,
  ComfyUiSam2Bbox,
  ComfyUiSam2Device,
  ComfyUiSam2MaskRequest,
  ComfyUiSam2Point,
  ComfyUiSam2Precision,
  ComfyUiTextToImageRequest,
  ComfyUiTextToImageWorkflowProfileId,
  ResolvedComfyUiCharacterReferenceConfig,
  ResolvedComfyUiControlNetUnitConfig,
  ResolvedComfyUiFaceDetailerConfig,
  ResolvedComfyUiInpaintRequest,
  ResolvedComfyUiSam2MaskRequest,
  ResolvedComfyUiTextToImageRequest,
} from "./types";
import {
  DEFAULT_COMFYUI_LATENT_IMAGE_NODE,
  normalizeComfyUiLatentImageNode,
} from "./latent-image-node";
import {
  COMFYUI_FACE_DETAILER_DEFAULTS,
  COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS,
  COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
} from "./face-detailer";
import {
  DEFAULT_COMFYUI_INPAINT_DENOISE,
  DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY,
  DEFAULT_COMFYUI_INPAINT_MODE,
  normalizeComfyUiInpaintDenoiseForMode,
  normalizeComfyUiInpaintMode,
} from "./inpaint";
import {
  DEFAULT_COMFYUI_ANIMA_CLIP_NAME,
  DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE,
  DEFAULT_COMFYUI_ANIMA_VAE_NAME,
  resolveComfyUiTextToImageWorkflowProfile,
} from "./workflow-profiles";

export const COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS = {
  "real-esrgan-x2": {
    label: "RealESRGAN x2",
    modelName: "RealESRGAN_x2plus.pth",
  },
  "aniscale2-x2": {
    label: "AniScale2 x2",
    modelName: "2x_AniScale2_ESRGAN_i16_110K.pth",
  },
} as const satisfies Partial<Record<ComfyUiInpaintUpscaleMode, { label: string; modelName: string }>>;

export type ComfyUiInpaintUpscaleModelPresetMode = keyof typeof COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS;

export const DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_MODE: ComfyUiInpaintUpscaleModelPresetMode = "real-esrgan-x2";
export const DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_NAME =
  COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS[DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_MODE].modelName;

export function isComfyUiInpaintModelUpscaleMode(
  mode: ComfyUiInpaintUpscaleMode,
): mode is ComfyUiInpaintUpscaleModelPresetMode {
  return mode in COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS;
}

export function getComfyUiInpaintUpscaleModelName(mode: ComfyUiInpaintUpscaleMode) {
  return isComfyUiInpaintModelUpscaleMode(mode)
    ? COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS[mode].modelName
    : DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_NAME;
}

const DEFAULT_TEXT_TO_IMAGE_REQUEST = {
  negativePrompt: "",
  loras: [],
  width: 1024,
  height: 1024,
  steps: 30,
  cfg: 7,
  samplerName: "euler",
  scheduler: "normal",
  denoise: 1,
  batchSize: 1,
  latentImageNode: DEFAULT_COMFYUI_LATENT_IMAGE_NODE,
  promptWrapper: {
    positivePrefix: "",
    negativePrefix: "",
  },
  outputPrefix: "SceneForge",
  faceDetailer: {
    ...COMFYUI_FACE_DETAILER_DEFAULTS,
    cfg: 7,
    enabled: false,
    detectorModelName: DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
    samplerName: "euler",
    scheduler: "normal",
    steps: 30,
  },
  handDetailer: {
    ...COMFYUI_FACE_DETAILER_DEFAULTS,
    cfg: 7,
    enabled: false,
    detectorModelName: DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
    samplerName: "euler",
    scheduler: "normal",
    steps: 30,
  },
  controlNets: [],
  characterReferences: [],
} satisfies Omit<ResolvedComfyUiTextToImageRequest, "checkpointName" | "positivePrompt" | "seed" | "workflowProfile">;
const DEFAULT_CONTROLNET_UNIT = {
  enabled: false,
  modelName: "",
  strength: 0.85,
  startPercent: 0,
  endPercent: 1,
  svg: "",
  imageDataUrl: "",
  imageName: "",
};
const DEFAULT_INPAINT_REQUEST = {
  negativePrompt: "",
  loras: [],
  steps: 30,
  cfg: 7,
  samplerName: "euler",
  scheduler: "normal",
  denoise: DEFAULT_COMFYUI_INPAINT_DENOISE,
  promptWrapper: {
    positivePrefix: "",
    negativePrefix: "",
  },
  outputPrefix: "SceneForge_inpaint",
  imageName: "",
  maskDataUrl: "",
  maskName: "",
  inpaintMode: DEFAULT_COMFYUI_INPAINT_MODE,
  growMaskBy: DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY,
  faceDetailer: {
    ...COMFYUI_FACE_DETAILER_DEFAULTS,
    cfg: 7,
    enabled: false,
    detectorModelName: DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
    samplerName: "euler",
    scheduler: "normal",
    steps: 30,
  },
  handDetailer: {
    ...COMFYUI_FACE_DETAILER_DEFAULTS,
    cfg: 7,
    enabled: false,
    detectorModelName: DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
    samplerName: "euler",
    scheduler: "normal",
    steps: 30,
  },
  upscaleBeforeInpaint: {
    enabled: false,
    mode: "lanczos",
    scaleBy: 2,
    modelName: DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_NAME,
    strategy: "full-image",
  },
} satisfies Omit<ResolvedComfyUiInpaintRequest, "checkpointName" | "positivePrompt" | "seed">;
const DEFAULT_SAM2_MASK_REQUEST = {
  model: "sam2.1_hiera_small.safetensors",
  device: "cuda",
  precision: "fp16",
  keepModelLoaded: true,
  outputPrefix: "SceneForge_sam_mask",
} satisfies Pick<ResolvedComfyUiSam2MaskRequest, "device" | "keepModelLoaded" | "model" | "outputPrefix" | "precision">;
const RANDOM_SEED_UPPER_BOUND = 2 ** 50;
const RANDOM_SEED_RANGE = RANDOM_SEED_UPPER_BOUND + 1;
const MAX_CONTROLNET_SVG_LENGTH = 2_000_000;
const MAX_CONTROLNET_IMAGE_DATA_URL_LENGTH = 12_000_000;
const MAX_INPAINT_MASK_DATA_URL_LENGTH = 24_000_000;
const MAX_INPAINT_SOURCE_IMAGE_DATA_URL_LENGTH = 32_000_000;
const MAX_CHARACTER_REFERENCE_COUNT = 8;
const MAX_CHARACTER_REFERENCE_IMAGE_COUNT = 4;
const CONTROLNET_TYPES = ["openpose", "depth", "normal"] as const satisfies readonly ComfyUiControlNetType[];
const IPADAPTER_REFERENCE_MODES = ["ipadapter", "face", "faceid"] as const satisfies readonly ComfyUiIpAdapterReferenceMode[];
const IPADAPTER_COMBINE_EMBEDS = ["concat", "add", "subtract", "average", "norm average"] as const satisfies readonly ComfyUiIpAdapterCombineEmbeds[];
const COMFYUI_MODEL_STORAGE_KINDS = ["checkpoint", "diffusion"] as const;
const COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILE_IDS = ["default", "anima"] as const satisfies readonly ComfyUiTextToImageWorkflowProfileId[];
const INPAINT_UPSCALE_MODES = ["lanczos", "real-esrgan-x2", "aniscale2-x2"] as const satisfies readonly ComfyUiInpaintUpscaleMode[];
const INPAINT_UPSCALE_STRATEGIES = ["full-image", "local-region"] as const satisfies readonly ComfyUiInpaintUpscaleStrategy[];
const INPAINT_LOCAL_REGION_SOURCES = ["mask-bounds", "box"] as const satisfies readonly ComfyUiInpaintLocalRegionSource[];
const SAM2_DEVICES = ["cuda", "cpu", "mps"] as const satisfies readonly ComfyUiSam2Device[];
const SAM2_PRECISIONS = ["fp16", "bf16", "fp32"] as const satisfies readonly ComfyUiSam2Precision[];

export type ComfyUiTextToImageValidationResult =
  | {
      ok: true;
      request: ComfyUiTextToImageRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

export type ComfyUiInpaintValidationResult =
  | {
      ok: true;
      request: ComfyUiInpaintRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

export type ComfyUiSam2MaskValidationResult =
  | {
      ok: true;
      request: ComfyUiSam2MaskRequest;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || hasNonEmptyString(value);
}

function isOptionalStringValue(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function isOptionalSafeSeed(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function getString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim() || fallback;
}

function getOptionalTrimmedStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function normalizeLoraInput(value: unknown): ComfyUiLoraInput | null {
  if (!isRecord(value) || !hasNonEmptyString(value.loraName)) {
    return null;
  }

  if (!isOptionalFiniteNumber(value.strengthModel) || !isOptionalFiniteNumber(value.strengthClip)) {
    return null;
  }

  return {
    loraName: value.loraName.trim(),
    strengthModel: value.strengthModel ?? 0.7,
    strengthClip: value.strengthClip,
  };
}

function normalizeOptionalLoras(value: unknown): ComfyUiLoraInput[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map(normalizeLoraInput).filter((lora): lora is ComfyUiLoraInput => lora !== null);
}

function normalizePromptWrapper(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.positivePrefix !== undefined && typeof value.positivePrefix !== "string") {
    return null;
  }

  if (value.negativePrefix !== undefined && typeof value.negativePrefix !== "string") {
    return null;
  }

  return {
    ...(typeof value.positivePrefix === "string" ? { positivePrefix: value.positivePrefix } : {}),
    ...(typeof value.negativePrefix === "string" ? { negativePrefix: value.negativePrefix } : {}),
  };
}

function isOptionalIntegerInRange(value: unknown, min: number, max: number): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max);
}

function isOptionalNumberInRange(value: unknown, min: number, max: number): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
}

function isOptionalPositiveFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isOptionalFaceDetailerOption<T extends string>(
  value: unknown,
  options: readonly { value: T }[],
): value is T | undefined {
  return value === undefined || (typeof value === "string" && options.some((option) => option.value === value));
}

function isControlNetType(value: unknown): value is ComfyUiControlNetType {
  return typeof value === "string" && CONTROLNET_TYPES.some((type) => type === value);
}

function isComfyUiModelStorageKind(value: unknown): value is ComfyUiModelStorageKind {
  return typeof value === "string" && COMFYUI_MODEL_STORAGE_KINDS.some((kind) => kind === value);
}

function isComfyUiTextToImageWorkflowProfileId(value: unknown): value is ComfyUiTextToImageWorkflowProfileId {
  return typeof value === "string" && COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILE_IDS.some((profile) => profile === value);
}

function isIpAdapterReferenceMode(value: unknown): value is ComfyUiIpAdapterReferenceMode {
  return typeof value === "string" && IPADAPTER_REFERENCE_MODES.some((mode) => mode === value);
}

function isIpAdapterCombineEmbeds(value: unknown): value is ComfyUiIpAdapterCombineEmbeds {
  return typeof value === "string" && IPADAPTER_COMBINE_EMBEDS.some((mode) => mode === value);
}

function isInpaintUpscaleMode(value: unknown): value is ComfyUiInpaintUpscaleMode {
  return typeof value === "string" && INPAINT_UPSCALE_MODES.some((mode) => mode === value);
}

function isInpaintUpscaleStrategy(value: unknown): value is ComfyUiInpaintUpscaleStrategy {
  return typeof value === "string" && INPAINT_UPSCALE_STRATEGIES.some((strategy) => strategy === value);
}

function isInpaintLocalRegionSource(value: unknown): value is ComfyUiInpaintLocalRegionSource {
  return typeof value === "string" && INPAINT_LOCAL_REGION_SOURCES.some((source) => source === value);
}

function isPngDataUrl(value: string) {
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.trim());
}

function isImageDataUrl(value: string) {
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value.trim());
}

function normalizeImageReference(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value) || !hasNonEmptyString(value.filename)) {
    return null;
  }

  if (
    (value.subfolder !== undefined && typeof value.subfolder !== "string") ||
    (value.type !== undefined && typeof value.type !== "string")
  ) {
    return null;
  }

  return {
    filename: value.filename.trim(),
    ...(typeof value.subfolder === "string" ? { subfolder: value.subfolder } : {}),
    ...(typeof value.type === "string" ? { type: value.type } : {}),
  };
}

function normalizeInpaintLocalRegionConfig(value: unknown): ComfyUiInpaintLocalRegionConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (
    !isOptionalIntegerInRange(value.x, 0, 16_384) ||
    !isOptionalIntegerInRange(value.y, 0, 16_384) ||
    !isOptionalIntegerInRange(value.width, 1, 16_384) ||
    !isOptionalIntegerInRange(value.height, 1, 16_384) ||
    !isOptionalIntegerInRange(value.padding, 0, 2048) ||
    !isOptionalIntegerInRange(value.feather, 0, 1024) ||
    (value.source !== undefined && !isInpaintLocalRegionSource(value.source))
  ) {
    return null;
  }

  const harmonizeAfter = value.harmonizeAfter;
  if (
    harmonizeAfter !== undefined &&
    (
      !isRecord(harmonizeAfter) ||
      !isOptionalBoolean(harmonizeAfter.enabled) ||
      !isOptionalNumberInRange(harmonizeAfter.denoise, 0, 1)
    )
  ) {
    return null;
  }

  return {
    ...(typeof value.x === "number" ? { x: value.x } : {}),
    ...(typeof value.y === "number" ? { y: value.y } : {}),
    ...(typeof value.width === "number" ? { width: value.width } : {}),
    ...(typeof value.height === "number" ? { height: value.height } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.padding === "number" ? { padding: value.padding } : {}),
    ...(typeof value.feather === "number" ? { feather: value.feather } : {}),
    ...(isRecord(harmonizeAfter)
      ? {
          harmonizeAfter: {
            ...(typeof harmonizeAfter.enabled === "boolean" ? { enabled: harmonizeAfter.enabled } : {}),
            ...(typeof harmonizeAfter.denoise === "number" ? { denoise: harmonizeAfter.denoise } : {}),
          },
        }
      : {}),
  };
}

function normalizeInpaintUpscaleConfig(value: unknown): ComfyUiInpaintUpscaleConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (!isOptionalBoolean(value.enabled)) {
    return null;
  }

  if (value.mode !== undefined && !isInpaintUpscaleMode(value.mode)) {
    return null;
  }

  if (value.scaleBy !== undefined && value.scaleBy !== 2) {
    return null;
  }

  if (!isOptionalString(value.modelName)) {
    return null;
  }

  if (value.strategy !== undefined && !isInpaintUpscaleStrategy(value.strategy)) {
    return null;
  }

  const localRegion = normalizeInpaintLocalRegionConfig(value.localRegion);
  if (localRegion === null) {
    return null;
  }

  return {
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    ...(value.mode !== undefined ? { mode: value.mode } : {}),
    ...(value.scaleBy !== undefined ? { scaleBy: value.scaleBy } : {}),
    ...(typeof value.modelName === "string" ? { modelName: value.modelName.trim() } : {}),
    ...(typeof value.strategy === "string" ? { strategy: value.strategy } : {}),
    ...(localRegion !== undefined ? { localRegion } : {}),
  };
}

function isSam2Device(value: unknown): value is ComfyUiSam2Device {
  return typeof value === "string" && SAM2_DEVICES.some((device) => device === value);
}

function isSam2Precision(value: unknown): value is ComfyUiSam2Precision {
  return typeof value === "string" && SAM2_PRECISIONS.some((precision) => precision === value);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSam2Point(value: unknown, imageWidth: number, imageHeight: number): ComfyUiSam2Point | null {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return null;
  }

  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    return null;
  }

  return {
    x: Math.round(clampNumber(value.x, 0, imageWidth - 1)),
    y: Math.round(clampNumber(value.y, 0, imageHeight - 1)),
  };
}

function normalizeSam2Points(value: unknown, imageWidth: number, imageHeight: number): ComfyUiSam2Point[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const points: ComfyUiSam2Point[] = [];
  for (const point of value) {
    const normalized = normalizeSam2Point(point, imageWidth, imageHeight);
    if (!normalized) {
      return null;
    }

    points.push(normalized);
  }

  return points;
}

function normalizeSam2Bbox(value: unknown, imageWidth: number, imageHeight: number): ComfyUiSam2Bbox | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height)
  ) {
    return null;
  }

  const rawX0 = Math.min(value.x, value.x + value.width);
  const rawY0 = Math.min(value.y, value.y + value.height);
  const rawX1 = Math.max(value.x, value.x + value.width);
  const rawY1 = Math.max(value.y, value.y + value.height);
  const x0 = Math.round(clampNumber(rawX0, 0, imageWidth));
  const y0 = Math.round(clampNumber(rawY0, 0, imageHeight));
  const x1 = Math.round(clampNumber(rawX1, 0, imageWidth));
  const y1 = Math.round(clampNumber(rawY1, 0, imageHeight));

  if (x1 <= x0 || y1 <= y0) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
  };
}

function normalizeFaceDetailerConfig(value: unknown): ComfyUiFaceDetailerConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return {
      enabled: value,
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return null;
  }

  if (value.detectorModelName !== undefined && typeof value.detectorModelName !== "string") {
    return null;
  }

  if (
    !isOptionalPositiveFiniteNumber(value.guideSize) ||
    !isOptionalPositiveFiniteNumber(value.maxSize) ||
    !isOptionalPositiveInteger(value.steps) ||
    !isOptionalFiniteNumber(value.cfg) ||
    !isOptionalNumberInRange(value.denoise, 0, 1) ||
    !isOptionalNumberInRange(value.bboxThreshold, 0, 1) ||
    !isOptionalNumberInRange(value.bboxCropFactor, 1, 10) ||
    !isOptionalNumberInRange(value.samThreshold, 0, 1) ||
    !isOptionalNumberInRange(value.samMaskHintThreshold, 0, 1)
  ) {
    return null;
  }

  if (
    !isOptionalIntegerInRange(value.feather, 0, 100) ||
    !isOptionalIntegerInRange(value.bboxDilation, -512, 512) ||
    !isOptionalIntegerInRange(value.dropSize, 1, 16384) ||
    !isOptionalIntegerInRange(value.cycle, 1, 10) ||
    !isOptionalIntegerInRange(value.samDilation, -512, 512) ||
    !isOptionalIntegerInRange(value.samBBoxExpansion, 0, 1000)
  ) {
    return null;
  }

  if (
    !isOptionalBoolean(value.guideSizeFor) ||
    !isOptionalBoolean(value.noiseMask) ||
    !isOptionalBoolean(value.forceInpaint)
  ) {
    return null;
  }

  if (!isOptionalStringValue(value.wildcard)) {
    return null;
  }

  if (!isOptionalStringValue(value.samplerName) || !isOptionalStringValue(value.scheduler)) {
    return null;
  }

  if (
    !isOptionalFaceDetailerOption(value.samDetectionHint, COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS) ||
    !isOptionalFaceDetailerOption(
      value.samMaskHintUseNegative,
      COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS,
    )
  ) {
    return null;
  }

  return {
    ...(typeof value.bboxCropFactor === "number" ? { bboxCropFactor: value.bboxCropFactor } : {}),
    ...(typeof value.bboxDilation === "number" ? { bboxDilation: value.bboxDilation } : {}),
    ...(typeof value.bboxThreshold === "number" ? { bboxThreshold: value.bboxThreshold } : {}),
    ...(typeof value.cfg === "number" ? { cfg: value.cfg } : {}),
    ...(typeof value.cycle === "number" ? { cycle: value.cycle } : {}),
    ...(typeof value.denoise === "number" ? { denoise: value.denoise } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(hasNonEmptyString(value.detectorModelName) ? { detectorModelName: value.detectorModelName.trim() } : {}),
    ...(typeof value.dropSize === "number" ? { dropSize: value.dropSize } : {}),
    ...(typeof value.feather === "number" ? { feather: value.feather } : {}),
    ...(typeof value.forceInpaint === "boolean" ? { forceInpaint: value.forceInpaint } : {}),
    ...(typeof value.guideSize === "number" ? { guideSize: value.guideSize } : {}),
    ...(typeof value.guideSizeFor === "boolean" ? { guideSizeFor: value.guideSizeFor } : {}),
    ...(typeof value.maxSize === "number" ? { maxSize: value.maxSize } : {}),
    ...(typeof value.noiseMask === "boolean" ? { noiseMask: value.noiseMask } : {}),
    ...(typeof value.samBBoxExpansion === "number" ? { samBBoxExpansion: value.samBBoxExpansion } : {}),
    ...(typeof value.samDetectionHint === "string" ? { samDetectionHint: value.samDetectionHint } : {}),
    ...(typeof value.samDilation === "number" ? { samDilation: value.samDilation } : {}),
    ...(typeof value.samMaskHintThreshold === "number" ? { samMaskHintThreshold: value.samMaskHintThreshold } : {}),
    ...(typeof value.samMaskHintUseNegative === "string" ? { samMaskHintUseNegative: value.samMaskHintUseNegative } : {}),
    ...(typeof value.samThreshold === "number" ? { samThreshold: value.samThreshold } : {}),
    ...(hasNonEmptyString(value.samplerName) ? { samplerName: value.samplerName.trim() } : {}),
    ...(hasNonEmptyString(value.scheduler) ? { scheduler: value.scheduler.trim() } : {}),
    ...(typeof value.steps === "number" ? { steps: value.steps } : {}),
    ...(typeof value.wildcard === "string" ? { wildcard: value.wildcard } : {}),
  };
}

function normalizeControlNetConfig(value: unknown): ComfyUiControlNetConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return {
      enabled: value,
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return null;
  }

  if (
    !isOptionalStringValue(value.modelName) ||
    !isOptionalStringValue(value.openPoseSvg) ||
    !isOptionalStringValue(value.svg) ||
    !isOptionalStringValue(value.imageDataUrl) ||
    !isOptionalStringValue(value.imageName)
  ) {
    return null;
  }

  if (
    !isOptionalNumberInRange(value.strength, 0, 2) ||
    !isOptionalNumberInRange(value.startPercent, 0, 1) ||
    !isOptionalNumberInRange(value.endPercent, 0, 1)
  ) {
    return null;
  }

  if (
    (typeof value.openPoseSvg === "string" && value.openPoseSvg.length > MAX_CONTROLNET_SVG_LENGTH) ||
    (typeof value.svg === "string" && value.svg.length > MAX_CONTROLNET_SVG_LENGTH) ||
    (typeof value.imageDataUrl === "string" && value.imageDataUrl.length > MAX_CONTROLNET_IMAGE_DATA_URL_LENGTH)
  ) {
    return null;
  }

  if (hasNonEmptyString(value.imageDataUrl) && !isPngDataUrl(value.imageDataUrl)) {
    return null;
  }

  return {
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(hasNonEmptyString(value.modelName) ? { modelName: value.modelName.trim() } : {}),
    ...(typeof value.strength === "number" ? { strength: value.strength } : {}),
    ...(typeof value.startPercent === "number" ? { startPercent: value.startPercent } : {}),
    ...(typeof value.endPercent === "number" ? { endPercent: value.endPercent } : {}),
    ...(typeof value.openPoseSvg === "string" ? { openPoseSvg: value.openPoseSvg } : {}),
    ...(typeof value.svg === "string" ? { svg: value.svg } : {}),
    ...(typeof value.imageDataUrl === "string" ? { imageDataUrl: value.imageDataUrl } : {}),
    ...(hasNonEmptyString(value.imageName) ? { imageName: value.imageName.trim() } : {}),
  };
}

function normalizeControlNetUnitConfig(value: unknown): ComfyUiControlNetUnitConfig | null {
  if (!isRecord(value) || !isControlNetType(value.type)) {
    return null;
  }

  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return null;
  }

  if (
    !isOptionalStringValue(value.modelName) ||
    !isOptionalStringValue(value.svg) ||
    !isOptionalStringValue(value.imageDataUrl) ||
    !isOptionalStringValue(value.imageName)
  ) {
    return null;
  }

  if (
    !isOptionalNumberInRange(value.strength, 0, 2) ||
    !isOptionalNumberInRange(value.startPercent, 0, 1) ||
    !isOptionalNumberInRange(value.endPercent, 0, 1)
  ) {
    return null;
  }

  if (
    (typeof value.svg === "string" && value.svg.length > MAX_CONTROLNET_SVG_LENGTH) ||
    (typeof value.imageDataUrl === "string" && value.imageDataUrl.length > MAX_CONTROLNET_IMAGE_DATA_URL_LENGTH)
  ) {
    return null;
  }

  if (hasNonEmptyString(value.imageDataUrl) && !isPngDataUrl(value.imageDataUrl)) {
    return null;
  }

  return {
    type: value.type,
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(hasNonEmptyString(value.modelName) ? { modelName: value.modelName.trim() } : {}),
    ...(typeof value.strength === "number" ? { strength: value.strength } : {}),
    ...(typeof value.startPercent === "number" ? { startPercent: value.startPercent } : {}),
    ...(typeof value.endPercent === "number" ? { endPercent: value.endPercent } : {}),
    ...(typeof value.svg === "string" ? { svg: value.svg } : {}),
    ...(typeof value.imageDataUrl === "string" ? { imageDataUrl: value.imageDataUrl } : {}),
    ...(hasNonEmptyString(value.imageName) ? { imageName: value.imageName.trim() } : {}),
  };
}

function normalizeControlNetUnits(value: unknown): ComfyUiControlNetUnitConfig[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const units = value.map(normalizeControlNetUnitConfig);
  if (units.some((unit) => unit === null)) {
    return null;
  }

  return units as ComfyUiControlNetUnitConfig[];
}

function normalizeCharacterReferenceConfig(value: unknown): ComfyUiCharacterReferenceConfig | null {
  if (!isRecord(value) || !hasNonEmptyString(value.name) || !Array.isArray(value.images)) {
    return null;
  }

  if (value.images.length < 1 || value.images.length > MAX_CHARACTER_REFERENCE_IMAGE_COUNT) {
    return null;
  }

  const images = value.images.map((image) => {
    if (!isRecord(image) || !hasNonEmptyString(image.imageName)) {
      return null;
    }

    if (!isOptionalFiniteNumber(image.weight)) {
      return null;
    }

    return {
      ...(hasNonEmptyString(image.id) ? { id: image.id.trim() } : {}),
      imageName: image.imageName.trim(),
      ...(typeof image.weight === "number" ? { weight: image.weight } : {}),
    };
  });

  if (images.some((image) => image === null)) {
    return null;
  }

  if (!isOptionalString(value.id) || !isOptionalStringValue(value.prompt) || !isOptionalBoolean(value.enabled)) {
    return null;
  }

  if (value.mode !== undefined && !isIpAdapterReferenceMode(value.mode)) {
    return null;
  }

  if (
    !isOptionalString(value.maskImageName) ||
    !isOptionalFiniteNumber(value.weight) ||
    !isOptionalString(value.weightType) ||
    !isOptionalFiniteNumber(value.startPercent) ||
    !isOptionalFiniteNumber(value.endPercent) ||
    !isOptionalString(value.preset) ||
    !isOptionalFiniteNumber(value.loraStrength) ||
    !isOptionalString(value.provider) ||
    !isOptionalString(value.embedsScaling)
  ) {
    return null;
  }

  if (value.combineEmbeds !== undefined && !isIpAdapterCombineEmbeds(value.combineEmbeds)) {
    return null;
  }

  return {
    ...(hasNonEmptyString(value.id) ? { id: value.id.trim() } : {}),
    name: value.name.trim(),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt.trim() } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(value.mode ? { mode: value.mode } : {}),
    images: images as NonNullable<ComfyUiCharacterReferenceConfig["images"]>,
    ...(hasNonEmptyString(value.maskImageName) ? { maskImageName: value.maskImageName.trim() } : {}),
    ...(typeof value.weight === "number" ? { weight: value.weight } : {}),
    ...(hasNonEmptyString(value.weightType) ? { weightType: value.weightType.trim() } : {}),
    ...(value.combineEmbeds ? { combineEmbeds: value.combineEmbeds } : {}),
    ...(typeof value.startPercent === "number" ? { startPercent: value.startPercent } : {}),
    ...(typeof value.endPercent === "number" ? { endPercent: value.endPercent } : {}),
    ...(hasNonEmptyString(value.preset) ? { preset: value.preset.trim() } : {}),
    ...(typeof value.loraStrength === "number" ? { loraStrength: value.loraStrength } : {}),
    ...(hasNonEmptyString(value.provider) ? { provider: value.provider.trim() } : {}),
    ...(hasNonEmptyString(value.embedsScaling) ? { embedsScaling: value.embedsScaling.trim() } : {}),
  };
}

function normalizeCharacterReferences(value: unknown): ComfyUiCharacterReferenceConfig[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > MAX_CHARACTER_REFERENCE_COUNT) {
    return null;
  }

  const references = value.map(normalizeCharacterReferenceConfig);
  if (references.some((reference) => reference === null)) {
    return null;
  }

  return references as ComfyUiCharacterReferenceConfig[];
}

function getLegacyControlNetSvg(controlNet: ComfyUiControlNetConfig | undefined) {
  return controlNet?.svg ?? controlNet?.openPoseSvg;
}

function getControlNetValidationUnits(
  controlNet: ComfyUiControlNetConfig | undefined,
  controlNets: ComfyUiControlNetUnitConfig[] | undefined,
): ComfyUiControlNetUnitConfig[] {
  if (controlNets !== undefined) {
    return controlNets;
  }

  if (!controlNet) {
    return [];
  }

  return [
    {
      type: "openpose",
      enabled: controlNet.enabled,
      modelName: controlNet.modelName,
      strength: controlNet.strength,
      startPercent: controlNet.startPercent,
      endPercent: controlNet.endPercent,
      svg: getLegacyControlNetSvg(controlNet),
      imageDataUrl: controlNet.imageDataUrl,
      imageName: controlNet.imageName,
    },
  ];
}

function createRandomSeed() {
  return Math.floor(Math.random() * RANDOM_SEED_RANGE);
}

export function validateComfyUiTextToImageRequest(value: unknown): ComfyUiTextToImageValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  if (!hasNonEmptyString(value.checkpointName)) {
    return {
      ok: false,
      message: "checkpointName is required.",
    };
  }

  if (!hasNonEmptyString(value.positivePrompt)) {
    return {
      ok: false,
      message: "positivePrompt is required.",
    };
  }

  for (const field of ["modelBaseModel", "clipName", "clipDevice", "vaeName", "unetWeightDtype"] as const) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
      return {
        ok: false,
        message: `${field} must be a string when provided.`,
      };
    }
  }

  if (value.modelStorageKind !== undefined && !isComfyUiModelStorageKind(value.modelStorageKind)) {
    return {
      ok: false,
      message: "modelStorageKind must be checkpoint or diffusion when provided.",
    };
  }

  if (value.workflowProfile !== undefined && !isComfyUiTextToImageWorkflowProfileId(value.workflowProfile)) {
    return {
      ok: false,
      message: "workflowProfile must be default or anima when provided.",
    };
  }

  if (value.negativePrompt !== undefined && typeof value.negativePrompt !== "string") {
    return {
      ok: false,
      message: "negativePrompt must be a string when provided.",
    };
  }

  const promptWrapper = normalizePromptWrapper(value.promptWrapper);
  if (promptWrapper === null) {
    return {
      ok: false,
      message: "promptWrapper must include string positivePrefix and negativePrefix values when provided.",
    };
  }

  const faceDetailer = normalizeFaceDetailerConfig(value.faceDetailer);
  if (faceDetailer === null) {
    return {
      ok: false,
      message: "faceDetailer must be a boolean or an object with valid FaceDetailer option values when provided.",
    };
  }

  const handDetailer = normalizeFaceDetailerConfig(value.handDetailer);
  if (handDetailer === null) {
    return {
      ok: false,
      message: "handDetailer must be a boolean or an object with valid HandDetailer option values when provided.",
    };
  }

  const controlNet = normalizeControlNetConfig(value.controlNet);
  if (controlNet === null) {
    return {
      ok: false,
      message: "controlNet must be a boolean or an object with valid ControlNet option values when provided.",
    };
  }

  const controlNets = normalizeControlNetUnits(value.controlNets);
  if (controlNets === null) {
    return {
      ok: false,
      message: "controlNets must be an array of valid ControlNet unit option values when provided.",
    };
  }

  const controlNetUnitsForValidation = getControlNetValidationUnits(controlNet, controlNets);
  const invalidControlNetUnit = controlNetUnitsForValidation.find((unit) =>
    unit.enabled &&
    !hasNonEmptyString(unit.svg) &&
    !hasNonEmptyString(unit.imageDataUrl) &&
    !hasNonEmptyString(unit.imageName)
  );

  if (invalidControlNetUnit) {
    return {
      ok: false,
      message: `controlNets.${invalidControlNetUnit.type}.svg or imageDataUrl is required when ControlNet is enabled.`,
    };
  }

  const invalidControlNetTiming = controlNetUnitsForValidation.find((unit) =>
    unit.enabled &&
    typeof unit.startPercent === "number" &&
    typeof unit.endPercent === "number" &&
    unit.startPercent > unit.endPercent
  );

  if (invalidControlNetTiming) {
    return {
      ok: false,
      message: `controlNets.${invalidControlNetTiming.type}.startPercent must be less than or equal to endPercent.`,
    };
  }

  const characterReferences = normalizeCharacterReferences(value.characterReferences);
  if (characterReferences === null) {
    return {
      ok: false,
      message: "characterReferences must be an array of valid character reference values when provided.",
    };
  }

  const invalidCharacterReferenceTiming = characterReferences?.find((reference) =>
    reference.enabled !== false &&
    typeof reference.startPercent === "number" &&
    typeof reference.endPercent === "number" &&
    reference.startPercent > reference.endPercent
  );

  if (invalidCharacterReferenceTiming) {
    return {
      ok: false,
      message: `characterReferences.${invalidCharacterReferenceTiming.name}.startPercent must be less than or equal to endPercent.`,
    };
  }

  if (value.loras !== undefined) {
    if (!Array.isArray(value.loras)) {
      return {
        ok: false,
        message: "loras must be an array when provided.",
      };
    }

    for (const lora of value.loras) {
      if (!normalizeLoraInput(lora)) {
        return {
          ok: false,
          message: "Each LoRA must include loraName and finite strength values when provided.",
        };
      }
    }
  }

  if (!isOptionalString(value.samplerName)) {
    return {
      ok: false,
      message: "samplerName must be a non-empty string when provided.",
    };
  }

  if (!isOptionalString(value.scheduler)) {
    return {
      ok: false,
      message: "scheduler must be a non-empty string when provided.",
    };
  }

  if (!isOptionalString(value.outputPrefix)) {
    return {
      ok: false,
      message: "outputPrefix must be a non-empty string when provided.",
    };
  }

  if (value.latentImageNode !== undefined && !normalizeComfyUiLatentImageNode(value.latentImageNode)) {
    return {
      ok: false,
      message: "latentImageNode must be EmptyLatentImage or EmptySD3LatentImage when provided.",
    };
  }

  if (!isOptionalBoolean(value.preview)) {
    return {
      ok: false,
      message: "preview must be a boolean when provided.",
    };
  }

  for (const field of ["width", "height", "batchSize", "steps"] as const) {
    if (!isOptionalPositiveInteger(value[field])) {
      return {
        ok: false,
        message: `${field} must be a positive integer when provided.`,
      };
    }
  }

  if (!isOptionalSafeSeed(value.seed)) {
    return {
      ok: false,
      message: "seed must be a non-negative safe integer when provided.",
    };
  }

  for (const field of ["cfg", "denoise"] as const) {
    if (!isOptionalFiniteNumber(value[field])) {
      return {
        ok: false,
        message: `${field} must be a finite number when provided.`,
      };
    }
  }

  if (typeof value.denoise === "number" && (value.denoise < 0 || value.denoise > 1)) {
    return {
      ok: false,
      message: "denoise must be between 0 and 1.",
    };
  }

  return {
    ok: true,
    request: {
      checkpointName: value.checkpointName.trim(),
      workflowProfile: isComfyUiTextToImageWorkflowProfileId(value.workflowProfile) ? value.workflowProfile : undefined,
      modelBaseModel: getOptionalTrimmedStringValue(value.modelBaseModel),
      modelStorageKind: isComfyUiModelStorageKind(value.modelStorageKind) ? value.modelStorageKind : undefined,
      clipName: getOptionalTrimmedStringValue(value.clipName),
      clipDevice: getOptionalTrimmedStringValue(value.clipDevice),
      vaeName: getOptionalTrimmedStringValue(value.vaeName),
      unetWeightDtype: getOptionalTrimmedStringValue(value.unetWeightDtype),
      positivePrompt: value.positivePrompt.trim(),
      negativePrompt: typeof value.negativePrompt === "string" ? value.negativePrompt.trim() : undefined,
      loras: normalizeOptionalLoras(value.loras),
      width: getOptionalNumber(value.width),
      height: getOptionalNumber(value.height),
      seed: getOptionalNumber(value.seed),
      steps: getOptionalNumber(value.steps),
      cfg: getOptionalNumber(value.cfg),
      samplerName: value.samplerName?.trim(),
      scheduler: value.scheduler?.trim(),
      denoise: getOptionalNumber(value.denoise),
      batchSize: getOptionalNumber(value.batchSize),
      latentImageNode: normalizeComfyUiLatentImageNode(value.latentImageNode),
      promptWrapper,
      outputPrefix: value.outputPrefix?.trim(),
      faceDetailer,
      handDetailer,
      controlNet,
      controlNets,
      characterReferences,
      preview: typeof value.preview === "boolean" ? value.preview : undefined,
    },
  };
}

export function validateComfyUiInpaintRequest(value: unknown): ComfyUiInpaintValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  if (!hasNonEmptyString(value.checkpointName)) {
    return {
      ok: false,
      message: "checkpointName is required.",
    };
  }

  if (!hasNonEmptyString(value.positivePrompt)) {
    return {
      ok: false,
      message: "positivePrompt is required.",
    };
  }

  if (value.negativePrompt !== undefined && typeof value.negativePrompt !== "string") {
    return {
      ok: false,
      message: "negativePrompt must be a string when provided.",
    };
  }

  const sourceImage = normalizeImageReference(value.sourceImage);
  if (sourceImage === null) {
    return {
      ok: false,
      message: "sourceImage must include a generated ComfyUI image filename when provided.",
    };
  }

  if (value.sourceImageDataUrl !== undefined) {
    if (typeof value.sourceImageDataUrl !== "string" || value.sourceImageDataUrl.length > MAX_INPAINT_SOURCE_IMAGE_DATA_URL_LENGTH) {
      return {
        ok: false,
        message: "sourceImageDataUrl must be an image data URL within the size limit.",
      };
    }

    if (!isImageDataUrl(value.sourceImageDataUrl)) {
      return {
        ok: false,
        message: "sourceImageDataUrl must be a PNG, JPEG, or WEBP data URL.",
      };
    }
  }

  if (sourceImage === undefined && !hasNonEmptyString(value.imageName) && value.sourceImageDataUrl === undefined) {
    return {
      ok: false,
      message: "sourceImage is required.",
    };
  }

  if (value.maskDataUrl !== undefined) {
    if (typeof value.maskDataUrl !== "string" || value.maskDataUrl.length > MAX_INPAINT_MASK_DATA_URL_LENGTH) {
      return {
        ok: false,
        message: "maskDataUrl must be a PNG data URL within the size limit.",
      };
    }

    if (!isPngDataUrl(value.maskDataUrl)) {
      return {
        ok: false,
        message: "maskDataUrl must be a PNG data URL.",
      };
    }
  }

  if (value.maskDataUrl === undefined && !hasNonEmptyString(value.maskName)) {
    return {
      ok: false,
      message: "maskDataUrl is required.",
    };
  }

  if (value.imageName !== undefined && !isOptionalString(value.imageName)) {
    return {
      ok: false,
      message: "imageName must be a non-empty string when provided.",
    };
  }

  if (!isOptionalPositiveInteger(value.imageWidth) || !isOptionalPositiveInteger(value.imageHeight)) {
    return {
      ok: false,
      message: "imageWidth and imageHeight must be positive integers when provided.",
    };
  }

  if (value.maskName !== undefined && !isOptionalString(value.maskName)) {
    return {
      ok: false,
      message: "maskName must be a non-empty string when provided.",
    };
  }

  const promptWrapper = normalizePromptWrapper(value.promptWrapper);
  if (promptWrapper === null) {
    return {
      ok: false,
      message: "promptWrapper must include string positivePrefix and negativePrefix values when provided.",
    };
  }

  const faceDetailer = normalizeFaceDetailerConfig(value.faceDetailer);
  if (faceDetailer === null) {
    return {
      ok: false,
      message: "faceDetailer must be a boolean or an object with valid FaceDetailer option values when provided.",
    };
  }

  const handDetailer = normalizeFaceDetailerConfig(value.handDetailer);
  if (handDetailer === null) {
    return {
      ok: false,
      message: "handDetailer must be a boolean or an object with valid HandDetailer option values when provided.",
    };
  }

  const upscaleBeforeInpaint = normalizeInpaintUpscaleConfig(value.upscaleBeforeInpaint);
  if (upscaleBeforeInpaint === null) {
    return {
      ok: false,
      message: "upscaleBeforeInpaint must be an object with enabled, mode, scaleBy, strategy, modelName, and localRegion values when provided.",
    };
  }

  if (upscaleBeforeInpaint?.enabled === true && upscaleBeforeInpaint.strategy === "local-region" && !upscaleBeforeInpaint.localRegion) {
    return {
      ok: false,
      message: "localRegion is required when high-res inpaint strategy is local-region.",
    };
  }

  if (value.inpaintMode !== undefined && !normalizeComfyUiInpaintMode(value.inpaintMode)) {
    return {
      ok: false,
      message: "inpaintMode must be latent-noise-mask or vae-inpaint when provided.",
    };
  }

  if (!isOptionalIntegerInRange(value.growMaskBy, 0, 512)) {
    return {
      ok: false,
      message: "growMaskBy must be an integer between 0 and 512 when provided.",
    };
  }

  if (value.loras !== undefined) {
    if (!Array.isArray(value.loras)) {
      return {
        ok: false,
        message: "loras must be an array when provided.",
      };
    }

    for (const lora of value.loras) {
      if (!normalizeLoraInput(lora)) {
        return {
          ok: false,
          message: "Each LoRA must include loraName and finite strength values when provided.",
        };
      }
    }
  }

  if (!isOptionalString(value.samplerName)) {
    return {
      ok: false,
      message: "samplerName must be a non-empty string when provided.",
    };
  }

  if (!isOptionalString(value.scheduler)) {
    return {
      ok: false,
      message: "scheduler must be a non-empty string when provided.",
    };
  }

  if (!isOptionalString(value.outputPrefix)) {
    return {
      ok: false,
      message: "outputPrefix must be a non-empty string when provided.",
    };
  }

  if (!isOptionalBoolean(value.preview)) {
    return {
      ok: false,
      message: "preview must be a boolean when provided.",
    };
  }

  for (const field of ["steps"] as const) {
    if (!isOptionalPositiveInteger(value[field])) {
      return {
        ok: false,
        message: `${field} must be a positive integer when provided.`,
      };
    }
  }

  if (!isOptionalSafeSeed(value.seed)) {
    return {
      ok: false,
      message: "seed must be a non-negative safe integer when provided.",
    };
  }

  for (const field of ["cfg", "denoise"] as const) {
    if (!isOptionalFiniteNumber(value[field])) {
      return {
        ok: false,
        message: `${field} must be a finite number when provided.`,
      };
    }
  }

  if (typeof value.denoise === "number" && (value.denoise < 0 || value.denoise > 1)) {
    return {
      ok: false,
      message: "denoise must be between 0 and 1.",
    };
  }

  return {
    ok: true,
    request: {
      checkpointName: value.checkpointName.trim(),
      positivePrompt: value.positivePrompt.trim(),
      negativePrompt: typeof value.negativePrompt === "string" ? value.negativePrompt.trim() : undefined,
      loras: normalizeOptionalLoras(value.loras),
      seed: getOptionalNumber(value.seed),
      steps: getOptionalNumber(value.steps),
      cfg: getOptionalNumber(value.cfg),
      samplerName: value.samplerName?.trim(),
      scheduler: value.scheduler?.trim(),
      denoise: getOptionalNumber(value.denoise),
      promptWrapper,
      outputPrefix: value.outputPrefix?.trim(),
      sourceImage,
      sourceImageDataUrl: typeof value.sourceImageDataUrl === "string" ? value.sourceImageDataUrl.trim() : undefined,
      imageWidth: getOptionalNumber(value.imageWidth),
      imageHeight: getOptionalNumber(value.imageHeight),
      imageName: value.imageName?.trim(),
      maskDataUrl: typeof value.maskDataUrl === "string" ? value.maskDataUrl.trim() : undefined,
      maskName: value.maskName?.trim(),
      inpaintMode: normalizeComfyUiInpaintMode(value.inpaintMode),
      growMaskBy: getOptionalNumber(value.growMaskBy),
      faceDetailer,
      handDetailer,
      upscaleBeforeInpaint,
      preview: typeof value.preview === "boolean" ? value.preview : undefined,
    },
  };
}

export function validateComfyUiSam2MaskRequest(value: unknown): ComfyUiSam2MaskValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Request body must be an object.",
    };
  }

  const sourceImage = normalizeImageReference(value.sourceImage);
  if (sourceImage === null) {
    return {
      ok: false,
      message: "sourceImage must include a ComfyUI filename and optional subfolder/type values.",
    };
  }

  if (!isOptionalString(value.imageName)) {
    return {
      ok: false,
      message: "imageName must be a non-empty string when provided.",
    };
  }

  if (
    typeof value.imageWidth !== "number" ||
    typeof value.imageHeight !== "number" ||
    !Number.isInteger(value.imageWidth) ||
    value.imageWidth <= 0 ||
    !Number.isInteger(value.imageHeight) ||
    value.imageHeight <= 0
  ) {
    return {
      ok: false,
      message: "imageWidth and imageHeight must be positive integers.",
    };
  }

  const imageWidth = value.imageWidth;
  const imageHeight = value.imageHeight;
  const positivePoints = normalizeSam2Points(value.positivePoints, imageWidth, imageHeight);
  if (!positivePoints) {
    return {
      ok: false,
      message: "positivePoints must be an array of finite {x, y} coordinates when provided.",
    };
  }

  const negativePoints = normalizeSam2Points(value.negativePoints, imageWidth, imageHeight);
  if (!negativePoints) {
    return {
      ok: false,
      message: "negativePoints must be an array of finite {x, y} coordinates when provided.",
    };
  }

  const bbox = normalizeSam2Bbox(value.bbox, imageWidth, imageHeight);
  if (bbox === null) {
    return {
      ok: false,
      message: "bbox must describe a non-empty rectangle inside the image when provided.",
    };
  }

  if (positivePoints.length === 0 && !bbox) {
    return {
      ok: false,
      message: "Add at least one positive point or one box before generating a SAM mask.",
    };
  }

  if (negativePoints.length > 0 && positivePoints.length === 0) {
    return {
      ok: false,
      message: "negativePoints require at least one positive point.",
    };
  }

  if (!isOptionalString(value.model)) {
    return {
      ok: false,
      message: "model must be a non-empty string when provided.",
    };
  }

  if (value.device !== undefined && !isSam2Device(value.device)) {
    return {
      ok: false,
      message: "device must be cuda, cpu, or mps when provided.",
    };
  }

  if (value.precision !== undefined && !isSam2Precision(value.precision)) {
    return {
      ok: false,
      message: "precision must be fp16, bf16, or fp32 when provided.",
    };
  }

  if (!isOptionalBoolean(value.keepModelLoaded)) {
    return {
      ok: false,
      message: "keepModelLoaded must be a boolean when provided.",
    };
  }

  if (!isOptionalString(value.outputPrefix)) {
    return {
      ok: false,
      message: "outputPrefix must be a non-empty string when provided.",
    };
  }

  return {
    ok: true,
    request: {
      ...(sourceImage ? { sourceImage } : {}),
      imageName: value.imageName?.trim(),
      imageWidth,
      imageHeight,
      positivePoints,
      negativePoints,
      ...(bbox ? { bbox } : {}),
      model: value.model?.trim(),
      device: value.device,
      precision: value.precision,
      keepModelLoaded: value.keepModelLoaded,
      outputPrefix: value.outputPrefix?.trim(),
    },
  };
}

function toResolvedControlNetUnit(unit: ComfyUiControlNetUnitConfig): ResolvedComfyUiControlNetUnitConfig {
  return {
    type: unit.type,
    enabled: unit.enabled ?? DEFAULT_CONTROLNET_UNIT.enabled,
    modelName: getString(unit.modelName, DEFAULT_CONTROLNET_UNIT.modelName),
    strength: unit.strength ?? DEFAULT_CONTROLNET_UNIT.strength,
    startPercent: unit.startPercent ?? DEFAULT_CONTROLNET_UNIT.startPercent,
    endPercent: unit.endPercent ?? DEFAULT_CONTROLNET_UNIT.endPercent,
    svg: unit.svg ?? DEFAULT_CONTROLNET_UNIT.svg,
    imageDataUrl: unit.imageDataUrl ?? DEFAULT_CONTROLNET_UNIT.imageDataUrl,
    imageName: getString(unit.imageName, DEFAULT_CONTROLNET_UNIT.imageName),
  };
}

function resolveControlNetUnits(request: ComfyUiTextToImageRequest): ResolvedComfyUiControlNetUnitConfig[] {
  const units = request.controlNets !== undefined
    ? request.controlNets
    : getControlNetValidationUnits(request.controlNet, undefined);

  return [...units]
    .sort((left, right) => CONTROLNET_TYPES.indexOf(left.type) - CONTROLNET_TYPES.indexOf(right.type))
    .map(toResolvedControlNetUnit);
}

function resolveCharacterReferences(request: ComfyUiTextToImageRequest): ResolvedComfyUiCharacterReferenceConfig[] {
  return (request.characterReferences ?? []).map((reference, referenceIndex) => {
    const id = getString(reference.id, `character-${referenceIndex + 1}`);
    const mode = reference.mode ?? "ipadapter";

    return {
      id,
      name: reference.name.trim(),
      prompt: typeof reference.prompt === "string" ? reference.prompt.trim() : "",
      enabled: reference.enabled ?? true,
      mode,
      images: reference.images.map((image, imageIndex) => ({
        id: getString(image.id, `${id}-reference-${imageIndex + 1}`),
        imageName: image.imageName.trim(),
        weight: image.weight ?? 1,
      })),
      maskImageName: getString(reference.maskImageName, ""),
      weight: reference.weight ?? 0.45,
      weightType: getString(reference.weightType, "linear"),
      combineEmbeds: reference.combineEmbeds ?? "concat",
      startPercent: reference.startPercent ?? 0,
      endPercent: reference.endPercent ?? 1,
      preset: getString(
        reference.preset,
        mode === "faceid"
          ? "FACEID PLUS V2"
          : mode === "face"
            ? "PLUS FACE (portraits)"
            : "PLUS (high strength)",
      ),
      loraStrength: reference.loraStrength ?? 0.6,
      provider: getString(reference.provider, "CPU"),
      embedsScaling: getString(reference.embedsScaling, "V only"),
    };
  });
}

function resolveDetailerConfig(
  detailer: ComfyUiFaceDetailerConfig | undefined,
  request: Pick<ComfyUiTextToImageRequest | ComfyUiInpaintRequest, "cfg" | "samplerName" | "scheduler" | "steps">,
  defaults: ResolvedComfyUiFaceDetailerConfig,
): ResolvedComfyUiFaceDetailerConfig {
  return {
    bboxCropFactor: detailer?.bboxCropFactor ?? defaults.bboxCropFactor,
    bboxDilation: detailer?.bboxDilation ?? defaults.bboxDilation,
    bboxThreshold: detailer?.bboxThreshold ?? defaults.bboxThreshold,
    cfg: detailer?.cfg ?? request.cfg ?? defaults.cfg,
    cycle: detailer?.cycle ?? defaults.cycle,
    denoise: detailer?.denoise ?? defaults.denoise,
    enabled: detailer?.enabled ?? defaults.enabled,
    detectorModelName: getString(detailer?.detectorModelName, defaults.detectorModelName),
    dropSize: detailer?.dropSize ?? defaults.dropSize,
    feather: detailer?.feather ?? defaults.feather,
    forceInpaint: detailer?.forceInpaint ?? defaults.forceInpaint,
    guideSize: detailer?.guideSize ?? defaults.guideSize,
    guideSizeFor: detailer?.guideSizeFor ?? defaults.guideSizeFor,
    maxSize: detailer?.maxSize ?? defaults.maxSize,
    noiseMask: detailer?.noiseMask ?? defaults.noiseMask,
    samBBoxExpansion: detailer?.samBBoxExpansion ?? defaults.samBBoxExpansion,
    samDetectionHint: detailer?.samDetectionHint ?? defaults.samDetectionHint,
    samDilation: detailer?.samDilation ?? defaults.samDilation,
    samMaskHintThreshold: detailer?.samMaskHintThreshold ?? defaults.samMaskHintThreshold,
    samMaskHintUseNegative: detailer?.samMaskHintUseNegative ?? defaults.samMaskHintUseNegative,
    samThreshold: detailer?.samThreshold ?? defaults.samThreshold,
    samplerName: getString(detailer?.samplerName, getString(request.samplerName, defaults.samplerName)),
    scheduler: getString(detailer?.scheduler, getString(request.scheduler, defaults.scheduler)),
    steps: detailer?.steps ?? request.steps ?? defaults.steps,
    wildcard: detailer?.wildcard ?? defaults.wildcard,
  };
}

function resolveInpaintUpscaleConfig(upscale: ComfyUiInpaintUpscaleConfig | undefined) {
  const mode = upscale?.mode ?? DEFAULT_INPAINT_REQUEST.upscaleBeforeInpaint.mode;
  const strategy = upscale?.strategy ?? DEFAULT_INPAINT_REQUEST.upscaleBeforeInpaint.strategy;
  const localRegion = upscale?.localRegion;

  return {
    enabled: upscale?.enabled ?? DEFAULT_INPAINT_REQUEST.upscaleBeforeInpaint.enabled,
    mode,
    scaleBy: upscale?.scaleBy ?? DEFAULT_INPAINT_REQUEST.upscaleBeforeInpaint.scaleBy,
    modelName: isComfyUiInpaintModelUpscaleMode(mode)
      ? getComfyUiInpaintUpscaleModelName(mode)
      : DEFAULT_INPAINT_REQUEST.upscaleBeforeInpaint.modelName,
    strategy,
    ...(localRegion
      ? {
          localRegion: {
            x: localRegion.x ?? 0,
            y: localRegion.y ?? 0,
            width: localRegion.width ?? 1,
            height: localRegion.height ?? 1,
            source: localRegion.source ?? "mask-bounds",
            padding: localRegion.padding ?? 128,
            feather: localRegion.feather ?? 32,
            harmonizeAfter: {
              enabled: localRegion.harmonizeAfter?.enabled ?? false,
              denoise: localRegion.harmonizeAfter?.denoise ?? 0.12,
            },
          },
        }
      : {}),
  };
}

export function resolveComfyUiTextToImageRequest(
  request: ComfyUiTextToImageRequest,
): ResolvedComfyUiTextToImageRequest {
  const checkpointName = request.checkpointName.trim();
  const modelBaseModel = getOptionalTrimmedStringValue(request.modelBaseModel);
  const modelStorageKind = isComfyUiModelStorageKind(request.modelStorageKind) ? request.modelStorageKind : undefined;
  const workflowProfile = resolveComfyUiTextToImageWorkflowProfile({
    checkpointName,
    modelBaseModel,
    modelStorageKind,
  }).id;
  const isAnimaProfile = workflowProfile === "anima";

  return {
    checkpointName,
    workflowProfile,
    modelBaseModel,
    modelStorageKind,
    clipName: isAnimaProfile ? DEFAULT_COMFYUI_ANIMA_CLIP_NAME : getOptionalTrimmedStringValue(request.clipName),
    clipDevice: getOptionalTrimmedStringValue(request.clipDevice),
    vaeName: isAnimaProfile ? DEFAULT_COMFYUI_ANIMA_VAE_NAME : getOptionalTrimmedStringValue(request.vaeName),
    unetWeightDtype: isAnimaProfile
      ? DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE
      : getOptionalTrimmedStringValue(request.unetWeightDtype),
    positivePrompt: request.positivePrompt.trim(),
    negativePrompt: getString(request.negativePrompt, DEFAULT_TEXT_TO_IMAGE_REQUEST.negativePrompt),
    loras: (request.loras ?? []).map((lora) => ({
      loraName: lora.loraName.trim(),
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip ?? lora.strengthModel,
    })),
    width: request.width ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.width,
    height: request.height ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.height,
    seed: request.seed ?? createRandomSeed(),
    steps: request.steps ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.steps,
    cfg: request.cfg ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.cfg,
    samplerName: getString(request.samplerName, DEFAULT_TEXT_TO_IMAGE_REQUEST.samplerName),
    scheduler: getString(request.scheduler, DEFAULT_TEXT_TO_IMAGE_REQUEST.scheduler),
    denoise: request.denoise ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.denoise,
    batchSize: request.batchSize ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.batchSize,
    latentImageNode: request.latentImageNode ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.latentImageNode,
    promptWrapper: {
      positivePrefix: request.promptWrapper?.positivePrefix ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.promptWrapper.positivePrefix,
      negativePrefix: request.promptWrapper?.negativePrefix ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.promptWrapper.negativePrefix,
    },
    outputPrefix: getString(request.outputPrefix, DEFAULT_TEXT_TO_IMAGE_REQUEST.outputPrefix),
    faceDetailer: resolveDetailerConfig(request.faceDetailer, request, DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer),
    handDetailer: resolveDetailerConfig(request.handDetailer, request, DEFAULT_TEXT_TO_IMAGE_REQUEST.handDetailer),
    controlNets: resolveControlNetUnits(request),
    characterReferences: resolveCharacterReferences(request),
  };
}

export function resolveComfyUiInpaintRequest(request: ComfyUiInpaintRequest): ResolvedComfyUiInpaintRequest {
  const inpaintMode = request.inpaintMode ?? DEFAULT_INPAINT_REQUEST.inpaintMode;

  return {
    checkpointName: request.checkpointName.trim(),
    positivePrompt: request.positivePrompt.trim(),
    negativePrompt: getString(request.negativePrompt, DEFAULT_INPAINT_REQUEST.negativePrompt),
    loras: (request.loras ?? []).map((lora) => ({
      loraName: lora.loraName.trim(),
      strengthModel: lora.strengthModel,
      strengthClip: lora.strengthClip ?? lora.strengthModel,
    })),
    seed: request.seed ?? createRandomSeed(),
    steps: request.steps ?? DEFAULT_INPAINT_REQUEST.steps,
    cfg: request.cfg ?? DEFAULT_INPAINT_REQUEST.cfg,
    samplerName: getString(request.samplerName, DEFAULT_INPAINT_REQUEST.samplerName),
    scheduler: getString(request.scheduler, DEFAULT_INPAINT_REQUEST.scheduler),
    denoise: normalizeComfyUiInpaintDenoiseForMode(request.denoise ?? DEFAULT_INPAINT_REQUEST.denoise, inpaintMode),
    promptWrapper: {
      positivePrefix: request.promptWrapper?.positivePrefix ?? DEFAULT_INPAINT_REQUEST.promptWrapper.positivePrefix,
      negativePrefix: request.promptWrapper?.negativePrefix ?? DEFAULT_INPAINT_REQUEST.promptWrapper.negativePrefix,
    },
    outputPrefix: getString(request.outputPrefix, DEFAULT_INPAINT_REQUEST.outputPrefix),
    ...(request.sourceImage ? { sourceImage: request.sourceImage } : {}),
    ...(request.sourceImageDataUrl ? { sourceImageDataUrl: request.sourceImageDataUrl } : {}),
    ...(request.imageWidth ? { imageWidth: request.imageWidth } : {}),
    ...(request.imageHeight ? { imageHeight: request.imageHeight } : {}),
    imageName: getString(request.imageName, DEFAULT_INPAINT_REQUEST.imageName),
    maskDataUrl: request.maskDataUrl ?? DEFAULT_INPAINT_REQUEST.maskDataUrl,
    maskName: getString(request.maskName, DEFAULT_INPAINT_REQUEST.maskName),
    inpaintMode,
    growMaskBy: request.growMaskBy ?? DEFAULT_INPAINT_REQUEST.growMaskBy,
    faceDetailer: resolveDetailerConfig(request.faceDetailer, request, DEFAULT_INPAINT_REQUEST.faceDetailer),
    handDetailer: resolveDetailerConfig(request.handDetailer, request, DEFAULT_INPAINT_REQUEST.handDetailer),
    upscaleBeforeInpaint: resolveInpaintUpscaleConfig(request.upscaleBeforeInpaint),
  };
}

export function resolveComfyUiSam2MaskRequest(request: ComfyUiSam2MaskRequest): ResolvedComfyUiSam2MaskRequest {
  const device = request.device ?? DEFAULT_SAM2_MASK_REQUEST.device;
  const requestedPrecision = request.precision ?? DEFAULT_SAM2_MASK_REQUEST.precision;

  return {
    ...(request.sourceImage ? { sourceImage: request.sourceImage } : {}),
    imageName: getString(request.imageName, ""),
    imageWidth: request.imageWidth,
    imageHeight: request.imageHeight,
    positivePoints: request.positivePoints ?? [],
    negativePoints: request.negativePoints ?? [],
    ...(request.bbox ? { bbox: request.bbox } : {}),
    model: getString(request.model, DEFAULT_SAM2_MASK_REQUEST.model),
    device,
    precision: device === "cpu" ? "fp32" : requestedPrecision,
    keepModelLoaded: request.keepModelLoaded ?? DEFAULT_SAM2_MASK_REQUEST.keepModelLoaded,
    outputPrefix: getString(request.outputPrefix, DEFAULT_SAM2_MASK_REQUEST.outputPrefix),
  };
}
