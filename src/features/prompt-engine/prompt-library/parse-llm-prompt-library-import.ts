import type { PromptTag, PromptTagCategory } from "@/shared/types";

const allowedCategories: PromptTagCategory[] = [
  "style",
  "lighting",
  "quality",
  "scene",
  "character",
  "body-part",
  "negative",
];

const categorySet = new Set<PromptTagCategory>(allowedCategories);

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

function isPromptTagCategory(value: unknown): value is PromptTagCategory {
  return typeof value === "string" && categorySet.has(value as PromptTagCategory);
}

function normalizeCategory(value: unknown): PromptTagCategory {
  if (isPromptTagCategory(value)) {
    return value;
  }

  return "style";
}

function trimPromptToken(value: string) {
  let token = value.trim();

  while (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  while (token.startsWith('"') || token.startsWith("'")) {
    token = token.slice(1).trim();
  }

  while (token.endsWith('"') || token.endsWith("'")) {
    token = token.slice(0, -1).trim();
  }

  while (
    (token.startsWith("{") && token.endsWith("}")) ||
    (token.startsWith("[") && token.endsWith("]"))
  ) {
    token = token.slice(1, -1).trim();
  }

  while (token.startsWith("{") || token.startsWith("[") || token.startsWith("(")) {
    token = token.slice(1).trim();
  }

  while (token.endsWith("}") || token.endsWith("]") || token.endsWith(")")) {
    token = token.slice(0, -1).trim();
  }

  return token;
}

function parseWeightedPromptToken(value: string) {
  let token = value.trim();
  let weight = { enabled: false, value: 1 };

  while (token.startsWith("(") && token.endsWith(")")) {
    token = token.slice(1, -1).trim();
  }

  const weighted = /^(.*):([0-9]+(?:\.[0-9]+)?)$/.exec(token);
  if (weighted?.[1] && weighted[2]) {
    const parsedWeight = Number(weighted[2]);
    if (Number.isFinite(parsedWeight)) {
      token = weighted[1].trim();
      weight = { enabled: true, value: parsedWeight };
    }
  }

  return { prompt: trimPromptToken(token), weight };
}

function stripKnownSectionPrefix(value: string) {
  return value.replace(/^(negative\s*prompt|positive\s*prompt|prompt)\s*:\s*/i, "").trim();
}

function isGenerationMetadataToken(value: string) {
  return /^(steps|cfg\s*scale|sampler|seed|size|model|version|model\s*hash|schedule\s*type|clip\s*skip)\s*:/i.test(
    value,
  );
}

function splitPromptTokens(value: string) {
  const tokens: string[] = [];
  let current = "";
  let angleDepth = 0;

  for (const char of value) {
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "," && angleDepth === 0) {
      tokens.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  tokens.push(current);

  return tokens.map(trimPromptToken).filter(Boolean);
}

function createPromptTag(
  prompt: string,
  category: PromptTagCategory,
  negative: boolean,
  labelFallback?: string,
): Omit<PromptTag, "id"> | null {
  const parsed = parseWeightedPromptToken(prompt);
  const normalizedPrompt = stripKnownSectionPrefix(parsed.prompt);

  if (!normalizedPrompt || isGenerationMetadataToken(normalizedPrompt)) {
    return null;
  }

  const label =
    labelFallback && !labelFallback.includes(",") ? labelFallback : normalizedPrompt.slice(0, 48);

  return {
    label,
    prompt: normalizedPrompt,
    category,
    negative,
    weight: parsed.weight,
  };
}

function parseItem(value: unknown): Array<Omit<PromptTag, "id">> {
  if (!isRecord(value)) {
    return [];
  }

  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (!prompt) {
    return [];
  }

  const labelRaw = typeof value.label === "string" ? value.label.trim() : "";
  const category = normalizeCategory(value.category);
  const negative = category === "negative" ? true : Boolean(value.negative);
  const tokens = splitPromptTokens(prompt);
  const labelFallback = tokens.length === 1 ? labelRaw : undefined;

  return tokens
    .map((token) => createPromptTag(token, category, negative, labelFallback))
    .filter((tag): tag is Omit<PromptTag, "id"> => Boolean(tag));
}

export type ParseLlmPromptLibraryImportResult =
  | { ok: true; tags: Array<Omit<PromptTag, "id">> }
  | { ok: false; error: string };

export function parseLlmPromptLibraryImportContent(content: string): ParseLlmPromptLibraryImportResult {
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

  const tags: Array<Omit<PromptTag, "id">> = [];

  for (const entry of items) {
    tags.push(...parseItem(entry));
  }

  if (tags.length === 0) {
    return { ok: false, error: "未解析到任何有效词条。" };
  }

  return { ok: true, tags };
}

export function buildPromptLibraryImportMessages(rawPromptText: string) {
  const categoryList = allowedCategories.join(", ");

  return [
    {
      role: "system" as const,
      content: [
        "You split Stable Diffusion / Midjourney style prompt text into a structured library.",
        "The user message is raw prompt text: it may contain positive prompt, a Negative prompt section, commas, newlines, quoted segments, and lines like <lora:Name:weight>.",
        "Create ATOMIC library entries. Do NOT group many comma-separated prompt tokens into one entry.",
        "Each comma-separated prompt token should usually become its own item: \"1girl\", \"black hair\", \"blue eyes\", \"chinese clothes\" are four separate items.",
        "Keep multi-word prompt phrases together when they are one token, e.g. \"best quality\", \"dynamic angle\", \"bad anatomy\".",
        "Keep a whole LoRA/embed token like <lora:Alpaca_Carlesi_Style:1> as one item.",
        "Ignore generation metadata such as Steps, CFG scale, Sampler, Seed, Size, Model, Version, Model hash, Schedule type, and Clip skip.",
        "Each entry must become one object with:",
        `- label: short display title, prefer concise Chinese when it fits the content.`,
        `- prompt: one atomic prompt token to store, never a comma-separated list.`,
        `- category: one of: ${categoryList}.`,
        "Use category \"negative\" only for negative-prompt style content; set that category for such entries.",
        "Use \"style\" for overall rendering, film grain, candid style, contrast, aesthetic wording.",
        "Use \"quality\" for tags like masterpiece, best quality, 8k, absurdres, detailed.",
        "Use \"scene\" for background, weather, environment.",
        "Use \"character\" for identity, clothing role, pose at character level when not a single body part.",
        "Use \"body-part\" for anatomy-focused descriptors (hair, eyes, breasts, hands, etc.) when they are the main focus of that chunk.",
        "Use \"lighting\" for light and shadow descriptions.",
        "Respond with JSON ONLY (no markdown fences, no commentary) in this exact shape:",
        '{"items":[{"label":"...","prompt":"...","category":"quality"}]}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: rawPromptText.trim(),
    },
  ];
}
