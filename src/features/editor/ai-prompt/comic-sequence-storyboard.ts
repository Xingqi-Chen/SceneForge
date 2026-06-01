import type { LlmChatMessage } from "@/features/llm";

export const COMIC_SEQUENCE_STORYBOARD_MIN_SHOTS = 1;
export const COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS = 20;

export type ComicSequenceStoryboardShot = {
  title: string;
  prompt: string;
};

export type ComicSequenceStoryboardResult = {
  shots: ComicSequenceStoryboardShot[];
};

export type ComicSequenceStoryboardPromptProfile = "default" | "anima";

export type BuildComicSequenceStoryboardMessagesInput = {
  existingShotCount?: number;
  globalPrompt?: string;
  negativePrompt?: string;
  promptProfile?: ComicSequenceStoryboardPromptProfile;
  story: string;
  targetShotCount?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function normalizeComicSequenceStoryboardTargetCount(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
  if (parsed === undefined) {
    return undefined;
  }

  return Math.min(COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS, Math.max(COMIC_SEQUENCE_STORYBOARD_MIN_SHOTS, parsed));
}

function readOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildComicSequenceStoryboardMessages({
  existingShotCount,
  globalPrompt,
  negativePrompt,
  promptProfile = "default",
  story,
  targetShotCount,
}: BuildComicSequenceStoryboardMessagesInput): LlmChatMessage[] {
  const normalizedTarget = normalizeComicSequenceStoryboardTargetCount(targetShotCount);
  const shotCountInstruction = normalizedTarget
    ? `Create exactly ${normalizedTarget} shots.`
    : `Choose the natural number of shots for the action rhythm, with an upper limit of ${COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS}.`;
  const animaPrompt = promptProfile === "anima";
  const promptStyleInstructions = animaPrompt
    ? [
        "Each prompt must be an English Anima local shot prompt:",
        "compact anime-style natural-language visual phrases, comma-separated, not full prose paragraphs.",
        "",
        "Use anime visual phrasing such as:",
        "a low-angle close-up as the hero raises one arm, a dynamic sword draw with motion blur,",
        "determined expression amid debris and impact lines, reaching out to grab an arm,",
        "leaning close while facing each other, looking at another with a surprised expression.",
      ]
    : [
        "Each prompt must be an English booru-style local shot prompt:",
        "comma-separated tags and short tag phrases, not natural-language sentences.",
        "",
        "Use anime prompt vocabulary such as:",
        "low angle, close-up, dynamic pose, one arm raised, sword draw, blocking attack,",
        "motion blur, determined expression, debris, impact lines, eye contact,",
        "reaching out, holding hands, grabbing arm, hand on shoulder, leaning close,",
        "facing each other, looking at another, reacting, surprised expression.",
      ];
  const promptFocusInstruction = animaPrompt
    ? "Focus each prompt on local action, camera framing, pose, expression, gesture, motion, character placement, interaction, and immediate setting as compact visual phrases."
    : "Focus each prompt on local action, camera framing, pose, expression, gesture, motion, character placement, interaction, and immediate setting as tags.";
  const proseExampleInstructions = animaPrompt
    ? [
        "Do not write full prose paragraphs like:",
        "\"the hero jumps forward while blocking a strike, and the camera follows the motion\"",
        "",
        "Rewrite them as compact visual phrases like:",
        "2 people, character A in the foreground leaping forward, character B in the background blocking with a sword, impact lines, determined expression.",
      ]
    : [
        "Do not write prose sentences like:",
        "\"the hero jumps forward while blocking a strike\"",
        "",
        "Rewrite them as tags like:",
        "2 people, character A in foreground, character B in background, dynamic pose, jumping, blocking attack, sword clash, impact lines, determined expression.",
      ];

  return [
    {
      role: "system",
      content: [
        "You are a comic and cinematic storyboard assistant for Stable Diffusion image generation.",
        "",
        "Split the user's complete action paragraph into sequential, single-image shots.",
        shotCountInstruction,
        "",
        "Return JSON only. Do not wrap it in markdown.",
        "Schema: { \"shots\": [{ \"title\"?: string, \"prompt\": string }] }.",
        "",
        "Include a short natural-language title for each shot when possible. The title is only for the UI.",
        "",
        ...promptStyleInstructions,
        "",
        "For shots with two or more active visible characters:",
        "- Mark the visible active character count, such as 2 people, 1girl, 1boy, 2girls, or 2boys. Use many people or crowd for crowd shots instead of inventing an exact count.",
        "- Use character A and character B when two distinct people need disambiguation. For three or more distinct people, use character A, character B, character C, or clear role labels already present in the user's story.",
        "- Keep character labels consistent across shots when the same people continue across the sequence.",
        "- Clearly describe relative placement, such as character A on the left, character B on the right, character A in foreground, character B in background.",
        "- Clearly describe interaction direction: who acts, who receives, who reacts.",
        "- Include the contact point or shared object when relevant, such as hands near cup, hand on shoulder, grabbing wrist, sword between them.",
        "- Include gaze relationship when relevant, such as eye contact, looking at another, character A looking at character B, character B looking away.",
        "- Prefer both visible, clear separation between characters, readable silhouettes for interaction shots.",
        "- Avoid vague phrases like interacting, together, with another person unless supported by concrete action tags.",
        "",
        "Do not connect separate words with underscores; preserve underscores only when they are part of a known canonical tag or exact source token.",
        "",
        promptFocusInstruction,
        "",
        "Do not repeat broad global art style, quality boilerplate, LoRA syntax, model names, or negative prompt terms.",
        "",
        "Do not invent character identities, extra characters, model resources, or off-screen events not implied by the user's paragraph.",
        "",
        ...proseExampleInstructions,
        "",
        "Keep each prompt concise but specific enough to paste into a Manual shot prompt field.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          existingShotCount: existingShotCount ?? 0,
          globalPrompt: globalPrompt?.trim() || undefined,
          negativePrompt: negativePrompt?.trim() || undefined,
          story: story.trim(),
          targetShotCount: normalizedTarget ?? "auto",
        },
        null,
        2,
      ),
    },
  ];
}

export function parseComicSequenceStoryboardResponse(
  rawContent: string,
  options: { existingShotCount?: number; maxShots?: number } = {},
): ComicSequenceStoryboardResult {
  const parsed = parseJsonCandidate(rawContent);
  const parsedMaxShots =
    typeof options.maxShots === "number" && Number.isFinite(options.maxShots)
      ? Math.round(options.maxShots)
      : COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS;
  const maxShots = Math.min(COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS, Math.max(COMIC_SEQUENCE_STORYBOARD_MIN_SHOTS, parsedMaxShots));
  const existingShotCount = Math.max(0, Math.round(options.existingShotCount ?? 0));

  if (!isRecord(parsed) || !Array.isArray(parsed.shots)) {
    return { shots: [] };
  }

  const shots: ComicSequenceStoryboardShot[] = [];
  for (const value of parsed.shots) {
    if (shots.length >= maxShots || !isRecord(value)) {
      continue;
    }

    const prompt = readOptionalText(value.prompt);
    if (!prompt) {
      continue;
    }

    shots.push({
      title: readOptionalText(value.title) || `Shot ${existingShotCount + shots.length + 1}`,
      prompt,
    });
  }

  return { shots };
}
