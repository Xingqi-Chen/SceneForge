import type { PromptTagCategory, PromptTagSubcategory } from "@/shared/types";

export const PROMPT_TAG_CATEGORY_ORDER = [
  "style",
  "lighting",
  "quality",
  "scene",
  "character",
  "body-part",
  "negative",
] satisfies PromptTagCategory[];

export const PROMPT_TAG_CATEGORY_LABELS: Record<PromptTagCategory, string> = {
  style: "风格",
  lighting: "光照",
  quality: "质量",
  scene: "场景",
  character: "人物",
  "body-part": "身体部位",
  negative: "负面提示",
};

export const PROMPT_TAG_SUBCATEGORY_LABELS: Record<PromptTagSubcategory, string> = {
  "style-rendering": "画风",
  "style-camera": "镜头",
  "style-composition": "构图",
  "style-color": "色彩",
  "lighting-source": "光源",
  "lighting-mood": "氛围光",
  "lighting-shadow": "阴影",
  "quality-detail": "细节",
  "quality-resolution": "清晰度",
  "quality-finish": "完成度",
  "scene-environment": "环境",
  "scene-weather": "天气",
  "scene-background": "背景",
  "scene-prop": "道具",
  "character-subject": "主体",
  "character-clothing": "服装",
  "character-pose": "姿态",
  "character-expression": "表情",
  "character-accessory": "配饰",
  "body-part-hair": "头发",
  "body-part-eyes": "眼睛",
  "body-part-face": "面部",
  "body-part-hands": "手部",
  "body-part-legs": "腿脚",
  "body-part-body": "身体",
  "negative-quality": "质量问题",
  "negative-anatomy": "人体问题",
  "negative-artifact": "画面瑕疵",
  "negative-composition": "构图问题",
};

export const PROMPT_TAG_SUBCATEGORY_OPTIONS: Record<PromptTagCategory, PromptTagSubcategory[]> = {
  style: ["style-rendering", "style-camera", "style-composition", "style-color"],
  lighting: ["lighting-source", "lighting-mood", "lighting-shadow"],
  quality: ["quality-detail", "quality-resolution", "quality-finish"],
  scene: ["scene-environment", "scene-weather", "scene-background", "scene-prop"],
  character: [
    "character-subject",
    "character-clothing",
    "character-pose",
    "character-expression",
    "character-accessory",
  ],
  "body-part": [
    "body-part-hair",
    "body-part-eyes",
    "body-part-face",
    "body-part-hands",
    "body-part-legs",
    "body-part-body",
  ],
  negative: ["negative-quality", "negative-anatomy", "negative-artifact", "negative-composition"],
};

const promptTagSubcategorySet = new Set<PromptTagSubcategory>(
  Object.values(PROMPT_TAG_SUBCATEGORY_OPTIONS).flat(),
);

export function isPromptTagCategory(value: unknown): value is PromptTagCategory {
  return (
    typeof value === "string" &&
    (PROMPT_TAG_CATEGORY_ORDER as readonly string[]).includes(value)
  );
}

export function isPromptTagSubcategory(value: unknown): value is PromptTagSubcategory {
  return typeof value === "string" && promptTagSubcategorySet.has(value as PromptTagSubcategory);
}

export function normalizePromptTagCategory(value: unknown): PromptTagCategory {
  return isPromptTagCategory(value) ? value : "style";
}

export function normalizePromptTagSubcategory(
  category: PromptTagCategory,
  value: unknown,
): PromptTagSubcategory | undefined {
  if (!isPromptTagSubcategory(value)) {
    return undefined;
  }

  return PROMPT_TAG_SUBCATEGORY_OPTIONS[category].includes(value) ? value : undefined;
}
