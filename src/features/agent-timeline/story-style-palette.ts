import {
  createGenerationStylePaletteSnapshot,
  sanitizeGenerationStylePaletteSnapshot,
  type GenerationStylePaletteLoraSnapshot,
  type GenerationStylePaletteParameters,
  type GenerationStylePaletteSnapshot,
} from "./generation-style-palette";
import {
  STYLE_REFERENCE_IP_ADAPTER_DEFAULTS,
  buildStyleReferenceSequenceCharacter,
  createStyleReferenceSnapshot,
  getStyleReferenceAiContext,
  getStyleReferenceBlockingIssue,
  getStyleReferenceCapability,
  getStyleReferenceFromSettingsSnapshot,
  getStyleReferencePrompt,
  isStyleReferenceReady,
  parseStyleReferenceAnalysisContent,
  sanitizeStyleReferenceIpAdapterSettings,
  sanitizeStyleReferenceSnapshot,
  type StyleReferenceAnalysis,
  type StyleReferenceIpAdapterSettings,
  type StyleReferenceMetadata,
  type StyleReferenceMode,
  type StyleReferenceSettingsSnapshot,
  type StyleReferenceSnapshot,
} from "./style-reference";

export type StoryStylePaletteLoraSnapshot = GenerationStylePaletteLoraSnapshot;
export type StoryStylePaletteGenerationParameters = GenerationStylePaletteParameters;
export type StoryStylePaletteSnapshot = GenerationStylePaletteSnapshot;
export type StoryStyleReferenceMode = StyleReferenceMode;
export type StoryStyleReferenceMetadata = StyleReferenceMetadata;
export type StoryStyleReferenceAnalysis = StyleReferenceAnalysis;
export type StoryStyleReferenceIpAdapterSettings = StyleReferenceIpAdapterSettings;
export type StoryStyleReferenceSettingsSnapshot = StyleReferenceSettingsSnapshot;
export type StoryStyleReferenceSnapshot = StyleReferenceSnapshot;

export const STORY_STYLE_REFERENCE_IP_ADAPTER_DEFAULTS = STYLE_REFERENCE_IP_ADAPTER_DEFAULTS;

export function createStoryStylePaletteSnapshot(
  value: Parameters<typeof createGenerationStylePaletteSnapshot>[0],
): StoryStylePaletteSnapshot | undefined {
  return createGenerationStylePaletteSnapshot(value);
}

export function sanitizeStoryStylePaletteSnapshot(value: unknown): StoryStylePaletteSnapshot | undefined {
  return sanitizeGenerationStylePaletteSnapshot(value);
}

export const getStoryStyleReferenceCapability = getStyleReferenceCapability;
export const parseStoryStyleReferenceAnalysisContent = parseStyleReferenceAnalysisContent;
export const sanitizeStoryStyleReferenceIpAdapterSettings = sanitizeStyleReferenceIpAdapterSettings;

function withStoryError(value: StoryStyleReferenceSnapshot | undefined) {
  if (!value?.error || !value.error.startsWith("Style reference")) {
    return value;
  }
  return { ...value, error: `Story style reference${value.error.slice("Style reference".length)}` };
}

export function createStoryStyleReferenceSnapshot(
  value: Parameters<typeof createStyleReferenceSnapshot>[0],
): StoryStyleReferenceSnapshot {
  return withStoryError(createStyleReferenceSnapshot(value)) as StoryStyleReferenceSnapshot;
}

export function sanitizeStoryStyleReferenceSnapshot(value: unknown): StoryStyleReferenceSnapshot | undefined {
  return withStoryError(sanitizeStyleReferenceSnapshot(value));
}

export function getStoryStyleReferenceBlockingIssue(value: StoryStyleReferenceSnapshot | undefined) {
  return getStyleReferenceBlockingIssue(withStoryError(value), "Story");
}

export const isStoryStyleReferenceReady = isStyleReferenceReady;
export const getStoryStyleReferencePrompt = getStyleReferencePrompt;

export function getStoryStyleReferenceFromSettingsSnapshot(value: unknown) {
  return withStoryError(getStyleReferenceFromSettingsSnapshot(value));
}

export const getStoryStyleReferenceAiContext = getStyleReferenceAiContext;

export function buildStoryStyleReferenceSequenceCharacter(value: StoryStyleReferenceSnapshot | undefined) {
  return buildStyleReferenceSequenceCharacter(value, {
    id: "story-style-reference",
    name: "Story style reference",
  });
}
