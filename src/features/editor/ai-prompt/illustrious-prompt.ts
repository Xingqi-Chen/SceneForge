import type {
  CivitaiLoraCategory,
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";

export const ILLUSTRIOUS_DEFAULT_QUALITY_TAGS = ["masterpiece", "best quality", "amazing quality"];
export const ILLUSTRIOUS_DEFAULT_AESTHETIC_VERSION_TAGS = ["very aesthetic", "newest"];

export type IllustriousPromptSectionKey =
  | "quality"
  | "aestheticVersion"
  | "rating"
  | "artistStyle"
  | "styleLoraTriggers"
  | "checkpointTriggerWords"
  | "subjectIdentity"
  | "characterLoraTriggers"
  | "unknownLoraTriggers"
  | "appearancePhysicalTraits"
  | "clothingAccessories"
  | "poseActionExpression"
  | "backgroundEnvironmentObjects"
  | "spatialComposition"
  | "cameraFraming"
  | "lightingFocus"
  | "detailResolution";

export type IllustriousPromptSections = Partial<Record<IllustriousPromptSectionKey, string | string[]>>;

const ILLUSTRIOUS_RENDER_ORDER: IllustriousPromptSectionKey[] = [
  "quality",
  "aestheticVersion",
  "rating",
  "artistStyle",
  "styleLoraTriggers",
  "checkpointTriggerWords",
  "subjectIdentity",
  "characterLoraTriggers",
  "unknownLoraTriggers",
  "appearancePhysicalTraits",
  "clothingAccessories",
  "poseActionExpression",
  "backgroundEnvironmentObjects",
  "spatialComposition",
  "cameraFraming",
  "lightingFocus",
  "detailResolution",
];

const SECTION_KEY_ALIASES: Record<string, IllustriousPromptSectionKey> = {
  quality: "quality",
  qualitytags: "quality",
  aesthetic: "aestheticVersion",
  aestheticversion: "aestheticVersion",
  aestheticversiontags: "aestheticVersion",
  version: "aestheticVersion",
  versiontags: "aestheticVersion",
  rating: "rating",
  ratingtags: "rating",
  artist: "artistStyle",
  artists: "artistStyle",
  artiststyle: "artistStyle",
  artistandstyle: "artistStyle",
  style: "artistStyle",
  styletags: "artistStyle",
  styleloratriggers: "styleLoraTriggers",
  checkpoint: "checkpointTriggerWords",
  checkpointtriggerwords: "checkpointTriggerWords",
  checkpointtriggers: "checkpointTriggerWords",
  subject: "subjectIdentity",
  subjectidentity: "subjectIdentity",
  identity: "subjectIdentity",
  character: "subjectIdentity",
  characterloratriggers: "characterLoraTriggers",
  charactertriggers: "characterLoraTriggers",
  unknownloratriggers: "unknownLoraTriggers",
  unknowntriggers: "unknownLoraTriggers",
  appearance: "appearancePhysicalTraits",
  appearancephysicaltraits: "appearancePhysicalTraits",
  physicaltraits: "appearancePhysicalTraits",
  traits: "appearancePhysicalTraits",
  clothing: "clothingAccessories",
  clothingaccessories: "clothingAccessories",
  accessories: "clothingAccessories",
  outfit: "clothingAccessories",
  pose: "poseActionExpression",
  poseactionexpression: "poseActionExpression",
  action: "poseActionExpression",
  expression: "poseActionExpression",
  background: "backgroundEnvironmentObjects",
  backgroundenvironmentobjects: "backgroundEnvironmentObjects",
  environment: "backgroundEnvironmentObjects",
  scene: "backgroundEnvironmentObjects",
  objects: "backgroundEnvironmentObjects",
  spatial: "spatialComposition",
  spatialcomposition: "spatialComposition",
  composition: "spatialComposition",
  camera: "cameraFraming",
  cameraframing: "cameraFraming",
  framing: "cameraFraming",
  lighting: "lightingFocus",
  lightingfocus: "lightingFocus",
  focus: "lightingFocus",
  detail: "detailResolution",
  detailresolution: "detailResolution",
  details: "detailResolution",
  resolution: "detailResolution",
};

const RESOURCE_TAG_SECTION_RULES: Array<{
  section: IllustriousPromptSectionKey;
  categories: CivitaiLoraCategory[];
  tags: string[];
}> = [
  {
    section: "characterLoraTriggers",
    categories: ["character"],
    tags: ["character", "characters", "person", "girl", "boy", "woman", "man"],
  },
  {
    section: "styleLoraTriggers",
    categories: ["style"],
    tags: ["style", "art style", "anime style", "illustration", "render style"],
  },
  {
    section: "clothingAccessories",
    categories: ["clothing"],
    tags: ["clothing", "clothes", "outfit", "costume", "fashion", "accessory", "accessories"],
  },
  {
    section: "poseActionExpression",
    categories: ["pose"],
    tags: ["pose", "action", "gesture", "expression"],
  },
  {
    section: "backgroundEnvironmentObjects",
    categories: ["scene"],
    tags: ["scene", "background", "environment", "location", "prop", "object"],
  },
  {
    section: "lightingFocus",
    categories: ["lighting"],
    tags: ["lighting", "light", "illumination", "shadow", "glow"],
  },
  {
    section: "detailResolution",
    categories: ["detail"],
    tags: ["detail", "details", "quality", "texture", "highres", "resolution"],
  },
];

const QUALITY_TAGS = new Set([
  "masterpiece",
  "best quality",
  "amazing quality",
  "high quality",
  "great quality",
  "normal quality",
  "low quality",
  "worst quality",
]);

const AESTHETIC_VERSION_TAGS = new Set([
  "very aesthetic",
  "aesthetic",
  "newest",
  "recent",
  "latest",
  "mid",
  "old",
  "older",
  "oldest",
]);

const RATING_TAGS = new Set([
  "safe",
  "general",
  "sensitive",
  "questionable",
  "explicit",
  "rating:safe",
  "rating:general",
  "rating:sensitive",
  "rating:questionable",
  "rating:explicit",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePromptPart(value: string) {
  return value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripResponseNoise(value: string) {
  return value
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:positive prompt|prompt|tags)\s*:\s*/i, "");
}

export function splitPromptParts(value: string) {
  return stripResponseNoise(value)
    .replace(/\uFF0C/g, ",")
    .split(/[,\n]+/g)
    .map(normalizePromptPart)
    .filter((part) => Boolean(part) && !/^<lora:/i.test(part));
}

export function dedupePromptParts(parts: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts.map(normalizePromptPart).filter(Boolean)) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(part);
  }

  return result;
}

export function mergePromptParts(parts: Array<string | undefined>) {
  return dedupePromptParts(parts.flatMap((part) => splitPromptParts(part ?? ""))).join(", ");
}

function sectionValueToParts(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.flatMap(splitPromptParts);
  }

  return splitPromptParts(value ?? "");
}

function appendSection(
  sections: Record<IllustriousPromptSectionKey, string[]>,
  key: IllustriousPromptSectionKey,
  parts: string[],
) {
  sections[key].push(...parts);
}

function createEmptySections(): Record<IllustriousPromptSectionKey, string[]> {
  return {
    quality: [],
    aestheticVersion: [],
    rating: [],
    artistStyle: [],
    styleLoraTriggers: [],
    checkpointTriggerWords: [],
    subjectIdentity: [],
    characterLoraTriggers: [],
    unknownLoraTriggers: [],
    appearancePhysicalTraits: [],
    clothingAccessories: [],
    poseActionExpression: [],
    backgroundEnvironmentObjects: [],
    spatialComposition: [],
    cameraFraming: [],
    lightingFocus: [],
    detailResolution: [],
  };
}

function normalizeSectionKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classifyPromptPart(part: string): IllustriousPromptSectionKey {
  const key = part.toLowerCase();

  if (QUALITY_TAGS.has(key)) {
    return "quality";
  }

  if (AESTHETIC_VERSION_TAGS.has(key) || /\b(?:newest|latest|oldest|aesthetic)\b/.test(key)) {
    return "aestheticVersion";
  }

  if (RATING_TAGS.has(key) || key.startsWith("rating:")) {
    return "rating";
  }

  if (/\b(?:artist|style|by |anime|manga|illustration|painting|watercolor|cel shading|lineart)\b/.test(key)) {
    return "artistStyle";
  }

  if (/^\d+\s*(?:girl|boy|other)s?$/.test(key) || /\b(?:solo|girl|boy|woman|man|person|character|protagonist)\b/.test(key)) {
    return "subjectIdentity";
  }

  if (/\b(?:hair|eyes?|skin|face|body|tall|short|slim|muscular|freckles|scar|horns?|tail)\b/.test(key)) {
    return "appearancePhysicalTraits";
  }

  if (/\b(?:dress|uniform|shirt|jacket|coat|skirt|pants|shorts|boots?|shoes?|hat|gloves?|glasses|earrings?|necklace|outfit|accessor)\b/.test(key)) {
    return "clothingAccessories";
  }

  if (/\b(?:pose|standing|sitting|kneeling|running|walking|jumping|holding|reaching|waving|looking|smile|smiling|angry|crying|open mouth|expression|dynamic)\b/.test(key)) {
    return "poseActionExpression";
  }

  if (/\b(?:background|room|city|street|forest|sky|cloud|water|river|mountain|table|chair|building|environment|scenery|landscape|object|prop)\b/.test(key)) {
    return "backgroundEnvironmentObjects";
  }

  if (/\b(?:close-up|cowboy shot|wide shot|medium shot|portrait|from above|from below|low angle|high angle|dutch angle|pov|view|framing|camera|angle)\b/.test(key)) {
    return "cameraFraming";
  }

  if (/\b(?:light|lighting|shadow|glow|backlit|backlighting|rim light|sunlight|moonlight|bokeh|depth of field|focus|soft focus)\b/.test(key)) {
    return "lightingFocus";
  }

  if (/\b(?:detailed|details|highres|absurdres|resolution|intricate|texture|sharp|fine detail|ultra-detailed)\b/.test(key)) {
    return "detailResolution";
  }

  if (/\b(?:left|right|foreground|behind|front of|beside|near|center|composition|symmetrical|asymmetrical)\b/.test(key)) {
    return "spatialComposition";
  }

  return "backgroundEnvironmentObjects";
}

export function classifyFlatPromptToIllustriousSections(prompt: string): IllustriousPromptSections {
  const sections = createEmptySections();

  for (const part of splitPromptParts(prompt)) {
    appendSection(sections, classifyPromptPart(part), [part]);
  }

  return sections;
}

function normalizeResourceTag(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function getLoraTriggerSection(resource: SelectedCivitaiResourcePreview): IllustriousPromptSectionKey {
  for (const rule of RESOURCE_TAG_SECTION_RULES) {
    if (resource.categories.some((category) => rule.categories.includes(category))) {
      return rule.section;
    }
  }

  const tags = resource.tags.map(normalizeResourceTag);
  for (const rule of RESOURCE_TAG_SECTION_RULES) {
    if (tags.some((tag) => rule.tags.some((candidate) => tag === candidate || tag.includes(candidate)))) {
      return rule.section;
    }
  }

  return "unknownLoraTriggers";
}

function getResourceTriggerWords(resource: SelectedCivitaiResourcePreview) {
  return resource.trainedWords.flatMap(splitPromptParts);
}

export function collectCivitaiTriggerSections(
  resources: SelectedCivitaiResourcesPreview,
): IllustriousPromptSections {
  const sections = createEmptySections();

  if (resources.checkpoint) {
    appendSection(sections, "checkpointTriggerWords", getResourceTriggerWords(resources.checkpoint));
  }

  for (const lora of resources.loras) {
    appendSection(sections, getLoraTriggerSection(lora), getResourceTriggerWords(lora));
  }

  return sections;
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
  const sections: IllustriousPromptSections = {};

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

function hasSectionContent(sections: IllustriousPromptSections) {
  return Object.values(sections).some((value) => sectionValueToParts(value).length > 0);
}

export function parseIllustriousPromptSectionsFromResponse(rawContent: string): IllustriousPromptSections | null {
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

export function renderIllustriousPrompt({
  includeDefaultQualityTags = true,
  resources = { checkpoint: null, loras: [] },
  sections = {},
}: {
  includeDefaultQualityTags?: boolean;
  resources?: SelectedCivitaiResourcesPreview;
  sections?: IllustriousPromptSections;
}) {
  const merged = createEmptySections();
  const resourceSections = collectCivitaiTriggerSections(resources);

  for (const key of ILLUSTRIOUS_RENDER_ORDER) {
    appendSection(merged, key, sectionValueToParts(sections[key]));
    appendSection(merged, key, sectionValueToParts(resourceSections[key]));
  }

  if (includeDefaultQualityTags) {
    merged.quality = [...ILLUSTRIOUS_DEFAULT_QUALITY_TAGS, ...merged.quality];
    merged.aestheticVersion = [
      ...ILLUSTRIOUS_DEFAULT_AESTHETIC_VERSION_TAGS,
      ...merged.aestheticVersion,
    ];
  }

  return dedupePromptParts(ILLUSTRIOUS_RENDER_ORDER.flatMap((key) => merged[key])).join(", ");
}

export function renderIllustriousPromptFromAiResponse({
  rawContent,
  resources = { checkpoint: null, loras: [] },
}: {
  rawContent: string;
  resources?: SelectedCivitaiResourcesPreview;
}) {
  const sections =
    parseIllustriousPromptSectionsFromResponse(rawContent) ??
    classifyFlatPromptToIllustriousSections(extractPromptFromResponse(rawContent));

  return renderIllustriousPrompt({ resources, sections });
}

export function buildIllustriousComicSequencePrompt({
  basePrompt,
  canvasPrompt,
  characterPrompts = [],
  environmentPrompt,
  reference,
  resources = { checkpoint: null, loras: [] },
  shotPrompt,
}: {
  basePrompt: string;
  canvasPrompt?: string;
  characterPrompts?: string[];
  environmentPrompt?: string;
  reference?: {
    characterName: string;
    characterPrompt: string;
  };
  resources?: SelectedCivitaiResourcesPreview;
  shotPrompt: string;
}) {
  const sections = createEmptySections();

  for (const [key, value] of Object.entries(classifyFlatPromptToIllustriousSections(basePrompt))) {
    appendSection(sections, key as IllustriousPromptSectionKey, sectionValueToParts(value));
  }

  for (const characterPrompt of characterPrompts) {
    const labeledCharacter = /^([^:]+):\s*(.+)$/.exec(characterPrompt.trim());
    if (labeledCharacter) {
      appendSection(sections, "subjectIdentity", splitPromptParts(labeledCharacter[1] ?? ""));
    }

    const promptToClassify = labeledCharacter?.[2] ?? characterPrompt;
    for (const [key, value] of Object.entries(classifyFlatPromptToIllustriousSections(promptToClassify))) {
      appendSection(sections, key as IllustriousPromptSectionKey, sectionValueToParts(value));
    }
  }

  if (reference) {
    appendSection(sections, "subjectIdentity", splitPromptParts(reference.characterName));
    for (const [key, value] of Object.entries(classifyFlatPromptToIllustriousSections(reference.characterPrompt))) {
      appendSection(sections, key as IllustriousPromptSectionKey, sectionValueToParts(value));
    }
  }

  for (const [key, value] of Object.entries(classifyFlatPromptToIllustriousSections(environmentPrompt ?? ""))) {
    appendSection(sections, key as IllustriousPromptSectionKey, sectionValueToParts(value));
  }

  for (const [key, value] of Object.entries(classifyFlatPromptToIllustriousSections(canvasPrompt ?? ""))) {
    appendSection(sections, key as IllustriousPromptSectionKey, sectionValueToParts(value));
  }

  for (const [key, value] of Object.entries(classifyFlatPromptToIllustriousSections(shotPrompt))) {
    appendSection(sections, key as IllustriousPromptSectionKey, sectionValueToParts(value));
  }

  return renderIllustriousPrompt({ resources, sections });
}

export function mergeNegativePrompts(parts: Array<string | undefined>) {
  return mergePromptParts(parts);
}

export function buildIllustriousAiResponseInstructions() {
  return [
    "Stable Diffusion uses Illustrious prompt ordering.",
    "Return JSON only. Do not wrap it in markdown.",
    "Shape: { \"sections\": { \"quality\"?: string[], \"aestheticVersion\"?: string[], \"rating\"?: string[], \"artistStyle\"?: string[], \"subjectIdentity\"?: string[], \"appearancePhysicalTraits\"?: string[], \"clothingAccessories\"?: string[], \"poseActionExpression\"?: string[], \"backgroundEnvironmentObjects\"?: string[], \"spatialComposition\"?: string[], \"cameraFraming\"?: string[], \"lightingFocus\"?: string[], \"detailResolution\"?: string[] } }.",
    "Write each section as concise booru-style tags or short tag phrases.",
    "Use this positive order: quality, aesthetic/version, rating, artist/style and style LoRA triggers, checkpoint trigger words, subject identity, character LoRA triggers, unknown LoRA triggers, appearance/physical traits, clothing/accessories, pose/action/expression, background/environment/objects, spatial composition, camera/framing, lighting/focus, detail/resolution.",
    "Default quality and aesthetic/version tags will be added locally: masterpiece, best quality, amazing quality, very aesthetic, newest.",
    "Do not add rating tags unless they are explicitly provided by the scene or user.",
    "Use selected Civitai trainedWords only when useful, and never invent trigger words.",
    "Do not generate <lora:...> syntax; LoRA loading is handled separately by ComfyUI.",
  ].join("\n");
}
