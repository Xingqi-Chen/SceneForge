import type {
  ComfyUiFaceDetailerConfig,
  ComfyUiControlNetType,
  ComfyUiControlNetUnitConfig,
  ComfyUiInpaintRequest,
  ComfyUiInpaintLocalRegionConfig,
  ComfyUiInpaintUpscaleMode,
  ComfyUiInpaintUpscaleStrategy,
  ComfyUiSam2MaskRequest,
  ComfyUiTextToImageRequest,
} from "./types";
import {
  COMFYUI_FACE_DETAILER_DETECTOR_MODEL_PREFERENCES,
  COMFYUI_HAND_DETAILER_DETECTOR_MODEL_PREFERENCES,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
} from "./face-detailer";
import { DEFAULT_COMFYUI_INPAINT_MODE } from "./inpaint";
import { normalizeComfyUiLatentImageNode } from "./latent-image-node";
import {
  DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_NAME,
  getComfyUiInpaintUpscaleModelName,
  isComfyUiInpaintModelUpscaleMode,
} from "./validation";

type ComfyUiObjectInfoNode = {
  input?: {
    required?: Record<string, unknown>;
  };
};

export type ComfyUiObjectInfo = Record<string, ComfyUiObjectInfoNode>;

export type ComfyUiRequestObjectInfoValidation = {
  errors: string[];
  request: ComfyUiTextToImageRequest;
  warnings: string[];
};

export type ComfyUiInpaintRequestObjectInfoValidation = {
  errors: string[];
  request: ComfyUiInpaintRequest;
  warnings: string[];
};

export type ComfyUiSam2MaskRequestObjectInfoValidation = {
  errors: string[];
  request: ComfyUiSam2MaskRequest;
  warnings: string[];
};

const SAMPLER_ALIASES: Record<string, string> = {
  dpmpp2m: "dpmpp_2m",
  dpm2m: "dpmpp_2m",
  dpm2msde: "dpmpp_2m_sde",
  dpm2msdegpu: "dpmpp_2m_sde_gpu",
  dpmpp2msde: "dpmpp_2m_sde",
  dpmpp2msdegpu: "dpmpp_2m_sde_gpu",
  dpm3msde: "dpmpp_3m_sde",
  dpm3msdegpu: "dpmpp_3m_sde_gpu",
  dpmpp3msde: "dpmpp_3m_sde",
  dpmpp3msdegpu: "dpmpp_3m_sde_gpu",
  dpmsde: "dpmpp_sde",
  dpmsdegpu: "dpmpp_sde_gpu",
  dpmppsde: "dpmpp_sde",
  dpmppsdegpu: "dpmpp_sde_gpu",
  eulera: "euler_ancestral",
  eulerancestral: "euler_ancestral",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionName(value: string) {
  return value.toLowerCase().replace(/\+\+/g, "pp").replace(/[^a-z0-9]+/g, "");
}

function readInputOptions(objectInfo: unknown, classType: string, inputName: string): string[] {
  if (!isRecord(objectInfo)) {
    return [];
  }

  const nodeInfo = objectInfo[classType];
  if (!isRecord(nodeInfo) || !isRecord(nodeInfo.input) || !isRecord(nodeInfo.input.required)) {
    return [];
  }

  const inputInfo = nodeInfo.input.required[inputName];
  if (!Array.isArray(inputInfo)) {
    return [];
  }

  if (Array.isArray(inputInfo[0])) {
    return inputInfo[0].filter((value): value is string => typeof value === "string");
  }

  if (isRecord(inputInfo[1]) && Array.isArray(inputInfo[1].options)) {
    return inputInfo[1].options.filter((value): value is string => typeof value === "string");
  }

  return [];
}

function hasNodeInfo(objectInfo: unknown, classType: string) {
  return isRecord(objectInfo) && isRecord(objectInfo[classType]);
}

function findOption(value: string, options: string[]) {
  const trimmed = value.trim();
  const exact = options.find((option) => option === trimmed);
  if (exact) {
    return exact;
  }

  const normalized = normalizeOptionName(trimmed);
  return options.find((option) => normalizeOptionName(option) === normalized) ?? null;
}

function findSamplerAlias(normalizedValue: string, options: string[]) {
  const alias = SAMPLER_ALIASES[normalizedValue];
  if (!alias) {
    return null;
  }

  const fallbackAlias = alias.endsWith("_gpu") ? alias.replace(/_gpu$/, "") : `${alias}_gpu`;
  return [alias, fallbackAlias].find((option) => options.includes(option)) ?? null;
}

function findSamplerByNormalizedValue(normalizedValue: string, options: string[]) {
  return options.find((option) => normalizeOptionName(option) === normalizedValue) ?? findSamplerAlias(normalizedValue, options);
}

function findSampler(value: string | undefined, options: string[], schedulerOptions: string[]) {
  if (!value) {
    return {
      samplerName: null,
      scheduler: null,
    };
  }

  const direct = findOption(value, options);
  if (direct) {
    return {
      samplerName: direct,
      scheduler: null,
    };
  }

  const normalized = normalizeOptionName(value);
  const alias = findSamplerAlias(normalized, options);
  if (alias) {
    return {
      samplerName: alias,
      scheduler: null,
    };
  }

  for (const scheduler of schedulerOptions) {
    const normalizedScheduler = normalizeOptionName(scheduler);
    if (!normalized.endsWith(normalizedScheduler) || normalized.length <= normalizedScheduler.length) {
      continue;
    }

    const samplerName = findSamplerByNormalizedValue(
      normalized.slice(0, -normalizedScheduler.length),
      options,
    );
    if (samplerName) {
      return {
        samplerName,
        scheduler,
      };
    }
  }

  return {
    samplerName: null,
    scheduler: null,
  };
}

function findPreferredFaceDetailerDetectorModel(options: string[]) {
  for (const preferred of COMFYUI_FACE_DETAILER_DETECTOR_MODEL_PREFERENCES) {
    const matched = findOption(preferred, options);
    if (matched) {
      return matched;
    }
  }

  return options.find((option) => option.toLowerCase().startsWith("bbox/") && option.toLowerCase().includes("face"))
    ?? options.find((option) => option.toLowerCase().includes("face"))
    ?? options.find((option) => option.toLowerCase().startsWith("bbox/"))
    ?? options[0]
    ?? null;
}

function findPreferredHandDetailerDetectorModel(options: string[]) {
  for (const preferred of COMFYUI_HAND_DETAILER_DETECTOR_MODEL_PREFERENCES) {
    const matched = findOption(preferred, options);
    if (matched) {
      return matched;
    }
  }

  return options.find((option) => option.toLowerCase().startsWith("bbox/") && option.toLowerCase().includes("hand"))
    ?? options.find((option) => option.toLowerCase().includes("hand"))
    ?? options.find((option) => option.toLowerCase().startsWith("bbox/"))
    ?? options[0]
    ?? null;
}

function shouldFallbackFromRequestedDetailerDetectorModel(value: string | undefined, defaultModel: string) {
  return !value || normalizeOptionName(value) === normalizeOptionName(defaultModel);
}

function findPreferredOpenPoseControlNetModel(options: string[]) {
  return options.find((option) => normalizeOptionName(option).includes("openpose"))
    ?? options.find((option) => normalizeOptionName(option).includes("dwpose"))
    ?? options[0]
    ?? null;
}

function findPreferredDepthControlNetModel(options: string[]) {
  return options.find((option) => normalizeOptionName(option).includes("depth"))
    ?? options.find((option) => normalizeOptionName(option).includes("depthanything"))
    ?? options.find((option) => normalizeOptionName(option).includes("midas"))
    ?? options.find((option) => normalizeOptionName(option).includes("zoe"))
    ?? options.find((option) => normalizeOptionName(option).includes("leres"))
    ?? null;
}

function findPreferredNormalControlNetModel(options: string[]) {
  return options.find((option) => normalizeOptionName(option).includes("normalbae"))
    ?? options.find((option) => normalizeOptionName(option).includes("normal"))
    ?? options.find((option) => normalizeOptionName(option).includes("bae"))
    ?? options.find((option) => normalizeOptionName(option).includes("dsine"))
    ?? null;
}

function findPreferredControlNetModel(type: ComfyUiControlNetType, options: string[]) {
  if (type === "depth") {
    return findPreferredDepthControlNetModel(options);
  }

  if (type === "normal") {
    return findPreferredNormalControlNetModel(options);
  }

  return findPreferredOpenPoseControlNetModel(options);
}

function formatControlNetType(type: ComfyUiControlNetType) {
  if (type === "depth") {
    return "Depth";
  }

  if (type === "normal") {
    return "Normal";
  }

  return "OpenPose";
}

function getRequestControlNetUnits(request: ComfyUiTextToImageRequest): ComfyUiControlNetUnitConfig[] {
  if (request.controlNets !== undefined) {
    return request.controlNets;
  }

  if (!request.controlNet) {
    return [];
  }

  return [
    {
      type: "openpose",
      enabled: request.controlNet.enabled,
      modelName: request.controlNet.modelName,
      strength: request.controlNet.strength,
      startPercent: request.controlNet.startPercent,
      endPercent: request.controlNet.endPercent,
      svg: request.controlNet.svg ?? request.controlNet.openPoseSvg,
      imageDataUrl: request.controlNet.imageDataUrl,
      imageName: request.controlNet.imageName,
    },
  ];
}

function validateDimension(value: number | undefined, label: string, latentImageNode: string, errors: string[]) {
  if (value === undefined) {
    return;
  }

  if (value < 16 || value > 16384 || value % 8 !== 0) {
    errors.push(`${label} must be between 16 and 16384 and divisible by 8 for ComfyUI ${latentImageNode}.`);
  }
}

function validateDetailerAgainstObjectInfo({
  defaultDetectorModel,
  detailer,
  errors,
  findPreferredDetectorModel,
  label,
  objectInfo,
  samplerOptions,
  schedulerOptions,
  ultralyticsDetectorOptions,
}: {
  defaultDetectorModel: string;
  detailer: ComfyUiFaceDetailerConfig | undefined;
  errors: string[];
  findPreferredDetectorModel: (options: string[]) => string | null;
  label: "FaceDetailer" | "HandDetailer";
  objectInfo: unknown;
  samplerOptions: string[];
  schedulerOptions: string[];
  ultralyticsDetectorOptions: string[];
}): ComfyUiFaceDetailerConfig | undefined {
  if (!detailer?.enabled) {
    return detailer;
  }

  let resolvedDetailer = detailer;

  if (!hasNodeInfo(objectInfo, "FaceDetailer")) {
    errors.push(`FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use ${label}.`);
  }

  if (!hasNodeInfo(objectInfo, "UltralyticsDetectorProvider")) {
    errors.push(`UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use ${label}.`);
  }

  const detectorModelName = detailer.detectorModelName;
  const requestedDetectorModel = shouldFallbackFromRequestedDetailerDetectorModel(detectorModelName, defaultDetectorModel)
    ? (
        detectorModelName
          ? findOption(detectorModelName, ultralyticsDetectorOptions)
          : null
      ) ?? findPreferredDetectorModel(ultralyticsDetectorOptions)
    : detectorModelName
      ? findOption(detectorModelName, ultralyticsDetectorOptions)
      : null;

  if (!requestedDetectorModel) {
    errors.push(
      detailer.detectorModelName
        ? `${label} detector model is not available in ComfyUI: ${detailer.detectorModelName}`
        : `${label} detector model is not available in ComfyUI.`,
    );
  } else {
    resolvedDetailer = {
      ...resolvedDetailer,
      detectorModelName: requestedDetectorModel,
    };
  }

  const sampler = findSampler(detailer.samplerName, samplerOptions, schedulerOptions);
  const samplerName = sampler.samplerName;
  const requestedScheduler = detailer.scheduler
    ? findOption(detailer.scheduler, schedulerOptions)
    : null;
  const scheduler = sampler.scheduler ?? requestedScheduler;

  if (detailer.samplerName && !samplerName) {
    errors.push(`${label} sampler is not available in ComfyUI: ${detailer.samplerName}`);
  }

  if (detailer.scheduler && !scheduler) {
    errors.push(`${label} scheduler is not available in ComfyUI: ${detailer.scheduler}`);
  }

  if (samplerName || scheduler) {
    resolvedDetailer = {
      ...resolvedDetailer,
      ...(samplerName ? { samplerName } : {}),
      ...(scheduler ? { scheduler } : {}),
    };
  }

  return resolvedDetailer;
}

export function validateComfyUiRequestAgainstObjectInfo(
  request: ComfyUiTextToImageRequest,
  objectInfo: unknown,
): ComfyUiRequestObjectInfoValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkpointOptions = readInputOptions(objectInfo, "CheckpointLoaderSimple", "ckpt_name");
  const loraOptions = readInputOptions(objectInfo, "LoraLoader", "lora_name");
  const samplerOptions = readInputOptions(objectInfo, "KSampler", "sampler_name");
  const schedulerOptions = readInputOptions(objectInfo, "KSampler", "scheduler");
  const ultralyticsDetectorOptions = readInputOptions(objectInfo, "UltralyticsDetectorProvider", "model_name");
  const controlNetOptions = readInputOptions(objectInfo, "ControlNetLoader", "control_net_name");
  const checkpointName = findOption(request.checkpointName, checkpointOptions);
  const sampler = findSampler(request.samplerName, samplerOptions, schedulerOptions);
  const samplerName = sampler.samplerName;
  const requestedScheduler = request.scheduler ? findOption(request.scheduler, schedulerOptions) : null;
  const scheduler = sampler.scheduler ?? requestedScheduler;
  const latentImageNode = normalizeComfyUiLatentImageNode(request.latentImageNode);
  let faceDetailer = request.faceDetailer;
  let handDetailer = request.handDetailer;
  const loras = (request.loras ?? []).map((lora, index) => {
    const loraName = findOption(lora.loraName, loraOptions);
    if (!loraName) {
      errors.push(`LoRA ${index + 1} is not available in ComfyUI: ${lora.loraName}`);
    }

    return {
      ...lora,
      loraName: loraName ?? lora.loraName,
    };
  });

  if (!checkpointName) {
    errors.push(`Checkpoint is not available in ComfyUI: ${request.checkpointName}`);
  }

  if (request.samplerName && !samplerName) {
    errors.push(`Sampler is not available in ComfyUI: ${request.samplerName}`);
  }

  if (request.scheduler && !scheduler) {
    errors.push(`Scheduler is not available in ComfyUI: ${request.scheduler}`);
  }

  if (request.latentImageNode && !latentImageNode) {
    errors.push(`Latent image node is not supported by SceneForge: ${request.latentImageNode}`);
  }

  if (latentImageNode && !hasNodeInfo(objectInfo, latentImageNode)) {
    errors.push(`Latent image node is not available in ComfyUI: ${latentImageNode}`);
  }

  if (!hasNodeInfo(objectInfo, "PreviewImage")) {
    errors.push("PreviewImage node is not available in ComfyUI. It is required to preview generated images before saving.");
  }

  faceDetailer = validateDetailerAgainstObjectInfo({
    defaultDetectorModel: DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
    detailer: request.faceDetailer,
    errors,
    findPreferredDetectorModel: findPreferredFaceDetailerDetectorModel,
    label: "FaceDetailer",
    objectInfo,
    samplerOptions,
    schedulerOptions,
    ultralyticsDetectorOptions,
  });
  handDetailer = validateDetailerAgainstObjectInfo({
    defaultDetectorModel: DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
    detailer: request.handDetailer,
    errors,
    findPreferredDetectorModel: findPreferredHandDetailerDetectorModel,
    label: "HandDetailer",
    objectInfo,
    samplerOptions,
    schedulerOptions,
    ultralyticsDetectorOptions,
  });

  let controlNets = getRequestControlNetUnits(request);
  if (controlNets.some((unit) => unit.enabled)) {
    if (!hasNodeInfo(objectInfo, "LoadImage")) {
      errors.push("LoadImage node is not available in ComfyUI. It is required for ControlNet images.");
    }

    if (!hasNodeInfo(objectInfo, "ControlNetLoader")) {
      errors.push("ControlNetLoader node is not available in ComfyUI. Install ControlNet support to use ControlNet.");
    }

    if (!hasNodeInfo(objectInfo, "ControlNetApplyAdvanced")) {
      errors.push("ControlNetApplyAdvanced node is not available in ComfyUI. Update ComfyUI or install ControlNet support.");
    }

    controlNets = controlNets.map((unit) => {
      if (!unit.enabled) {
        return unit;
      }

      const requestedControlNetModel = unit.modelName
        ? findOption(unit.modelName, controlNetOptions)
        : findPreferredControlNetModel(unit.type, controlNetOptions);

      if (!requestedControlNetModel) {
        errors.push(
          unit.modelName
            ? `${formatControlNetType(unit.type)} ControlNet model is not available in ComfyUI: ${unit.modelName}`
            : `${formatControlNetType(unit.type)} ControlNet model is not available in ComfyUI.`,
        );
        return unit;
      }

      return {
        ...unit,
        modelName: requestedControlNetModel,
      };
    });
  }

  validateDimension(request.width, "width", latentImageNode ?? "EmptyLatentImage", errors);
  validateDimension(request.height, "height", latentImageNode ?? "EmptyLatentImage", errors);

  if (request.samplerName && samplerName && samplerName !== request.samplerName) {
    warnings.push(`Normalized sampler ${request.samplerName} to ${samplerName}.`);
  }

  if (request.samplerName && sampler.scheduler) {
    warnings.push(`Extracted scheduler ${sampler.scheduler} from sampler ${request.samplerName}.`);
  }

  if (request.scheduler && sampler.scheduler && sampler.scheduler !== request.scheduler) {
    warnings.push(`Normalized scheduler ${request.scheduler} to ${sampler.scheduler}.`);
  } else if (request.scheduler && scheduler && scheduler !== request.scheduler) {
    warnings.push(`Normalized scheduler ${request.scheduler} to ${scheduler}.`);
  }

  return {
    errors,
    warnings,
    request: {
      ...request,
      checkpointName: checkpointName ?? request.checkpointName,
      samplerName: samplerName ?? request.samplerName,
      scheduler: scheduler ?? request.scheduler,
      latentImageNode: latentImageNode ?? request.latentImageNode,
      faceDetailer,
      handDetailer,
      controlNets,
      loras,
    },
  };
}

export function validateComfyUiInpaintRequestAgainstObjectInfo(
  request: ComfyUiInpaintRequest,
  objectInfo: unknown,
): ComfyUiInpaintRequestObjectInfoValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkpointOptions = readInputOptions(objectInfo, "CheckpointLoaderSimple", "ckpt_name");
  const loraOptions = readInputOptions(objectInfo, "LoraLoader", "lora_name");
  const samplerOptions = readInputOptions(objectInfo, "KSampler", "sampler_name");
  const schedulerOptions = readInputOptions(objectInfo, "KSampler", "scheduler");
  const ultralyticsDetectorOptions = readInputOptions(objectInfo, "UltralyticsDetectorProvider", "model_name");
  const imageScaleByMethodOptions = readInputOptions(objectInfo, "ImageScaleBy", "upscale_method");
  const imageScaleMethodOptions = readInputOptions(objectInfo, "ImageScale", "upscale_method");
  const upscaleModelOptions = readInputOptions(objectInfo, "UpscaleModelLoader", "model_name");
  const checkpointName = findOption(request.checkpointName, checkpointOptions);
  const sampler = findSampler(request.samplerName, samplerOptions, schedulerOptions);
  const samplerName = sampler.samplerName;
  const requestedScheduler = request.scheduler ? findOption(request.scheduler, schedulerOptions) : null;
  const scheduler = sampler.scheduler ?? requestedScheduler;
  const inpaintMode = request.inpaintMode ?? DEFAULT_COMFYUI_INPAINT_MODE;
  const highResInpaint: {
    enabled: boolean;
    mode: ComfyUiInpaintUpscaleMode;
    modelName: string;
    scaleBy: number;
    strategy: ComfyUiInpaintUpscaleStrategy;
    localRegion?: ComfyUiInpaintLocalRegionConfig;
  } = request.upscaleBeforeInpaint?.enabled === true
    ? {
        enabled: true,
        mode: request.upscaleBeforeInpaint.mode ?? "lanczos" as const,
        scaleBy: request.upscaleBeforeInpaint.scaleBy ?? 2,
        modelName: getComfyUiInpaintUpscaleModelName(request.upscaleBeforeInpaint.mode ?? "lanczos"),
        strategy: request.upscaleBeforeInpaint.strategy ?? "full-image",
        ...(request.upscaleBeforeInpaint.localRegion ? { localRegion: request.upscaleBeforeInpaint.localRegion } : {}),
      }
    : {
        enabled: false,
        mode: request.upscaleBeforeInpaint?.mode ?? "lanczos" as const,
        scaleBy: request.upscaleBeforeInpaint?.scaleBy ?? 2,
        modelName: getComfyUiInpaintUpscaleModelName(request.upscaleBeforeInpaint?.mode ?? "lanczos"),
        strategy: request.upscaleBeforeInpaint?.strategy ?? "full-image",
        ...(request.upscaleBeforeInpaint?.localRegion ? { localRegion: request.upscaleBeforeInpaint.localRegion } : {}),
      };
  let faceDetailer = request.faceDetailer;
  let handDetailer = request.handDetailer;
  const loras = (request.loras ?? []).map((lora, index) => {
    const loraName = findOption(lora.loraName, loraOptions);
    if (!loraName) {
      errors.push(`LoRA ${index + 1} is not available in ComfyUI: ${lora.loraName}`);
    }

    return {
      ...lora,
      loraName: loraName ?? lora.loraName,
    };
  });

  if (!checkpointName) {
    errors.push(`Checkpoint is not available in ComfyUI: ${request.checkpointName}`);
  }

  if (request.samplerName && !samplerName) {
    errors.push(`Sampler is not available in ComfyUI: ${request.samplerName}`);
  }

  if (request.scheduler && !scheduler) {
    errors.push(`Scheduler is not available in ComfyUI: ${request.scheduler}`);
  }

  if (!hasNodeInfo(objectInfo, "LoadImage")) {
    errors.push("LoadImage node is not available in ComfyUI. It is required for inpaint source images.");
  }

  if (!hasNodeInfo(objectInfo, "PreviewImage")) {
    errors.push("PreviewImage node is not available in ComfyUI. It is required to preview inpaint results before saving.");
  }

  if (!hasNodeInfo(objectInfo, "LoadImageMask")) {
    errors.push("LoadImageMask node is not available in ComfyUI. It is required for inpaint masks.");
  }

  if (highResInpaint.enabled) {
    if (!hasNodeInfo(objectInfo, "VAEDecodeTiled")) {
      errors.push("VAEDecodeTiled node is not available in ComfyUI. It is required for high-res inpaint output images.");
    }
  } else if (!hasNodeInfo(objectInfo, "VAEDecode")) {
    errors.push("VAEDecode node is not available in ComfyUI. It is required for inpaint output images.");
  }

  if (highResInpaint.enabled) {
    if (!hasNodeInfo(objectInfo, "ImageScaleBy")) {
      errors.push("ImageScaleBy node is not available in ComfyUI. It is required for high-res inpaint upscaling.");
    }

    if (!hasNodeInfo(objectInfo, "MaskToImage")) {
      errors.push("MaskToImage node is not available in ComfyUI. It is required to upscale high-res inpaint masks.");
    }

    if (!hasNodeInfo(objectInfo, "ImageToMask")) {
      errors.push("ImageToMask node is not available in ComfyUI. It is required to restore high-res inpaint masks.");
    }

    if (imageScaleByMethodOptions.length > 0 && !findOption("nearest-exact", imageScaleByMethodOptions)) {
      errors.push("ImageScaleBy nearest-exact upscale method is not available in ComfyUI. It is required for high-res inpaint masks.");
    }

    if (highResInpaint.strategy === "local-region") {
      const localRegion = highResInpaint.localRegion;
      if (!localRegion) {
        errors.push("localRegion is required for local-region high-res inpaint.");
      } else {
        const x = localRegion.x;
        const y = localRegion.y;
        const width = localRegion.width;
        const height = localRegion.height;
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          x === undefined ||
          y === undefined ||
          width === undefined ||
          height === undefined ||
          x < 0 ||
          y < 0 ||
          width <= 0 ||
          height <= 0
        ) {
          errors.push("localRegion must describe a non-empty rectangle using integer x, y, width, and height values.");
        } else if (
          request.imageWidth !== undefined &&
          request.imageHeight !== undefined &&
          (x + width > request.imageWidth || y + height > request.imageHeight)
        ) {
          errors.push("localRegion must stay inside the source image bounds.");
        }
      }

      if (!hasNodeInfo(objectInfo, "ImageCrop")) {
        errors.push("ImageCrop node is not available in ComfyUI. It is required for local-region high-res inpaint.");
      }

      if (!hasNodeInfo(objectInfo, "CropMask")) {
        errors.push("CropMask node is not available in ComfyUI. It is required for local-region high-res inpaint masks.");
      }

      if (!hasNodeInfo(objectInfo, "FeatherMask")) {
        errors.push("FeatherMask node is not available in ComfyUI. It is required to blend local-region inpaint patches.");
      }

      if (!hasNodeInfo(objectInfo, "ImageScale")) {
        errors.push("ImageScale node is not available in ComfyUI. It is required to resize local-region inpaint patches.");
      }

      if (imageScaleMethodOptions.length > 0 && !findOption("lanczos", imageScaleMethodOptions)) {
        errors.push("ImageScale lanczos upscale method is not available in ComfyUI. It is required to resize local-region inpaint patches.");
      }

      if (!hasNodeInfo(objectInfo, "ImageCompositeMasked")) {
        errors.push("ImageCompositeMasked node is not available in ComfyUI. It is required to paste local-region inpaint patches.");
      }
    }

    if (highResInpaint.mode === "lanczos") {
      if (imageScaleByMethodOptions.length > 0 && !findOption("lanczos", imageScaleByMethodOptions)) {
        errors.push("ImageScaleBy lanczos upscale method is not available in ComfyUI. It is required for high-res inpaint source images.");
      }
    } else if (isComfyUiInpaintModelUpscaleMode(highResInpaint.mode)) {
      const requestedModelName = getComfyUiInpaintUpscaleModelName(highResInpaint.mode);
      const upscaleModel = findOption(requestedModelName, upscaleModelOptions);

      if (!hasNodeInfo(objectInfo, "UpscaleModelLoader")) {
        errors.push("UpscaleModelLoader node is not available in ComfyUI. It is required for model-based high-res inpaint.");
      }

      if (!hasNodeInfo(objectInfo, "ImageUpscaleWithModel")) {
        errors.push("ImageUpscaleWithModel node is not available in ComfyUI. It is required for model-based high-res inpaint.");
      }

      if (upscaleModelOptions.length > 0 && !upscaleModel) {
        errors.push(`2x upscale model is not available in ComfyUI: ${requestedModelName}`);
      }

      highResInpaint.modelName = upscaleModel ?? requestedModelName;
    } else {
      highResInpaint.modelName = DEFAULT_COMFYUI_INPAINT_UPSCALE_MODEL_NAME;
    }
  }

  if (inpaintMode === "vae-inpaint") {
    if (!hasNodeInfo(objectInfo, "VAEEncodeForInpaint")) {
      errors.push("VAEEncodeForInpaint node is not available in ComfyUI. It is required for VAE inpaint mode.");
    }
  } else {
    if (highResInpaint.enabled) {
      if (!hasNodeInfo(objectInfo, "VAEEncodeTiled")) {
        errors.push("VAEEncodeTiled node is not available in ComfyUI. It is required for high-res latent noise mask inpaint mode.");
      }
    } else if (!hasNodeInfo(objectInfo, "VAEEncode")) {
      errors.push("VAEEncode node is not available in ComfyUI. It is required for latent noise mask inpaint mode.");
    }

    if (!hasNodeInfo(objectInfo, "SetLatentNoiseMask")) {
      errors.push("SetLatentNoiseMask node is not available in ComfyUI. It is required for latent noise mask inpaint mode.");
    }
  }

  faceDetailer = validateDetailerAgainstObjectInfo({
    defaultDetectorModel: DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
    detailer: request.faceDetailer,
    errors,
    findPreferredDetectorModel: findPreferredFaceDetailerDetectorModel,
    label: "FaceDetailer",
    objectInfo,
    samplerOptions,
    schedulerOptions,
    ultralyticsDetectorOptions,
  });
  handDetailer = validateDetailerAgainstObjectInfo({
    defaultDetectorModel: DEFAULT_COMFYUI_HAND_DETAILER_DETECTOR_MODEL,
    detailer: request.handDetailer,
    errors,
    findPreferredDetectorModel: findPreferredHandDetailerDetectorModel,
    label: "HandDetailer",
    objectInfo,
    samplerOptions,
    schedulerOptions,
    ultralyticsDetectorOptions,
  });

  if (request.samplerName && samplerName && samplerName !== request.samplerName) {
    warnings.push(`Normalized sampler ${request.samplerName} to ${samplerName}.`);
  }

  if (request.samplerName && sampler.scheduler) {
    warnings.push(`Extracted scheduler ${sampler.scheduler} from sampler ${request.samplerName}.`);
  }

  if (request.scheduler && sampler.scheduler && sampler.scheduler !== request.scheduler) {
    warnings.push(`Normalized scheduler ${request.scheduler} to ${sampler.scheduler}.`);
  } else if (request.scheduler && scheduler && scheduler !== request.scheduler) {
    warnings.push(`Normalized scheduler ${request.scheduler} to ${scheduler}.`);
  }

  return {
    errors,
    warnings,
    request: {
      ...request,
      checkpointName: checkpointName ?? request.checkpointName,
      samplerName: samplerName ?? request.samplerName,
      scheduler: scheduler ?? request.scheduler,
      inpaintMode,
      faceDetailer,
      handDetailer,
      upscaleBeforeInpaint: highResInpaint,
      loras,
    },
  };
}

export function readComfyUiUpscaleModelOptions(objectInfo: unknown) {
  return readInputOptions(objectInfo, "UpscaleModelLoader", "model_name");
}

export function validateComfyUiSam2MaskRequestAgainstObjectInfo(
  request: ComfyUiSam2MaskRequest,
  objectInfo: unknown,
): ComfyUiSam2MaskRequestObjectInfoValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const modelOptions = readInputOptions(objectInfo, "DownloadAndLoadSAM2Model", "model");
  const deviceOptions = readInputOptions(objectInfo, "DownloadAndLoadSAM2Model", "device");
  const precisionOptions = readInputOptions(objectInfo, "DownloadAndLoadSAM2Model", "precision");
  const requestedModel = request.model ?? "sam2.1_hiera_small.safetensors";
  const requestedDevice = request.device ?? "cuda";
  const requestedPrecision = requestedDevice === "cpu" ? "fp32" : request.precision ?? "fp16";
  const model = findOption(requestedModel, modelOptions);
  const device = findOption(requestedDevice, deviceOptions);
  const precision = findOption(requestedPrecision, precisionOptions);

  if (!hasNodeInfo(objectInfo, "DownloadAndLoadSAM2Model")) {
    errors.push("DownloadAndLoadSAM2Model node is not available in ComfyUI. It is required for SAM2 mask generation.");
  }

  if (!hasNodeInfo(objectInfo, "Sam2Segmentation")) {
    errors.push("Sam2Segmentation node is not available in ComfyUI. It is required for SAM2 mask generation.");
  }

  if (!hasNodeInfo(objectInfo, "LoadImage")) {
    errors.push("LoadImage node is not available in ComfyUI. It is required for SAM2 source images.");
  }

  if (!hasNodeInfo(objectInfo, "MaskToImage")) {
    errors.push("MaskToImage node is not available in ComfyUI. It is required to preview SAM2 masks.");
  }

  if (!hasNodeInfo(objectInfo, "SaveImage")) {
    errors.push("SaveImage node is not available in ComfyUI. It is required to return SAM2 mask previews.");
  }

  if (modelOptions.length > 0 && !model) {
    errors.push(`SAM2 model is not available in ComfyUI: ${requestedModel}`);
  }

  if (deviceOptions.length > 0 && !device) {
    errors.push(`SAM2 device is not available in ComfyUI: ${requestedDevice}`);
  }

  if (precisionOptions.length > 0 && !precision) {
    errors.push(`SAM2 precision is not available in ComfyUI: ${requestedPrecision}`);
  }

  if (request.device === "cpu" && request.precision && request.precision !== "fp32") {
    warnings.push(`Normalized SAM2 precision ${request.precision} to fp32 because CPU does not support fp16/bf16.`);
  }

  return {
    errors,
    warnings,
    request: {
      ...request,
      model: model ?? requestedModel,
      device: (device ?? requestedDevice) as ComfyUiSam2MaskRequest["device"],
      precision: (precision ?? requestedPrecision) as ComfyUiSam2MaskRequest["precision"],
    },
  };
}

export function summarizeComfyUiErrorDetails(details: unknown) {
  if (!isRecord(details)) {
    return [];
  }

  const nodeErrors = isRecord(details.node_errors) ? details.node_errors : {};

  return Object.entries(nodeErrors).flatMap(([nodeId, nodeError]) => {
    if (!isRecord(nodeError)) {
      return [`Node ${nodeId}: ${String(nodeError)}`];
    }

    const classType = typeof nodeError.class_type === "string" ? nodeError.class_type : "unknown";
    const errors = Array.isArray(nodeError.errors) ? nodeError.errors : [];
    if (errors.length === 0) {
      return [`Node ${nodeId} (${classType}) failed validation.`];
    }

    return errors.map((error) => {
      if (!isRecord(error)) {
        return `Node ${nodeId} (${classType}): ${String(error)}`;
      }

      const message = typeof error.message === "string" ? error.message : "validation error";
      const detail = typeof error.details === "string" && error.details ? ` ${error.details}` : "";
      const inputName = isRecord(error.extra_info) && typeof error.extra_info.input_name === "string"
        ? ` ${error.extra_info.input_name}:`
        : "";

      return `Node ${nodeId} (${classType}):${inputName} ${message}${detail}`;
    });
  });
}
