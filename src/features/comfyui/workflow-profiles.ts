import type {
  ComfyUiInpaintRequest,
  ComfyUiTextToImageRequest,
  ComfyUiTextToImageWorkflowProfileId,
  ResolvedComfyUiInpaintRequest,
  ResolvedComfyUiTextToImageRequest,
} from "./types";
import { isKrea2CivitaiBaseModel } from "@/features/civitai-lora-library/base-model";

export type ComfyUiTextToImageWorkflowProfile = {
  id: ComfyUiTextToImageWorkflowProfileId;
  label: string;
  requiredNodeClasses: readonly string[];
};

export const DEFAULT_COMFYUI_ANIMA_CLIP_TYPE = "qwen_image";
export const DEFAULT_COMFYUI_ANIMA_CLIP_DEVICE = "default";
export const DEFAULT_COMFYUI_ANIMA_CLIP_NAME = "qwen_3_06b_base.safetensors";
export const DEFAULT_COMFYUI_ANIMA_VAE_NAME = "qwen_image_vae.safetensors";
export const DEFAULT_COMFYUI_ANIMA_UNET_WEIGHT_DTYPE = "default";
export const DEFAULT_COMFYUI_KREA2_CLIP_TYPE = "krea2";
export const DEFAULT_COMFYUI_KREA2_CLIP_NAME = "qwen3vl_4b_fp8_scaled.safetensors";
export const DEFAULT_COMFYUI_KREA2_VAE_NAME = "qwen_image_vae.safetensors";
export const DEFAULT_COMFYUI_KREA2_UNET_WEIGHT_DTYPE = "default";

export const COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILES = {
  default: {
    id: "default",
    label: "Illustrious/default txt2img",
    requiredNodeClasses: [
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "KSampler",
      "PreviewImage",
      "VAEDecode",
    ],
  },
  anima: {
    id: "anima",
    label: "Anima txt2img",
    requiredNodeClasses: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "PreviewImage",
      "VAEDecode",
    ],
  },
  krea2: {
    id: "krea2",
    label: "Krea 2 Turbo direct txt2img",
    requiredNodeClasses: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "SaveImage",
      "VAEDecode",
    ],
  },
} as const satisfies Record<ComfyUiTextToImageWorkflowProfileId, ComfyUiTextToImageWorkflowProfile>;

type ComfyUiWorkflowProfileRequest =
  Pick<ComfyUiTextToImageRequest | ResolvedComfyUiTextToImageRequest | ComfyUiInpaintRequest | ResolvedComfyUiInpaintRequest, "checkpointName"> &
  Partial<
    Pick<
      ComfyUiTextToImageRequest | ResolvedComfyUiTextToImageRequest | ComfyUiInpaintRequest | ResolvedComfyUiInpaintRequest,
      "modelBaseModel" | "modelStorageKind" | "workflowProfile"
    >
  >;

function hasAnimaModelMarker(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();
  return /\banima\b/i.test(text.replace(/[_-]+/g, " ")) ||
    /(?:^|[^A-Za-z0-9])(?:[Aa]nima|ANIMA)(?=[A-Z0-9])/u.test(text);
}

export function isComfyUiAnimaTextToImageRequest(
  request: ComfyUiWorkflowProfileRequest,
) {
  if (request.workflowProfile === "anima") {
    return true;
  }

  if (hasAnimaModelMarker(request.modelBaseModel)) {
    return true;
  }

  if (request.modelStorageKind === "checkpoint") {
    return false;
  }

  return hasAnimaModelMarker(request.checkpointName);
}

export function isComfyUiKrea2TextToImageRequest(
  request: ComfyUiWorkflowProfileRequest,
) {
  return request.modelStorageKind === "diffusion" && isKrea2CivitaiBaseModel(request.modelBaseModel);
}

export function resolveComfyUiTextToImageWorkflowProfile(
  request: ComfyUiWorkflowProfileRequest,
): ComfyUiTextToImageWorkflowProfile {
  if (isComfyUiKrea2TextToImageRequest(request)) {
    return COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILES.krea2;
  }

  return isComfyUiAnimaTextToImageRequest(request)
    ? COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILES.anima
    : COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILES.default;
}
