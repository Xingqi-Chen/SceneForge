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

export type BuildComicSequenceStoryboardMessagesInput = {
  existingShotCount?: number;
  globalPrompt?: string;
  negativePrompt?: string;
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
  story,
  targetShotCount,
}: BuildComicSequenceStoryboardMessagesInput): LlmChatMessage[] {
  const normalizedTarget = normalizeComicSequenceStoryboardTargetCount(targetShotCount);
  const shotCountInstruction = normalizedTarget
    ? `Create exactly ${normalizedTarget} shots.`
    : `Choose the natural number of shots for the action rhythm, with an upper limit of ${COMIC_SEQUENCE_STORYBOARD_MAX_SHOTS}.`;

  return [
    {
      role: "system",
      content: [
        "You are a comic and cinematic storyboard assistant for Stable Diffusion image generation.",
        "Split the user's complete action paragraph into sequential shots.",
        shotCountInstruction,
        "Return JSON only. Do not wrap it in markdown.",
        "Schema: { \"shots\": [{ \"title\"?: string, \"prompt\": string }] }.",
        "The title may be a short natural-language label for the UI.",
        "Each prompt must be an English Danbooru/booru-style local shot prompt: comma-separated tags and short tag phrases, not natural-language sentences.",
        "Use anime prompt vocabulary such as low_angle, close-up, dynamic_pose, one_arm_raised, sword_draw, blocking_attack, motion_blur, determined_expression, debris, impact_lines.",
        "Use underscores for multi-word Danbooru-like tags when appropriate.",
        "Focus each prompt on local action, camera framing, pose, expression, gesture, motion, and immediate setting as tags.",
        "Do not repeat broad global art style, quality boilerplate, LoRA syntax, model names, or negative prompt terms.",
        "Do not write prose sentences like \"the hero jumps forward while blocking a strike\"; rewrite them as tags like dynamic_pose, jumping, blocking_attack.",
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
