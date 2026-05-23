import { describe, expect, it } from "vitest";

import {
  createComfyUiGenerationSeed,
  getInitialComfyUiGenerationSeedMode,
  normalizeComfyUiGenerationImageCount,
  resolveComfyUiGenerationSeed,
} from "./comfyui-generation-seed";

describe("ComfyUI generation seed mode", () => {
  it("defaults to random when no seed was suggested", () => {
    expect(
      getInitialComfyUiGenerationSeedMode({
        checkpointName: "model.safetensors",
        positivePrompt: "portrait",
      }),
    ).toBe("random");
  });

  it("defaults to fixed when a seed was provided", () => {
    expect(
      getInitialComfyUiGenerationSeedMode({
        checkpointName: "model.safetensors",
        positivePrompt: "portrait",
        seed: 123,
      }),
    ).toBe("fixed");
  });

  it("creates safe integer seeds", () => {
    expect(createComfyUiGenerationSeed(() => 0)).toBe(0);
    expect(createComfyUiGenerationSeed(() => 0.5)).toBe(Math.floor(Number.MAX_SAFE_INTEGER * 0.5));
  });

  it("randomizes only in random mode", () => {
    expect(resolveComfyUiGenerationSeed({ currentSeed: 123, mode: "fixed", random: () => 0.25 })).toBe(123);
    expect(resolveComfyUiGenerationSeed({ currentSeed: 123, mode: "random", random: () => 0.25 })).toBe(
      Math.floor(Number.MAX_SAFE_INTEGER * 0.25),
    );
  });

  it("clamps image counts to the supported UI range", () => {
    expect(normalizeComfyUiGenerationImageCount(0)).toBe(1);
    expect(normalizeComfyUiGenerationImageCount(3.4)).toBe(3);
    expect(normalizeComfyUiGenerationImageCount(999)).toBe(16);
  });

  it("leaves batch image count separate from seed resolution", () => {
    expect(resolveComfyUiGenerationSeed({ currentSeed: 123, mode: "fixed", random: () => 0 })).toBe(123);
  });
});
