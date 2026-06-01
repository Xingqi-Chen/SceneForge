import type {
  ComfyUiTextToImageRequest,
  ComfyUiTextToImageWorkflowProfileId,
  ResolvedComfyUiTextToImageRequest,
} from "./types";

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
} as const satisfies Record<ComfyUiTextToImageWorkflowProfileId, ComfyUiTextToImageWorkflowProfile>;

function hasAnimaModelMarker(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();
  return /\banima\b/i.test(text.replace(/[_-]+/g, " ")) ||
    /(?:^|[^A-Za-z0-9])(?:[Aa]nima|ANIMA)(?=[A-Z0-9])/u.test(text);
}

export function isComfyUiAnimaTextToImageRequest(
  request: Pick<ComfyUiTextToImageRequest | ResolvedComfyUiTextToImageRequest, "checkpointName"> &
    Partial<Pick<ComfyUiTextToImageRequest | ResolvedComfyUiTextToImageRequest, "modelBaseModel" | "modelStorageKind">>,
) {
  if (hasAnimaModelMarker(request.modelBaseModel)) {
    return true;
  }

  if (request.modelStorageKind === "checkpoint") {
    return false;
  }

  return hasAnimaModelMarker(request.checkpointName);
}

export function resolveComfyUiTextToImageWorkflowProfile(
  request: Pick<ComfyUiTextToImageRequest | ResolvedComfyUiTextToImageRequest, "checkpointName"> &
    Partial<Pick<ComfyUiTextToImageRequest | ResolvedComfyUiTextToImageRequest, "modelBaseModel" | "modelStorageKind">>,
): ComfyUiTextToImageWorkflowProfile {
  return isComfyUiAnimaTextToImageRequest(request)
    ? COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILES.anima
    : COMFYUI_TEXT_TO_IMAGE_WORKFLOW_PROFILES.default;
}
