import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const INDEX_TABLE = "civitai_resource_search_fts";

const DOMAIN_SYNONYM_RULES = [
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

function sqlitePath() {
  const override = process.env.SCENEFORGE_SQLITE_FILE?.trim();
  return path.resolve(override || path.join(process.cwd(), "data", "sceneforge.sqlite"));
}

function readJsonArray(value) {
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

function textList(values) {
  return values.filter((value) => typeof value === "string" && value.trim().length > 0);
}

function addLatinTokens(text, tokens) {
  for (const token of text.match(/[a-z0-9][a-z0-9+._-]*/gi) ?? []) {
    if (token.length >= 2) {
      tokens.add(token.toLocaleLowerCase());
    }
  }
}

function addCjkGrams(text, tokens) {
  for (const match of text.match(/[\u3400-\u9fff]+/g) ?? []) {
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

function addSegmenterTokens(text, tokens) {
  const segmenter = "Segmenter" in Intl ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
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

function addDomainSynonyms(text, tokens) {
  for (const rule of DOMAIN_SYNONYM_RULES) {
    if (rule.tests.some((test) => text.includes(test))) {
      for (const token of rule.tokens) {
        tokens.add(token);
      }
    }
  }
}

function tokenizeSearchText(value) {
  const normalized = String(value ?? "").toLocaleLowerCase().trim();
  const tokens = new Set();
  addLatinTokens(normalized, tokens);
  addSegmenterTokens(normalized, tokens);
  addCjkGrams(normalized, tokens);
  addDomainSynonyms(normalized, tokens);
  return Array.from(tokens);
}

function recommendationText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  return [value.condition, value.baseModel, value.checkpoint, value.sampler, value.notes]
    .filter((item) => typeof item === "string")
    .join(" ");
}

function buildSearchText(row) {
  const categories = textList(readJsonArray(row.categories_json));
  const rawText = [
    row.name,
    row.version_name,
    row.base_model,
    ...textList(readJsonArray(row.trained_words_json)),
    ...textList(readJsonArray(row.tags_json)),
    ...(categories.length > 0 ? categories : row.category ? [row.category] : []),
    row.usage_guide,
    row.description,
    ...readJsonArray(row.recommendations_json).map(recommendationText),
  ].filter((item) => typeof item === "string" && item.trim().length > 0).join(" ");

  return [rawText, ...tokenizeSearchText(rawText)].join(" ");
}

const filePath = sqlitePath();
fs.mkdirSync(path.dirname(filePath), { recursive: true });

const db = new DatabaseSync(filePath);
try {
  db.exec("BEGIN IMMEDIATE");
  db.exec(`
    DROP TABLE IF EXISTS ${INDEX_TABLE};
    CREATE VIRTUAL TABLE ${INDEX_TABLE}
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
    INSERT INTO ${INDEX_TABLE} (resource_id, resource_type, search_text)
    VALUES (?, ?, ?)
  `);

  for (const row of rows) {
    insert.run(row.id, row.resource_type, buildSearchText(row));
  }

  db.exec("COMMIT");
  console.log(`Rebuilt Civitai FTS search index at ${filePath}. Indexed ${rows.length} resources.`);
} catch (error) {
  db.exec("ROLLBACK");
  console.error("Failed to rebuild Civitai FTS search index.");
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}
