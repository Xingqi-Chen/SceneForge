import { describe, expect, it } from "vitest";

import {
  resolveTimelineFinalGenerationPolicy,
  sanitizeTimelineFinalRedrawPreset,
  timelineFinalGenerationPolicy,
} from "./final-generation-policy";

describe("timeline Final generation policy", () => {
  it("defaults missing, invalid, and numeric preset values to balanced", () => {
    for (const value of [undefined, "unknown", "__proto__", "constructor", "toString", 0.99]) {
      expect(sanitizeTimelineFinalRedrawPreset(value)).toBe("balanced");
      expect(resolveTimelineFinalGenerationPolicy({}, value)).toMatchObject({
        preset: "balanced",
        family: "fallback",
        denoise: 0.45,
      });
    }
  });

  it.each([
    ["conservative", "illustrious", 0.3],
    ["balanced", "illustrious", 0.4],
    ["strong", "illustrious", 0.5],
    ["conservative", "anima", 0.35],
    ["balanced", "anima", 0.45],
    ["strong", "anima", 0.55],
    ["conservative", "fallback", 0.35],
    ["balanced", "fallback", 0.45],
    ["strong", "fallback", 0.55],
  ] as const)("resolves %s/%s to %s", (preset, family, denoise) => {
    const context = family === "fallback"
      ? { modelBaseModel: "future-xl" }
      : { modelBaseModel: family };
    expect(resolveTimelineFinalGenerationPolicy(context, preset)).toEqual({
      version: 2,
      resizeMode: "lanczos3-exact",
      preset,
      family,
      denoise,
    });
  });

  it("publishes the complete immutable v2 mapping with balanced as default", () => {
    expect(timelineFinalGenerationPolicy).toMatchObject({
      version: 2,
      defaultPreset: "balanced",
      denoiseByPreset: {
        conservative: { illustrious: 0.3, anima: 0.35, fallback: 0.35 },
        balanced: { illustrious: 0.4, anima: 0.45, fallback: 0.45 },
        strong: { illustrious: 0.5, anima: 0.55, fallback: 0.55 },
      },
    });
  });
});
