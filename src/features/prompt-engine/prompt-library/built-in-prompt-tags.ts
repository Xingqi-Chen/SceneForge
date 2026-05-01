import type { PromptTag } from "@/shared/types";

export const BUILT_IN_PROMPT_LIBRARY_TAGS: PromptTag[] = [
  {
    id: "library-cinematic",
    label: "电影感",
    prompt: "cinematic composition",
    category: "style",
    weight: { enabled: true, value: 1.15 },
  },
  {
    id: "library-soft-light",
    label: "柔和光线",
    prompt: "soft light",
    category: "lighting",
    weight: { enabled: true, value: 1.1 },
  },
  {
    id: "library-high-quality",
    label: "高质量",
    prompt: "high quality, detailed illustration",
    category: "quality",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-long-hair",
    label: "长发",
    prompt: "long flowing hair",
    category: "body-part",
    weight: { enabled: true, value: 1.2 },
  },
  {
    id: "library-blue-eyes",
    label: "蓝色眼睛",
    prompt: "blue eyes",
    category: "body-part",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-holding-sword",
    label: "手持剑",
    prompt: "holding a sword",
    category: "body-part",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-standing-pose",
    label: "自然站姿",
    prompt: "standing naturally",
    category: "character",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-misty-background",
    label: "雾气背景",
    prompt: "misty background",
    category: "scene",
    weight: { enabled: false, value: 1 },
  },
  {
    id: "library-negative-low-quality",
    label: "低质量负面",
    prompt: "low quality, blurry",
    category: "negative",
    weight: { enabled: false, value: 1 },
    negative: true,
  },
];
