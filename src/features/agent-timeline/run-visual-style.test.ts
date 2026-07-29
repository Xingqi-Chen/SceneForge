import { describe, expect, it } from "vitest";

import {
  appendRunVisualStyleNegativeGuidance,
  buildAuthoritativeRunVisualStyleSection,
  buildRunVisualStyleLlmInstructions,
  DEFAULT_RUN_VISUAL_STYLE,
  getRunVisualStyleNegativeGuidance,
  getRunVisualStylePositiveGuidance,
  hasOpposingRunVisualStyleSignal,
  isRunVisualStyle,
  KREA2_RUN_VISUAL_STYLE_POSITIVE_GUIDANCE,
  normalizeRunVisualStyle,
  RUN_VISUAL_STYLE_NEGATIVE_GUIDANCE,
  RUN_VISUAL_STYLE_POSITIVE_GUIDANCE,
  runVisualStyles,
} from "./run-visual-style";

describe("Run visual style contract", () => {
  it("keeps the selector closed and defaults missing or invalid values to Anime", () => {
    expect(runVisualStyles).toEqual(["anime", "photoreal"]);
    expect(DEFAULT_RUN_VISUAL_STYLE).toBe("anime");
    expect(isRunVisualStyle("anime")).toBe(true);
    expect(isRunVisualStyle("photoreal")).toBe(true);
    expect(isRunVisualStyle("cinematic")).toBe(false);
    expect(normalizeRunVisualStyle(undefined)).toBe("anime");
    expect(normalizeRunVisualStyle("cinematic")).toBe("anime");
    expect(normalizeRunVisualStyle("anime", "photoreal")).toBe("anime");
  });

  it("exposes the exact positive and negative style contracts", () => {
    expect(RUN_VISUAL_STYLE_POSITIVE_GUIDANCE).toEqual({
      anime: "anime illustration, clean lineart, anime coloring, stylized character design",
      photoreal:
        "live-action photography, natural skin texture, realistic material response, physically plausible lighting, photographic camera optics",
    });
    expect(KREA2_RUN_VISUAL_STYLE_POSITIVE_GUIDANCE).toEqual({
      anime:
        "Rendered as a polished Japanese anime illustration with stylized character design, clean linework, and illustrated shading.",
      photoreal:
        "Rendered as a live-action photograph with natural human proportions, realistic skin and material response, physically plausible lighting, and photographic camera optics.",
    });
    expect(RUN_VISUAL_STYLE_NEGATIVE_GUIDANCE).toEqual({
      anime: [
        "live-action human photography",
        "documentary photograph",
        "photographic skin texture",
      ],
      photoreal: [
        "anime illustration",
        "manga",
        "cel shading",
        "cartoon character rendering",
      ],
    });
    expect(getRunVisualStylePositiveGuidance("anime")).toBe(
      RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.anime,
    );
    expect(getRunVisualStylePositiveGuidance("photoreal", "krea2")).toBe(
      KREA2_RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.photoreal,
    );
    expect(getRunVisualStyleNegativeGuidance("photoreal")).toEqual(
      RUN_VISUAL_STYLE_NEGATIVE_GUIDANCE.photoreal,
    );
  });

  it("places the authoritative guidance exactly once while retaining compatible authored detail", () => {
    const guidance = RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.anime;
    const section = buildAuthoritativeRunVisualStyleSection(
      `${guidance}, watercolor texture, ${guidance}`,
      "anime",
    );

    expect(section).toContain("watercolor texture");
    expect(section.match(new RegExp(guidance, "g"))).toHaveLength(1);
  });

  it("falls back the whole style section on a strong opposing signal", () => {
    expect(buildAuthoritativeRunVisualStyleSection(
      "watercolor texture, live-action human photography, soft paper grain",
      "anime",
    )).toBe(RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.anime);
    expect(buildAuthoritativeRunVisualStyleSection(
      "cinematic manga with cel shading and natural light",
      "photoreal",
    )).toBe(RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.photoreal);
  });

  it.each([
    "3D cartoon",
    "3-D cartoon",
    "3 d cartoon",
    "3D-cartoon-render",
    "3-D-cartoon rendering",
    "three dimensional cartoon rendered",
    "three-dimensional-cartoon-rendering",
    "semi-real illustration",
    "semi real illustration",
    "semireal illustration",
    "semi-realistic illustration",
    "semi realistic illustrative",
    "semirealistic render",
    "semi-realistic-rendering",
    "semi realistic rendered",
  ])("falls back the complete Photoreal style section for '%s'", (term) => {
    expect(hasOpposingRunVisualStyleSignal(term, "photoreal")).toBe(true);
    expect(buildAuthoritativeRunVisualStyleSection(
      `soft amber palette, ${term}, fine surface texture`,
      "photoreal",
    )).toBe(RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.photoreal);
  });

  it.each([
    "photo",
    "realistic",
    "photorealistic",
    "camera optics",
    "85mm lens",
    "soft bokeh",
    "shallow depth-of-field",
    "cinematic depth of field",
    "wide aperture and natural lens flare",
  ])("does not treat generic '%s' vocabulary as an opposing classifier", (term) => {
    expect(hasOpposingRunVisualStyleSignal(term, "anime")).toBe(false);
    expect(hasOpposingRunVisualStyleSignal(term, "photoreal")).toBe(false);
    expect(buildAuthoritativeRunVisualStyleSection(term, "anime")).toContain(term);
    expect(buildAuthoritativeRunVisualStyleSection(term, "photoreal")).toContain(term);
  });

  it("appends required negatives once without losing authored negatives", () => {
    expect(appendRunVisualStyleNegativeGuidance(
      "low quality, manga, low quality",
      "photoreal",
    )).toBe(
      "low quality, manga, anime illustration, cel shading, cartoon character rendering",
    );
  });

  it("tells LLM nodes the selector is authoritative and profile-independent", () => {
    const instructions = buildRunVisualStyleLlmInstructions("photoreal", "krea2");

    expect(instructions).toContain(
      "Selected visual style: Photoreal (photoreal). This selector is authoritative and independent from the prompt profile.",
    );
    expect(instructions).toContain(KREA2_RUN_VISUAL_STYLE_POSITIVE_GUIDANCE.photoreal);
    expect(instructions).toContain(RUN_VISUAL_STYLE_NEGATIVE_GUIDANCE.photoreal.join(", "));
    expect(instructions).toContain(
      "Generic photo, realistic, photorealistic, camera/lens, bokeh, and depth-of-field terms are not opposing-domain classifiers",
    );
  });
});
