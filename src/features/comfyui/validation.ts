import type {
  ComfyUiControlNetConfig,
  ComfyUiControlNetType,
  ComfyUiControlNetUnitConfig,
  ComfyUiFaceDetailerConfig,
  ComfyUiLoraInput,
  ComfyUiTextToImageRequest,
  ResolvedComfyUiControlNetUnitConfig,
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
} from "./face-detailer";

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
  controlNets: [],
} satisfies Omit<ResolvedComfyUiTextToImageRequest, "checkpointName" | "positivePrompt" | "seed">;
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
const RANDOM_SEED_UPPER_BOUND = 2 ** 50;
const RANDOM_SEED_RANGE = RANDOM_SEED_UPPER_BOUND + 1;
const MAX_CONTROLNET_SVG_LENGTH = 2_000_000;
const MAX_CONTROLNET_IMAGE_DATA_URL_LENGTH = 12_000_000;
const CONTROLNET_TYPES = ["openpose", "depth", "normal"] as const satisfies readonly ComfyUiControlNetType[];

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

function isPngDataUrl(value: string) {
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.trim());
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
      controlNet,
      controlNets,
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

export function resolveComfyUiTextToImageRequest(
  request: ComfyUiTextToImageRequest,
): ResolvedComfyUiTextToImageRequest {
  return {
    checkpointName: request.checkpointName.trim(),
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
    faceDetailer: {
      bboxCropFactor: request.faceDetailer?.bboxCropFactor ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.bboxCropFactor,
      bboxDilation: request.faceDetailer?.bboxDilation ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.bboxDilation,
      bboxThreshold: request.faceDetailer?.bboxThreshold ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.bboxThreshold,
      cfg: request.faceDetailer?.cfg ?? request.cfg ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.cfg,
      cycle: request.faceDetailer?.cycle ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.cycle,
      denoise: request.faceDetailer?.denoise ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.denoise,
      enabled: request.faceDetailer?.enabled ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.enabled,
      detectorModelName: getString(
        request.faceDetailer?.detectorModelName,
        DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.detectorModelName,
      ),
      dropSize: request.faceDetailer?.dropSize ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.dropSize,
      feather: request.faceDetailer?.feather ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.feather,
      forceInpaint: request.faceDetailer?.forceInpaint ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.forceInpaint,
      guideSize: request.faceDetailer?.guideSize ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.guideSize,
      guideSizeFor: request.faceDetailer?.guideSizeFor ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.guideSizeFor,
      maxSize: request.faceDetailer?.maxSize ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.maxSize,
      noiseMask: request.faceDetailer?.noiseMask ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.noiseMask,
      samBBoxExpansion: request.faceDetailer?.samBBoxExpansion ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.samBBoxExpansion,
      samDetectionHint: request.faceDetailer?.samDetectionHint ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.samDetectionHint,
      samDilation: request.faceDetailer?.samDilation ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.samDilation,
      samMaskHintThreshold: request.faceDetailer?.samMaskHintThreshold
        ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.samMaskHintThreshold,
      samMaskHintUseNegative: request.faceDetailer?.samMaskHintUseNegative
        ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.samMaskHintUseNegative,
      samThreshold: request.faceDetailer?.samThreshold ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.samThreshold,
      samplerName: getString(request.faceDetailer?.samplerName, getString(request.samplerName, DEFAULT_TEXT_TO_IMAGE_REQUEST.samplerName)),
      scheduler: getString(request.faceDetailer?.scheduler, getString(request.scheduler, DEFAULT_TEXT_TO_IMAGE_REQUEST.scheduler)),
      steps: request.faceDetailer?.steps ?? request.steps ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.steps,
      wildcard: request.faceDetailer?.wildcard ?? DEFAULT_TEXT_TO_IMAGE_REQUEST.faceDetailer.wildcard,
    },
    controlNets: resolveControlNetUnits(request),
  };
}
