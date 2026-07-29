export const runVisualStyles = ["anime", "photoreal"] as const;

export type RunVisualStyle = (typeof runVisualStyles)[number];

export const DEFAULT_RUN_VISUAL_STYLE: RunVisualStyle = "anime";

export const RUN_VISUAL_STYLE_POSITIVE_GUIDANCE = {
  anime: "anime illustration, clean lineart, anime coloring, stylized character design",
  photoreal:
    "live-action photography, natural skin texture, realistic material response, physically plausible lighting, photographic camera optics",
} as const satisfies Record<RunVisualStyle, string>;

export const KREA2_RUN_VISUAL_STYLE_POSITIVE_GUIDANCE = {
  anime:
    "Rendered as a polished Japanese anime illustration with stylized character design, clean linework, and illustrated shading.",
  photoreal:
    "Rendered as a live-action photograph with natural human proportions, realistic skin and material response, physically plausible lighting, and photographic camera optics.",
} as const satisfies Record<RunVisualStyle, string>;

export const RUN_VISUAL_STYLE_NEGATIVE_GUIDANCE = {
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
} as const satisfies Record<RunVisualStyle, readonly string[]>;

const OPPOSING_VISUAL_STYLE_SIGNAL = {
  anime:
    /\b(?:live[\s-]*action\s+human\s+photography|documentary\s+photograph|photographic\s+skin\s+texture)\b/i,
  photoreal:
    /\b(?:anime\s+illustration|manga|cel[\s-]*shad(?:ing|ed)|cartoon\s+character\s+rendering|(?:3[\s-]*d(?:imensional)?|three[\s-]*dimensional)[\s-]+cartoon(?:[\s-]+render(?:ing|ed)?)?|semi[\s-]*(?:real|realistic)[\s-]+(?:illustration|illustrative|render(?:ing|ed)?))\b/i,
} as const satisfies Record<RunVisualStyle, RegExp>;

function compactText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function flattenSectionValue(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? value.map(compactText).filter(Boolean).join(", ")
    : compactText(value);
}

function splitPromptParts(value: string) {
  return value
    .replace(/\uFF0C/g, ",")
    .split(/[,\n]+/g)
    .map(compactText)
    .filter(Boolean);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isRunVisualStyle(value: unknown): value is RunVisualStyle {
  return typeof value === "string" && runVisualStyles.includes(value as RunVisualStyle);
}

export function normalizeRunVisualStyle(
  value: unknown,
  fallback: RunVisualStyle = DEFAULT_RUN_VISUAL_STYLE,
): RunVisualStyle {
  return isRunVisualStyle(value) ? value : fallback;
}

export function formatRunVisualStyleLabel(value: RunVisualStyle) {
  return value === "photoreal" ? "Photoreal" : "Anime";
}

export function getRunVisualStylePositiveGuidance(
  value: RunVisualStyle,
  promptFamily: "tag" | "krea2" = "tag",
) {
  return promptFamily === "krea2"
    ? KREA2_RUN_VISUAL_STYLE_POSITIVE_GUIDANCE[value]
    : RUN_VISUAL_STYLE_POSITIVE_GUIDANCE[value];
}

export function getRunVisualStyleNegativeGuidance(value: RunVisualStyle) {
  return [...RUN_VISUAL_STYLE_NEGATIVE_GUIDANCE[value]];
}

/**
 * Detect only strong opposing-domain signals in the dedicated style/medium
 * section. Generic photography, realism, camera, lens, bokeh, and depth-of-field
 * vocabulary deliberately is not a classifier.
 */
export function hasOpposingRunVisualStyleSignal(
  authoredSection: string | string[] | undefined,
  visualStyle: RunVisualStyle,
) {
  return OPPOSING_VISUAL_STYLE_SIGNAL[visualStyle].test(flattenSectionValue(authoredSection));
}

/**
 * Build one dedicated, authoritative style/medium section. Compatible authored
 * detail is retained inside that section; an opposing-domain signal replaces
 * the whole section without rewriting any other prompt section.
 */
export function buildAuthoritativeRunVisualStyleSection(
  authoredSection: string | string[] | undefined,
  visualStyle: RunVisualStyle,
  promptFamily: "tag" | "krea2" = "tag",
) {
  const guidance = getRunVisualStylePositiveGuidance(visualStyle, promptFamily);
  const authored = flattenSectionValue(authoredSection);
  if (!authored || hasOpposingRunVisualStyleSignal(authoredSection, visualStyle)) {
    return guidance;
  }
  const authoredWithoutGuidance = authored
    .replace(new RegExp(escapeRegExp(guidance), "gi"), "")
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "")
    .replace(/\s*[,;]\s*[,;]\s*/g, ", ")
    .trim();
  if (!authoredWithoutGuidance) return guidance;
  return promptFamily === "krea2"
    ? `${guidance} ${authoredWithoutGuidance}`
    : `${guidance}, ${authoredWithoutGuidance}`;
}

export function appendRunVisualStyleNegativeGuidance(
  negativePrompt: string,
  visualStyle: RunVisualStyle,
) {
  const seen = new Set<string>();
  const parts = [
    ...splitPromptParts(negativePrompt),
    ...getRunVisualStyleNegativeGuidance(visualStyle),
  ].filter((part) => {
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parts.join(", ");
}

export function buildRunVisualStyleLlmInstructions(
  visualStyle: RunVisualStyle,
  promptProfile?: string,
) {
  const opposing = getRunVisualStyleNegativeGuidance(visualStyle).join(", ");
  const promptFamily = promptProfile === "krea2" ? "krea2" : "tag";
  return [
    `Selected visual style: ${formatRunVisualStyleLabel(visualStyle)} (${visualStyle}). This selector is authoritative and independent from the prompt profile.`,
    `The dedicated visualStyleAndMedium section must support exactly once: ${getRunVisualStylePositiveGuidance(visualStyle, promptFamily)}`,
    `Do not place opposing-domain rendering in that section (${opposing}).`,
    "Generic photo, realistic, photorealistic, camera/lens, bokeh, and depth-of-field terms are not opposing-domain classifiers by themselves.",
  ].join("\n");
}
