import {
  PROMPT_TAG_SUBCATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
  migrateLegacyPromptTagCategorySubcategory,
  normalizePromptTagCategory,
  normalizePromptTagSubcategory,
} from "./prompt-tag-taxonomy";
import type { BodyPartId, CharacterBodyPart, PromptTag, PromptTagCategory } from "@/shared/types";
import type { LlmChatMessage } from "@/features/llm";

export type CharacterPromptTagTarget =
  | { kind: "scene" }
  | { kind: "character" }
  | { kind: "bodyPart"; bodyPartId: BodyPartId };

type CharacterImagePromptTagItem = {
  target: CharacterPromptTagTarget;
  bodyPartId?: BodyPartId;
  tag: Omit<PromptTag, "id">;
};

type CharacterPromptTagMessageContext = {
  bodyParts: CharacterBodyPart[];
  characterTarget: {
    label: string;
    promptCategoryBindings?: PromptTagCategory[];
  };
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
export const CHARACTER_BODY_PROMPT_TAG_CATEGORIES = [
  "character",
  "body-part",
  "outfit",
] satisfies PromptTagCategory[];
export const SCENE_PROMPT_TAG_CATEGORIES = [
  "style",
  "lighting",
  "quality",
  "scene",
] satisfies PromptTagCategory[];

export function isCharacterBodyPromptTagCategory(
  category: PromptTagCategory,
): category is (typeof CHARACTER_BODY_PROMPT_TAG_CATEGORIES)[number] {
  return (CHARACTER_BODY_PROMPT_TAG_CATEGORIES as readonly PromptTagCategory[]).includes(category);
}

export function isScenePromptTagCategory(
  category: PromptTagCategory,
): category is (typeof SCENE_PROMPT_TAG_CATEGORIES)[number] {
  return (SCENE_PROMPT_TAG_CATEGORIES as readonly PromptTagCategory[]).includes(category);
}

function getAllowedCharacterBodyCategories(categories: PromptTagCategory[] | undefined) {
  return (categories ?? []).filter(isCharacterBodyPromptTagCategory);
}

function getAllowedWholeCharacterCategories(categories: PromptTagCategory[] | undefined) {
  return categories?.includes("character") ? ["character"] : [];
}

function getAllowedSceneCategories(categories: PromptTagCategory[] | undefined) {
  return (categories ?? []).filter(isScenePromptTagCategory);
}

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

function normalizePromptTarget(value: Record<string, unknown>): CharacterPromptTagTarget | null {
  const targetKind = typeof value.targetKind === "string" ? value.targetKind.trim() : "";
  const target = typeof value.target === "string" ? value.target.trim() : "";
  const bodyPartValue = value.bodyPartId ?? value.partId ?? value.part;

  if (targetKind === "scene" || target === "scene") {
    return { kind: "scene" };
  }

  if (targetKind === "character" || target === "character" || bodyPartValue === "character") {
    return { kind: "character" };
  }

  const bodyPartId =
    normalizeBodyPartId(bodyPartValue) ??
    normalizeBodyPartId(targetKind) ??
    normalizeBodyPartId(target);
  return bodyPartId ? { kind: "bodyPart", bodyPartId } : null;
}

function getPromptTargetBodyPartId(target: CharacterPromptTagTarget) {
  return target.kind === "bodyPart" ? target.bodyPartId : undefined;
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

  const target = normalizePromptTarget(value);
  if (!target) {
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
    target,
    ...(getPromptTargetBodyPartId(target) ? { bodyPartId: getPromptTargetBodyPartId(target) } : {}),
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
  characterTarget,
  imageDataUrl,
}: {
  bodyParts: CharacterBodyPart[];
  characterTarget: CharacterPromptTagMessageContext["characterTarget"];
  imageDataUrl: string;
}): LlmChatMessage[] {
  const categoryList = CHARACTER_BODY_PROMPT_TAG_CATEGORIES.join(", ");
  const subcategoryList = CHARACTER_BODY_PROMPT_TAG_CATEGORIES.map((category) => {
    const values = PROMPT_TAG_SUBCATEGORY_OPTIONS[category]
      .map((subcategory) => `${subcategory} (${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]})`)
      .join(", ");

    return `- ${category}: ${values}`;
  }).join("\n");

  return [
    {
      role: "system",
      content: [
        "You reverse-engineer reusable image prompt tags from a reference character image for SceneForge.",
        "The user provides one compressed character image and a list of available character body parts.",
        "Infer short Stable Diffusion style prompt tags that match the project prompt-library style.",
        "Every returned item MUST target either the whole character or exactly one bodyPartId from the provided list.",
        "Each target has allowedCategories. The item's category MUST be included in that exact target's allowedCategories.",
        "Use targetKind character only for category character whole-character role, subject, pose, or expression tags.",
        "Never bind category body-part or outfit to targetKind character; bind those to the most specific matching bodyPart target.",
        "Use head for hair, face, eyes, expression, hats, glasses, and head accessories.",
        "Use torso for full outfit, upper clothing, body silhouette, dress, coat, armor, chest accessories, and whole-body style when no smaller part fits.",
        "Use hands/feet/arms/legs only for visible details specific to those limbs.",
        "Keep prompts atomic: one prompt token per item, no comma-separated prompt values.",
        "The label MUST be a short Simplified Chinese display label. The prompt MUST stay in English image-prompt wording.",
        "Use category body-part for anatomy, hair, eyes, face, hands, and legs. Use category outfit for clothing/accessories. Use category character only for whole-character role, subject, pose, or expression tags.",
        "Never return style, lighting, quality, scene, or negative prompt tags.",
        "Do not invent hidden details. Skip uncertain or occluded parts.",
        "Return compact JSON ONLY, no markdown, no commentary.",
        `Categories: ${categoryList}.`,
        "Allowed subcategories:",
        subcategoryList,
        'Shape: {"items":[{"targetKind":"bodyPart","bodyPartId":"head","label":"黑长发","prompt":"long black hair","category":"body-part","subcategory":"body-part-hair"},{"targetKind":"character","label":"站姿","prompt":"standing pose","category":"character","subcategory":"character-pose"}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            characterTarget: {
              targetKind: "character",
              label: characterTarget.label,
              allowedCategories: getAllowedWholeCharacterCategories(characterTarget.promptCategoryBindings),
            },
            bodyParts: bodyParts.map((part) => ({
              id: part.id,
              label: part.label,
              allowedCategories: getAllowedCharacterBodyCategories(part.promptCategoryBindings),
            })),
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

export function buildCharacterTextPromptTagMessages({
  bodyParts,
  characterTarget,
  userPrompt,
}: CharacterPromptTagMessageContext & {
  userPrompt: string;
}): LlmChatMessage[] {
  const categoryList = CHARACTER_BODY_PROMPT_TAG_CATEGORIES.join(", ");
  const subcategoryList = CHARACTER_BODY_PROMPT_TAG_CATEGORIES.map((category) => {
    const values = PROMPT_TAG_SUBCATEGORY_OPTIONS[category]
      .map((subcategory) => `${subcategory} (${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]})`)
      .join(", ");

    return `- ${category}: ${values}`;
  }).join("\n");

  return [
    {
      role: "system",
      content: [
        "You reverse-engineer reusable image prompt tags from a natural-language character idea for SceneForge.",
        "The user provides a rough character prompt and a list of available character body parts.",
        "Infer short Stable Diffusion style prompt tags that match the project prompt-library style.",
        "If the input is short, abstract, or underspecified, freely expand it into a coherent visual design while staying faithful to the stated idea.",
        "Do not ask follow-up questions. Make reasonable creative choices for missing details.",
        "Every returned item MUST target either the whole character or exactly one bodyPartId from the provided list.",
        "Each target has allowedCategories. The item's category MUST be included in that exact target's allowedCategories.",
        "Use targetKind character only for category character whole-character role, subject, pose, or expression tags.",
        "Never bind category body-part or outfit to targetKind character; bind those to the most specific matching bodyPart target.",
        "Use head for hair, face, eyes, expression, hats, glasses, and head accessories.",
        "Use torso for full outfit, upper clothing, body silhouette, dress, coat, armor, chest accessories, and whole-body style when no smaller part fits.",
        "Use hands/feet/arms/legs only for details specific to those limbs.",
        "Keep prompts atomic: one prompt token per item, no comma-separated prompt values.",
        "The label MUST be a short Simplified Chinese display label. The prompt MUST stay in English image-prompt wording.",
        "Use category body-part for anatomy, hair, eyes, face, hands, and legs. Use category outfit for clothing/accessories. Use category character only for whole-character role, subject, pose, or expression tags.",
        "Never return style, lighting, quality, scene, or negative prompt tags, even if the user's text mentions background, atmosphere, camera, or lighting.",
        "Return compact JSON ONLY, no markdown, no commentary.",
        `Categories: ${categoryList}.`,
        "Allowed subcategories:",
        subcategoryList,
        'Shape: {"items":[{"targetKind":"bodyPart","bodyPartId":"head","label":"黑长发","prompt":"long black hair","category":"body-part","subcategory":"body-part-hair"},{"targetKind":"character","label":"站姿","prompt":"standing pose","category":"character","subcategory":"character-pose"}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        characterTarget: {
          targetKind: "character",
          label: characterTarget.label,
          allowedCategories: getAllowedWholeCharacterCategories(characterTarget.promptCategoryBindings),
        },
        bodyParts: bodyParts.map((part) => ({
          id: part.id,
          label: part.label,
          allowedCategories: getAllowedCharacterBodyCategories(part.promptCategoryBindings),
        })),
        userCharacterPrompt: userPrompt.trim(),
      }),
    },
  ];
}

function buildSceneSubcategoryList() {
  return SCENE_PROMPT_TAG_CATEGORIES.map((category) => {
    const values = PROMPT_TAG_SUBCATEGORY_OPTIONS[category]
      .map((subcategory) => `${subcategory} (${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]})`)
      .join(", ");

    return `- ${category}: ${values}`;
  }).join("\n");
}

function getSceneMessageHeader(source: "image" | "text") {
  return [
    `You reverse-engineer reusable image prompt tags from a reference scene ${source} for SceneForge.`,
    "Infer short Stable Diffusion style prompt tags that match the project prompt-library style.",
    "Every returned item MUST target the scene with targetKind scene.",
    "Each returned category MUST be one of the scene allowedCategories.",
    "Extract only broad reusable tags for visual style, lighting, image quality, and scene/environment.",
    "Use category style for rendering style, mood, atmosphere, camera/shot language, and overall art direction.",
    "Use category lighting for light source, brightness, color temperature, shadows, and time-of-day light.",
    "Use category quality for rendering quality, detail level, resolution/finish, and model-quality terms.",
    "Use category scene for location, background, environment, weather, and reusable props.",
    "Never return character, body-part, outfit, or negative prompt tags.",
    "Keep prompts atomic: one prompt token per item, no comma-separated prompt values.",
    "The label MUST be a short Simplified Chinese display label. The prompt MUST stay in English image-prompt wording.",
    "Do not invent hidden details. Skip uncertain details.",
    "Return compact JSON ONLY, no markdown, no commentary.",
    `Categories: ${SCENE_PROMPT_TAG_CATEGORIES.join(", ")}.`,
    "Allowed subcategories:",
    buildSceneSubcategoryList(),
    'Shape: {"items":[{"targetKind":"scene","label":"柔和光照","prompt":"soft lighting","category":"lighting","subcategory":"lighting-mood"},{"targetKind":"scene","label":"室内背景","prompt":"cozy interior background","category":"scene","subcategory":"scene-background"}]}',
  ].join("\n");
}

export function buildSceneImagePromptTagMessages({
  imageDataUrl,
  sceneTarget,
}: {
  imageDataUrl: string;
  sceneTarget: {
    label: string;
    description?: string;
    promptCategoryBindings?: PromptTagCategory[];
  };
}): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: getSceneMessageHeader("image"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            sceneTarget: {
              targetKind: "scene",
              label: sceneTarget.label,
              description: sceneTarget.description,
              allowedCategories: getAllowedSceneCategories(sceneTarget.promptCategoryBindings),
            },
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

export function buildSceneTextPromptTagMessages({
  sceneTarget,
  userPrompt,
}: {
  sceneTarget: {
    label: string;
    description?: string;
    promptCategoryBindings?: PromptTagCategory[];
  };
  userPrompt: string;
}): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        getSceneMessageHeader("text"),
        "If the input is short, abstract, or underspecified, expand it into a coherent scene direction while staying faithful to the stated idea.",
        "Do not ask follow-up questions. Make reasonable creative choices for missing details.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        sceneTarget: {
          targetKind: "scene",
          label: sceneTarget.label,
          description: sceneTarget.description,
          allowedCategories: getAllowedSceneCategories(sceneTarget.promptCategoryBindings),
        },
        userScenePrompt: userPrompt.trim(),
      }),
    },
  ];
}
