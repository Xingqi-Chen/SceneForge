import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";

export type Krea2PromptSectionKey =
  | "subjectMood"
  | "subjectAttributesAndActions"
  | "visualStyleAndMedium"
  | "lightingColorAndTexture"
  | "spatialCompositionAndFraming"
  | "selectedLoraTriggerWords";

export type Krea2PromptSections = Partial<Record<Krea2PromptSectionKey, string | string[]>>;

const KREA2_RENDER_ORDER: Krea2PromptSectionKey[] = [
  "subjectMood",
  "subjectAttributesAndActions",
  "visualStyleAndMedium",
  "lightingColorAndTexture",
  "spatialCompositionAndFraming",
  "selectedLoraTriggerWords",
];

const SECTION_KEY_ALIASES: Record<string, Krea2PromptSectionKey> = {
  subject: "subjectMood",
  subjectmood: "subjectMood",
  mood: "subjectMood",
  subjectattributes: "subjectAttributesAndActions",
  subjectattributesandactions: "subjectAttributesAndActions",
  attributes: "subjectAttributesAndActions",
  actions: "subjectAttributesAndActions",
  visualstyle: "visualStyleAndMedium",
  visualstyleandmedium: "visualStyleAndMedium",
  style: "visualStyleAndMedium",
  medium: "visualStyleAndMedium",
  lighting: "lightingColorAndTexture",
  lightingcolorandtexture: "lightingColorAndTexture",
  color: "lightingColorAndTexture",
  texture: "lightingColorAndTexture",
  spatial: "spatialCompositionAndFraming",
  spatialcompositionandframing: "spatialCompositionAndFraming",
  composition: "spatialCompositionAndFraming",
  framing: "spatialCompositionAndFraming",
  lora: "selectedLoraTriggerWords",
  loratriggers: "selectedLoraTriggerWords",
  selectedloratriggerwords: "selectedLoraTriggerWords",
  triggerwords: "selectedLoraTriggerWords",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactPromptClause(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeSectionKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeSectionValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeSectionValue);
  }

  const text = compactPromptClause(value);
  return text ? [text] : [];
}

function parseJsonObject(rawContent: string): Record<string, unknown> | null {
  const trimmed = rawContent.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next likely JSON span.
    }
  }

  return null;
}

export function parseKrea2PromptSectionsFromResponse(rawContent: string): Krea2PromptSections | null {
  const parsed = parseJsonObject(rawContent);
  if (!parsed) return null;
  const source = isRecord(parsed.krea2Sections)
    ? parsed.krea2Sections
    : isRecord(parsed.krea2_sections)
      ? parsed.krea2_sections
      : isRecord(parsed.sections) ? parsed.sections : parsed;
  const sections: Krea2PromptSections = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = SECTION_KEY_ALIASES[normalizeSectionKey(rawKey)];
    const values = normalizeSectionValue(rawValue);
    if (!key || values.length === 0) continue;
    sections[key] = values.length === 1 ? values[0] : values;
  }

  return Object.keys(sections).length > 0 ? sections : null;
}

function sectionParts(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? value.map(compactPromptClause).filter(Boolean)
    : [compactPromptClause(value)].filter(Boolean);
}

function normalizedPromptKey(value: string) {
  return compactPromptClause(value).toLocaleLowerCase();
}

function containsPromptPart(parts: readonly string[], value: string) {
  const escaped = normalizedPromptKey(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clauseBoundary = "[\\s,;:.!?\"“”()\\[\\]{}]";
  // A selected trigger can already appear as quoted visible text (for example,
  // `"soft ink"`). Treat quote marks and clause punctuation as term boundaries
  // while retaining word boundaries so `art` does not match `portrait` and
  // `soft ink` does not match `soft inking`.
  return escaped.length > 0 && new RegExp(`(?:^|${clauseBoundary})${escaped}(?=$|${clauseBoundary})`, "i")
    .test(parts.join(", "));
}

function collectSelectedLoraTriggerWords(
  sections: Krea2PromptSections,
  resources: SelectedCivitaiResourcesPreview | undefined,
) {
  return [
    ...sectionParts(sections.selectedLoraTriggerWords),
    ...(resources?.loras ?? []).flatMap((lora) => lora.trainedWords),
  ]
    .map(compactPromptClause)
    .filter(Boolean);
}

/**
 * Render Krea 2's author-recommended prompt order as a single natural-language
 * paragraph. The renderer deliberately does not infer or invent visual details:
 * it only compacts supplied text and appends selected local LoRA trained words.
 */
export function renderKrea2Prompt({
  resources,
  sections,
  sourcePrompt,
}: {
  resources?: SelectedCivitaiResourcesPreview;
  sections?: Krea2PromptSections;
  sourcePrompt?: string;
}) {
  const normalizedSections = sections ?? {};
  const orderedParts: string[] = [];
  const seen = new Set<string>();
  const addPart = (part: string) => {
    const key = normalizedPromptKey(part);
    if (!key || seen.has(key)) return;
    seen.add(key);
    orderedParts.push(part);
  };

  const subjectParts = sectionParts(normalizedSections.subjectMood);
  if (subjectParts.length > 0) {
    subjectParts.forEach(addPart);
  } else {
    sectionParts(sourcePrompt).forEach(addPart);
  }

  for (const key of KREA2_RENDER_ORDER.slice(1, -1)) {
    sectionParts(normalizedSections[key]).forEach(addPart);
  }

  for (const triggerWord of collectSelectedLoraTriggerWords(normalizedSections, resources)) {
    const key = normalizedPromptKey(triggerWord);
    if (!key || seen.has(key) || containsPromptPart(orderedParts, triggerWord)) continue;
    addPart(triggerWord);
  }

  return orderedParts.join(", ");
}

export function buildKrea2AiResponseInstructions() {
  return [
    "Use Krea 2 Turbo's natural-language prompting order. Return only JSON with a krea2Sections object.",
    "Required ordered keys: subjectMood, subjectAttributesAndActions, visualStyleAndMedium, lightingColorAndTexture, spatialCompositionAndFraming.",
    "Write English natural-language clauses, never booru tags, quality tags, negative prompts, Markdown, or reasoning.",
    "Keep subject, action, explicit colors, visible text in double quotes, requested medium, and spatial relations faithful to the user input.",
    "Do not invent characters, animals, props, outfits, materials, colors, or other unsupported details.",
    "Bind each subject's attributes and actions to that subject. Keep user-specified media exactly as specified.",
    "Do not emit selectedLoraTriggerWords; SceneForge appends selected local LoRA trained words once after the visual sections.",
  ].join("\n");
}
