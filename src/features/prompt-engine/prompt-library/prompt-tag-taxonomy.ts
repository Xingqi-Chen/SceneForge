import type { PromptTag, PromptTagCategory, PromptTagSubcategory } from "@/shared/types";

export const PROMPT_TAG_CATEGORY_ORDER = [
  "style",
  "lighting",
  "quality",
  "scene",
  "character",
  "body-part",
  "outfit",
  "negative",
] satisfies PromptTagCategory[];

export const PROMPT_TAG_CATEGORY_LABELS: Record<PromptTagCategory, string> = {
  style: "风格",
  lighting: "光照",
  quality: "质量",
  scene: "场景",
  character: "人物",
  outfit: "服装",
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
  "character-pose": "姿态",
  "character-expression": "表情",
  "body-part-hair": "头发",
  "body-part-eyes": "眼睛",
  "body-part-face": "面部",
  "body-part-hands": "手部",
  "body-part-legs": "腿脚",
  "body-part-body": "身体",
  "outfit-upper": "上装",
  "outfit-lower": "下装",
  "outfit-dress": "裙装",
  "outfit-footwear": "鞋袜",
  "outfit-accessory": "配饰",
  "outfit-full": "整身/套装",
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
  character: ["character-subject", "character-pose", "character-expression"],
  "body-part": [
    "body-part-hair",
    "body-part-eyes",
    "body-part-face",
    "body-part-hands",
    "body-part-legs",
    "body-part-body",
  ],
  outfit: ["outfit-upper", "outfit-lower", "outfit-dress", "outfit-footwear", "outfit-accessory", "outfit-full"],
  negative: ["negative-quality", "negative-anatomy", "negative-artifact", "negative-composition"],
};

const promptTagSubcategorySet = new Set<PromptTagSubcategory>(
  Object.values(PROMPT_TAG_SUBCATEGORY_OPTIONS).flat(),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 已移除的服装子类 id → 当前子类（载入旧存档、绑定列表时使用）。 */
const DROPPED_OUTFIT_SUBCATEGORY_REMAP: Record<string, PromptTagSubcategory> = {
  "outfit-outerwear": "outfit-upper",
  "outfit-underwear": "outfit-full",
  "outfit-lounge": "outfit-full",
  "outfit-socks": "outfit-footwear",
  "outfit-bag": "outfit-accessory",
  "outfit-headwear": "outfit-accessory",
};

function remapDroppedOutfitSubcategoryId(subcategory: unknown): unknown {
  if (typeof subcategory !== "string") {
    return subcategory;
  }

  return DROPPED_OUTFIT_SUBCATEGORY_REMAP[subcategory] ?? subcategory;
}

/**
 * 旧版「人物」下的服装/配饰子类迁入独立「服装」大类（载入旧 JSON、合并导入等）。
 * 按子类识别，避免 category/subcategory 不一致的存档无法修正。
 * 已删减的服装子类 id 会映射到当前二次元常用分类。
 */
export function migrateLegacyPromptTagCategorySubcategory(
  category: unknown,
  subcategory: unknown,
): { category: unknown; subcategory: unknown } {
  if (subcategory === "character-clothing") {
    return { category: "outfit", subcategory: "outfit-full" };
  }

  if (subcategory === "character-accessory") {
    return { category: "outfit", subcategory: "outfit-accessory" };
  }

  const remappedSub = remapDroppedOutfitSubcategoryId(subcategory);
  if (remappedSub !== subcategory) {
    return { category: "outfit", subcategory: remappedSub };
  }

  return { category, subcategory };
}

/** 将绑定列表中的旧子类 id 替换为新服装子类，并在需要时插入 `outfit` 一级类目。 */
export function migrateLegacyPromptBindingArrays(
  categoriesRaw: unknown,
  subcategoriesRaw: unknown,
): { categoriesRaw: unknown; subcategoriesRaw: unknown } {
  if (!Array.isArray(subcategoriesRaw)) {
    return { categoriesRaw, subcategoriesRaw };
  }

  const mappedSubs = subcategoriesRaw.map((s) => {
    if (s === "character-clothing") {
      return "outfit-full";
    }

    if (s === "character-accessory") {
      return "outfit-accessory";
    }

    return remapDroppedOutfitSubcategoryId(s);
  });

  const needsOutfit = mappedSubs.some(
    (s) => typeof s === "string" && (s as string).startsWith("outfit-"),
  );

  if (!needsOutfit || !Array.isArray(categoriesRaw)) {
    return { categoriesRaw, subcategoriesRaw: mappedSubs };
  }

  const order = PROMPT_TAG_CATEGORY_ORDER;
  const merged = new Set<PromptTagCategory>();

  for (const c of categoriesRaw) {
    if (typeof c === "string" && (order as readonly string[]).includes(c)) {
      merged.add(c as PromptTagCategory);
    }
  }

  merged.add("outfit");

  return {
    categoriesRaw: order.filter((c) => merged.has(c)),
    subcategoriesRaw: mappedSubs,
  };
}

/** 将不信任来源的单条提示词标签修补为安全结构；无法识别则丢弃。 */
export function coercePersistedPromptTag(raw: unknown): PromptTag | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  if (!id) {
    return null;
  }

  const migrated = migrateLegacyPromptTagCategorySubcategory(raw.category, raw.subcategory);
  const category = normalizePromptTagCategory(migrated.category);
  const subcategory = normalizePromptTagSubcategory(category, migrated.subcategory);

  const weightRaw = raw.weight;
  const w = isRecord(weightRaw) ? weightRaw : undefined;
  const value = typeof w?.value === "number" && Number.isFinite(w.value) ? w.value : 1;
  const enabled = typeof w?.enabled === "boolean" ? w.enabled : false;

  const tag: PromptTag = {
    id,
    label: typeof raw.label === "string" ? raw.label : "标签",
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    category,
    ...(subcategory ? { subcategory } : {}),
    weight: { value, enabled },
  };

  if (typeof raw.negative === "boolean") {
    tag.negative = raw.negative;
  }

  return tag;
}

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
