import type { CivitaiLoraCategory } from "./types";

const CATEGORY_RULES: Array<{ category: CivitaiLoraCategory; keywords: string[] }> = [
  {
    category: "character",
    keywords: ["character", "角色", "人物", "person", "girl", "boy", "anime", "vtuber"],
  },
  {
    category: "style",
    keywords: ["style", "artist", "画风", "filter", "滤镜", "aesthetic", "artstyle"],
  },
  {
    category: "lighting",
    keywords: ["light", "lighting", "shadow", "光影", "cinematic", "illumination"],
  },
  {
    category: "clothing",
    keywords: ["dress", "uniform", "armor", "kimono", "服装", "outfit", "clothing"],
  },
  {
    category: "pose",
    keywords: ["pose", "standing", "sitting", "action", "姿势", "posing"],
  },
  {
    category: "scene",
    keywords: ["city", "room", "forest", "street", "background", "scene", "场景", "环境"],
  },
  {
    category: "detail",
    keywords: ["detail", "enhancer", "face", "eyes", "hands", "细节", "quality"],
  },
];

export function classifyCivitaiLora(input: {
  name?: string | null;
  tags?: string[] | null;
  description?: string | null;
}): CivitaiLoraCategory {
  const haystack = [
    input.name ?? "",
    ...(input.tags ?? []),
    input.description ?? "",
  ].join(" ").toLocaleLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase()))) {
      return rule.category;
    }
  }

  return "other";
}
