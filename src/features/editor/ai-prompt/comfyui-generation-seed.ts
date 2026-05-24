import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

export type ComfyUiGenerationSeedMode = "random" | "fixed";

export const MAX_COMFYUI_GENERATION_IMAGE_COUNT = 16;
export const MAX_COMFYUI_GENERATION_RANDOM_SEED = 2 ** 50;
const SEED_RANGE = MAX_COMFYUI_GENERATION_RANDOM_SEED + 1;
const SEED_MODULUS = BigInt(SEED_RANGE);

export function createComfyUiGenerationSeed(random: () => number = Math.random) {
  const raw = random();
  const value = Number.isFinite(raw) ? raw : 0;
  return Math.min(MAX_COMFYUI_GENERATION_RANDOM_SEED, Math.max(0, Math.floor(value * SEED_RANGE)));
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

export function getComfyUiGenerationBatchSeed(baseSeed: number, imageIndex: number) {
  const seed = Number.isSafeInteger(baseSeed) && baseSeed >= 0 ? baseSeed : 0;
  const index = Number.isSafeInteger(imageIndex) && imageIndex > 0 ? imageIndex : 0;
  return Number((BigInt(seed) + BigInt(index)) % SEED_MODULUS);
}

export function getComfyUiGenerationBatchSeeds(baseSeed: number, imageCount: number) {
  return Array.from({ length: normalizeComfyUiGenerationImageCount(imageCount) }, (_, index) =>
    getComfyUiGenerationBatchSeed(baseSeed, index),
  );
}
