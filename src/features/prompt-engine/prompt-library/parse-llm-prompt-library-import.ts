import {
  PROMPT_TAG_CATEGORY_ORDER,
  PROMPT_TAG_SUBCATEGORY_LABELS,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
  migrateLegacyPromptTagCategorySubcategory,
  normalizePromptTagCategory,
  normalizePromptTagSubcategory,
} from "./prompt-tag-taxonomy";
import type { PromptTag, PromptTagCategory, PromptTagSubcategory } from "@/shared/types";

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

  while (token.startsWith("(") && token.endsWith(")")) {
    token = token.slice(1, -1).trim();
  }

  while (token.startsWith("{") || token.startsWith("[")) {
    token = token.slice(1).trim();
  }

  while (token.endsWith("}") || token.endsWith("]")) {
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

function containsCjk(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
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
  subcategory: PromptTagSubcategory | undefined,
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
    ...(subcategory ? { subcategory } : {}),
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
  const migrated = migrateLegacyPromptTagCategorySubcategory(value.category, value.subcategory);
  const category = normalizePromptTagCategory(migrated.category);
  const subcategory = normalizePromptTagSubcategory(category, migrated.subcategory);
  const negative = category === "negative" ? true : Boolean(value.negative);
  const tokens = splitPromptTokens(prompt);
  const labelFallback = tokens.length === 1 ? labelRaw : undefined;

  return tokens
    .map((token) => createPromptTag(token, category, subcategory, negative, labelFallback))
    .filter((tag): tag is Omit<PromptTag, "id"> => Boolean(tag));
}

export type ParseLlmPromptLibraryImportResult =
  | { ok: true; tags: Array<Omit<PromptTag, "id">> }
  | { ok: false; error: string };

export type PromptLibrarySubcategoryAssignment = {
  id: string;
  subcategory: PromptTagSubcategory;
};

export type PromptLibraryConsolidatedItem = {
  sourceIds: string[];
  label: string;
  prompt: string;
};

export type PromptLibraryConsolidationReference = {
  ref: string;
  id: string;
  label: string;
  prompt: string;
};

export type ParseLlmPromptLibrarySubcategoryResult =
  | { ok: true; assignments: PromptLibrarySubcategoryAssignment[] }
  | { ok: false; error: string };

export type ParseLlmPromptLibraryConsolidationResult =
  | { ok: true; items: PromptLibraryConsolidatedItem[] }
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

export function parseLlmPromptLibrarySubcategoryContent(
  content: string,
  category: PromptTagCategory,
): ParseLlmPromptLibrarySubcategoryResult {
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

  const assignments: PromptLibrarySubcategoryAssignment[] = [];

  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string") {
      continue;
    }

    const subcategory = normalizePromptTagSubcategory(category, item.subcategory);
    if (!subcategory) {
      continue;
    }

    assignments.push({ id: item.id, subcategory });
  }

  if (assignments.length === 0) {
    return { ok: false, error: "AI 未返回任何有效二级分类。" };
  }

  return { ok: true, assignments };
}

export function parseLlmPromptLibraryConsolidationContent(
  content: string,
  references: Map<string, PromptLibraryConsolidationReference>,
): ParseLlmPromptLibraryConsolidationResult {
  const jsonText = extractJsonPayload(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return { ok: false, error: "无法解析 AI 返回的 JSON。" };
  }

  if (!isRecord(parsed) && !Array.isArray(parsed)) {
    return { ok: false, error: "JSON 顶层必须是对象。" };
  }

  const items = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(items)) {
    return { ok: false, error: 'JSON 必须包含 "items" 数组。' };
  }

  const consolidatedItems: PromptLibraryConsolidatedItem[] = [];
  const usedSourceIds = new Set<string>();

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }

    const rawRefs = Array.isArray(item.refs)
      ? item.refs
      : Array.isArray(item.sourceRefs)
        ? item.sourceRefs
        : Array.isArray(item.sourceIds)
          ? item.sourceIds
          : [];
    const refs = rawRefs.filter((ref): ref is string => typeof ref === "string");
    const sourceIds: string[] = [];
    const sourceReferences: PromptLibraryConsolidationReference[] = [];

    for (const ref of refs) {
      const source = references.get(ref);
      if (!source || usedSourceIds.has(source.id)) {
        continue;
      }

      sourceIds.push(source.id);
      sourceReferences.push(source);
    }

    const rawLabel = typeof item.l === "string" ? item.l : item.label;
    const rawPrompt = typeof item.p === "string" ? item.p : item.prompt;
    const primarySource = sourceReferences[0];
    const prompt =
      typeof rawPrompt === "string" && rawPrompt.trim()
        ? trimPromptToken(rawPrompt)
        : primarySource?.prompt.trim() ?? "";
    const modelLabel = typeof rawLabel === "string" ? rawLabel.trim() : "";
    const primaryLabel = primarySource?.label.trim() ?? "";
    const label =
      primaryLabel && containsCjk(primaryLabel) && (!modelLabel || !containsCjk(modelLabel))
        ? primaryLabel
        : modelLabel || primaryLabel || prompt.slice(0, 48);

    if (sourceIds.length === 0 || !prompt) {
      continue;
    }

    for (const sourceId of sourceIds) {
      usedSourceIds.add(sourceId);
    }

    consolidatedItems.push({
      sourceIds,
      label: label || prompt.slice(0, 48),
      prompt,
    });
  }

  if (consolidatedItems.length === 0) {
    return { ok: false, error: "AI 未返回任何可保留的有效词条。" };
  }

  return { ok: true, items: consolidatedItems };
}

export function buildPromptLibraryConsolidationReferences(
  tags: Pick<PromptTag, "id" | "label" | "prompt">[],
): PromptLibraryConsolidationReference[] {
  return tags.map((tag, index) => ({
    ref: `T${String(index + 1).padStart(3, "0")}`,
    id: tag.id,
    label: tag.label,
    prompt: tag.prompt,
  }));
}

export function buildPromptLibraryImportMessages(rawPromptText: string) {
  const categoryList = PROMPT_TAG_CATEGORY_ORDER.join(", ");
  const subcategoryList = PROMPT_TAG_CATEGORY_ORDER.map((category) => {
    const values = PROMPT_TAG_SUBCATEGORY_OPTIONS[category]
      .map((subcategory) => `${subcategory} (${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]})`)
      .join(", ");

    return `- ${category}: ${values}`;
  }).join("\n");

  return [
    {
      role: "system" as const,
      content: [
        "You split Stable Diffusion style prompt text into a structured library.",
        "The user message is raw prompt text: it may contain positive prompt, a Negative prompt section, commas, newlines, quoted segments, and lines like <lora:Name:weight>.",
        "Create ATOMIC library entries. Do NOT group many comma-separated prompt tokens into one entry.",
        "When the user text is prose or long descriptive sentences (not already a comma-separated tag list), you MUST distill it: rewrite into short, reusable prompt vocabulary. Never copy a full sentence or long clause into a single `prompt` value.",
        "Summarize each idea into 1–3 common tag-style tokens (English unless the source is clearly Chinese). Prefer established Stable Diffusion wording (e.g. mood: \"serene\", \"ethereal atmosphere\", \"tranquil\"; lighting: \"soft lighting\"). Split mixed clauses into separate items with the right category for each idea.",
        "Omit or generalize one-off narrative props that are not useful as generic tags. If a detail is only story dressing or contradicts the mood you are encoding, do not surface it as its own entry (e.g. do not emit awkward fragments like \"person partially covered by a floral arrangement\" when the useful reusable parts are mood and scene). Prefer a generic decor tag only when it stays broadly applicable (e.g. \"flowers\" under scene/decor), or skip.",
        "Assign category by what the token actually expresses: atmosphere and rendering tone → \"style\" (or \"lighting\" for light/shadow); environment/setting → \"scene\"; do not park mood words under unrelated categories just because the sentence mentioned an object.",
        "Each comma-separated prompt token should usually become its own item: \"1girl\", \"black hair\", \"blue eyes\", \"chinese clothes\" are four separate items.",
        "Keep multi-word prompt phrases together when they are one token, e.g. \"best quality\", \"dynamic angle\", \"bad anatomy\".",
        "Keep a whole LoRA/embed token like <lora:Alpaca_Carlesi_Style:1> as one item.",
        "Ignore generation metadata such as Steps, CFG scale, Sampler, Seed, Size, Model, Version, Model hash, Schedule type, and Clip skip.",
        "Each entry must become one object with:",
        `- label: short display title, prefer concise Chinese when it fits the content.`,
        `- prompt: one atomic prompt token to store, never a comma-separated list.`,
        `- category: one of: ${categoryList}.`,
        "- subcategory: choose one allowed subcategory for that category, or omit it only when uncertain.",
        "Use category \"negative\" only for negative-prompt style content; set that category for such entries.",
        "Use \"style\" for overall rendering, film grain, candid style, contrast, aesthetic wording.",
        "Use \"quality\" for tags like masterpiece, best quality, 8k, absurdres, detailed.",
        "Use \"scene\" for background, weather, environment.",
        "Use \"character\" for identity, role, pose, expression at character level when not clothing-only or a single body part.",
        "Use \"body-part\" for anatomy-focused descriptors (hair, eyes, breasts, hands, etc.) when they are the main focus of that chunk.",
        "Use \"outfit\" for illustration clothing tags: tops, bottoms, dresses or skirts, shoes and socks, accessories (bags, hats, ribbons, jewelry, glasses), or full outfits (school uniform, cosplay, hanfu). Pick the closest outfit subcategory.",
        "Use \"lighting\" for light and shadow descriptions.",
        "Allowed subcategories:",
        subcategoryList,
        "Respond with JSON ONLY (no markdown fences, no commentary) in this exact shape:",
        '{"items":[{"label":"...","prompt":"...","category":"quality","subcategory":"quality-detail"}]}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: rawPromptText.trim(),
    },
  ];
}

export function buildPromptLibrarySubcategoryMessages(
  category: PromptTagCategory,
  tags: Pick<PromptTag, "id" | "label" | "prompt">[],
) {
  const subcategoryList = PROMPT_TAG_SUBCATEGORY_OPTIONS[category]
    .map((subcategory) => `${subcategory} (${PROMPT_TAG_SUBCATEGORY_LABELS[subcategory]})`)
    .join(", ");
  const items = tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    prompt: tag.prompt,
  }));

  return [
    {
      role: "system" as const,
      content: [
        "You classify existing SceneForge prompt-library tags into one allowed subcategory.",
        "Do not rewrite labels, prompts, ids, or categories. Return only a JSON object.",
        `All items already belong to category "${category}".`,
        `Allowed subcategories for this category: ${subcategoryList}.`,
        "Choose the best subcategory from the allowed list for each item. If uncertain, choose the closest useful option.",
        "Respond with JSON ONLY (no markdown fences, no commentary) in this exact shape:",
        '{"items":[{"id":"existing-id","subcategory":"allowed-subcategory"}]}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({ category, items }),
    },
  ];
}

export function buildPromptLibraryConsolidationMessages(
  category: PromptTagCategory,
  subcategory: PromptTagSubcategory | "",
  tags: Pick<PromptTag, "id" | "label" | "prompt" | "negative">[],
) {
  const subcategoryLabel = subcategory ? PROMPT_TAG_SUBCATEGORY_LABELS[subcategory] : "未分类";
  const references = buildPromptLibraryConsolidationReferences(tags);
  const items = references.map((reference) => ({
    r: reference.ref,
    l: reference.label,
    p: reference.prompt,
  }));

  return [
    {
      role: "system" as const,
      content: [
        "You consolidate SceneForge prompt-library tags within one secondary category.",
        "Inputs use short reference codes. NEVER output original ids because they are not provided.",
        "Deduplicate exact duplicates, near duplicates, spelling/case variants, and tags that express the same reusable visual idea.",
        "Filter out weak, overly vague, broken, contradictory, metadata-like, or one-off narrative fragments that are not useful as reusable image prompt vocabulary.",
        "You may lightly rewrite the kept prompt into a clean atomic Stable Diffusion style token, but do not broaden it beyond the source meaning.",
        "Keep each final item atomic: never return comma-separated prompt lists.",
        "Return only kept groups. Each group must contain refs, an array of one or more input reference codes. Put merged duplicate refs in the same refs array.",
        "If an input should be removed entirely, omit its ref from every refs array.",
        "Do not invent new ids, categories, subcategories, or unrelated prompt concepts.",
        `All input items belong to category "${category}" and subcategory "${subcategory || "uncategorized"}" (${subcategoryLabel}).`,
        "Use short keys to keep JSON small: refs = input refs, p = final atomic prompt, l = short display label.",
        "Preserve existing Chinese labels. If the first kept source label is Chinese, omit l or return a Chinese label; never translate it into English.",
        "Respond with compact JSON ONLY (no markdown fences, no commentary) in this exact shape:",
        '{"items":[{"refs":["T001","T002"],"p":"atomic prompt token","l":"short label"}]}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({ c: category, s: subcategory || "", items }),
    },
  ];
}
