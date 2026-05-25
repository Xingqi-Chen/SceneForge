import type {
  ComfyUiControlNetType,
  ComfyUiControlNetUnitConfig,
  ComfyUiInpaintRequest,
  ComfyUiTextToImageRequest,
} from "./types";
import {
  COMFYUI_FACE_DETAILER_DETECTOR_MODEL_PREFERENCES,
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
} from "./face-detailer";
import { DEFAULT_COMFYUI_INPAINT_MODE } from "./inpaint";
import { normalizeComfyUiLatentImageNode } from "./latent-image-node";

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
  if (!Array.isArray(inputInfo) || !Array.isArray(inputInfo[0])) {
    return [];
  }

  return inputInfo[0].filter((value): value is string => typeof value === "string");
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

function shouldFallbackFromRequestedFaceDetailerDetectorModel(value: string | undefined) {
  return !value || normalizeOptionName(value) === normalizeOptionName(DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL);
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

  if (request.faceDetailer?.enabled) {
    if (!hasNodeInfo(objectInfo, "FaceDetailer")) {
      errors.push("FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use FaceDetailer.");
    }

    if (!hasNodeInfo(objectInfo, "UltralyticsDetectorProvider")) {
      errors.push("UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use FaceDetailer.");
    }

    const detectorModelName = request.faceDetailer.detectorModelName;
    const requestedDetectorModel = shouldFallbackFromRequestedFaceDetailerDetectorModel(detectorModelName)
      ? (
          detectorModelName
            ? findOption(detectorModelName, ultralyticsDetectorOptions)
            : null
        ) ?? findPreferredFaceDetailerDetectorModel(ultralyticsDetectorOptions)
      : detectorModelName
        ? findOption(detectorModelName, ultralyticsDetectorOptions)
        : null;

    if (!requestedDetectorModel) {
      errors.push(
        request.faceDetailer.detectorModelName
          ? `FaceDetailer detector model is not available in ComfyUI: ${request.faceDetailer.detectorModelName}`
          : "FaceDetailer detector model is not available in ComfyUI.",
      );
    } else {
      faceDetailer = {
        ...request.faceDetailer,
        detectorModelName: requestedDetectorModel,
      };
    }

    const faceSampler = findSampler(request.faceDetailer.samplerName, samplerOptions, schedulerOptions);
    const faceSamplerName = faceSampler.samplerName;
    const requestedFaceScheduler = request.faceDetailer.scheduler
      ? findOption(request.faceDetailer.scheduler, schedulerOptions)
      : null;
    const faceScheduler = faceSampler.scheduler ?? requestedFaceScheduler;

    if (request.faceDetailer.samplerName && !faceSamplerName) {
      errors.push(`FaceDetailer sampler is not available in ComfyUI: ${request.faceDetailer.samplerName}`);
    }

    if (request.faceDetailer.scheduler && !faceScheduler) {
      errors.push(`FaceDetailer scheduler is not available in ComfyUI: ${request.faceDetailer.scheduler}`);
    }

    if (faceSamplerName || faceScheduler) {
      faceDetailer = {
        ...faceDetailer,
        ...(faceSamplerName ? { samplerName: faceSamplerName } : {}),
        ...(faceScheduler ? { scheduler: faceScheduler } : {}),
      };
    }
  }

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
  const checkpointName = findOption(request.checkpointName, checkpointOptions);
  const sampler = findSampler(request.samplerName, samplerOptions, schedulerOptions);
  const samplerName = sampler.samplerName;
  const requestedScheduler = request.scheduler ? findOption(request.scheduler, schedulerOptions) : null;
  const scheduler = sampler.scheduler ?? requestedScheduler;
  const inpaintMode = request.inpaintMode ?? DEFAULT_COMFYUI_INPAINT_MODE;
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

  if (!hasNodeInfo(objectInfo, "LoadImageMask")) {
    errors.push("LoadImageMask node is not available in ComfyUI. It is required for inpaint masks.");
  }

  if (!hasNodeInfo(objectInfo, "VAEDecode")) {
    errors.push("VAEDecode node is not available in ComfyUI. It is required for inpaint output images.");
  }

  if (inpaintMode === "vae-inpaint") {
    if (!hasNodeInfo(objectInfo, "VAEEncodeForInpaint")) {
      errors.push("VAEEncodeForInpaint node is not available in ComfyUI. It is required for VAE inpaint mode.");
    }
  } else {
    if (!hasNodeInfo(objectInfo, "VAEEncode")) {
      errors.push("VAEEncode node is not available in ComfyUI. It is required for latent noise mask inpaint mode.");
    }

    if (!hasNodeInfo(objectInfo, "SetLatentNoiseMask")) {
      errors.push("SetLatentNoiseMask node is not available in ComfyUI. It is required for latent noise mask inpaint mode.");
    }
  }

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
      loras,
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
