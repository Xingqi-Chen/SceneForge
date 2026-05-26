export const COMFYUI_INPAINT_MODE_OPTIONS = [
  {
    label: "Latent noise mask",
    value: "latent-noise-mask",
  },
  {
    label: "VAE inpaint",
    value: "vae-inpaint",
  },
] as const;

export type ComfyUiInpaintMode = (typeof COMFYUI_INPAINT_MODE_OPTIONS)[number]["value"];

export const DEFAULT_COMFYUI_INPAINT_MODE: ComfyUiInpaintMode = "latent-noise-mask";
export const DEFAULT_COMFYUI_INPAINT_DENOISE = 0.65;
export const DEFAULT_COMFYUI_INPAINT_GROW_MASK_BY = 6;
export const MIN_COMFYUI_VAE_INPAINT_DENOISE = 0.55;

export function normalizeComfyUiInpaintMode(value: unknown): ComfyUiInpaintMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return COMFYUI_INPAINT_MODE_OPTIONS.find((option) => option.value === trimmed)?.value;
}

export function normalizeComfyUiInpaintDenoiseForMode(denoise: number, mode: ComfyUiInpaintMode) {
  const clamped = Math.min(1, Math.max(0, denoise));
  return mode === "vae-inpaint" ? Math.max(MIN_COMFYUI_VAE_INPAINT_DENOISE, clamped) : clamped;
}
