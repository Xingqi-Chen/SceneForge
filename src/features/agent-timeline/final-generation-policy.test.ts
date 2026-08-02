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
    ["conservative", "illustrious", 2, 0.3, undefined],
    ["balanced", "illustrious", 2, 0.4, undefined],
    ["strong", "illustrious", 2, 0.5, undefined],
    ["conservative", "anima", 2, 0.35, undefined],
    ["balanced", "anima", 2, 0.45, undefined],
    ["strong", "anima", 2, 0.55, undefined],
    ["conservative", "krea2", 3, 0.12, 4],
    ["balanced", "krea2", 3, 0.18, 4],
    ["strong", "krea2", 3, 0.28, 6],
    ["conservative", "fallback", 2, 0.35, undefined],
    ["balanced", "fallback", 2, 0.45, undefined],
    ["strong", "fallback", 2, 0.55, undefined],
  ] as const)("resolves %s/%s to its versioned Final contract", (preset, family, version, denoise, steps) => {
    const context = family === "krea2"
      ? { modelBaseModel: "Krea 2", workflowProfile: "krea2" }
      : family === "fallback"
      ? { modelBaseModel: "future-xl" }
      : { modelBaseModel: family };
    const resolved = resolveTimelineFinalGenerationPolicy(context, preset);
    expect(resolved).toEqual({
      version,
      resizeMode: "lanczos3-exact",
      preset,
      family,
      denoise,
      ...(steps === undefined ? {} : { steps }),
    });
    if (family !== "krea2") expect(resolved).not.toHaveProperty("steps");
  });

  it("publishes ordinary v2 and Krea v3 mappings with balanced as default", () => {
    expect(timelineFinalGenerationPolicy).toMatchObject({
      version: 2,
      krea2Version: 3,
      krea2ReIdVersion: 4,
      defaultPreset: "balanced",
      denoiseByPreset: {
        conservative: { illustrious: 0.3, anima: 0.35, fallback: 0.35, krea2: 0.12 },
        balanced: { illustrious: 0.4, anima: 0.45, fallback: 0.45, krea2: 0.18 },
        strong: { illustrious: 0.5, anima: 0.55, fallback: 0.55, krea2: 0.28 },
      },
      krea2StepsByPreset: { conservative: 4, balanced: 4, strong: 6 },
    });
  });

  it.each(["conservative", "balanced", "strong"] as const)(
    "locks Krea2 ReID %s Final to policy v4 and eight steps while preserving preset denoise",
    (preset) => {
      const ordinary = resolveTimelineFinalGenerationPolicy(
        { modelBaseModel: "Krea 2", workflowProfile: "krea2" },
        preset,
      );
      const reId = resolveTimelineFinalGenerationPolicy(
        { modelBaseModel: "Krea 2", workflowProfile: "krea2" },
        preset,
        { krea2ReId: true },
      );

      expect(reId).toEqual({ ...ordinary, version: 4, steps: 8 });
    },
  );
});
