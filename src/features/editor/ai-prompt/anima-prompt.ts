import type { SelectedCivitaiResourcePreview, SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import type { ComfyUiTextToImageWorkflowProfileId } from "@/features/comfyui";
import type { GeneratedPrompt } from "@/features/prompt-engine";
import type { SavedComfyUiWorkflowProfile } from "@/shared/types";

import {
  dedupePromptParts,
  mergePromptParts,
  splitPromptParts,
} from "./illustrious-prompt";

export const ANIMA_DEFAULT_QUALITY_META_TAGS = ["masterpiece", "best quality", "score_7"];
export const ANIMA_DEFAULT_NEGATIVE_TAGS = ["low quality", "worst quality", "bad anatomy", "bad hands"];

export type AnimaPromptSectionKey =
  | "qualityMetaSafety"
  | "subjectCount"
  | "character"
  | "source"
  | "artist"
  | "general";

export type AnimaPromptSections = Partial<Record<AnimaPromptSectionKey, string | string[]>>;

export type AnimaPromptContext = {
  baseModel?: string | null;
  resources?: SelectedCivitaiResourcesPreview;
  supportsNsfw?: boolean;
  workflowProfile?: ComfyUiTextToImageWorkflowProfileId | SavedComfyUiWorkflowProfile;
};

const SECTION_KEY_ALIASES: Record<string, AnimaPromptSectionKey> = {
  artist: "artist",
  artists: "artist",
  character: "character",
  characters: "character",
  general: "general",
  generaltags: "general",
  meta: "qualityMetaSafety",
  quality: "qualityMetaSafety",
  qualitymeta: "qualityMetaSafety",
  qualitymetasafety: "qualityMetaSafety",
  rating: "qualityMetaSafety",
  safety: "qualityMetaSafety",
  source: "source",
  sources: "source",
  series: "source",
  subject: "subjectCount",
  subjectcount: "subjectCount",
  subjectcounttags: "subjectCount",
};

const ANIMA_RENDER_ORDER: AnimaPromptSectionKey[] = [
  "qualityMetaSafety",
  "subjectCount",
  "character",
  "source",
  "artist",
  "general",
];

const SAFETY_TAGS = new Set([
  "safe",
  "general",
  "sensitive",
  "questionable",
  "explicit",
  "nsfw",
  "rating:safe",
  "rating:general",
  "rating:sensitive",
  "rating:questionable",
  "rating:explicit",
]);

const QUALITY_META_TAGS = new Set([
  "masterpiece",
  "best quality",
  "score_9",
  "score_8",
  "score_7",
  "score_6",
  "score_5",
  "score_4",
  "amazing quality",
  "high quality",
  "great quality",
  "normal quality",
  "very aesthetic",
  "newest",
  "latest",
  "recent",
  "old",
  "oldest",
]);

function createEmptyAnimaSections(): Record<AnimaPromptSectionKey, string[]> {
  return {
    qualityMetaSafety: [],
    subjectCount: [],
    character: [],
    source: [],
    artist: [],
    general: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sectionValueToParts(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? value.flatMap(splitPromptParts)
    : splitPromptParts(value ?? "");
}

function appendSection(
  sections: Record<AnimaPromptSectionKey, string[]>,
  key: AnimaPromptSectionKey,
  parts: string[],
) {
  sections[key].push(...parts);
}

function isAnimaBaseModel(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() === "anima";
}

export function isAnimaPromptContext(context: AnimaPromptContext = {}) {
  return context.workflowProfile === "anima" ||
    isAnimaBaseModel(context.baseModel) ||
    isAnimaBaseModel(context.resources?.checkpoint?.baseModel);
}

export function resolveAnimaPromptContextFromResources({
  resources,
  supportsNsfw,
}: {
  resources?: SelectedCivitaiResourcesPreview;
  supportsNsfw?: boolean;
}): AnimaPromptContext {
  return {
    baseModel: resources?.checkpoint?.baseModel,
    resources,
    supportsNsfw,
  };
}

function normalizePromptKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeSectionKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasSafeTag(parts: string[]) {
  return parts.some((part) => {
    const key = normalizePromptKey(part);
    return key === "safe" || key === "rating:safe";
  });
}

function normalizeAnimaArtistPromptPart(part: string) {
  const weightedArtist = /^\(artist\s*:\s*(.+):([+-]?(?:\d+\.?\d*|\.\d+))\)$/i.exec(part);
  if (weightedArtist?.[1] && weightedArtist[2]) {
    return `(@${weightedArtist[1].trim()}:${weightedArtist[2]})`;
  }

  const weightedBy = /^by\s+(.+?):([+-]?(?:\d+\.?\d*|\.\d+))$/i.exec(part);
  if (weightedBy?.[1] && weightedBy[2]) {
    return `(@${weightedBy[1].trim()}:${weightedBy[2]})`;
  }

  const artist = /^artist\s*:\s*(.+)$/i.exec(part);
  if (artist?.[1]) {
    return `@${artist[1].trim()}`;
  }

  const by = /^by\s+(.+)$/i.exec(part);
  if (by?.[1]) {
    return `@${by[1].trim()}`;
  }

  return part;
}

function classifyAnimaPromptPart(part: string): AnimaPromptSectionKey {
  const key = normalizePromptKey(part);

  if (
    SAFETY_TAGS.has(key) ||
    QUALITY_META_TAGS.has(key) ||
    /^score_[4-9]$/.test(key) ||
    /^(?:year\s*)?\d{4}s?$/.test(key)
  ) {
    return "qualityMetaSafety";
  }

  if (/^(?:solo|\d+\s*(?:girls?|boys?|others?|people|persons?|characters?))$/.test(key)) {
    return "subjectCount";
  }

  if (
    key.startsWith("@") ||
    /^artist\s*:/.test(key) ||
    /^by\s+/.test(key) ||
    /\b(?:artist|art style|style|illustration|manga|anime|painting|watercolor|lineart|cel shading)\b/.test(key)
  ) {
    return "artist";
  }

  if (/^(?:source|series|copyright)\s*:/.test(key) || /\b(?:from\s+|series|source|copyright)\b/.test(key)) {
    return "source";
  }

  if (
    /\b(?:1girl|1boy|girl|boy|woman|man|person|character|protagonist|hero|hair|eyes?|face|skin|body|dress|uniform|shirt|jacket|coat|skirt|pants|shorts|boots?|shoes?|hat|gloves?|glasses|outfit|pose|standing|sitting|kneeling|running|walking|jumping|holding|reaching|waving|looking|smile|smiling|angry|crying|expression|dynamic)\b/.test(key)
  ) {
    return "character";
  }

  return "general";
}

export function classifyFlatPromptToAnimaSections(prompt: string): AnimaPromptSections {
  const sections = createEmptyAnimaSections();

  for (const part of splitPromptParts(prompt)) {
    const section = classifyAnimaPromptPart(part);
    appendSection(sections, section, [
      section === "artist" ? normalizeAnimaArtistPromptPart(part) : part,
    ]);
  }

  return sections;
}

function normalizeResourceTag(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function getResourceTriggerSection(resource: SelectedCivitaiResourcePreview): AnimaPromptSectionKey {
  if (resource.categories.includes("character")) {
    return "character";
  }

  if (resource.categories.includes("style")) {
    return "artist";
  }

  const tags = resource.tags.map(normalizeResourceTag);
  if (tags.some((tag) => /\b(?:character|person|girl|boy|woman|man)\b/.test(tag))) {
    return "character";
  }

  if (tags.some((tag) => /\b(?:artist|style|illustration|manga|anime)\b/.test(tag))) {
    return "artist";
  }

  if (tags.some((tag) => /\b(?:series|source|copyright)\b/.test(tag))) {
    return "source";
  }

  return "general";
}

function collectResourceTriggerSections(resources: SelectedCivitaiResourcesPreview) {
  const sections = createEmptyAnimaSections();

  if (resources.checkpoint) {
    for (const part of resources.checkpoint.trainedWords.flatMap(splitPromptParts)) {
      const section = classifyAnimaPromptPart(part);
      appendSection(sections, section, [
        section === "artist" ? normalizeAnimaArtistPromptPart(part) : part,
      ]);
    }
  }

  for (const lora of resources.loras) {
    appendSection(sections, getResourceTriggerSection(lora), lora.trainedWords.flatMap(splitPromptParts));
  }

  return sections;
}

export function renderAnimaPrompt({
  includeDefaultQualityTags = true,
  resources = { checkpoint: null, loras: [] },
  sections = {},
  sourcePrompt,
  supportsNsfw = false,
}: {
  includeDefaultQualityTags?: boolean;
  resources?: SelectedCivitaiResourcesPreview;
  sections?: AnimaPromptSections;
  sourcePrompt?: string;
  supportsNsfw?: boolean;
}) {
  const merged = createEmptyAnimaSections();
  const sourceSections = sourcePrompt ? classifyFlatPromptToAnimaSections(sourcePrompt) : {};
  const resourceSections = collectResourceTriggerSections(resources);

  for (const key of ANIMA_RENDER_ORDER) {
    appendSection(merged, key, sectionValueToParts(sourceSections[key]));
    appendSection(merged, key, sectionValueToParts(sections[key]));
    appendSection(merged, key, sectionValueToParts(resourceSections[key]));
  }

  if (includeDefaultQualityTags) {
    merged.qualityMetaSafety = [
      ...ANIMA_DEFAULT_QUALITY_META_TAGS,
      ...(!supportsNsfw && !hasSafeTag(merged.qualityMetaSafety) ? ["safe"] : []),
      ...merged.qualityMetaSafety,
    ];
  }

  merged.artist = merged.artist.map(normalizeAnimaArtistPromptPart);

  return dedupePromptParts(ANIMA_RENDER_ORDER.flatMap((key) => merged[key])).join(", ");
}

export function renderAnimaPromptForContext(prompt: string, context: AnimaPromptContext = {}) {
  return isAnimaPromptContext(context)
    ? renderAnimaPrompt({
        resources: context.resources,
        sourcePrompt: prompt,
        supportsNsfw: context.supportsNsfw,
      })
    : prompt;
}

function parseJsonCandidate(rawContent: string) {
  const trimmed = rawContent.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Continue to fenced JSON fallback.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) {
    return null;
  }

  try {
    return JSON.parse(fenced[1].trim()) as unknown;
  } catch {
    return null;
  }
}

function normalizeSectionSource(value: unknown): string | string[] | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === "string");
    return values.length > 0 ? values : null;
  }

  return null;
}

function readSectionsFromRecord(record: Record<string, unknown>) {
  const sections: AnimaPromptSections = {};

  for (const [key, value] of Object.entries(record)) {
    const sectionKey = SECTION_KEY_ALIASES[normalizeSectionKey(key)];
    const normalizedValue = normalizeSectionSource(value);
    if (!sectionKey || normalizedValue === null) {
      continue;
    }

    sections[sectionKey] = normalizedValue;
  }

  return sections;
}

function hasSectionContent(sections: AnimaPromptSections) {
  return Object.values(sections).some((value) => sectionValueToParts(value).length > 0);
}

export function parseAnimaPromptSectionsFromResponse(rawContent: string): AnimaPromptSections | null {
  const parsed = parseJsonCandidate(rawContent);
  if (!isRecord(parsed)) {
    return null;
  }

  const sectionSource = isRecord(parsed.sections) ? parsed.sections : parsed;
  const sections = readSectionsFromRecord(sectionSource);

  return hasSectionContent(sections) ? sections : null;
}

function extractPromptFromResponse(rawContent: string) {
  const parsed = parseJsonCandidate(rawContent);
  if (isRecord(parsed) && typeof parsed.prompt === "string") {
    return parsed.prompt;
  }

  return rawContent;
}

export function renderAnimaPromptFromAiResponse({
  rawContent,
  resources = { checkpoint: null, loras: [] },
  supportsNsfw = false,
}: {
  rawContent: string;
  resources?: SelectedCivitaiResourcesPreview;
  supportsNsfw?: boolean;
}) {
  const sections =
    parseAnimaPromptSectionsFromResponse(rawContent) ??
    classifyFlatPromptToAnimaSections(extractPromptFromResponse(rawContent));

  return renderAnimaPrompt({ resources, sections, supportsNsfw });
}

export function formatGeneratedPromptForAnimaContext(
  generated: GeneratedPrompt,
  context: AnimaPromptContext = {},
): GeneratedPrompt {
  if (!isAnimaPromptContext(context)) {
    return generated;
  }

  const prompt = renderAnimaPrompt({
    resources: context.resources,
    sourcePrompt: generated.prompt,
    supportsNsfw: context.supportsNsfw,
  });
  const negativePrompt = mergeAnimaNegativePrompts([generated.negativePrompt]);

  return {
    prompt,
    negativePrompt,
    parts: splitPromptParts(prompt),
  };
}

export function buildAnimaComicSequencePrompt({
  basePrompt,
  hasReferenceImages,
  reference,
  resources = { checkpoint: null, loras: [] },
  shotPrompt,
  supportsNsfw = false,
}: {
  basePrompt: string;
  hasReferenceImages: boolean;
  reference?: {
    characterName: string;
    characterPrompt: string;
  };
  resources?: SelectedCivitaiResourcesPreview;
  shotPrompt: string;
  supportsNsfw?: boolean;
}) {
  const sections = createEmptyAnimaSections();

  for (const [key, value] of Object.entries(classifyFlatPromptToAnimaSections(basePrompt))) {
    appendSection(sections, key as AnimaPromptSectionKey, sectionValueToParts(value));
  }

  if (hasReferenceImages && reference) {
    appendSection(sections, "character", splitPromptParts(reference.characterName));
    for (const [key, value] of Object.entries(classifyFlatPromptToAnimaSections(reference.characterPrompt))) {
      appendSection(sections, key as AnimaPromptSectionKey, sectionValueToParts(value));
    }
  }

  for (const [key, value] of Object.entries(classifyFlatPromptToAnimaSections(shotPrompt))) {
    appendSection(sections, key as AnimaPromptSectionKey, sectionValueToParts(value));
  }

  return renderAnimaPrompt({ resources, sections, supportsNsfw });
}

export function mergeAnimaNegativePrompts(parts: Array<string | undefined>) {
  return mergePromptParts([ANIMA_DEFAULT_NEGATIVE_TAGS.join(", "), ...parts]);
}

export function buildAnimaAiResponseInstructions() {
  return [
    "Stable Diffusion uses Anima prompt ordering.",
    "Return JSON only. Do not wrap it in markdown.",
    "Shape: { \"sections\": { \"qualityMetaSafety\"?: string[], \"subjectCount\"?: string[], \"character\"?: string[], \"source\"?: string[], \"artist\"?: string[], \"general\"?: string[] } }.",
    "Write each section as detailed English anime-style visual phrases or short descriptive clauses.",
    "Keep output comma-separated and prompt-like; do not write paragraph fiction or full prose paragraphs.",
    "Prefer visible descriptive clauses over bare tags for action, expression, scene, lighting, atmosphere, camera, and composition.",
    "Keep character identity early and clear, then describe visible pose/action and facial expression as image details.",
    "When multiple characters are represented, give each person a distinct hairstyle and a distinct pose or action.",
    "Describe environment and objects, foreground/background relationship, lighting or mood, camera/framing/composition, and visible motion or atmosphere when available.",
    "Avoid abstract psychological narration unless it is visible through expression, pose, lighting, or atmosphere.",
    "Example style: 1girl, standing beside a rain-streaked window in an unlit room, gazing out at the rainy night with a quiet and pensive expression, faint blue-gray light coming from outside, cinematic over-shoulder composition.",
    "Use this positive order: quality/meta/year/safety, subject count, character, series/source, artist, general tags.",
    "Default quality/meta tags will be added locally: masterpiece, best quality, score_7.",
    "Do not add safety or rating tags unless they are explicitly provided by the scene or user.",
    "Use selected Civitai trainedWords only when useful, and never invent trigger words.",
    "Use @artist syntax for artist names when possible.",
    "Do not generate <lora:...> syntax; LoRA loading is handled separately by ComfyUI.",
  ].join("\n");
}
