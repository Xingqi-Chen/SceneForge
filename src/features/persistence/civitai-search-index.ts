import type { CivitaiResourceType } from "@/features/civitai-lora-library/types";

import type { SceneForgeSqliteDatabase } from "./sqlite-storage";

export const CIVITAI_SEARCH_INDEX_TABLE = "civitai_resource_search_fts";
export const CIVITAI_SEARCH_INDEX_MISSING_MESSAGE =
  "Civitai search index is missing. Run npm run civitai:reindex, then try the recommendation again.";

const DOMAIN_SYNONYM_RULES: Array<{ tests: string[]; tokens: string[] }> = [
  { tests: ["赛博", "赛博朋克", "霓虹", "cyber", "neon"], tokens: ["cyberpunk", "neon", "techwear", "futuristic"] },
  { tests: ["写实", "真实", "照片", "电影", "real"], tokens: ["realistic", "photo", "cinematic", "film"] },
  { tests: ["动漫", "二次元", "插画", "anime"], tokens: ["anime", "manga", "illustration", "toon"] },
  { tests: ["服装", "衣服", "穿搭", "outfit"], tokens: ["clothing", "outfit", "fashion", "costume"] },
  { tests: ["姿势", "动作", "pose"], tokens: ["pose", "action", "dynamic"] },
  { tests: ["光", "灯光", "lighting"], tokens: ["lighting", "light", "glow", "shadow"] },
  { tests: ["细节", "质感", "detail"], tokens: ["detail", "texture", "sharp", "highres"] },
  { tests: ["可爱", "cute"], tokens: ["cute", "kawaii", "soft"] },
  { tests: ["暗黑", "恐怖", "horror"], tokens: ["dark", "horror", "gothic"] },
  { tests: ["模型", "checkpoint", "ckpt"], tokens: ["checkpoint", "model", "base"] },
  { tests: ["lora", "罗拉", "触发词"], tokens: ["lora", "trigger", "trainedword"] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTextColumn(row: unknown, column: string): string | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function readNumberColumn(row: unknown, column: string): number | undefined {
  if (!isRecord(row)) {
    return undefined;
  }

  const value = row[column];
  return typeof value === "number" ? value : undefined;
}

function readJsonArray(value: string | undefined): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase().trim();
}

function addLatinTokens(text: string, tokens: Set<string>) {
  const matches = text.match(/[a-z0-9][a-z0-9+._-]*/gi) ?? [];
  for (const token of matches) {
    if (token.length >= 2) {
      tokens.add(token.toLocaleLowerCase());
    }
  }
}

function addCjkGrams(text: string, tokens: Set<string>) {
  const matches = text.match(/[\u3400-\u9fff]+/g) ?? [];
  for (const match of matches) {
    if (match.length >= 2) {
      tokens.add(match);
    }

    for (const size of [2, 3]) {
      if (match.length < size) {
        continue;
      }

      for (let index = 0; index <= match.length - size; index += 1) {
        tokens.add(match.slice(index, index + size));
      }
    }
  }
}

function addSegmenterTokens(text: string, tokens: Set<string>) {
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("zh", { granularity: "word" })
    : null;
  if (!segmenter) {
    return;
  }

  for (const segment of segmenter.segment(text)) {
    const token = segment.segment.trim();
    if (token.length >= 2) {
      tokens.add(token);
    }
  }
}

function addDomainSynonyms(text: string, tokens: Set<string>) {
  for (const rule of DOMAIN_SYNONYM_RULES) {
    if (rule.tests.some((test) => text.includes(test))) {
      for (const token of rule.tokens) {
        tokens.add(token);
      }
    }
  }
}

export function tokenizeCivitaiSearchText(value: string | null | undefined): string[] {
  const normalized = normalizeSearchText(value);
  const tokens = new Set<string>();

  addLatinTokens(normalized, tokens);
  addSegmenterTokens(normalized, tokens);
  addCjkGrams(normalized, tokens);
  addDomainSynonyms(normalized, tokens);

  return Array.from(tokens);
}

function textList(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function recommendationText(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  return [
    value.condition,
    value.baseModel,
    value.checkpoint,
    value.sampler,
    value.notes,
  ].filter((item): item is string => typeof item === "string").join(" ");
}

export function buildCivitaiResourceSearchText(input: {
  name: string | null;
  versionName: string | null;
  baseModel: string | null;
  trainedWords: string[];
  tags: string[];
  categories: string[];
  usageGuide: string | null;
  description: string | null;
  recommendations: unknown[];
}) {
  const rawText = [
    input.name,
    input.versionName,
    input.baseModel,
    ...input.trainedWords,
    ...input.tags,
    ...input.categories,
    input.usageGuide,
    input.description,
    ...input.recommendations.map(recommendationText),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0).join(" ");
  const tokens = tokenizeCivitaiSearchText(rawText);

  return [rawText, ...tokens].join(" ");
}

export function isCivitaiSearchIndexAvailable(db: SceneForgeSqliteDatabase): boolean {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(CIVITAI_SEARCH_INDEX_TABLE);

  return readTextColumn(row, "name") === CIVITAI_SEARCH_INDEX_TABLE;
}

export function rebuildCivitaiSearchIndex(db: SceneForgeSqliteDatabase): { indexedCount: number } {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DROP TABLE IF EXISTS ${CIVITAI_SEARCH_INDEX_TABLE};
      CREATE VIRTUAL TABLE ${CIVITAI_SEARCH_INDEX_TABLE}
      USING fts5(
        resource_id UNINDEXED,
        resource_type UNINDEXED,
        search_text,
        tokenize = 'unicode61'
      );
    `);

    const rows = db.prepare(`
      SELECT
        r.id,
        r.resource_type,
        r.name,
        r.version_name,
        r.base_model,
        r.trained_words_json,
        r.tags_json,
        r.category,
        r.usage_guide,
        r.description,
        r.recommendations_json,
        (
          SELECT json_group_array(rc.category)
          FROM civitai_resource_categories rc
          WHERE rc.resource_id = r.id
          ORDER BY rc.sort_order, rc.category
        ) AS categories_json
      FROM civitai_resources r
      WHERE r.resource_type IN ('model', 'lora')
    `).all();
    const insert = db.prepare(`
      INSERT INTO ${CIVITAI_SEARCH_INDEX_TABLE} (resource_id, resource_type, search_text)
      VALUES (?, ?, ?)
    `);

    for (const row of rows) {
      const category = readTextColumn(row, "category");
      const categories = textList(readJsonArray(readTextColumn(row, "categories_json")));
      insert.run(
        readTextColumn(row, "id") ?? "",
        readTextColumn(row, "resource_type") ?? "",
        buildCivitaiResourceSearchText({
          name: readTextColumn(row, "name") ?? null,
          versionName: readTextColumn(row, "version_name") ?? null,
          baseModel: readTextColumn(row, "base_model") ?? null,
          trainedWords: textList(readJsonArray(readTextColumn(row, "trained_words_json"))),
          tags: textList(readJsonArray(readTextColumn(row, "tags_json"))),
          categories: categories.length > 0 ? categories : category ? [category] : [],
          usageGuide: readTextColumn(row, "usage_guide") ?? null,
          description: readTextColumn(row, "description") ?? null,
          recommendations: readJsonArray(readTextColumn(row, "recommendations_json")),
        }),
      );
    }

    db.exec("COMMIT");
    return { indexedCount: rows.length };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function escapeFtsPhrase(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildFtsQuery(desiredEffect: string) {
  const tokens = tokenizeCivitaiSearchText(desiredEffect);
  return tokens.length > 0 ? tokens.map(escapeFtsPhrase).join(" OR ") : "";
}

export function rankCivitaiResourceIdsBySearchIndex(
  db: SceneForgeSqliteDatabase,
  input: {
    desiredEffect: string;
    resourceIds: string[];
    resourceType: Extract<CivitaiResourceType, "model" | "lora">;
  },
): Map<string, number> {
  if (input.resourceIds.length === 0) {
    return new Map();
  }

  const ftsQuery = buildFtsQuery(input.desiredEffect);
  if (!ftsQuery) {
    return new Map();
  }

  const placeholders = input.resourceIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT resource_id, bm25(${CIVITAI_SEARCH_INDEX_TABLE}) AS rank
    FROM ${CIVITAI_SEARCH_INDEX_TABLE}
    WHERE ${CIVITAI_SEARCH_INDEX_TABLE} MATCH ?
      AND resource_type = ?
      AND resource_id IN (${placeholders})
    ORDER BY rank ASC
  `).all(ftsQuery, input.resourceType, ...input.resourceIds);

  return new Map(
    rows.map((row) => [
      readTextColumn(row, "resource_id") ?? "",
      readNumberColumn(row, "rank") ?? Number.POSITIVE_INFINITY,
    ]),
  );
}
