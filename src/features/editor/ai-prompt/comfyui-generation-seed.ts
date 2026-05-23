import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

export type ComfyUiGenerationSeedMode = "random" | "fixed";

export const MAX_COMFYUI_GENERATION_IMAGE_COUNT = 16;
const SEED_UPPER_BOUND = Number.MAX_SAFE_INTEGER;

export function createComfyUiGenerationSeed(random: () => number = Math.random) {
  return Math.floor(random() * SEED_UPPER_BOUND);
}

export function normalizeComfyUiGenerationImageCount(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_COMFYUI_GENERATION_IMAGE_COUNT, Math.max(1, Math.round(value)));
}

export function getInitialComfyUiGenerationSeedMode(request: ComfyUiTextToImageRequest): ComfyUiGenerationSeedMode {
  return request.seed === undefined ? "random" : "fixed";
}

export function resolveComfyUiGenerationSeed(input: {
  currentSeed: number;
  mode: ComfyUiGenerationSeedMode;
  random?: () => number;
}) {
  return input.mode === "random" ? createComfyUiGenerationSeed(input.random) : input.currentSeed;
}
