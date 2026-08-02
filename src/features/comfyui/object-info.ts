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
import {
  DEFAULT_COMFYUI_ANIMA_CLIP_DEVICE,
  DEFAULT_COMFYUI_ANIMA_CLIP_NAME,
  DEFAULT_COMFYUI_ANIMA_CLIP_TYPE,
  DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE,
  DEFAULT_COMFYUI_ANIMA_VAE_NAME,
  DEFAULT_COMFYUI_KREA2_CLIP_NAME,
  DEFAULT_COMFYUI_KREA2_CLIP_TYPE,
  DEFAULT_COMFYUI_KREA2_UNET_WEIGHT_DTYPE,
  DEFAULT_COMFYUI_KREA2_VAE_NAME,
  resolveComfyUiTextToImageWorkflowProfile,
} from "./workflow-profiles";
import {
  getComfyUiKrea2StyleReferenceContextIssue,
  KREA2_STYLE_REFERENCE_LORA_NAME,
  KREA2_STYLE_REFERENCE_MODEL_PATCH_NODE,
  KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE,
} from "./krea2-style-reference";
import {
  ANIMA_CHARACTER_REFERENCE_APPLY_NODE,
  ANIMA_CHARACTER_REFERENCE_LOADER_NODE,
  ANIMA_CHARACTER_REFERENCE_MODEL_NAME,
} from "./anima-character-reference";

type ComfyUiObjectInfoNode = {
  input?: {
    optional?: Record<string, unknown>;
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

/**
 * The Krea Repair route intentionally uses one bounded local, tiled inpaint
 * graph. Keep this contract next to object_info validation so preflight checks
 * the inputs and enum values that buildBasicInpaintWorkflow will actually send.
 */
const KREA2_REPAIR_REQUIRED_NODE_CLASSES = [
  "UNETLoader",
  "CLIPLoader",
  "VAELoader",
  "CLIPTextEncode",
  "KSampler",
  "LoadImage",
  "LoadImageMask",
  "ImageScaleBy",
  "MaskToImage",
  "ImageToMask",
  "VAEEncodeTiled",
  "SetLatentNoiseMask",
  "VAEDecodeTiled",
  "ImageCrop",
  "CropMask",
  "FeatherMask",
  "ImageScale",
  "ImageCompositeMasked",
  "PreviewImage",
] as const;

const KREA2_REPAIR_REQUIRED_INPUTS = [
  { classType: "UNETLoader", inputNames: ["unet_name", "weight_dtype"] },
  { classType: "CLIPLoader", inputNames: ["clip_name", "type"] },
  { classType: "VAELoader", inputNames: ["vae_name"] },
  { classType: "CLIPTextEncode", inputNames: ["text"] },
  {
    classType: "KSampler",
    inputNames: [
      "seed",
      "steps",
      "cfg",
      "sampler_name",
      "scheduler",
      "denoise",
    ],
  },
  { classType: "LoadImage", inputNames: ["image"] },
  { classType: "LoadImageMask", inputNames: ["image", "channel"] },
  { classType: "ImageScaleBy", inputNames: ["upscale_method", "scale_by"] },
  { classType: "ImageToMask", inputNames: ["channel"] },
  {
    classType: "VAEEncodeTiled",
    inputNames: ["tile_size", "overlap", "temporal_size", "temporal_overlap"],
  },
  {
    classType: "VAEDecodeTiled",
    inputNames: ["tile_size", "overlap", "temporal_size", "temporal_overlap"],
  },
  { classType: "ImageCrop", inputNames: ["x", "y", "width", "height"] },
  { classType: "CropMask", inputNames: ["x", "y", "width", "height"] },
  { classType: "FeatherMask", inputNames: ["left", "top", "right", "bottom"] },
  { classType: "ImageScale", inputNames: ["upscale_method", "width", "height", "crop"] },
  {
    classType: "ImageCompositeMasked",
    inputNames: ["x", "y", "resize_source"],
  },
] as const;

/**
 * These ports are populated by edges in the repair graph. ComfyUI may declare
 * connected ports under either input.required or input.optional, but a missing
 * declaration must still fail preflight.
 */
const KREA2_REPAIR_CONNECTED_INPUTS = [
  { classType: "CLIPTextEncode", inputNames: ["clip"] },
  { classType: "KSampler", inputNames: ["model", "positive", "negative", "latent_image"] },
  { classType: "ImageScaleBy", inputNames: ["image"] },
  { classType: "MaskToImage", inputNames: ["mask"] },
  { classType: "ImageToMask", inputNames: ["image"] },
  { classType: "VAEEncodeTiled", inputNames: ["pixels", "vae"] },
  { classType: "SetLatentNoiseMask", inputNames: ["samples", "mask"] },
  { classType: "VAEDecodeTiled", inputNames: ["samples", "vae"] },
  { classType: "ImageCrop", inputNames: ["image"] },
  { classType: "CropMask", inputNames: ["mask"] },
  { classType: "FeatherMask", inputNames: ["mask"] },
  { classType: "ImageScale", inputNames: ["image"] },
  { classType: "ImageCompositeMasked", inputNames: ["destination", "source", "mask"] },
  { classType: "PreviewImage", inputNames: ["images"] },
] as const;

const KREA2_REPAIR_REQUIRED_OPTIONS = [
  {
    classType: "LoadImageMask",
    inputName: "channel",
    value: "red",
    error: "LoadImageMask red channel is not available in ComfyUI. It is required for Krea 2 Turbo repair.",
  },
  {
    classType: "ImageScaleBy",
    inputName: "upscale_method",
    value: "lanczos",
    error: "ImageScaleBy lanczos upscale method is not available in ComfyUI. It is required for high-res inpaint source images.",
  },
  {
    classType: "ImageScaleBy",
    inputName: "upscale_method",
    value: "nearest-exact",
    error: "ImageScaleBy nearest-exact upscale method is not available in ComfyUI. It is required for high-res inpaint masks.",
  },
  {
    classType: "ImageToMask",
    inputName: "channel",
    value: "red",
    error: "ImageToMask red channel is not available in ComfyUI. It is required for Krea 2 Turbo repair.",
  },
  {
    classType: "ImageScale",
    inputName: "upscale_method",
    value: "lanczos",
    error: "ImageScale lanczos upscale method is not available in ComfyUI. It is required to resize local-region inpaint patches.",
  },
  {
    classType: "ImageScale",
    inputName: "crop",
    value: "disabled",
    error: "ImageScale disabled crop mode is not available in ComfyUI. It is required for Krea 2 Turbo repair.",
  },
] as const;

const SAMPLER_ALIASES: Record<string, string> = {
  dpmpp2m: "dpmpp_2m",
  dpmpp2mcfgpp: "dpmpp_2m_cfg_pp",
  dpm2m: "dpmpp_2m",
  dpm2mcfgpp: "dpmpp_2m_cfg_pp",
  dpm2msde: "dpmpp_2m_sde",
  dpm2msdegpu: "dpmpp_2m_sde_gpu",
  dpm2msdeheun: "dpmpp_2m_sde_heun",
  dpm2msdeheungpu: "dpmpp_2m_sde_heun_gpu",
  dpmpp2msde: "dpmpp_2m_sde",
  dpmpp2msdegpu: "dpmpp_2m_sde_gpu",
  dpmpp2msdeheun: "dpmpp_2m_sde_heun",
  dpmpp2msdeheungpu: "dpmpp_2m_sde_heun_gpu",
  dpmpp2sancestralcfgpp: "dpmpp_2s_ancestral_cfg_pp",
  dpm3msde: "dpmpp_3m_sde",
  dpm3msdegpu: "dpmpp_3m_sde_gpu",
  dpmpp3msde: "dpmpp_3m_sde",
  dpmpp3msdegpu: "dpmpp_3m_sde_gpu",
  dpmsde: "dpmpp_sde",
  dpmsdegpu: "dpmpp_sde_gpu",
  dpmppsde: "dpmpp_sde",
  dpmppsdegpu: "dpmpp_sde_gpu",
  eulera: "euler_ancestral",
  euleracfgpp: "euler_ancestral_cfg_pp",
  eulerancestral: "euler_ancestral",
  eulerancestralcfgpp: "euler_ancestral_cfg_pp",
  eulercfgpp: "euler_cfg_pp",
  resmultistep: "res_multistep",
  resmultistepancestral: "res_multistep_ancestral",
  resmultistepancestralcfgpp: "res_multistep_ancestral_cfg_pp",
  resmultistepcfgpp: "res_multistep_cfg_pp",
};

const KREA2_DETAILER_REQUIRED_INPUTS = [
  ["UltralyticsDetectorProvider", ["model_name"]],
  ["FaceDetailer", [
    "image",
    "model",
    "clip",
    "vae",
    "guide_size",
    "guide_size_for",
    "max_size",
    "seed",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "positive",
    "negative",
    "denoise",
    "feather",
    "noise_mask",
    "force_inpaint",
    "bbox_threshold",
    "bbox_dilation",
    "bbox_crop_factor",
    "sam_detection_hint",
    "sam_dilation",
    "sam_threshold",
    "sam_bbox_expansion",
    "sam_mask_hint_threshold",
    "sam_mask_hint_use_negative",
    "drop_size",
    "bbox_detector",
    "wildcard",
    "cycle",
  ]],
] as const;

const KREA2_DETAILER_GRAPH_REQUIRED_INPUTS = [
  ["CLIPTextEncode", ["text", "clip"]],
  ["EmptyLatentImage", ["width", "height", "batch_size"]],
  ["KSampler", ["model", "positive", "negative", "latent_image"]],
  ["VAEDecode", ["samples", "vae"]],
  ...KREA2_DETAILER_REQUIRED_INPUTS,
  ["SaveImage", ["filename_prefix", "images"]],
] as const;

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
  if (!isRecord(nodeInfo) || !isRecord(nodeInfo.input)) {
    return [];
  }

  const requiredInputs = isRecord(nodeInfo.input.required) ? nodeInfo.input.required : {};
  const optionalInputs = isRecord(nodeInfo.input.optional) ? nodeInfo.input.optional : {};
  const inputInfo = requiredInputs[inputName] ?? optionalInputs[inputName];
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

function hasInputPort(objectInfo: unknown, classType: string, inputName: string) {
  if (!isRecord(objectInfo)) {
    return false;
  }

  const nodeInfo = objectInfo[classType];
  return isRecord(nodeInfo) &&
    isRecord(nodeInfo.input) &&
    (
      (isRecord(nodeInfo.input.required) && inputName in nodeInfo.input.required) ||
      (isRecord(nodeInfo.input.optional) && inputName in nodeInfo.input.optional)
    );
}

function hasRequiredInput(objectInfo: unknown, classType: string, inputName: string) {
  if (!isRecord(objectInfo)) {
    return false;
  }

  const nodeInfo = objectInfo[classType];
  return isRecord(nodeInfo) &&
    isRecord(nodeInfo.input) &&
    isRecord(nodeInfo.input.required) &&
    inputName in nodeInfo.input.required;
}

function hasNodeInfo(objectInfo: unknown, classType: string) {
  return isRecord(objectInfo) && isRecord(objectInfo[classType]);
}

function validateRequiredNodeClasses(
  objectInfo: unknown,
  classTypes: readonly string[],
  errors: string[],
) {
  for (const classType of classTypes) {
    if (!hasNodeInfo(objectInfo, classType)) {
      errors.push(`${classType} node is not available in ComfyUI.`);
    }
  }
}

function validateRequiredInputs(
  objectInfo: unknown,
  classType: string,
  inputNames: readonly string[],
  errors: string[],
) {
  if (!hasNodeInfo(objectInfo, classType)) {
    return;
  }

  for (const inputName of inputNames) {
    if (!hasRequiredInput(objectInfo, classType, inputName)) {
      errors.push(`${classType}.${inputName} input is not available in ComfyUI object_info.`);
    }
  }
}

function validateRequiredInputPorts(
  objectInfo: unknown,
  classType: string,
  inputNames: readonly string[],
  errors: string[],
) {
  if (!hasNodeInfo(objectInfo, classType)) {
    return;
  }

  for (const inputName of inputNames) {
    if (!hasInputPort(objectInfo, classType, inputName)) {
      errors.push(`${classType}.${inputName} input is not available in ComfyUI object_info.`);
    }
  }
}

function validateRequiredOption(
  objectInfo: unknown,
  classType: string,
  inputName: string,
  value: string,
  error: string,
  errors: string[],
) {
  if (!hasRequiredInput(objectInfo, classType, inputName)) {
    return;
  }

  if (!findOption(value, readInputOptions(objectInfo, classType, inputName))) {
    errors.push(error);
  }
}

function validateKrea2RepairObjectInfoContract(objectInfo: unknown, errors: string[]) {
  validateRequiredNodeClasses(objectInfo, KREA2_REPAIR_REQUIRED_NODE_CLASSES, errors);

  for (const { classType, inputNames } of KREA2_REPAIR_REQUIRED_INPUTS) {
    validateRequiredInputs(objectInfo, classType, inputNames, errors);
  }

  for (const { classType, inputNames } of KREA2_REPAIR_CONNECTED_INPUTS) {
    validateRequiredInputPorts(objectInfo, classType, inputNames, errors);
  }

  for (const { classType, inputName, value, error } of KREA2_REPAIR_REQUIRED_OPTIONS) {
    validateRequiredOption(objectInfo, classType, inputName, value, error, errors);
  }
}

function resolveRequiredOption({
  aliases = [],
  classType,
  errors,
  fallback,
  inputName,
  label,
  objectInfo,
  requested,
}: {
  aliases?: string[];
  classType: string;
  errors: string[];
  fallback?: string;
  inputName: string;
  label: string;
  objectInfo: unknown;
  requested: string | undefined;
}) {
  const options = readInputOptions(objectInfo, classType, inputName);
  const requestedOption = requested ? findOption(requested, options) : null;
  const aliasOption = aliases.map((alias) => findOption(alias, options)).find(Boolean) ?? null;
  const fallbackOption = fallback ? findOption(fallback, options) : null;
  const resolved = requestedOption ?? aliasOption ?? (!requested ? fallbackOption ?? options[0] ?? null : null);

  if (!resolved) {
    errors.push(requested ? `${label} is not available in ComfyUI: ${requested}` : `${label} is not available in ComfyUI.`);
    return requested ?? fallback;
  }

  return resolved;
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

function getMissingCharacterReferenceNodes(
  reference: NonNullable<ComfyUiTextToImageRequest["characterReferences"]>[number],
  objectInfo: unknown,
) {
  const missingNodes: string[] = [];

  if (!hasNodeInfo(objectInfo, "LoadImage")) {
    missingNodes.push("LoadImage");
  }

  if (reference.images.length > 1 && !hasNodeInfo(objectInfo, "ImageBatch")) {
    missingNodes.push("ImageBatch");
  }

  if (!hasNodeInfo(objectInfo, "IPAdapterAdvanced")) {
    missingNodes.push("IPAdapterAdvanced");
  }

  const loaderNode = reference.mode === "faceid" ? "IPAdapterUnifiedLoaderFaceID" : "IPAdapterUnifiedLoader";
  if (!hasNodeInfo(objectInfo, loaderNode)) {
    missingNodes.push(loaderNode);
  }

  return missingNodes;
}

function validateAnimaCharacterReferenceNodes(
  references: ComfyUiTextToImageRequest["characterReferences"],
  objectInfo: unknown,
  errors: string[],
) {
  const enabledReferences = (references ?? []).filter((reference) => reference.enabled !== false);
  if (enabledReferences.length === 0) return;

  const requiredNodeClasses = [
    "LoadImage",
    ANIMA_CHARACTER_REFERENCE_LOADER_NODE,
    ANIMA_CHARACTER_REFERENCE_APPLY_NODE,
    ...(enabledReferences.some((reference) => reference.images.length > 1) ? ["ImageBatch"] : []),
  ];
  const missingNodes = requiredNodeClasses.filter((classType) => !hasNodeInfo(objectInfo, classType));
  if (missingNodes.length > 0) {
    errors.push(
      `Anima character references require LuciferTC9527/ComfyUI-Anima_IP-Adapter. Missing ComfyUI nodes: ${missingNodes.join(", ")}. Install or update the plugin, then restart ComfyUI.`,
    );
  }

  validateRequiredInputs(objectInfo, "LoadImage", ["image"], errors);
  if (enabledReferences.some((reference) => reference.images.length > 1)) {
    validateRequiredInputs(objectInfo, "ImageBatch", ["image1", "image2"], errors);
  }
  validateRequiredInputs(
    objectInfo,
    ANIMA_CHARACTER_REFERENCE_LOADER_NODE,
    ["ip_adapter_name", "auto_download"],
    errors,
  );
  validateRequiredInputs(
    objectInfo,
    ANIMA_CHARACTER_REFERENCE_APPLY_NODE,
    [
      "model",
      "ip_adapter",
      "ref_image",
      "strength",
      "ref_image_size",
      "siglip_layer",
      "ip_cfg_scale",
      "ip_cfg_separate",
      "gray_null",
      "use_lora",
    ],
    errors,
  );

  if (hasNodeInfo(objectInfo, ANIMA_CHARACTER_REFERENCE_LOADER_NODE) &&
      !readInputOptions(objectInfo, ANIMA_CHARACTER_REFERENCE_LOADER_NODE, "ip_adapter_name")
        .includes(ANIMA_CHARACTER_REFERENCE_MODEL_NAME)) {
    errors.push(
      `Anima character-reference adapter is not available in ComfyUI: ${ANIMA_CHARACTER_REFERENCE_MODEL_NAME}. Place the exact file in ComfyUI/models/ipadapter/ and restart ComfyUI.`,
    );
  }
}

function validateKrea2StyleReferenceNodes(
  request: ComfyUiTextToImageRequest,
  objectInfo: unknown,
  errors: string[],
) {
  const reference = request.krea2StyleReference;
  if (!reference) {
    return;
  }

  const contextIssue = getComfyUiKrea2StyleReferenceContextIssue(request);
  if (contextIssue) {
    errors.push(contextIssue);
    return;
  }

  validateRequiredNodeClasses(objectInfo, [
    "LoadImage",
    "LoraLoaderModelOnly",
    KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE,
    KREA2_STYLE_REFERENCE_MODEL_PATCH_NODE,
  ], errors);
  validateRequiredInputs(objectInfo, "LoadImage", ["image"], errors);
  validateRequiredInputs(objectInfo, "LoraLoaderModelOnly", ["model", "lora_name", "strength_model"], errors);
  validateRequiredInputs(objectInfo, KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE, ["clip", "prompt"], errors);
  validateRequiredInputs(objectInfo, KREA2_STYLE_REFERENCE_MODEL_PATCH_NODE, ["model", "kv_cache"], errors);

  for (const inputName of ["vae", "image1"] as const) {
    if (hasNodeInfo(objectInfo, KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE) &&
        !hasInputPort(objectInfo, KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE, inputName)) {
      errors.push(`${KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE}.${inputName} input is not available in ComfyUI object_info.`);
    }
  }
  if (reference.styleImageName && reference.characterImageName &&
      hasNodeInfo(objectInfo, KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE) &&
      !hasInputPort(objectInfo, KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE, "image2")) {
    errors.push(`${KREA2_STYLE_REFERENCE_TEXT_ENCODE_NODE}.image2 input is not available in ComfyUI object_info for dual style and character references.`);
  }

  const loraName = reference.loraName ?? KREA2_STYLE_REFERENCE_LORA_NAME;
  if (loraName !== KREA2_STYLE_REFERENCE_LORA_NAME) {
    errors.push("Krea style reference must use the verified krea2_style_reference.safetensors adapter file.");
    return;
  }
  if (!findOption(loraName, readInputOptions(objectInfo, "LoraLoaderModelOnly", "lora_name"))) {
    errors.push(`Krea style-reference adapter is not available in ComfyUI: ${loraName}`);
  }
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

function validateKrea2DetailerGraphAgainstObjectInfo({
  errors,
  objectInfo,
  usesImg2ImgSource,
}: {
  errors: string[];
  objectInfo: unknown;
  usesImg2ImgSource: boolean;
}) {
  for (const [classType, inputNames] of KREA2_DETAILER_GRAPH_REQUIRED_INPUTS) {
    if (usesImg2ImgSource && classType === "EmptyLatentImage") {
      continue;
    }
    validateRequiredInputs(objectInfo, classType, inputNames, errors);
  }
}

function validateKrea2StyleReferenceModelPatch(
  request: ComfyUiInpaintRequest,
  objectInfo: unknown,
  errors: string[],
) {
  const descriptor = request.krea2StyleReferenceDescriptor;
  if (!descriptor) return;
  const contextIssue = getComfyUiKrea2StyleReferenceContextIssue(request);
  if (contextIssue) {
    errors.push(contextIssue);
    return;
  }
  validateRequiredNodeClasses(objectInfo, [
    "LoraLoaderModelOnly",
    KREA2_STYLE_REFERENCE_MODEL_PATCH_NODE,
  ], errors);
  validateRequiredInputs(objectInfo, "LoraLoaderModelOnly", ["model", "lora_name", "strength_model"], errors);
  validateRequiredInputs(objectInfo, KREA2_STYLE_REFERENCE_MODEL_PATCH_NODE, ["model", "kv_cache"], errors);
  if (descriptor.loraName !== KREA2_STYLE_REFERENCE_LORA_NAME) {
    errors.push("Krea Repair must use the verified krea2_style_reference.safetensors adapter file.");
  } else if (!findOption(
    descriptor.loraName,
    readInputOptions(objectInfo, "LoraLoaderModelOnly", "lora_name"),
  )) {
    errors.push(`Krea style-reference adapter is not available in ComfyUI: ${descriptor.loraName}`);
  }
}

function validateKrea2DetailerInputsAgainstObjectInfo(objectInfo: unknown, errors: string[]) {
  for (const [classType, inputNames] of KREA2_DETAILER_REQUIRED_INPUTS) {
    validateRequiredInputs(objectInfo, classType, inputNames, errors);
  }
}

function resolveAnimaProfileObjectInfoOptions({
  errors,
  objectInfo,
  request,
}: {
  errors: string[];
  objectInfo: unknown;
  request: Pick<ComfyUiTextToImageRequest | ComfyUiInpaintRequest, "checkpointName"> &
    Partial<Pick<ComfyUiTextToImageRequest | ComfyUiInpaintRequest, "checkpointNameAliases">>;
}) {
  const unetName = resolveRequiredOption({
    aliases: request.checkpointNameAliases,
    classType: "UNETLoader",
    errors,
    inputName: "unet_name",
    label: "Anima UNET model",
    objectInfo,
    requested: request.checkpointName,
  });
  const unetWeightDtype = resolveRequiredOption({
    classType: "UNETLoader",
    errors,
    fallback: DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE,
    inputName: "weight_dtype",
    label: "Anima UNET weight dtype",
    objectInfo,
    requested: DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE,
  });
  const clipName = resolveRequiredOption({
    classType: "CLIPLoader",
    errors,
    fallback: DEFAULT_COMFYUI_ANIMA_CLIP_NAME,
    inputName: "clip_name",
    label: "Anima CLIP model",
    objectInfo,
    requested: DEFAULT_COMFYUI_ANIMA_CLIP_NAME,
  });
  resolveRequiredOption({
    classType: "CLIPLoader",
    errors,
    inputName: "type",
    label: "Anima CLIP type",
    objectInfo,
    requested: DEFAULT_COMFYUI_ANIMA_CLIP_TYPE,
  });
  const clipDevice = hasInputPort(objectInfo, "CLIPLoader", "device")
    ? resolveRequiredOption({
        classType: "CLIPLoader",
        errors,
        fallback: DEFAULT_COMFYUI_ANIMA_CLIP_DEVICE,
        inputName: "device",
        label: "Anima CLIP device",
        objectInfo,
        requested: DEFAULT_COMFYUI_ANIMA_CLIP_DEVICE,
      })
    : undefined;
  const vaeName = resolveRequiredOption({
    classType: "VAELoader",
    errors,
    fallback: DEFAULT_COMFYUI_ANIMA_VAE_NAME,
    inputName: "vae_name",
    label: "Anima VAE model",
    objectInfo,
    requested: DEFAULT_COMFYUI_ANIMA_VAE_NAME,
  });

  return {
    clipDevice,
    clipName,
    unetName,
    unetWeightDtype,
    vaeName,
  };
}

function resolveKrea2ProfileObjectInfoOptions({
  errors,
  objectInfo,
  request,
}: {
  errors: string[];
  objectInfo: unknown;
  request: Pick<ComfyUiTextToImageRequest | ComfyUiInpaintRequest, "checkpointName"> &
    Partial<Pick<ComfyUiTextToImageRequest | ComfyUiInpaintRequest, "checkpointNameAliases">>;
}) {
  const unetName = resolveRequiredOption({
    aliases: request.checkpointNameAliases,
    classType: "UNETLoader",
    errors,
    inputName: "unet_name",
    label: "Krea 2 UNET model",
    objectInfo,
    requested: request.checkpointName,
  });
  const unetWeightDtype = resolveRequiredOption({
    classType: "UNETLoader",
    errors,
    fallback: DEFAULT_COMFYUI_KREA2_UNET_WEIGHT_DTYPE,
    inputName: "weight_dtype",
    label: "Krea 2 UNET weight dtype",
    objectInfo,
    requested: DEFAULT_COMFYUI_KREA2_UNET_WEIGHT_DTYPE,
  });
  const clipName = resolveRequiredOption({
    classType: "CLIPLoader",
    errors,
    fallback: DEFAULT_COMFYUI_KREA2_CLIP_NAME,
    inputName: "clip_name",
    label: "Krea 2 CLIP model",
    objectInfo,
    requested: DEFAULT_COMFYUI_KREA2_CLIP_NAME,
  });
  resolveRequiredOption({
    classType: "CLIPLoader",
    errors,
    inputName: "type",
    label: "Krea 2 CLIP type",
    objectInfo,
    requested: DEFAULT_COMFYUI_KREA2_CLIP_TYPE,
  });
  const vaeName = resolveRequiredOption({
    classType: "VAELoader",
    errors,
    fallback: DEFAULT_COMFYUI_KREA2_VAE_NAME,
    inputName: "vae_name",
    label: "Krea 2 VAE model",
    objectInfo,
    requested: DEFAULT_COMFYUI_KREA2_VAE_NAME,
  });

  return { clipName, unetName, unetWeightDtype, vaeName };
}

export function validateComfyUiRequestAgainstObjectInfo(
  request: ComfyUiTextToImageRequest,
  objectInfo: unknown,
): ComfyUiRequestObjectInfoValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const profile = resolveComfyUiTextToImageWorkflowProfile(request);
  const isAnimaProfile = profile.id === "anima";
  const isKrea2Profile = profile.id === "krea2";
  const usesImg2ImgSource = Boolean(request.imageName || request.sourceImageDataUrl);
  const requiredNodeClasses = usesImg2ImgSource
    ? profile.requiredNodeClasses.filter((classType) => classType !== "EmptyLatentImage")
    : profile.requiredNodeClasses;
  validateRequiredNodeClasses(objectInfo, requiredNodeClasses, errors);
  validateRequiredInputs(objectInfo, "KSampler", ["sampler_name", "scheduler"], errors);

  if (isAnimaProfile || isKrea2Profile) {
    validateRequiredInputs(objectInfo, "UNETLoader", ["unet_name", "weight_dtype"], errors);
    validateRequiredInputs(objectInfo, "CLIPLoader", ["clip_name", "type"], errors);
    validateRequiredInputs(objectInfo, "VAELoader", ["vae_name"], errors);
  } else {
    validateRequiredInputs(objectInfo, "CheckpointLoaderSimple", ["ckpt_name"], errors);
  }

  const checkpointOptions = readInputOptions(objectInfo, "CheckpointLoaderSimple", "ckpt_name");
  const loraOptions = readInputOptions(
    objectInfo,
    isKrea2Profile ? "LoraLoaderModelOnly" : "LoraLoader",
    "lora_name",
  );
  const samplerOptions = readInputOptions(objectInfo, "KSampler", "sampler_name");
  const schedulerOptions = readInputOptions(objectInfo, "KSampler", "scheduler");
  const ultralyticsDetectorOptions = readInputOptions(objectInfo, "UltralyticsDetectorProvider", "model_name");
  const controlNetOptions = readInputOptions(objectInfo, "ControlNetLoader", "control_net_name");
  const checkpointName = findOption(request.checkpointName, checkpointOptions);
  const animaOptions = isAnimaProfile
    ? resolveAnimaProfileObjectInfoOptions({ errors, objectInfo, request })
    : undefined;
  const krea2Options = isKrea2Profile
    ? resolveKrea2ProfileObjectInfoOptions({ errors, objectInfo, request })
    : undefined;
  const sampler = findSampler(request.samplerName, samplerOptions, schedulerOptions);
  const samplerName = sampler.samplerName;
  const requestedScheduler = request.scheduler ? findOption(request.scheduler, schedulerOptions) : null;
  const scheduler = sampler.scheduler ?? requestedScheduler;
  const requestedLatentImageNode = normalizeComfyUiLatentImageNode(request.latentImageNode);
  const latentImageNode = isAnimaProfile || isKrea2Profile
    ? "EmptyLatentImage"
    : requestedLatentImageNode ?? "EmptyLatentImage";
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

  if ((request.loras ?? []).length > 0 && !hasNodeInfo(objectInfo, isKrea2Profile ? "LoraLoaderModelOnly" : "LoraLoader")) {
    errors.push(
      isKrea2Profile
        ? "LoraLoaderModelOnly node is not available in ComfyUI. It is required when Krea LoRAs are enabled."
        : "LoraLoader node is not available in ComfyUI. It is required when LoRAs are enabled.",
    );
  }
  if (isKrea2Profile && (request.loras ?? []).length > 0) {
    validateRequiredInputs(
      objectInfo,
      "LoraLoaderModelOnly",
      ["model", "lora_name", "strength_model"],
      errors,
    );
  }

  if (!isAnimaProfile && !isKrea2Profile && !checkpointName) {
    errors.push(`Checkpoint is not available in ComfyUI: ${request.checkpointName}`);
  }

  if (request.samplerName && !samplerName) {
    errors.push(`Sampler is not available in ComfyUI: ${request.samplerName}`);
  }

  if (request.scheduler && !scheduler) {
    errors.push(`Scheduler is not available in ComfyUI: ${request.scheduler}`);
  }

  if (request.latentImageNode && !requestedLatentImageNode) {
    errors.push(`Latent image node is not supported by SceneForge: ${request.latentImageNode}`);
  }

  if (!usesImg2ImgSource && latentImageNode && !hasNodeInfo(objectInfo, latentImageNode)) {
    errors.push(`Latent image node is not available in ComfyUI: ${latentImageNode}`);
  }

  if (usesImg2ImgSource) {
    if (!hasNodeInfo(objectInfo, "LoadImage")) {
      errors.push("LoadImage node is not available in ComfyUI. It is required for img2img source images.");
    }

    if (!hasNodeInfo(objectInfo, "ImageScale")) {
      errors.push("ImageScale node is not available in ComfyUI. It is required to resize img2img source images.");
    }

    if (!hasNodeInfo(objectInfo, "VAEEncode")) {
      errors.push("VAEEncode node is not available in ComfyUI. It is required to encode img2img source images.");
    }

    validateRequiredInputs(objectInfo, "LoadImage", ["image"], errors);
    validateRequiredInputs(objectInfo, "ImageScale", ["image", "upscale_method", "width", "height", "crop"], errors);
    validateRequiredInputs(objectInfo, "VAEEncode", ["pixels", "vae"], errors);

    const imageScaleMethodOptions = readInputOptions(objectInfo, "ImageScale", "upscale_method");
    if (imageScaleMethodOptions.length > 0 && !findOption("lanczos", imageScaleMethodOptions)) {
      errors.push("ImageScale lanczos upscale method is not available in ComfyUI. It is required for img2img source images.");
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

  if (isKrea2Profile && (request.faceDetailer?.enabled || request.handDetailer?.enabled)) {
    validateKrea2DetailerGraphAgainstObjectInfo({ errors, objectInfo, usesImg2ImgSource });
  }

  let controlNets = getRequestControlNetUnits(request);
  let characterReferences = request.characterReferences ?? [];
  const strictCharacterReferences = request.strictCharacterReferences === true;
  if (isKrea2Profile) {
    if (controlNets.some((unit) => unit.enabled)) {
      errors.push("Krea 2 Turbo does not support ControlNet.");
    }
    if (characterReferences.some((reference) => reference.enabled !== false)) {
      errors.push("Krea 2 Turbo does not support entity or character references.");
    }
    validateKrea2StyleReferenceNodes(request, objectInfo, errors);
  }
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

  if (isAnimaProfile) {
    validateAnimaCharacterReferenceNodes(characterReferences, objectInfo, errors);
  } else if (!isKrea2Profile) {
    characterReferences = characterReferences.map((reference) => {
      if (reference.enabled === false) {
        return reference;
      }

      const missingNodes = getMissingCharacterReferenceNodes(reference, objectInfo);
      if (missingNodes.length === 0) {
        return reference;
      }

      if (strictCharacterReferences) {
        errors.push(
          `Character reference "${reference.name}" requires ComfyUI nodes: ${missingNodes.join(", ")}. Install ComfyUI_IPAdapter_plus before queueing this Run.`,
        );
        return reference;
      }

      warnings.push(
        `Character reference "${reference.name}" was disabled because ComfyUI is missing nodes: ${missingNodes.join(", ")}. Install ComfyUI_IPAdapter_plus to enable character consistency.`,
      );

      return {
        ...reference,
        enabled: false,
      };
    });
  }

  validateDimension(request.width, "width", latentImageNode ?? "EmptyLatentImage", errors);
  validateDimension(request.height, "height", latentImageNode ?? "EmptyLatentImage", errors);
  if (isKrea2Profile && request.width !== undefined && request.width % 16 !== 0) {
    errors.push("width must be divisible by 16 for Krea 2 Turbo without aspect-ratio rounding.");
  }
  if (isKrea2Profile && request.height !== undefined && request.height % 16 !== 0) {
    errors.push("height must be divisible by 16 for Krea 2 Turbo without aspect-ratio rounding.");
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
      workflowProfile: profile.id,
      checkpointName: isAnimaProfile
        ? animaOptions?.unetName ?? request.checkpointName
        : isKrea2Profile
          ? krea2Options?.unetName ?? request.checkpointName
          : checkpointName ?? request.checkpointName,
      clipName: isAnimaProfile
        ? animaOptions?.clipName
        : isKrea2Profile ? krea2Options?.clipName : request.clipName,
      clipDevice: isAnimaProfile ? animaOptions?.clipDevice : request.clipDevice,
      vaeName: isAnimaProfile
        ? animaOptions?.vaeName
        : isKrea2Profile ? krea2Options?.vaeName : request.vaeName,
      unetWeightDtype: isAnimaProfile
        ? animaOptions?.unetWeightDtype
        : isKrea2Profile ? krea2Options?.unetWeightDtype : request.unetWeightDtype,
      samplerName: samplerName ?? request.samplerName,
      scheduler: scheduler ?? request.scheduler,
      latentImageNode: latentImageNode ?? request.latentImageNode,
      faceDetailer,
      handDetailer,
      controlNets,
      characterReferences,
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
  const profile = resolveComfyUiTextToImageWorkflowProfile(request);
  const isAnimaProfile = profile.id === "anima";
  const isKrea2Profile = profile.id === "krea2";
  if (isKrea2Profile) {
    validateKrea2RepairObjectInfoContract(objectInfo, errors);
    validateKrea2StyleReferenceModelPatch(request, objectInfo, errors);
  } else {
    validateRequiredNodeClasses(
      objectInfo,
      isAnimaProfile
        ? ["UNETLoader", "CLIPLoader", "VAELoader", "CLIPTextEncode", "KSampler", "PreviewImage"]
        : ["CheckpointLoaderSimple", "CLIPTextEncode", "KSampler", "PreviewImage"],
      errors,
    );
    validateRequiredInputs(objectInfo, "KSampler", ["sampler_name", "scheduler"], errors);
  }

  if (isAnimaProfile) {
    validateRequiredInputs(objectInfo, "UNETLoader", ["unet_name", "weight_dtype"], errors);
    validateRequiredInputs(objectInfo, "CLIPLoader", ["clip_name", "type"], errors);
    validateRequiredInputs(objectInfo, "VAELoader", ["vae_name"], errors);
  } else if (!isKrea2Profile) {
    validateRequiredInputs(objectInfo, "CheckpointLoaderSimple", ["ckpt_name"], errors);
  }

  const checkpointOptions = readInputOptions(objectInfo, "CheckpointLoaderSimple", "ckpt_name");
  const loraOptions = readInputOptions(objectInfo, isKrea2Profile ? "LoraLoaderModelOnly" : "LoraLoader", "lora_name");
  const samplerOptions = readInputOptions(objectInfo, "KSampler", "sampler_name");
  const schedulerOptions = readInputOptions(objectInfo, "KSampler", "scheduler");
  const ultralyticsDetectorOptions = readInputOptions(objectInfo, "UltralyticsDetectorProvider", "model_name");
  const imageScaleByMethodOptions = readInputOptions(objectInfo, "ImageScaleBy", "upscale_method");
  const imageScaleMethodOptions = readInputOptions(objectInfo, "ImageScale", "upscale_method");
  const upscaleModelOptions = readInputOptions(objectInfo, "UpscaleModelLoader", "model_name");
  const checkpointName = findOption(request.checkpointName, checkpointOptions);
  const animaOptions = isAnimaProfile
    ? resolveAnimaProfileObjectInfoOptions({ errors, objectInfo, request })
    : undefined;
  const krea2Options = isKrea2Profile
    ? resolveKrea2ProfileObjectInfoOptions({ errors, objectInfo, request })
    : undefined;
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

  if (!isAnimaProfile && !isKrea2Profile && !checkpointName) {
    errors.push(`Checkpoint is not available in ComfyUI: ${request.checkpointName}`);
  }

  if (isKrea2Profile && (request.loras ?? []).length > 0) {
    if (!hasNodeInfo(objectInfo, "LoraLoaderModelOnly")) {
      errors.push("LoraLoaderModelOnly node is not available in ComfyUI. It is required when Krea LoRAs are enabled.");
    }
    validateRequiredInputs(objectInfo, "LoraLoaderModelOnly", ["model", "lora_name", "strength_model"], errors);
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

  if (isKrea2Profile) {
    if (request.faceDetailer?.enabled || request.handDetailer?.enabled) {
      validateKrea2DetailerInputsAgainstObjectInfo(objectInfo, errors);
    }
    const imageWidth = request.imageWidth;
    const imageHeight = request.imageHeight;
    if (typeof imageWidth !== "number" || typeof imageHeight !== "number" ||
        !Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) ||
        imageWidth < 16 || imageHeight < 16 || imageWidth % 16 !== 0 || imageHeight % 16 !== 0) {
      errors.push("Krea 2 Turbo repair source dimensions must be exact 16-pixel-aligned integers.");
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
      workflowProfile: profile.id,
      checkpointName: isAnimaProfile
        ? animaOptions?.unetName ?? request.checkpointName
        : isKrea2Profile ? krea2Options?.unetName ?? request.checkpointName : checkpointName ?? request.checkpointName,
      clipName: isAnimaProfile ? animaOptions?.clipName : isKrea2Profile ? krea2Options?.clipName : request.clipName,
      clipDevice: isAnimaProfile ? animaOptions?.clipDevice : request.clipDevice,
      vaeName: isAnimaProfile ? animaOptions?.vaeName : isKrea2Profile ? krea2Options?.vaeName : request.vaeName,
      unetWeightDtype: isAnimaProfile
        ? animaOptions?.unetWeightDtype
        : isKrea2Profile ? krea2Options?.unetWeightDtype : request.unetWeightDtype,
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

export function readComfyUiKSamplerOptions(objectInfo: unknown) {
  return {
    samplers: readInputOptions(objectInfo, "KSampler", "sampler_name"),
    schedulers: readInputOptions(objectInfo, "KSampler", "scheduler"),
  };
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
