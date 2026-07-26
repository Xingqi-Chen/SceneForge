import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";

export type Krea2PromptSectionKey =
  | "subjectMood"
  | "subjectAttributesAndActions"
  | "environmentAndBackground"
  | "visualStyleAndMedium"
  | "lightingColorAndTexture"
  | "spatialCompositionAndFraming"
  | "selectedLoraTriggerWords";

export type Krea2PromptSections = Partial<Record<Krea2PromptSectionKey, string | string[]>>;

const KREA2_RENDER_ORDER: Krea2PromptSectionKey[] = [
  "subjectMood",
  "subjectAttributesAndActions",
  "environmentAndBackground",
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
  environment: "environmentAndBackground",
  environmentandbackground: "environmentAndBackground",
  environmentbackground: "environmentAndBackground",
  background: "environmentAndBackground",
  setting: "environmentAndBackground",
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

  const text = normalizeKrea2PromptSegment(value);
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
    ? value.map(normalizeKrea2PromptSegment).filter(Boolean)
    : [normalizeKrea2PromptSegment(value)].filter(Boolean);
}

const KREA2_NO_SPACE_BEFORE_PUNCTUATION = new Set([
  ",", ".", ";", ":", "!", "?",
  "\u3001", "\u3002", "\uff0c", "\uff1b", "\uff1a", "\uff01", "\uff1f",
  ")", "]", "}",
]);
const KREA2_SOFT_BOUNDARY_PUNCTUATION = new Set([
  ",", ";", ":",
  "\u3001", "\uff0c", "\uff1b", "\uff1a",
]);
const KREA2_EXTRA_PROSE_BOUNDARIES = new Set(["|"]);
const KREA2_QUOTE_MARKS = new Set(['"', "'", "\u2018", "\u2019", "\u201c", "\u201d"]);
const KREA2_TRAILING_CLOSERS = new Set(['"', "'", "\u2019", "\u201d", ")", "]", "}"]);

function isUnicodePunctuation(value: string) {
  return /^\p{P}$/u.test(value);
}

function isProseBoundaryCharacter(value: string) {
  return Boolean(value) && (
    KREA2_EXTRA_PROSE_BOUNDARIES.has(value) ||
    isUnicodePunctuation(value) && !KREA2_QUOTE_MARKS.has(value)
  );
}

function isExactBoundaryAt(
  value: string,
  index: number,
  { allowQuotes, allowWhitespace }: { allowQuotes: boolean; allowWhitespace: boolean },
) {
  const character = value[index] ?? "";
  if (!character) return false;
  if (/\s/u.test(character)) return allowWhitespace;
  if (character === "_") return false;
  if (character === "-") {
    return value[index - 1] === "-" || value[index + 1] === "-";
  }
  if (KREA2_EXTRA_PROSE_BOUNDARIES.has(character)) return true;
  return isUnicodePunctuation(character) && (allowQuotes || !KREA2_QUOTE_MARKS.has(character));
}

function isSingleTokenSegment(value: string) {
  return !/\s/u.test(value);
}

function normalizeTrailingBoundaryPunctuation(value: string) {
  let closerStart = value.length;
  while (closerStart > 0 && KREA2_TRAILING_CLOSERS.has(value[closerStart - 1] ?? "")) {
    closerStart -= 1;
  }

  const closers = value.slice(closerStart);
  if ([...closers].some((character) => KREA2_QUOTE_MARKS.has(character))) {
    return value;
  }

  const body = value.slice(0, closerStart);
  let punctuationStart = body.length;
  while (punctuationStart > 0 && isProseBoundaryCharacter(body[punctuationStart - 1] ?? "")) {
    punctuationStart -= 1;
  }
  const punctuation = body.slice(punctuationStart);
  if (!punctuation) return value;

  const meaningfulPunctuation = [...punctuation]
    .filter((character) => !KREA2_SOFT_BOUNDARY_PUNCTUATION.has(character));
  const normalizedPunctuation = meaningfulPunctuation.length > 0
    ? meaningfulPunctuation.join("")
    : punctuation[0] ?? "";

  return `${body.slice(0, punctuationStart)}${normalizedPunctuation}${closers}`;
}

function trimKrea2ParagraphTail(value: string) {
  const terminal = value.at(-1) ?? "";
  if (KREA2_TRAILING_CLOSERS.has(terminal)) return value;

  let end = value.length;
  while (end > 0 && KREA2_SOFT_BOUNDARY_PUNCTUATION.has(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(0, end).trimEnd();
}

/**
 * Normalize only presentation-level punctuation and whitespace. Quoted text is
 * kept opaque so visible text is not rewritten while adjacent section
 * boundaries remain safe to assemble.
 */
function normalizeKrea2PromptSegment(value: unknown) {
  if (typeof value !== "string") return "";

  const result: string[] = [];
  let pendingWhitespace = false;
  let inAsciiQuote = false;
  let inCurlyQuote = false;

  for (const character of value.trim()) {
    if (inAsciiQuote) {
      result.push(character);
      if (character === '"' && result.at(-2) !== "\\") {
        inAsciiQuote = false;
      }
      continue;
    }
    if (inCurlyQuote) {
      result.push(character);
      if (character === "\u201d") {
        inCurlyQuote = false;
      }
      continue;
    }

    if (/\s/u.test(character)) {
      pendingWhitespace = true;
      continue;
    }

    if (pendingWhitespace && result.length > 0 && !KREA2_NO_SPACE_BEFORE_PUNCTUATION.has(character)) {
      result.push(" ");
    }
    pendingWhitespace = false;
    result.push(character);

    if (character === '"') {
      inAsciiQuote = true;
    } else if (character === "\u201c") {
      inCurlyQuote = true;
    }
  }

  return normalizeTrailingBoundaryPunctuation(result.join("").trim());
}

function hasTerminalJoinBoundary(value: string) {
  let index = value.length - 1;
  while (index >= 0 && KREA2_TRAILING_CLOSERS.has(value[index] ?? "")) {
    index -= 1;
  }
  const terminal = value[index] ?? "";
  return isProseBoundaryCharacter(terminal);
}

function stripLeadingBoundarySeparators(value: string) {
  let start = 0;
  while (start < value.length && KREA2_SOFT_BOUNDARY_PUNCTUATION.has(value[start] ?? "")) {
    start += 1;
  }
  return value.slice(start).trimStart();
}

function joinKrea2PromptSegments(parts: readonly string[]) {
  let paragraph = "";

  for (const rawPart of parts) {
    const part = stripLeadingBoundarySeparators(normalizeKrea2PromptSegment(rawPart));
    if (!part) continue;
    if (!paragraph) {
      paragraph = part;
      continue;
    }

    paragraph += hasTerminalJoinBoundary(paragraph) ? ` ${part}` : `, ${part}`;
  }

  return paragraph;
}

function hasPromptBoundaryBefore(value: string, index: number, segment: string) {
  if (index === 0) return true;
  let boundaryIndex = index - 1;
  if (/\s/u.test(value[boundaryIndex] ?? "")) {
    if (isSingleTokenSegment(segment)) return true;
    while (boundaryIndex >= 0 && /\s/u.test(value[boundaryIndex] ?? "")) {
      boundaryIndex -= 1;
    }
  }
  if (boundaryIndex < 0) return true;

  if (isExactBoundaryAt(value, boundaryIndex, {
    allowQuotes: false,
    allowWhitespace: false,
  })) {
    return true;
  }

  const immediateBoundary = value[boundaryIndex] ?? "";
  return KREA2_QUOTE_MARKS.has(immediateBoundary) &&
    hasTerminalJoinBoundary(value.slice(0, index));
}

function hasPromptBoundaryAfter(value: string, segment: string, segmentEnd: number) {
  if (segmentEnd >= value.length) return true;
  let boundaryIndex = segmentEnd;
  if (/\s/u.test(value[boundaryIndex] ?? "")) {
    if (isSingleTokenSegment(segment) || hasTerminalJoinBoundary(segment)) return true;
    while (boundaryIndex < value.length && /\s/u.test(value[boundaryIndex] ?? "")) {
      boundaryIndex += 1;
    }
  }
  if (boundaryIndex >= value.length) return true;

  if (isExactBoundaryAt(value, boundaryIndex, {
    allowQuotes: false,
    allowWhitespace: false,
  })) {
    return true;
  }

  return false;
}

/**
 * Validate an opaque Krea segment at the paragraph tail using the same
 * punctuation normalization and boundary rules as local assembly.
 */
export function hasKrea2PromptSegmentExactlyOnceAtTail(positivePrompt: string, segment: string) {
  const prompt = trimKrea2ParagraphTail(normalizeKrea2PromptSegment(positivePrompt));
  const normalizedSegment = trimKrea2ParagraphTail(
    stripLeadingBoundarySeparators(normalizeKrea2PromptSegment(segment)),
  );
  if (!hasKrea2PromptSegmentAtTail(prompt, normalizedSegment)) return false;

  let occurrenceCount = 0;
  let searchStart = 0;
  while (searchStart <= prompt.length - normalizedSegment.length) {
    const index = prompt.indexOf(normalizedSegment, searchStart);
    if (index < 0) break;

    if (
      hasPromptBoundaryBefore(prompt, index, normalizedSegment) &&
      hasPromptBoundaryAfter(prompt, normalizedSegment, index + normalizedSegment.length)
    ) {
      occurrenceCount += 1;
    }
    searchStart = index + Math.max(1, normalizedSegment.length);
  }

  return occurrenceCount === 1;
}

function hasKrea2PromptSegmentAtTail(prompt: string, segment: string) {
  if (!segment || !prompt.endsWith(segment)) return false;
  return hasPromptBoundaryBefore(prompt, prompt.length - segment.length, segment);
}

function normalizedPromptKey(value: string) {
  return normalizeKrea2PromptSegment(value).toLocaleLowerCase();
}

function containsPromptPart(parts: readonly string[], value: string) {
  const prompt = parts.join(", ").toLocaleLowerCase();
  const part = normalizedPromptKey(value);
  if (!part) return false;

  let searchStart = 0;
  while (searchStart <= prompt.length - part.length) {
    const index = prompt.indexOf(part, searchStart);
    if (index < 0) return false;

    const afterIndex = index + part.length;
    if (
      (index === 0 || isExactBoundaryAt(prompt, index - 1, {
        allowQuotes: true,
        allowWhitespace: true,
      })) &&
      (afterIndex >= prompt.length || isExactBoundaryAt(prompt, afterIndex, {
        allowQuotes: true,
        allowWhitespace: true,
      }))
    ) {
      return true;
    }
    searchStart = index + Math.max(1, part.length);
  }

  return false;
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
    const normalizedPart = normalizeKrea2PromptSegment(part);
    const key = normalizedPromptKey(normalizedPart);
    if (!key || seen.has(key)) return;
    seen.add(key);
    orderedParts.push(normalizedPart);
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

  return trimKrea2ParagraphTail(joinKrea2PromptSegments(orderedParts));
}

/**
 * Append an opaque Krea paragraph segment, such as analyzed style-reference
 * prose, without splitting or semantically rewriting it. Exact suffix matching
 * keeps the segment idempotent across repeated local assembly.
 */
export function appendKrea2PromptSegmentExactlyOnce(positivePrompt: string, segment: string) {
  const prompt = trimKrea2ParagraphTail(normalizeKrea2PromptSegment(positivePrompt));
  const normalizedSegment = trimKrea2ParagraphTail(
    stripLeadingBoundarySeparators(normalizeKrea2PromptSegment(segment)),
  );
  if (!normalizedSegment) return prompt;
  if (!prompt) return normalizedSegment;
  if (hasKrea2PromptSegmentAtTail(prompt, normalizedSegment)) return prompt;

  return trimKrea2ParagraphTail(joinKrea2PromptSegments([prompt, normalizedSegment]));
}

export function buildKrea2AiResponseInstructions() {
  return [
    "Use Krea 2 Turbo's natural-language prompting order. Return only JSON with a krea2Sections object.",
    "Required ordered keys for ordinary character-and-scene requests: subjectMood, subjectAttributesAndActions, environmentAndBackground, visualStyleAndMedium, lightingColorAndTexture, spatialCompositionAndFraming.",
    "Every newly generated ordinary character-and-scene krea2Sections object must include environmentAndBackground and populate it with supported setting, environment, and background content; keep it concise when the input is sparse rather than inventing concrete details.",
    "Write detailed English natural-language prose that becomes one cohesive paragraph when the ordered sections are joined; never write tag soup, a list, multiple paragraphs, booru tags, quality tags, negative prompts, Markdown, or reasoning.",
    "For an ordinary character-and-scene request, aim for roughly 160-240 English words across the rendered positive paragraph. This is guidance, not a hard limit: do not truncate, reject, pad, repeat, or force a minimum, and let sparse input remain shorter when more detail would require invention.",
    "Keep section ownership non-overlapping. environmentAndBackground alone owns the setting, environment, background, and supported ambient scene details.",
    "spatialCompositionAndFraming alone owns foreground, midground, and background placement; relative scale; atmospheric depth; framing; and subject-background separation or contrast.",
    "Keep every requested subject, action, color, visible text in double quotes, medium, and spatial relationship faithful to the user input.",
    "Bind each subject's attributes and actions to that subject. Keep user-specified media exactly as specified.",
    "Elaborate only presentation or spatial relationships grounded in supplied facts. Do not invent unsupported characters, animals, concrete objects, clothing, materials, colors, visible text, or events.",
    "Do not emit selectedLoraTriggerWords; SceneForge appends selected local LoRA trained words once after the visual sections.",
  ].join("\n");
}
