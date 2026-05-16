import type { CharacterBodyPart, PromptTag } from "@/shared/types";

export type FaceTemplateId =
  | "real-human-face"
  | "anime-handdrawn-face"
  | "transparent-handdrawn-anime-face";

export type FaceTemplate = {
  id: FaceTemplateId;
  label: string;
  description: string;
  tags: PromptTag[];
};

export type FaceTemplateApplyResult = {
  bodyParts: CharacterBodyPart[];
  addedTagIds: string[];
};

const MIN_FACE_TEMPLATE_INTENSITY = 0.8;
const MAX_FACE_TEMPLATE_INTENSITY = 1.4;

export const FACE_TEMPLATES: FaceTemplate[] = [
  {
    id: "real-human-face",
    label: "真实人像脸部",
    description: "强化活体肤色、皮肤微纹理、眼下细节和自然比例，减少蜡感、假毛孔与无神眼。",
    tags: [
      {
        id: "face-template-real-human-face-raw-photoreal-human-face",
        label: "原始真实人脸",
        prompt: "raw photoreal human face",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.1 },
      },
      {
        id: "face-template-real-human-face-multi-tone-living-skin",
        label: "活体肤色层次",
        prompt: "multi-tone living skin",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.16 },
      },
      {
        id: "face-template-real-human-face-natural-skin-microtexture",
        label: "自然皮肤微纹理",
        prompt: "natural skin microtexture",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.12 },
      },
      {
        id: "face-template-real-human-face-fine-vellus-facial-hair",
        label: "细小面部绒毛",
        prompt: "fine vellus facial hair",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.08 },
      },
      {
        id: "face-template-real-human-face-realistic-under-eye-texture",
        label: "真实眼下纹理",
        prompt: "realistic under-eye texture",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: true, value: 1.08 },
      },
      {
        id: "face-template-real-human-face-natural-catchlights",
        label: "自然眼部高光",
        prompt: "natural catchlights in the eyes",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-natural-facial-proportions",
        label: "自然面部比例",
        prompt: "natural facial proportions",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-slight-facial-asymmetry",
        label: "轻微面部不对称",
        prompt: "slight facial asymmetry",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-negative-fake-pores-texture",
        label: "避免假毛孔纹理",
        prompt: "fake pores texture",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-negative-waxy-face",
        label: "避免蜡质脸",
        prompt: "waxy face",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-negative-over-smoothed-skin",
        label: "避免过度磨皮",
        prompt: "over-smoothed skin",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-negative-unnatural-hdr",
        label: "避免不自然 HDR",
        prompt: "unnatural HDR",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-negative-dead-eyes",
        label: "避免无神眼睛",
        prompt: "dead eyes",
        category: "negative",
        subcategory: "negative-anatomy",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-real-human-face-negative-distorted-facial-proportions",
        label: "避免脸部比例扭曲",
        prompt: "distorted facial proportions",
        category: "negative",
        subcategory: "negative-anatomy",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
    ],
  },
  {
    id: "anime-handdrawn-face",
    label: "基础手绘二次元脸部",
    description: "强调基础手绘线稿、清晰眼部结构和自然表情，减少 AI 常见的碎线、糊眼和过度塑料感。",
    tags: [
      {
        id: "face-template-anime-handdrawn-face-clean-hand-drawn-lineart",
        label: "干净手绘线稿",
        prompt: "clean hand-drawn anime face lineart",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.12 },
      },
      {
        id: "face-template-anime-handdrawn-face-consistent-eye-shapes",
        label: "一致眼型结构",
        prompt: "consistent anime eye shapes",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: true, value: 1.1 },
      },
      {
        id: "face-template-anime-handdrawn-face-clear-iris-highlights",
        label: "清晰瞳孔高光",
        prompt: "clear iris highlights",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: true, value: 1.08 },
      },
      {
        id: "face-template-anime-handdrawn-face-simple-readable-nose-and-mouth",
        label: "简洁可读鼻口",
        prompt: "simple readable anime nose and mouth",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-subtle-asymmetric-expression",
        label: "轻微不对称表情",
        prompt: "subtle asymmetric expression",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-controlled-cel-shading",
        label: "克制赛璐璐阴影",
        prompt: "controlled cel shading on the face",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-negative-broken-eye-details",
        label: "避免眼部细节碎裂",
        prompt: "broken eye details",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-negative-melted-iris",
        label: "避免瞳孔融化",
        prompt: "melted iris",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-negative-wobbly-lineart",
        label: "避免线稿抖动",
        prompt: "wobbly lineart",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-negative-over-rendered-glossy-face",
        label: "避免过度油亮脸",
        prompt: "over-rendered glossy face",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-anime-handdrawn-face-negative-ai-generated-eye-artifacts",
        label: "避免 AI 眼部伪影",
        prompt: "AI-generated eye artifacts",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
    ],
  },
  {
    id: "transparent-handdrawn-anime-face",
    label: "通透手绘二次元脸部",
    description:
      "强化通透肤色、柔和红晕、分层虹膜高光与干净脸部线稿，让二次元脸更像人工绘制的日系插画。",
    tags: [
      {
        id: "face-template-transparent-handdrawn-anime-face-clean-hand-drawn-lineart",
        label: "干净手绘脸部线稿",
        prompt: "clean hand-drawn anime face lineart",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.12 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-watercolor-skin-shading",
        label: "通透水彩感肤色阴影",
        prompt: "transparent watercolor-like skin shading",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.12 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-warm-soft-lighting",
        label: "柔和暖色脸部光照",
        prompt: "warm soft facial lighting",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.08 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-soft-blush",
        label: "自然柔和脸颊红晕",
        prompt: "natural soft blush on cheeks",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: true, value: 1.08 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-expressive-eyes",
        label: "大而有神的二次元眼睛",
        prompt: "large expressive anime eyes",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: true, value: 1.1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-layered-iris-highlights",
        label: "分层细致虹膜高光",
        prompt: "detailed layered iris highlights",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: true, value: 1.12 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-delicate-eyelashes",
        label: "纤细睫毛",
        prompt: "delicate eyelashes",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-clear-eyelid-lines",
        label: "清晰眼睑线条",
        prompt: "clear eyelid line detail",
        category: "body-part",
        subcategory: "body-part-eyes",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-readable-nose",
        label: "简洁清楚的二次元鼻子",
        prompt: "simple readable anime nose",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-natural-smile",
        label: "细微自然的二次元微笑",
        prompt: "subtle natural anime smile",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-painterly-planes",
        label: "柔和绘画感脸部结构",
        prompt: "soft painterly facial planes",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-skin-gradients",
        label: "手绘感肤色渐变",
        prompt: "gentle hand-painted skin gradients",
        category: "body-part",
        subcategory: "body-part-face",
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-plastic-anime-face",
        label: "避免塑料二次元脸",
        prompt: "plastic anime face",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-over-smoothed-digital-skin",
        label: "避免过度磨皮数码肤感",
        prompt: "over-smoothed digital skin",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-flat-dead-eyes",
        label: "避免扁平无神眼睛",
        prompt: "flat dead eyes",
        category: "negative",
        subcategory: "negative-anatomy",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-melted-iris-details",
        label: "避免虹膜细节融化",
        prompt: "melted iris details",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-broken-eyelash-lines",
        label: "避免睫毛线条断裂",
        prompt: "broken eyelash lines",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-muddy-lineart",
        label: "避免脸部线稿脏乱",
        prompt: "muddy facial lineart",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-over-rendered-glossy-face",
        label: "避免过度油亮脸",
        prompt: "over-rendered glossy face",
        category: "negative",
        subcategory: "negative-artifact",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-uncanny-expression",
        label: "避免诡异二次元表情",
        prompt: "uncanny anime expression",
        category: "negative",
        subcategory: "negative-anatomy",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
      {
        id: "face-template-transparent-handdrawn-anime-face-negative-distorted-proportions",
        label: "避免脸部比例扭曲",
        prompt: "distorted facial proportions",
        category: "negative",
        subcategory: "negative-anatomy",
        negative: true,
        weight: { enabled: false, value: 1 },
      },
    ],
  },
];

export function getFaceTemplate(id: FaceTemplateId): FaceTemplate {
  return FACE_TEMPLATES.find((template) => template.id === id) ?? FACE_TEMPLATES[0];
}

function clampFaceTemplateIntensity(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_FACE_TEMPLATE_INTENSITY, Math.max(MIN_FACE_TEMPLATE_INTENSITY, value));
}

function roundWeight(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function promptTagSemanticKey(tag: Pick<PromptTag, "category" | "negative" | "prompt">) {
  return [
    tag.prompt.trim().toLocaleLowerCase(),
    tag.category,
    Boolean(tag.negative) ? "negative" : "positive",
  ].join("|");
}

function scaleTemplateTagWeight(tag: PromptTag, intensity: number): PromptTag {
  return {
    ...tag,
    weight: tag.weight.enabled
      ? { enabled: true, value: roundWeight(tag.weight.value * intensity) }
      : { ...tag.weight },
  };
}

export function createFaceTemplatePromptTags(
  templateId: FaceTemplateId,
  intensity: number,
): PromptTag[] {
  const scale = clampFaceTemplateIntensity(intensity);
  return getFaceTemplate(templateId).tags.map((tag) => scaleTemplateTagWeight(tag, scale));
}

export function upsertFaceTemplateTagsOnHead(
  bodyParts: CharacterBodyPart[],
  templateId: FaceTemplateId,
  intensity: number,
): CharacterBodyPart[] {
  return applyFaceTemplateTagsToHead(bodyParts, templateId, intensity).bodyParts;
}

export function applyFaceTemplateTagsToHead(
  bodyParts: CharacterBodyPart[],
  templateId: FaceTemplateId,
  intensity: number,
): FaceTemplateApplyResult {
  const templateTags = createFaceTemplatePromptTags(templateId, intensity);
  const addedTagIds: string[] = [];

  const nextBodyParts = bodyParts.map((bodyPart) => {
    if (bodyPart.id !== "head") {
      return bodyPart;
    }

    const nextPromptTags = [...bodyPart.promptTags];

    for (const templateTag of templateTags) {
      const templateKey = promptTagSemanticKey(templateTag);
      const existingIndex = nextPromptTags.findIndex(
        (tag) => promptTagSemanticKey(tag) === templateKey,
      );

      if (existingIndex >= 0) {
        const existingTag = nextPromptTags[existingIndex];
        nextPromptTags[existingIndex] = {
          ...existingTag,
          category: templateTag.category,
          subcategory: templateTag.subcategory,
          negative: templateTag.negative,
          weight: { ...templateTag.weight },
        };
        continue;
      }

      nextPromptTags.push({
        ...templateTag,
        weight: { ...templateTag.weight },
      });
      addedTagIds.push(templateTag.id);
    }

    return {
      ...bodyPart,
      promptTags: nextPromptTags,
    };
  });

  return { bodyParts: nextBodyParts, addedTagIds };
}

export function removeFaceTemplateTagsFromHead(
  bodyParts: CharacterBodyPart[],
  templateId: FaceTemplateId,
): CharacterBodyPart[] {
  const templateTagIds = new Set(getFaceTemplate(templateId).tags.map((tag) => tag.id));

  return bodyParts.map((bodyPart) => {
    if (bodyPart.id !== "head") {
      return bodyPart;
    }

    return {
      ...bodyPart,
      promptTags: bodyPart.promptTags.filter((tag) => !templateTagIds.has(tag.id)),
    };
  });
}

export function removeFaceTemplateApplicationFromHead(
  bodyParts: CharacterBodyPart[],
  addedTagIds: string[],
): CharacterBodyPart[] {
  const addedTagIdSet = new Set(addedTagIds);

  if (addedTagIdSet.size === 0) {
    return bodyParts;
  }

  return bodyParts.map((bodyPart) => {
    if (bodyPart.id !== "head") {
      return bodyPart;
    }

    return {
      ...bodyPart,
      promptTags: bodyPart.promptTags.filter((tag) => !addedTagIdSet.has(tag.id)),
    };
  });
}
