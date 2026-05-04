import {
  PROMPT_TAG_CATEGORY_ORDER,
  PROMPT_TAG_SUBCATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
  migrateLegacyPromptTagCategorySubcategory,
  normalizePromptTagCategory,
  normalizePromptTagSubcategory,
} from "./prompt-tag-taxonomy";
import type { BodyPartId, CharacterBodyPart, PromptTag } from "@/shared/types";
import type { LlmChatMessage } from "@/features/llm";

type CharacterImagePromptTagItem = {
  bodyPartId: BodyPartId;
  tag: Omit<PromptTag, "id">;
};

export type ParseCharacterImagePromptTagsResult =
  | { ok: true; items: CharacterImagePromptTagItem[] }
  | { ok: false; error: string };

const BODY_PART_IDS = new Set<BodyPartId>([
  "head",
  "torso",
  "leftUpperArm",
  "leftForearm",
  "rightUpperArm",
  "rightForearm",
  "leftThigh",
  "leftShin",
  "rightThigh",
  "rightShin",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  if (fence?.[1]) {
    return fence[1].trim();
  }

  return trimmed;
}

function normalizeBodyPartId(value: unknown): BodyPartId | null {
  if (typeof value !== "string") {
    return null;
  }

  const bodyPartId = value.trim() as BodyPartId;
  return BODY_PART_IDS.has(bodyPartId) ? bodyPartId : null;
}

function trimPromptToken(value: string) {
  let token = value.trim();

  while (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith("(") && token.endsWith(")"))
  ) {
    token = token.slice(1, -1).trim();
  }

  return token;
}

function parseWeight(prompt: string) {
  const trimmed = trimPromptToken(prompt);
  const weighted = /^(.*):([0-9]+(?:\.[0-9]+)?)$/.exec(trimmed);

  if (!weighted?.[1] || !weighted[2]) {
    return { prompt: trimmed, weight: { enabled: false, value: 1 } };
  }

  const value = Number(weighted[2]);
  if (!Number.isFinite(value)) {
    return { prompt: trimmed, weight: { enabled: false, value: 1 } };
  }

  return {
    prompt: trimPromptToken(weighted[1]),
    weight: { enabled: true, value },
  };
}

function parseItem(value: unknown): CharacterImagePromptTagItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const bodyPartId = normalizeBodyPartId(value.bodyPartId ?? value.partId ?? value.part);
  if (!bodyPartId) {
    return null;
  }

  const rawPrompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (!rawPrompt || rawPrompt.includes(",")) {
    return null;
  }

  const { prompt, weight } = parseWeight(rawPrompt);
  if (!prompt) {
    return null;
  }

  const migrated = migrateLegacyPromptTagCategorySubcategory(value.category, value.subcategory);
  const category = normalizePromptTagCategory(migrated.category);
  const subcategory = normalizePromptTagSubcategory(category, migrated.subcategory);
  const label = typeof value.label === "string" && value.label.trim()
    ? value.label.trim()
    : prompt.slice(0, 48);

  return {
    bodyPartId,
    tag: {
      label,
      prompt,
      category,
      ...(subcategory ? { subcategory } : {}),
      negative: category === "negative" ? true : Boolean(value.negative),
      weight,
    },
  };
}

export function parseCharacterImagePromptTagsContent(
  content: string,
): ParseCharacterImagePromptTagsResult {
  const jsonText = extractJsonPayload(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return { ok: false, error: "无法解析 AI 返回的 JSON。" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "JSON 顶层必须是对象。" };
  }

  const items = parsed.items;
  if (!Array.isArray(items)) {
    return { ok: false, error: 'JSON 必须包含 "items" 数组。' };
  }

  const parsedItems = items
    .map(parseItem)
    .filter((item): item is CharacterImagePromptTagItem => Boolean(item));

  if (parsedItems.length === 0) {
    return { ok: false, error: "AI 未返回可绑定到人物部位的有效提示词。" };
  }

  return { ok: true, items: parsedItems };
}

export function buildCharacterImagePromptTagMessages({
  bodyParts,
  existingTags,
  imageDataUrl,
}: {
  bodyParts: CharacterBodyPart[];
  existingTags: PromptTag[];
  imageDataUrl: string;
}): LlmChatMessage[] {
  const categoryList = PROMPT_TAG_CATEGORY_ORDER.join(", ");
  const subcategoryList = PROMPT_TAG_CATEGORY_ORDER.map((category) => {
    const values = PROMPT_TAG_SUBCATEGORY_OPTIONS[category]
      .map((subcategory) => `${subcategory} (${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]})`)
      .join(", ");

    return `- ${category}: ${values}`;
  }).join("\n");
  const compactExistingTags = existingTags.slice(0, 180).map((tag) => ({
    label: tag.label,
    prompt: tag.prompt,
    category: tag.category,
    subcategory: tag.subcategory ?? "",
  }));

  return [
    {
      role: "system",
      content: [
        "You reverse-engineer reusable image prompt tags from a reference character image for SceneForge.",
        "The user provides one compressed character image and a list of available character body parts.",
        "Infer short Stable Diffusion / Midjourney style prompt tags that match the project prompt-library style.",
        "Prefer reusing existing prompt wording when the visual idea already exists in the provided library examples.",
        "Every returned item MUST be bound to exactly one bodyPartId from the provided list.",
        "Use head for hair, face, eyes, expression, hats, glasses, and head accessories.",
        "Use torso for full outfit, upper clothing, body silhouette, dress, coat, armor, chest accessories, and whole-body style when no smaller part fits.",
        "Use hands/feet/arms/legs only for visible details specific to those limbs.",
        "Keep prompts atomic: one prompt token per item, no comma-separated prompt values.",
        "Use category body-part for anatomy, hair, eyes, face, hands, legs, and category outfit for clothing/accessories. Use character only for role/pose/expression that belongs to the whole character but still bind it to the best visible part.",
        "Do not invent hidden details. Skip uncertain or occluded parts.",
        "Return compact JSON ONLY, no markdown, no commentary.",
        `Categories: ${categoryList}.`,
        "Allowed subcategories:",
        subcategoryList,
        'Shape: {"items":[{"bodyPartId":"head","label":"黑长发","prompt":"long black hair","category":"body-part","subcategory":"body-part-hair"}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            bodyParts: bodyParts.map((part) => ({ id: part.id, label: part.label })),
            existingPromptLibraryExamples: compactExistingTags,
          }),
        },
        {
          type: "image_url",
          image_url: {
            url: imageDataUrl,
            detail: "low",
          },
        },
      ],
    },
  ];
}
