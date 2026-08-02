import type { ComfyUiAnimaCharacterReferenceAdapterConfig } from "./types";

export const ANIMA_CHARACTER_REFERENCE_LOADER_NODE = "AnimaIPAdapterLoader";
export const ANIMA_CHARACTER_REFERENCE_APPLY_NODE = "AnimaIPAdapterApply";
export const ANIMA_CHARACTER_REFERENCE_MODEL_NAME =
  "ip_adapter-Character_Reference-10.safetensors";

/**
 * SceneForge owns this fixed request contract for Anima character identity.
 * SigLIP2 remains plugin-managed storage and is intentionally not exposed as a
 * workflow input or an automatic network download.
 */
export const COMFYUI_ANIMA_CHARACTER_REFERENCE_ADAPTER = {
  modelName: ANIMA_CHARACTER_REFERENCE_MODEL_NAME,
  autoDownload: false,
  defaultStrength: 0.8,
  refImageSize: 512,
  siglipLayer: -1,
  ipCfgScale: 4,
  ipCfgSeparate: false,
  grayNull: false,
  useLora: true,
} as const satisfies ComfyUiAnimaCharacterReferenceAdapterConfig;
