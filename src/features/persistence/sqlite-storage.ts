import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import {
  coerceStructuredArtistString,
  normalizeFormattedArtistString,
} from "@/features/artist-string-library/novelai-artist-string";
import type {
  ArtistStringAdapterItem,
  ArtistStringCategoryCount,
  ArtistStringItemRecord,
  ArtistStringListFilters,
  ArtistStringPlatformRecord,
  ArtistStringReferenceImageInput,
  ArtistStringReferenceImageRecord,
} from "@/features/artist-string-library/types";
import { getOfficialPreviewImage } from "@/features/civitai-lora-library/normalize";
import { sanitizeCivitaiLibrarySettingsPayload } from "@/features/civitai-lora-library/settings";
import type {
  CivitaiLibrarySettings,
  CivitaiResourceListFilters,
  CivitaiResourceListItem,
  CivitaiResourceRecord,
  CivitaiLoraCategory,
  CivitaiResourceType,
  CivitaiResourceUpsertInput,
  CivitaiResolveStatus,
  CivitaiResourceDetail,
  CivitaiUsageSource,
  ImageResourceUsageRecord,
  ImportedImageDetail,
  ImportedImageListFilters,
  ImportedImageListItem,
  ImportedImageRecord,
  NormalizedCivitaiImage,
} from "@/features/civitai-lora-library/types";
import {
  characterTagNewTermDefaultOptions,
  defaultSceneForgeUserSettings,
  type CharacterTagNewTermDefaultOption,
  type SceneForgeUserSettings,
  type WorkflowDisplayMode,
  workflowDisplayModeOptions,
} from "@/features/settings/types";
import type { ProjectSummary, PromptBindingState, SceneForgeProject } from "@/shared/types";

import {
  getProjectContentFingerprint,
  sanitizeGlobalPromptBindingsPayload,
  sanitizeGlobalPromptLibraryPayload,
  sanitizeImportedProject,
  serializeProject,
  stripSharedPromptStateFromProject,
  type GlobalPromptLibraryState,
} from "./project-serialization";

type SqlitePrimitive = string | number | bigint | null | Uint8Array;

type SceneForgeSqliteStatement = {
  all(...values: SqlitePrimitive[]): unknown[];
  get(...values: SqlitePrimitive[]): unknown;
  run(...values: SqlitePrimitive[]): unknown;
};

export type SceneForgeSqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SceneForgeSqliteStatement;
};

const SCHEMA_VERSION = "2";
const PROMPT_LIBRARY_KEY = "prompt-library";
const PROMPT_BINDINGS_KEY = "prompt-bindings";
const CIVITAI_LIBRARY_SETTINGS_KEY = "civitai-lora-library-settings";
const SCENEFORGE_USER_SETTINGS_KEY = "sceneforge-user-settings";
const CIVITAI_LOCAL_IMAGE_ROUTE_PREFIX = "/api/civitai-lora-library/images/";
const ARTIST_STRING_LOCAL_IMAGE_ROUTE_PREFIX = "/api/artist-string-library/images/";

type NodeSqliteModule = {
  DatabaseSync: new (location: string) => SceneForgeSqliteDatabase;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function readBooleanColumn(row: unknown, column: string): boolean | null {
  const value = readNumberColumn(row, column);
  if (value === undefined) {
    return null;
  }

  return value === 1;
}

function readJsonColumn(row: unknown, column: string): unknown {
  const value = readTextColumn(row, column);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readJsonArrayColumn(row: unknown, column: string): unknown[] {
  const value = readJsonColumn(row, column);
  return Array.isArray(value) ? value : [];
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Optional absolute path; defaults to `<cwd>/data/sceneforge.sqlite`. */
export function getResolvedSqliteFilePath(): string {
  const override = process.env.SCENEFORGE_SQLITE_FILE?.trim();
  if (override) {
    return override;
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "sceneforge.sqlite");
}

function getTableColumns(db: SceneForgeSqliteDatabase, tableName: string): Set<string> {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row) => readTextColumn(row, "name"))
      .filter((name): name is string => Boolean(name)),
  );
}

function addColumnIfMissing(
  db: SceneForgeSqliteDatabase,
  columns: Set<string>,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  if (columns.has(columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  columns.add(columnName);
}

function ensureCivitaiResourceSchema(db: SceneForgeSqliteDatabase): void {
  const importedImageColumns = getTableColumns(db, "imported_images");
  addColumnIfMissing(db, importedImageColumns, "imported_images", "source_image_url", "TEXT");

  const columns = getTableColumns(db, "civitai_resources");
  addColumnIfMissing(db, columns, "civitai_resources", "usage_guide", "TEXT");
  addColumnIfMissing(db, columns, "civitai_resources", "recommendations_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, columns, "civitai_resources", "enrichment_status", "TEXT NOT NULL DEFAULT 'fallback'");
  addColumnIfMissing(db, columns, "civitai_resources", "enrichment_error", "TEXT");
  addColumnIfMissing(db, columns, "civitai_resources", "ai_nsfw_level", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, columns, "civitai_resources", "ai_nsfw_confidence", "REAL");
  addColumnIfMissing(db, columns, "civitai_resources", "ai_nsfw_reason", "TEXT");
  const categoryColumns = getTableColumns(db, "civitai_resource_categories");
  addColumnIfMissing(db, categoryColumns, "civitai_resource_categories", "sort_order", "INTEGER NOT NULL DEFAULT 0");

  db.prepare(`
    INSERT OR IGNORE INTO civitai_resource_categories (resource_id, category, sort_order)
    SELECT id, category, 0
    FROM civitai_resources
    WHERE category IS NOT NULL AND trim(category) <> ''
  `).run();
}

export function ensureSceneForgeSqliteSchema(db: SceneForgeSqliteDatabase): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS scene_forge_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_fingerprint TEXT NOT NULL,
      project_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_updated_at
      ON projects (updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_projects_content_fingerprint
      ON projects (content_fingerprint);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS imported_images (
      id TEXT PRIMARY KEY,
      civitai_image_id INTEGER NOT NULL UNIQUE,
      civitai_image_page_url TEXT NOT NULL,
      image_url TEXT,
      source_image_url TEXT,
      width INTEGER,
      height INTEGER,
      nsfw INTEGER,
      nsfw_level INTEGER,
      browsing_level INTEGER,
      created_at_on_civitai TEXT,
      post_id INTEGER,
      username TEXT,
      base_model TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      sampler TEXT,
      steps INTEGER,
      cfg_scale REAL,
      seed TEXT,
      raw_meta_json TEXT,
      imported_by_user_id TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS civitai_resources (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      civitai_model_id INTEGER,
      civitai_model_version_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      version_name TEXT,
      hash TEXT UNIQUE,
      base_model TEXT,
      trained_words_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      description TEXT,
      creator TEXT,
      download_url TEXT,
      files_json TEXT,
      official_images_json TEXT,
      category TEXT,
      usage_guide TEXT,
      recommendations_json TEXT NOT NULL DEFAULT '[]',
      enrichment_status TEXT NOT NULL DEFAULT 'fallback',
      enrichment_error TEXT,
      nsfw INTEGER,
      ai_nsfw_level TEXT NOT NULL DEFAULT 'unknown',
      ai_nsfw_confidence REAL,
      ai_nsfw_reason TEXT,
      raw_version_json TEXT,
      normalized_name TEXT NOT NULL,
      normalized_base_model TEXT,
      normalized_version_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_civitai_resources_type
      ON civitai_resources (resource_type);

    CREATE INDEX IF NOT EXISTS idx_civitai_resources_category
      ON civitai_resources (category);

    CREATE TABLE IF NOT EXISTS civitai_resource_categories (
      resource_id TEXT NOT NULL,
      category TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(resource_id, category),
      FOREIGN KEY(resource_id) REFERENCES civitai_resources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_civitai_resource_categories_category
      ON civitai_resource_categories (category);

    CREATE INDEX IF NOT EXISTS idx_civitai_resources_model_version_name
      ON civitai_resources (civitai_model_id, normalized_version_name);

    CREATE INDEX IF NOT EXISTS idx_civitai_resources_normalized_name_base_model
      ON civitai_resources (normalized_name, normalized_base_model);

    CREATE TABLE IF NOT EXISTS image_resource_usages (
      id TEXT PRIMARY KEY,
      imported_image_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      weight REAL,
      trigger_words_used_json TEXT NOT NULL,
      source TEXT NOT NULL,
      resolve_status TEXT NOT NULL,
      raw_resource_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(imported_image_id, resource_id, source),
      FOREIGN KEY(imported_image_id) REFERENCES imported_images(id) ON DELETE CASCADE,
      FOREIGN KEY(resource_id) REFERENCES civitai_resources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_image_resource_usages_image
      ON image_resource_usages (imported_image_id);

    CREATE INDEX IF NOT EXISTS idx_image_resource_usages_resource
      ON image_resource_usages (resource_id);

    CREATE TABLE IF NOT EXISTS artist_string_platforms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      prompt_format TEXT NOT NULL,
      source_updated_at_text TEXT,
      synced_at TEXT NOT NULL,
      raw_meta_json TEXT
    );

    CREATE TABLE IF NOT EXISTS artist_string_items (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL,
      source_sequence INTEGER NOT NULL,
      category_key TEXT NOT NULL,
      category_name TEXT NOT NULL,
      raw_artist_string TEXT NOT NULL,
      structured_artist_string_json TEXT NOT NULL,
      prompt_format TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      parse_error TEXT,
      formatted_prompt TEXT NOT NULL,
      normalized_artist_string TEXT NOT NULL,
      source_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform_id, source_sequence),
      FOREIGN KEY(platform_id) REFERENCES artist_string_platforms(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artist_string_items_platform_category
      ON artist_string_items (platform_id, category_key, source_sequence);

    CREATE INDEX IF NOT EXISTS idx_artist_string_items_normalized
      ON artist_string_items (normalized_artist_string);

    CREATE TABLE IF NOT EXISTS artist_string_reference_images (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      role TEXT NOT NULL,
      source_url TEXT NOT NULL,
      alt TEXT,
      local_url TEXT,
      width INTEGER,
      height INTEGER,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(item_id) REFERENCES artist_string_items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artist_string_reference_images_item
      ON artist_string_reference_images (item_id, sort_order);
  `);

  ensureCivitaiResourceSchema(db);

  db.prepare(`
    INSERT INTO scene_forge_metadata (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SCHEMA_VERSION);
}

export async function openSceneForgeSqliteDatabase(
  filePath = getResolvedSqliteFilePath(),
): Promise<SceneForgeSqliteDatabase> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(resolved), { recursive: true });

  const sqlite = (await import("node:sqlite")) as NodeSqliteModule;
  const db = new sqlite.DatabaseSync(resolved);
  ensureSceneForgeSqliteSchema(db);
  return db;
}

export function saveProjectToSqlite(
  db: SceneForgeSqliteDatabase,
  project: SceneForgeProject,
): void {
  const normalized = sanitizeImportedProject(project);
  const toWrite = stripSharedPromptStateFromProject(normalized);
  const fingerprint = getProjectContentFingerprint(toWrite);
  const projectJson = serializeProject(toWrite);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM projects WHERE content_fingerprint = ? AND id <> ?").run(
      fingerprint,
      toWrite.id,
    );

    db.prepare(`
      INSERT INTO projects (
        id,
        name,
        created_at,
        updated_at,
        content_fingerprint,
        project_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        content_fingerprint = excluded.content_fingerprint,
        project_json = excluded.project_json
    `).run(
      toWrite.id,
      toWrite.name,
      toWrite.createdAt,
      toWrite.updatedAt,
      fingerprint,
      projectJson,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadProjectFromSqlite(
  db: SceneForgeSqliteDatabase,
  projectId: string,
): SceneForgeProject | undefined {
  const row = db.prepare("SELECT project_json FROM projects WHERE id = ?").get(projectId);
  const projectJson = readTextColumn(row, "project_json");
  if (!projectJson) {
    return undefined;
  }

  return sanitizeImportedProject(JSON.parse(projectJson) as SceneForgeProject);
}

export function deleteProjectFromSqlite(
  db: SceneForgeSqliteDatabase,
  projectId: string,
): boolean {
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!readTextColumn(existing, "id")) {
    return false;
  }

  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  return true;
}

export function listProjectSummariesFromSqlite(
  db: SceneForgeSqliteDatabase,
): ProjectSummary[] {
  return db.prepare(`
    SELECT id, name, updated_at
    FROM projects
    ORDER BY updated_at DESC
  `).all().map((row) => ({
    id: readTextColumn(row, "id") ?? "",
    name: readTextColumn(row, "name") ?? "",
    updatedAt: readTextColumn(row, "updated_at") ?? "",
  })).filter((summary) => summary.id.length > 0);
}

function readAppStateJson(db: SceneForgeSqliteDatabase, key: string): unknown | undefined {
  const row = db.prepare("SELECT value_json FROM app_state WHERE key = ?").get(key);
  const valueJson = readTextColumn(row, "value_json");
  if (!valueJson) {
    return undefined;
  }

  return JSON.parse(valueJson);
}

function writeAppStateJson(
  db: SceneForgeSqliteDatabase,
  key: string,
  value: unknown,
): void {
  db.prepare(`
    INSERT INTO app_state (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), nowIso());
}

function sanitizeSceneForgeUserSettingsPayload(payload: unknown): SceneForgeUserSettings {
  const record = isRecord(payload) ? payload : {};
  const workflowRecord = isRecord(record.workflow) ? record.workflow : {};
  const rawCharacterTagDefault = workflowRecord.characterTagNewTermDefaultOption;
  const characterTagNewTermDefaultOption: CharacterTagNewTermDefaultOption =
    typeof rawCharacterTagDefault === "string" &&
    characterTagNewTermDefaultOptions.includes(rawCharacterTagDefault as CharacterTagNewTermDefaultOption)
      ? (rawCharacterTagDefault as CharacterTagNewTermDefaultOption)
      : defaultSceneForgeUserSettings.workflow.characterTagNewTermDefaultOption;
  const rawDisplayMode = workflowRecord.displayMode;
  const displayMode: WorkflowDisplayMode =
    typeof rawDisplayMode === "string" &&
    workflowDisplayModeOptions.includes(rawDisplayMode as WorkflowDisplayMode)
      ? (rawDisplayMode as WorkflowDisplayMode)
      : defaultSceneForgeUserSettings.workflow.displayMode;

  return {
    supportsNsfw:
      typeof record.supportsNsfw === "boolean"
        ? record.supportsNsfw
        : defaultSceneForgeUserSettings.supportsNsfw,
    workflow: {
      characterTagNewTermDefaultOption,
      autoReview:
        typeof workflowRecord.autoReview === "boolean"
          ? workflowRecord.autoReview
          : defaultSceneForgeUserSettings.workflow.autoReview,
      displayMode,
    },
  };
}

export function loadPromptLibraryFromSqlite(
  db: SceneForgeSqliteDatabase,
): GlobalPromptLibraryState {
  const payload = readAppStateJson(db, PROMPT_LIBRARY_KEY);
  return sanitizeGlobalPromptLibraryPayload(payload ?? {});
}

export function savePromptLibraryToSqlite(
  db: SceneForgeSqliteDatabase,
  state: GlobalPromptLibraryState,
): void {
  const normalized = sanitizeGlobalPromptLibraryPayload(state);
  writeAppStateJson(db, PROMPT_LIBRARY_KEY, { version: 1, ...normalized });
}

export function loadPromptBindingsFromSqlite(
  db: SceneForgeSqliteDatabase,
): PromptBindingState {
  const payload = readAppStateJson(db, PROMPT_BINDINGS_KEY);
  return sanitizeGlobalPromptBindingsPayload(payload ?? {});
}

export function savePromptBindingsToSqlite(
  db: SceneForgeSqliteDatabase,
  state: PromptBindingState,
): void {
  const normalized = sanitizeGlobalPromptBindingsPayload(state);
  writeAppStateJson(db, PROMPT_BINDINGS_KEY, { version: 1, ...normalized });
}

export function loadCivitaiLibrarySettingsFromSqlite(
  db: SceneForgeSqliteDatabase,
): CivitaiLibrarySettings {
  const payload = readAppStateJson(db, CIVITAI_LIBRARY_SETTINGS_KEY);
  return sanitizeCivitaiLibrarySettingsPayload(payload ?? {});
}

export function saveCivitaiLibrarySettingsToSqlite(
  db: SceneForgeSqliteDatabase,
  settings: unknown,
): CivitaiLibrarySettings {
  const normalized = sanitizeCivitaiLibrarySettingsPayload(settings);
  writeAppStateJson(db, CIVITAI_LIBRARY_SETTINGS_KEY, { version: 1, ...normalized });
  return normalized;
}

export function loadSceneForgeUserSettingsFromSqlite(
  db: SceneForgeSqliteDatabase,
): SceneForgeUserSettings {
  const payload = readAppStateJson(db, SCENEFORGE_USER_SETTINGS_KEY);
  return sanitizeSceneForgeUserSettingsPayload(payload ?? {});
}

export function saveSceneForgeUserSettingsToSqlite(
  db: SceneForgeSqliteDatabase,
  settings: unknown,
): SceneForgeUserSettings {
  const normalized = sanitizeSceneForgeUserSettingsPayload(settings);
  writeAppStateJson(db, SCENEFORGE_USER_SETTINGS_KEY, { version: 1, ...normalized });
  return normalized;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

type ArtistStringReferenceImageUpsertInput = ArtistStringReferenceImageInput & {
  localUrl: string | null;
  width: number | null;
  height: number | null;
};

type ArtistStringItemUpsertInput = Omit<ArtistStringAdapterItem, "referenceImages"> & {
  referenceImages: ArtistStringReferenceImageUpsertInput[];
};

function mapArtistStringPlatformRow(row: unknown): ArtistStringPlatformRecord {
  return {
    id: (readTextColumn(row, "id") ?? "nai_bot_artists_gallery") as ArtistStringPlatformRecord["id"],
    name: readTextColumn(row, "name") ?? "",
    sourceUrl: readTextColumn(row, "source_url") ?? "",
    promptFormat: (readTextColumn(row, "prompt_format") ?? "novelai") as ArtistStringPlatformRecord["promptFormat"],
    sourceUpdatedAtText: readTextColumn(row, "source_updated_at_text") ?? null,
    syncedAt: readTextColumn(row, "synced_at") ?? "",
    rawMetaJson: readJsonColumn(row, "raw_meta_json"),
  };
}

function mapArtistStringReferenceImageRow(row: unknown): ArtistStringReferenceImageRecord {
  return {
    id: readTextColumn(row, "id") ?? "",
    itemId: readTextColumn(row, "item_id") ?? "",
    role: readTextColumn(row, "role") ?? "",
    sourceUrl: readTextColumn(row, "source_url") ?? "",
    alt: readTextColumn(row, "alt") ?? null,
    localUrl: readTextColumn(row, "local_url") ?? null,
    width: readNumberColumn(row, "width") ?? null,
    height: readNumberColumn(row, "height") ?? null,
    sortOrder: readNumberColumn(row, "sort_order") ?? 0,
    createdAt: readTextColumn(row, "created_at") ?? "",
  };
}

function listArtistStringReferenceImagesForItem(
  db: SceneForgeSqliteDatabase,
  itemId: string,
): ArtistStringReferenceImageRecord[] {
  return db.prepare(`
    SELECT *
    FROM artist_string_reference_images
    WHERE item_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(itemId).map(mapArtistStringReferenceImageRow);
}

function mapArtistStringItemRow(
  row: unknown,
  referenceImages: ArtistStringReferenceImageRecord[] = [],
): ArtistStringItemRecord {
  const structuredArtistString = coerceStructuredArtistString(
    readJsonColumn(row, "structured_artist_string_json"),
  ) ?? {
    type: "novelai" as const,
    raw: readTextColumn(row, "raw_artist_string") ?? "",
    nodes: [],
    warnings: ["Stored structured artist string could not be parsed."],
  };

  return {
    id: readTextColumn(row, "id") ?? "",
    platformId: (readTextColumn(row, "platform_id") ?? "nai_bot_artists_gallery") as ArtistStringItemRecord["platformId"],
    sourceSequence: readNumberColumn(row, "source_sequence") ?? 0,
    categoryKey: readTextColumn(row, "category_key") ?? "",
    categoryName: readTextColumn(row, "category_name") ?? "",
    rawArtistString: readTextColumn(row, "raw_artist_string") ?? "",
    structuredArtistString,
    promptFormat: (readTextColumn(row, "prompt_format") ?? "novelai") as ArtistStringItemRecord["promptFormat"],
    parseStatus: (readTextColumn(row, "parse_status") ?? "failed") as ArtistStringItemRecord["parseStatus"],
    parseError: readTextColumn(row, "parse_error") ?? null,
    formattedPrompt: readTextColumn(row, "formatted_prompt") ?? "",
    normalizedArtistString: readTextColumn(row, "normalized_artist_string") ?? "",
    sourceUrl: readTextColumn(row, "source_url") ?? "",
    referenceImages,
    createdAt: readTextColumn(row, "created_at") ?? "",
    updatedAt: readTextColumn(row, "updated_at") ?? "",
  };
}

export function upsertArtistStringSyncToSqlite(
  db: SceneForgeSqliteDatabase,
  input: {
    platform: Omit<ArtistStringPlatformRecord, "syncedAt">;
    items: ArtistStringItemUpsertInput[];
  },
): ArtistStringPlatformRecord {
  const syncedAt = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO artist_string_platforms (
        id,
        name,
        source_url,
        prompt_format,
        source_updated_at_text,
        synced_at,
        raw_meta_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_url = excluded.source_url,
        prompt_format = excluded.prompt_format,
        source_updated_at_text = excluded.source_updated_at_text,
        synced_at = excluded.synced_at,
        raw_meta_json = excluded.raw_meta_json
    `).run(
      input.platform.id,
      input.platform.name,
      input.platform.sourceUrl,
      input.platform.promptFormat,
      input.platform.sourceUpdatedAtText,
      syncedAt,
      stringifyJson(input.platform.rawMetaJson),
    );

    const seenSequences: number[] = [];
    for (const item of input.items) {
      seenSequences.push(item.sourceSequence);
      const existing = db.prepare(`
        SELECT id, created_at
        FROM artist_string_items
        WHERE platform_id = ? AND source_sequence = ?
      `).get(item.platformId, item.sourceSequence);
      const id = readTextColumn(existing, "id") ?? newId("artist_str");
      const createdAt = readTextColumn(existing, "created_at") ?? syncedAt;
      const updatedAt = syncedAt;
      const normalizedArtistString = normalizeFormattedArtistString(item.formattedPrompt);

      db.prepare(`
        INSERT INTO artist_string_items (
          id,
          platform_id,
          source_sequence,
          category_key,
          category_name,
          raw_artist_string,
          structured_artist_string_json,
          prompt_format,
          parse_status,
          parse_error,
          formatted_prompt,
          normalized_artist_string,
          source_url,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform_id, source_sequence) DO UPDATE SET
          category_key = excluded.category_key,
          category_name = excluded.category_name,
          raw_artist_string = excluded.raw_artist_string,
          structured_artist_string_json = excluded.structured_artist_string_json,
          prompt_format = excluded.prompt_format,
          parse_status = excluded.parse_status,
          parse_error = excluded.parse_error,
          formatted_prompt = excluded.formatted_prompt,
          normalized_artist_string = excluded.normalized_artist_string,
          source_url = excluded.source_url,
          updated_at = excluded.updated_at
      `).run(
        id,
        item.platformId,
        item.sourceSequence,
        item.categoryKey,
        item.categoryName,
        item.rawArtistString,
        stringifyJson(item.structuredArtistString),
        item.promptFormat,
        item.parseStatus,
        item.parseError,
        item.formattedPrompt,
        normalizedArtistString,
        item.sourceUrl,
        createdAt,
        updatedAt,
      );

      db.prepare("DELETE FROM artist_string_reference_images WHERE item_id = ?").run(id);
      for (const referenceImage of item.referenceImages) {
        db.prepare(`
          INSERT INTO artist_string_reference_images (
            id,
            item_id,
            role,
            source_url,
            alt,
            local_url,
            width,
            height,
            sort_order,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId("artist_img"),
          id,
          referenceImage.role,
          referenceImage.sourceUrl,
          referenceImage.alt,
          referenceImage.localUrl,
          referenceImage.width,
          referenceImage.height,
          referenceImage.sortOrder,
          syncedAt,
        );
      }
    }

    if (seenSequences.length > 0) {
      const placeholders = seenSequences.map(() => "?").join(", ");
      db.prepare(`
        DELETE FROM artist_string_items
        WHERE platform_id = ?
          AND source_sequence NOT IN (${placeholders})
      `).run(input.platform.id, ...seenSequences);
    } else {
      db.prepare("DELETE FROM artist_string_items WHERE platform_id = ?").run(input.platform.id);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return mapArtistStringPlatformRow(
    db.prepare("SELECT * FROM artist_string_platforms WHERE id = ?").get(input.platform.id),
  );
}

export function listArtistStringPlatformsFromSqlite(
  db: SceneForgeSqliteDatabase,
): ArtistStringPlatformRecord[] {
  return db.prepare(`
    SELECT *
    FROM artist_string_platforms
    ORDER BY name ASC
  `).all().map(mapArtistStringPlatformRow);
}

export function listArtistStringCategoryCountsFromSqlite(
  db: SceneForgeSqliteDatabase,
  platformId: string,
): ArtistStringCategoryCount[] {
  return db.prepare(`
    SELECT
      category_key,
      category_name,
      MIN(source_sequence) AS start_sequence,
      MAX(source_sequence) AS end_sequence,
      COUNT(*) AS count
    FROM artist_string_items
    WHERE platform_id = ?
    GROUP BY category_key, category_name
    ORDER BY start_sequence ASC
  `).all(platformId).map((row) => ({
    key: readTextColumn(row, "category_key") ?? "",
    name: readTextColumn(row, "category_name") ?? "",
    description: "",
    startSequence: readNumberColumn(row, "start_sequence") ?? 0,
    endSequence: readNumberColumn(row, "end_sequence") ?? null,
    count: readNumberColumn(row, "count") ?? 0,
  }));
}

export function listArtistStringItemsFromSqlite(
  db: SceneForgeSqliteDatabase,
  filters: ArtistStringListFilters = {},
): ArtistStringItemRecord[] {
  const where: string[] = [];
  const values: SqlitePrimitive[] = [];

  if (filters.platformId) {
    where.push("platform_id = ?");
    values.push(filters.platformId);
  }

  if (filters.category && filters.category !== "all") {
    where.push("category_key = ?");
    values.push(filters.category);
  }

  if (filters.query?.trim()) {
    where.push(`(
      CAST(source_sequence AS TEXT) LIKE ?
      OR raw_artist_string LIKE ?
      OR formatted_prompt LIKE ?
      OR normalized_artist_string LIKE ?
      OR category_name LIKE ?
    )`);
    const query = `%${filters.query.trim()}%`;
    const normalizedQuery = `%${normalizeFormattedArtistString(filters.query)}%`;
    values.push(query, query, query, normalizedQuery, query);
  }

  return db.prepare(`
    SELECT *
    FROM artist_string_items
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY platform_id ASC, source_sequence ASC
  `).all(...values).map((row) => {
    const itemId = readTextColumn(row, "id") ?? "";
    return mapArtistStringItemRow(row, listArtistStringReferenceImagesForItem(db, itemId));
  });
}

export function getArtistStringItemFromSqlite(
  db: SceneForgeSqliteDatabase,
  itemId: string,
): ArtistStringItemRecord | undefined {
  const row = db.prepare("SELECT * FROM artist_string_items WHERE id = ?").get(itemId);
  const id = readTextColumn(row, "id");
  if (!id) {
    return undefined;
  }

  return mapArtistStringItemRow(row, listArtistStringReferenceImagesForItem(db, id));
}

export function getArtistStringItemsFromSqlite(
  db: SceneForgeSqliteDatabase,
  itemIds: string[],
): ArtistStringItemRecord[] {
  return itemIds
    .map((itemId) => getArtistStringItemFromSqlite(db, itemId))
    .filter((item): item is ArtistStringItemRecord => item !== undefined);
}

export function listReferencedArtistStringLocalImageUrlsFromSqlite(
  db: SceneForgeSqliteDatabase,
): string[] {
  return db.prepare(`
    SELECT local_url
    FROM artist_string_reference_images
    WHERE local_url LIKE ?
  `).all(`${ARTIST_STRING_LOCAL_IMAGE_ROUTE_PREFIX}%`).map((row) => readTextColumn(row, "local_url")).filter((url): url is string => Boolean(url));
}

function parseJsonText(value: string | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mergeTriggerWordsJson(targetJson: string | undefined, sourceJson: string | undefined): string {
  const words = new Set<string>();
  for (const value of [parseJsonText(targetJson), parseJsonText(sourceJson)]) {
    if (!Array.isArray(value)) {
      continue;
    }

    for (const word of value) {
      if (typeof word === "string" && word.trim()) {
        words.add(word);
      }
    }
  }

  return stringifyJson([...words]);
}

function mergeRawResourceJson(targetJson: string | undefined, sourceJson: string | undefined): string {
  const target = parseJsonText(targetJson);
  const source = parseJsonText(sourceJson);
  if (target === null) {
    return stringifyJson(source);
  }
  if (source === null || JSON.stringify(target) === JSON.stringify(source)) {
    return stringifyJson(target);
  }

  return stringifyJson({ source: "merged_civitai_resource_usage", sources: [target, source] });
}

function preferUsageResolveStatus(
  targetStatus: string | undefined,
  sourceStatus: string | undefined,
): CivitaiResolveStatus {
  const fallback: CivitaiResolveStatus = "unresolved";
  const priority: Record<CivitaiResolveStatus, number> = {
    resolved_by_model_version_id: 5,
    resolved_by_hash: 4,
    resolved_by_name_search: 3,
    metadata_only: 2,
    unresolved: 1,
  };
  const target = (targetStatus ?? fallback) as CivitaiResolveStatus;
  const source = (sourceStatus ?? fallback) as CivitaiResolveStatus;

  return (priority[source] ?? 0) > (priority[target] ?? 0) ? source : target;
}

function collectCivitaiLocalImageUrls(value: unknown, urls: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith(CIVITAI_LOCAL_IMAGE_ROUTE_PREFIX)) {
      urls.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectCivitaiLocalImageUrls(entry, urls));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.values(value).forEach((entry) => collectCivitaiLocalImageUrls(entry, urls));
}

export function listReferencedCivitaiLocalImageUrlsFromSqlite(db: SceneForgeSqliteDatabase): string[] {
  const urls = new Set<string>();
  db.prepare(`
    SELECT image_url
    FROM imported_images
    WHERE image_url LIKE '/api/civitai-lora-library/images/%'
  `).all().forEach((row) => {
    const imageUrl = readTextColumn(row, "image_url");
    if (imageUrl) {
      urls.add(imageUrl);
    }
  });

  db.prepare(`
    SELECT official_images_json
    FROM civitai_resources
    WHERE official_images_json IS NOT NULL
  `).all().forEach((row) => {
    collectCivitaiLocalImageUrls(readJsonColumn(row, "official_images_json"), urls);
  });

  return [...urls];
}

export function listCivitaiOfficialImageCacheReferencesFromSqlite(
  db: SceneForgeSqliteDatabase,
): Array<{ sourceUrl: string; localUrl: string }> {
  const references: Array<{ sourceUrl: string; localUrl: string }> = [];
  db.prepare(`
    SELECT official_images_json
    FROM civitai_resources
    WHERE official_images_json IS NOT NULL
  `).all().forEach((row) => {
    const value = readJsonColumn(row, "official_images_json");
    if (!Array.isArray(value)) {
      return;
    }

    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }

      const sourceUrl = typeof entry.sourceUrl === "string" ? entry.sourceUrl : null;
      const localUrl = typeof entry.url === "string" && entry.url.startsWith(CIVITAI_LOCAL_IMAGE_ROUTE_PREFIX)
        ? entry.url
        : null;
      if (sourceUrl && localUrl) {
        references.push({ sourceUrl, localUrl });
      }
    }
  });

  return references;
}

function isRemoteImageUrl(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith("https://") || value?.startsWith("http://"));
}

export function listCivitaiImageCacheReferencesFromSqlite(
  db: SceneForgeSqliteDatabase,
): Array<{ sourceUrl: string; localUrl: string }> {
  const references = new Map<string, { sourceUrl: string; localUrl: string }>();

  for (const reference of listCivitaiOfficialImageCacheReferencesFromSqlite(db)) {
    references.set(reference.localUrl, reference);
  }

  db.prepare(`
    SELECT image_url, source_image_url
    FROM imported_images
    WHERE image_url LIKE '/api/civitai-lora-library/images/%'
      AND source_image_url IS NOT NULL
  `).all().forEach((row) => {
    const localUrl = readTextColumn(row, "image_url");
    const sourceUrl = readTextColumn(row, "source_image_url");
    if (localUrl && isRemoteImageUrl(sourceUrl)) {
      references.set(localUrl, { sourceUrl, localUrl });
    }
  });

  return [...references.values()];
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeKeyText(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value)?.replace(/\s+/g, " ").toLocaleLowerCase();
  return normalized ?? null;
}

function normalizeResourceCategories(value: unknown, fallback: CivitaiLoraCategory | null): CivitaiLoraCategory[] {
  const rawCategories = Array.isArray(value) ? value : [];
  const categories = rawCategories
    .filter((category): category is string => typeof category === "string" && category.trim().length > 0)
    .map((category) => category as CivitaiLoraCategory);

  if (categories.length > 0) {
    return Array.from(new Set(categories));
  }

  return fallback ? [fallback] : [];
}

function mapImportedImageRow(row: unknown): ImportedImageRecord {
  return {
    id: readTextColumn(row, "id") ?? "",
    civitaiImageId: readNumberColumn(row, "civitai_image_id") ?? 0,
    civitaiImagePageUrl: readTextColumn(row, "civitai_image_page_url") ?? "",
    imageUrl: readTextColumn(row, "image_url") ?? null,
    sourceImageUrl: readTextColumn(row, "source_image_url") ?? null,
    width: readNumberColumn(row, "width") ?? null,
    height: readNumberColumn(row, "height") ?? null,
    nsfw: readBooleanColumn(row, "nsfw"),
    nsfwLevel: readNumberColumn(row, "nsfw_level") ?? null,
    browsingLevel: readNumberColumn(row, "browsing_level") ?? null,
    createdAtOnCivitai: readTextColumn(row, "created_at_on_civitai") ?? null,
    postId: readNumberColumn(row, "post_id") ?? null,
    username: readTextColumn(row, "username") ?? null,
    baseModel: readTextColumn(row, "base_model") ?? null,
    prompt: readTextColumn(row, "prompt") ?? null,
    negativePrompt: readTextColumn(row, "negative_prompt") ?? null,
    sampler: readTextColumn(row, "sampler") ?? null,
    steps: readNumberColumn(row, "steps") ?? null,
    cfgScale: readNumberColumn(row, "cfg_scale") ?? null,
    seed: readTextColumn(row, "seed") ?? null,
    rawMetaJson: readJsonColumn(row, "raw_meta_json"),
    importedByUserId: readTextColumn(row, "imported_by_user_id") ?? null,
    importedAt: readTextColumn(row, "imported_at") ?? "",
    updatedAt: readTextColumn(row, "updated_at") ?? "",
  };
}

function mapResourceRow(row: unknown): CivitaiResourceRecord {
  const category = (readTextColumn(row, "category") as CivitaiResourceRecord["category"]) ?? null;
  return {
    id: readTextColumn(row, "id") ?? "",
    resourceType: (readTextColumn(row, "resource_type") ?? "other") as CivitaiResourceType,
    civitaiModelId: readNumberColumn(row, "civitai_model_id") ?? null,
    civitaiModelVersionId: readNumberColumn(row, "civitai_model_version_id") ?? null,
    name: readTextColumn(row, "name") ?? "",
    versionName: readTextColumn(row, "version_name") ?? null,
    hash: readTextColumn(row, "hash") ?? null,
    baseModel: readTextColumn(row, "base_model") ?? null,
    trainedWords: (readJsonColumn(row, "trained_words_json") as string[] | null) ?? [],
    tags: (readJsonColumn(row, "tags_json") as string[] | null) ?? [],
    description: readTextColumn(row, "description") ?? null,
    creator: readTextColumn(row, "creator") ?? null,
    downloadUrl: readTextColumn(row, "download_url") ?? null,
    filesJson: readJsonColumn(row, "files_json"),
    officialImagesJson: readJsonColumn(row, "official_images_json"),
    category,
    categories: normalizeResourceCategories(readJsonArrayColumn(row, "categories_json"), category),
    usageGuide: readTextColumn(row, "usage_guide") ?? null,
    recommendations: readJsonArrayColumn(row, "recommendations_json") as CivitaiResourceRecord["recommendations"],
    enrichmentStatus: (readTextColumn(row, "enrichment_status") ?? "fallback") as CivitaiResourceRecord["enrichmentStatus"],
    enrichmentError: readTextColumn(row, "enrichment_error") ?? null,
    nsfw: readBooleanColumn(row, "nsfw"),
    aiNsfwLevel: (readTextColumn(row, "ai_nsfw_level") ?? "unknown") as CivitaiResourceRecord["aiNsfwLevel"],
    aiNsfwConfidence: readNumberColumn(row, "ai_nsfw_confidence") ?? null,
    aiNsfwReason: readTextColumn(row, "ai_nsfw_reason") ?? null,
    rawVersionJson: readJsonColumn(row, "raw_version_json"),
    createdAt: readTextColumn(row, "created_at") ?? "",
    updatedAt: readTextColumn(row, "updated_at") ?? "",
  };
}

function mapUsageRow(row: unknown): ImageResourceUsageRecord {
  return {
    id: readTextColumn(row, "id") ?? "",
    importedImageId: readTextColumn(row, "imported_image_id") ?? "",
    resourceId: readTextColumn(row, "resource_id") ?? "",
    weight: readNumberColumn(row, "weight") ?? null,
    triggerWordsUsed: (readJsonColumn(row, "trigger_words_used_json") as string[] | null) ?? [],
    source: (readTextColumn(row, "source") ?? "civitai_image_meta") as CivitaiUsageSource,
    resolveStatus: (readTextColumn(row, "resolve_status") ?? "unresolved") as CivitaiResolveStatus,
    rawResourceJson: readJsonColumn(row, "raw_resource_json"),
    createdAt: readTextColumn(row, "created_at") ?? "",
  };
}

function mapResourceListRow(row: unknown): CivitaiResourceListItem {
  const resource = mapResourceRow(row);
  const importedImageCount = readNumberColumn(row, "imported_image_count") ?? 0;
  return {
    ...resource,
    importedImageCount,
    averageWeight: readNumberColumn(row, "average_weight") ?? null,
    minWeight: readNumberColumn(row, "min_weight") ?? null,
    maxWeight: readNumberColumn(row, "max_weight") ?? null,
    previewImage: getOfficialPreviewImage(resource.officialImagesJson),
  };
}

function mapImportedImageListRow(row: unknown): ImportedImageListItem {
  return {
    ...mapImportedImageRow(row),
    resourceCount: readNumberColumn(row, "resource_count") ?? 0,
    loraCount: readNumberColumn(row, "lora_count") ?? 0,
    checkpointCount: readNumberColumn(row, "checkpoint_count") ?? 0,
  };
}

export function upsertImportedCivitaiImageToSqlite(
  db: SceneForgeSqliteDatabase,
  image: NormalizedCivitaiImage,
  importedByUserId: string | null = null,
): ImportedImageRecord {
  const existing = db.prepare("SELECT id, imported_at FROM imported_images WHERE civitai_image_id = ?").get(
    image.civitaiImageId,
  );
  const id = readTextColumn(existing, "id") ?? newId("civitai_img");
  const importedAt = readTextColumn(existing, "imported_at") ?? nowIso();
  const updatedAt = nowIso();

  db.prepare(`
    INSERT INTO imported_images (
      id,
      civitai_image_id,
      civitai_image_page_url,
      image_url,
      source_image_url,
      width,
      height,
      nsfw,
      nsfw_level,
      browsing_level,
      created_at_on_civitai,
      post_id,
      username,
      base_model,
      prompt,
      negative_prompt,
      sampler,
      steps,
      cfg_scale,
      seed,
      raw_meta_json,
      imported_by_user_id,
      imported_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(civitai_image_id) DO UPDATE SET
      civitai_image_page_url = excluded.civitai_image_page_url,
      image_url = excluded.image_url,
      source_image_url = excluded.source_image_url,
      width = excluded.width,
      height = excluded.height,
      nsfw = excluded.nsfw,
      nsfw_level = excluded.nsfw_level,
      browsing_level = excluded.browsing_level,
      created_at_on_civitai = excluded.created_at_on_civitai,
      post_id = excluded.post_id,
      username = excluded.username,
      base_model = excluded.base_model,
      prompt = excluded.prompt,
      negative_prompt = excluded.negative_prompt,
      sampler = excluded.sampler,
      steps = excluded.steps,
      cfg_scale = excluded.cfg_scale,
      seed = excluded.seed,
      raw_meta_json = excluded.raw_meta_json,
      imported_by_user_id = excluded.imported_by_user_id,
      updated_at = excluded.updated_at
  `).run(
    id,
    image.civitaiImageId,
    image.civitaiImagePageUrl,
    image.imageUrl,
    image.sourceImageUrl ?? image.imageUrl,
    image.width,
    image.height,
    image.nsfw === null ? null : image.nsfw ? 1 : 0,
    image.nsfwLevel,
    image.browsingLevel,
    image.createdAtOnCivitai,
    image.postId,
    image.username,
    image.baseModel,
    image.prompt,
    image.negativePrompt,
    image.sampler,
    image.steps,
    image.cfgScale,
    image.seed,
    stringifyJson(image.rawMetaJson),
    importedByUserId,
    importedAt,
    updatedAt,
  );

  return mapImportedImageRow(
    db.prepare("SELECT * FROM imported_images WHERE civitai_image_id = ?").get(image.civitaiImageId),
  );
}

function findResourceRowByModelVersionId(db: SceneForgeSqliteDatabase, modelVersionId: number) {
  return db.prepare("SELECT * FROM civitai_resources WHERE civitai_model_version_id = ?").get(modelVersionId);
}

function findResourceRowByHash(db: SceneForgeSqliteDatabase, hash: string) {
  return db.prepare("SELECT * FROM civitai_resources WHERE lower(hash) = ?").get(hash.toLocaleLowerCase());
}

function findExistingResource(db: SceneForgeSqliteDatabase, input: CivitaiResourceUpsertInput) {
  const rows: unknown[] = [];
  const addRow = (row: unknown) => {
    const id = readTextColumn(row, "id");
    if (id && !rows.some((existing) => readTextColumn(existing, "id") === id)) {
      rows.push(row);
    }
  };

  if (input.civitaiModelVersionId !== null) {
    addRow(findResourceRowByModelVersionId(db, input.civitaiModelVersionId));
  }
  if (input.hash) {
    addRow(findResourceRowByHash(db, input.hash));
  }

  return rows[0];
}

function mergeCivitaiResourceRows(db: SceneForgeSqliteDatabase, targetResourceId: string, sourceResourceId: string): void {
  if (targetResourceId === sourceResourceId) {
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO civitai_resource_categories (resource_id, category, sort_order)
    SELECT ?, category, sort_order
    FROM civitai_resource_categories
    WHERE resource_id = ?
  `).run(targetResourceId, sourceResourceId);

  const duplicateUsages = db.prepare(`
    SELECT
      target_usage.id AS target_id,
      target_usage.weight AS target_weight,
      target_usage.trigger_words_used_json AS target_trigger_words_used_json,
      target_usage.resolve_status AS target_resolve_status,
      target_usage.raw_resource_json AS target_raw_resource_json,
      source_usage.weight AS source_weight,
      source_usage.trigger_words_used_json AS source_trigger_words_used_json,
      source_usage.resolve_status AS source_resolve_status,
      source_usage.raw_resource_json AS source_raw_resource_json
    FROM image_resource_usages source_usage
    INNER JOIN image_resource_usages target_usage
      ON target_usage.imported_image_id = source_usage.imported_image_id
      AND target_usage.resource_id = ?
      AND target_usage.source = source_usage.source
    WHERE source_usage.resource_id = ?
  `).all(targetResourceId, sourceResourceId);
  for (const usage of duplicateUsages) {
    const targetUsageId = readTextColumn(usage, "target_id");
    if (!targetUsageId) {
      continue;
    }

    db.prepare(`
      UPDATE image_resource_usages
      SET
        weight = ?,
        trigger_words_used_json = ?,
        resolve_status = ?,
        raw_resource_json = ?
      WHERE id = ?
    `).run(
      readNumberColumn(usage, "target_weight") ?? readNumberColumn(usage, "source_weight") ?? null,
      mergeTriggerWordsJson(
        readTextColumn(usage, "target_trigger_words_used_json"),
        readTextColumn(usage, "source_trigger_words_used_json"),
      ),
      preferUsageResolveStatus(
        readTextColumn(usage, "target_resolve_status"),
        readTextColumn(usage, "source_resolve_status"),
      ),
      mergeRawResourceJson(
        readTextColumn(usage, "target_raw_resource_json"),
        readTextColumn(usage, "source_raw_resource_json"),
      ),
      targetUsageId,
    );
  }

  db.prepare(`
    UPDATE image_resource_usages
    SET resource_id = ?
    WHERE resource_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM image_resource_usages target_usage
        WHERE target_usage.imported_image_id = image_resource_usages.imported_image_id
          AND target_usage.resource_id = ?
          AND target_usage.source = image_resource_usages.source
      )
  `).run(targetResourceId, sourceResourceId, targetResourceId);

  db.prepare("DELETE FROM image_resource_usages WHERE resource_id = ?").run(sourceResourceId);
  db.prepare("DELETE FROM civitai_resources WHERE id = ?").run(sourceResourceId);
}

function mergeConflictingResourceRows(
  db: SceneForgeSqliteDatabase,
  targetResourceId: string,
  input: CivitaiResourceUpsertInput,
): void {
  if (input.hash) {
    const hashConflictId = readTextColumn(findResourceRowByHash(db, input.hash), "id");
    if (hashConflictId && hashConflictId !== targetResourceId) {
      mergeCivitaiResourceRows(db, targetResourceId, hashConflictId);
    }
  }

  if (input.civitaiModelVersionId !== null) {
    const versionConflictId = readTextColumn(findResourceRowByModelVersionId(db, input.civitaiModelVersionId), "id");
    if (versionConflictId && versionConflictId !== targetResourceId) {
      mergeCivitaiResourceRows(db, targetResourceId, versionConflictId);
    }
  }
}

function getResourceRowById(db: SceneForgeSqliteDatabase, id: string) {
  return db.prepare(`
    SELECT
      r.*,
      (
        SELECT json_group_array(rc.category)
        FROM civitai_resource_categories rc
        WHERE rc.resource_id = r.id
        ORDER BY rc.sort_order, rc.category
      ) AS categories_json
    FROM civitai_resources r
    WHERE r.id = ?
  `).get(id);
}

export function findCivitaiResourceByUpsertInputFromSqlite(
  db: SceneForgeSqliteDatabase,
  input: CivitaiResourceUpsertInput,
): CivitaiResourceRecord | undefined {
  const row = findExistingResource(db, input);
  const id = readTextColumn(row, "id");
  if (!id) {
    return undefined;
  }

  return mapResourceRow(getResourceRowById(db, id));
}

export function upsertCivitaiResourceToSqlite(
  db: SceneForgeSqliteDatabase,
  input: CivitaiResourceUpsertInput,
): { resource: CivitaiResourceRecord; isNew: boolean } {
  const existing = findExistingResource(db, input);
  const id = readTextColumn(existing, "id") ?? newId("civitai_res");
  const createdAt = readTextColumn(existing, "created_at") ?? nowIso();
  const updatedAt = nowIso();
  const normalizedName = normalizeKeyText(input.name) ?? "unknown civitai resource";
  const normalizedBaseModel = normalizeKeyText(input.baseModel);
  const normalizedVersionName = normalizeKeyText(input.versionName);
  const categories = input.categories.length > 0 ? input.categories : input.category ? [input.category] : [];

  mergeConflictingResourceRows(db, id, input);

  db.prepare(`
    INSERT INTO civitai_resources (
      id,
      resource_type,
      civitai_model_id,
      civitai_model_version_id,
      name,
      version_name,
      hash,
      base_model,
      trained_words_json,
      tags_json,
      description,
      creator,
      download_url,
      files_json,
      official_images_json,
      category,
      usage_guide,
      recommendations_json,
      enrichment_status,
      enrichment_error,
      nsfw,
      ai_nsfw_level,
      ai_nsfw_confidence,
      ai_nsfw_reason,
      raw_version_json,
      normalized_name,
      normalized_base_model,
      normalized_version_name,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      resource_type = excluded.resource_type,
      civitai_model_id = excluded.civitai_model_id,
      civitai_model_version_id = excluded.civitai_model_version_id,
      name = excluded.name,
      version_name = excluded.version_name,
      hash = excluded.hash,
      base_model = excluded.base_model,
      trained_words_json = excluded.trained_words_json,
      tags_json = excluded.tags_json,
      description = excluded.description,
      creator = excluded.creator,
      download_url = excluded.download_url,
      files_json = excluded.files_json,
      official_images_json = excluded.official_images_json,
      category = excluded.category,
      usage_guide = excluded.usage_guide,
      recommendations_json = excluded.recommendations_json,
      enrichment_status = excluded.enrichment_status,
      enrichment_error = excluded.enrichment_error,
      nsfw = excluded.nsfw,
      ai_nsfw_level = excluded.ai_nsfw_level,
      ai_nsfw_confidence = excluded.ai_nsfw_confidence,
      ai_nsfw_reason = excluded.ai_nsfw_reason,
      raw_version_json = excluded.raw_version_json,
      normalized_name = excluded.normalized_name,
      normalized_base_model = excluded.normalized_base_model,
      normalized_version_name = excluded.normalized_version_name,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.resourceType,
    input.civitaiModelId,
    input.civitaiModelVersionId,
    input.name,
    input.versionName,
    input.hash,
    input.baseModel,
    stringifyJson(input.trainedWords),
    stringifyJson(input.tags),
    input.description,
    input.creator,
    input.downloadUrl,
    stringifyJson(input.filesJson),
    stringifyJson(input.officialImagesJson),
    categories[0] ?? input.category,
    input.usageGuide,
    stringifyJson(input.recommendations),
    input.enrichmentStatus,
    input.enrichmentError,
    input.nsfw === null ? null : input.nsfw ? 1 : 0,
    input.aiNsfwLevel,
    input.aiNsfwConfidence,
    input.aiNsfwReason,
    stringifyJson(input.rawVersionJson),
    normalizedName,
    normalizedBaseModel,
    normalizedVersionName,
    createdAt,
    updatedAt,
  );

  db.prepare("DELETE FROM civitai_resource_categories WHERE resource_id = ?").run(id);
  for (const [index, resourceCategory] of categories.entries()) {
    db.prepare(`
      INSERT OR IGNORE INTO civitai_resource_categories (resource_id, category, sort_order)
      VALUES (?, ?, ?)
    `).run(id, resourceCategory, index);
  }

  return {
    resource: mapResourceRow(getResourceRowById(db, id)),
    isNew: !readTextColumn(existing, "id"),
  };
}

export function upsertImageResourceUsageToSqlite(
  db: SceneForgeSqliteDatabase,
  input: {
    importedImageId: string;
    resourceId: string;
    weight: number | null;
    triggerWordsUsed: string[];
    source: CivitaiUsageSource;
    resolveStatus: CivitaiResolveStatus;
    rawResourceJson: unknown;
  },
): ImageResourceUsageRecord {
  const existing = db.prepare(`
    SELECT id, created_at FROM image_resource_usages
    WHERE imported_image_id = ? AND resource_id = ? AND source = ?
  `).get(input.importedImageId, input.resourceId, input.source);
  const id = readTextColumn(existing, "id") ?? newId("civitai_use");
  const createdAt = readTextColumn(existing, "created_at") ?? nowIso();

  db.prepare(`
    INSERT INTO image_resource_usages (
      id,
      imported_image_id,
      resource_id,
      weight,
      trigger_words_used_json,
      source,
      resolve_status,
      raw_resource_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(imported_image_id, resource_id, source) DO UPDATE SET
      weight = excluded.weight,
      trigger_words_used_json = excluded.trigger_words_used_json,
      resolve_status = excluded.resolve_status,
      raw_resource_json = excluded.raw_resource_json
  `).run(
    id,
    input.importedImageId,
    input.resourceId,
    input.weight,
    stringifyJson(input.triggerWordsUsed),
    input.source,
    input.resolveStatus,
    stringifyJson(input.rawResourceJson),
    createdAt,
  );

  return mapUsageRow(db.prepare("SELECT * FROM image_resource_usages WHERE id = ?").get(id));
}

export function deleteImageResourceUsagesExceptFromSqlite(
  db: SceneForgeSqliteDatabase,
  input: {
    importedImageId: string;
    source: CivitaiUsageSource;
    keepResourceIds: string[];
  },
): void {
  if (input.keepResourceIds.length === 0) {
    db.prepare(`
      DELETE FROM image_resource_usages
      WHERE imported_image_id = ? AND source = ?
    `).run(input.importedImageId, input.source);
    return;
  }

  const placeholders = input.keepResourceIds.map(() => "?").join(", ");
  db.prepare(`
    DELETE FROM image_resource_usages
    WHERE imported_image_id = ?
      AND source = ?
      AND resource_id NOT IN (${placeholders})
  `).run(input.importedImageId, input.source, ...input.keepResourceIds);
}

export function updateImportedImageLoraUsageWeightsFromSqlite(
  db: SceneForgeSqliteDatabase,
  importedImageId: string,
  weights: Array<{ usageId: string; weight: number | null }>,
): ImportedImageDetail | undefined {
  const image = getImportedImageFromSqlite(db, importedImageId);
  if (!image) {
    return undefined;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const entry of weights) {
      db.prepare(`
        UPDATE image_resource_usages
        SET weight = ?
        WHERE id = ?
          AND imported_image_id = ?
          AND resource_id IN (
            SELECT id
            FROM civitai_resources
            WHERE resource_type = 'lora'
          )
      `).run(entry.weight, entry.usageId, importedImageId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getImportedImageDetailFromSqlite(db, importedImageId);
}

export function listImportedImagesFromSqlite(
  db: SceneForgeSqliteDatabase,
  filters: ImportedImageListFilters = {},
): ImportedImageListItem[] {
  const where: string[] = [];
  const values: SqlitePrimitive[] = [];

  if (filters.baseModel) {
    where.push("img.base_model = ?");
    values.push(filters.baseModel);
  }

  if (filters.nsfw === "sfw") {
    where.push("(img.nsfw IS NULL OR img.nsfw = 0)");
  } else if (filters.nsfw === "nsfw") {
    where.push("img.nsfw = 1");
  }

  if (filters.query?.trim()) {
    where.push(`(
      CAST(img.civitai_image_id AS TEXT) LIKE ?
      OR img.prompt LIKE ?
      OR img.negative_prompt LIKE ?
      OR img.username LIKE ?
      OR EXISTS (
        SELECT 1
        FROM image_resource_usages iru_filter
        INNER JOIN civitai_resources r_filter ON r_filter.id = iru_filter.resource_id
        WHERE iru_filter.imported_image_id = img.id
          AND (r_filter.name LIKE ? OR r_filter.tags_json LIKE ? OR r_filter.trained_words_json LIKE ?)
      )
    )`);
    const query = `%${filters.query.trim()}%`;
    values.push(query, query, query, query, query, query, query);
  }

  const having =
    filters.resourceCount === "none"
      ? "HAVING COUNT(iru.id) = 0"
      : filters.resourceCount === "with"
        ? "HAVING COUNT(iru.id) > 0"
        : "";

  return db.prepare(`
    SELECT
      img.*,
      COUNT(iru.id) AS resource_count,
      SUM(CASE WHEN r.resource_type = 'lora' THEN 1 ELSE 0 END) AS lora_count,
      SUM(CASE WHEN r.resource_type = 'model' THEN 1 ELSE 0 END) AS checkpoint_count
    FROM imported_images img
    LEFT JOIN image_resource_usages iru ON iru.imported_image_id = img.id
    LEFT JOIN civitai_resources r ON r.id = iru.resource_id
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY img.id
    ${having}
    ORDER BY img.imported_at DESC
  `).all(...values).map(mapImportedImageListRow);
}

export function listCivitaiResourcesFromSqlite(
  db: SceneForgeSqliteDatabase,
  filters: CivitaiResourceListFilters = {},
): CivitaiResourceListItem[] {
  const where = ["r.resource_type = ?"];
  const values: SqlitePrimitive[] = [filters.resourceType === "model" ? "model" : "lora"];

  if (values[0] === "lora" && filters.category && filters.category !== "all") {
    where.push(`EXISTS (
      SELECT 1
      FROM civitai_resource_categories rc_filter
      WHERE rc_filter.resource_id = r.id AND rc_filter.category = ?
    )`);
    values.push(filters.category);
  }

  if (filters.baseModel) {
    where.push("r.base_model = ?");
    values.push(filters.baseModel);
  }

  if (filters.nsfw === "sfw") {
    where.push("(r.nsfw IS NULL OR r.nsfw = 0)");
  } else if (filters.nsfw === "nsfw") {
    where.push("r.nsfw = 1");
  }

  if (filters.query?.trim()) {
    where.push("(r.name LIKE ? OR r.tags_json LIKE ? OR r.trained_words_json LIKE ?)");
    const query = `%${filters.query.trim()}%`;
    values.push(query, query, query);
  }

  const having =
    filters.importedCount === "one"
      ? "HAVING COUNT(DISTINCT iru.imported_image_id) = 1"
      : filters.importedCount === "multiple"
        ? "HAVING COUNT(DISTINCT iru.imported_image_id) > 1"
        : "";

  return db.prepare(`
    SELECT
      r.*,
      (
        SELECT json_group_array(rc.category)
        FROM civitai_resource_categories rc
        WHERE rc.resource_id = r.id
        ORDER BY rc.sort_order, rc.category
      ) AS categories_json,
      COUNT(DISTINCT iru.imported_image_id) AS imported_image_count,
      AVG(iru.weight) AS average_weight,
      MIN(iru.weight) AS min_weight,
      MAX(iru.weight) AS max_weight
    FROM civitai_resources r
    LEFT JOIN image_resource_usages iru ON iru.resource_id = r.id
    WHERE ${where.join(" AND ")}
    GROUP BY r.id
    ${having}
    ORDER BY imported_image_count DESC, r.updated_at DESC
  `).all(...values).map(mapResourceListRow);
}

export function getCivitaiResourceDetailFromSqlite(
  db: SceneForgeSqliteDatabase,
  resourceId: string,
): CivitaiResourceDetail | undefined {
  const row = db.prepare(`
    SELECT
      r.*,
      (
        SELECT json_group_array(rc.category)
        FROM civitai_resource_categories rc
        WHERE rc.resource_id = r.id
        ORDER BY rc.sort_order, rc.category
      ) AS categories_json,
      COUNT(DISTINCT iru.imported_image_id) AS imported_image_count,
      AVG(iru.weight) AS average_weight,
      MIN(iru.weight) AS min_weight,
      MAX(iru.weight) AS max_weight
    FROM civitai_resources r
    LEFT JOIN image_resource_usages iru ON iru.resource_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(resourceId);

  if (!readTextColumn(row, "id")) {
    return undefined;
  }

  const usages = db.prepare(`
    SELECT
      iru.*,
      img.id AS img_id,
      img.civitai_image_id AS img_civitai_image_id,
      img.civitai_image_page_url AS img_civitai_image_page_url,
      img.image_url AS img_image_url,
      img.source_image_url AS img_source_image_url,
      img.width AS img_width,
      img.height AS img_height,
      img.nsfw AS img_nsfw,
      img.nsfw_level AS img_nsfw_level,
      img.browsing_level AS img_browsing_level,
      img.created_at_on_civitai AS img_created_at_on_civitai,
      img.post_id AS img_post_id,
      img.username AS img_username,
      img.base_model AS img_base_model,
      img.prompt AS img_prompt,
      img.negative_prompt AS img_negative_prompt,
      img.sampler AS img_sampler,
      img.steps AS img_steps,
      img.cfg_scale AS img_cfg_scale,
      img.seed AS img_seed,
      img.raw_meta_json AS img_raw_meta_json,
      img.imported_by_user_id AS img_imported_by_user_id,
      img.imported_at AS img_imported_at,
      img.updated_at AS img_updated_at
    FROM image_resource_usages iru
    INNER JOIN imported_images img ON img.id = iru.imported_image_id
    WHERE iru.resource_id = ?
    ORDER BY img.created_at_on_civitai DESC, img.imported_at DESC
  `).all(resourceId).map((usageRow) => {
    const importedImageRow = {
      id: readTextColumn(usageRow, "img_id"),
      civitai_image_id: readNumberColumn(usageRow, "img_civitai_image_id"),
      civitai_image_page_url: readTextColumn(usageRow, "img_civitai_image_page_url"),
      image_url: readTextColumn(usageRow, "img_image_url"),
      source_image_url: readTextColumn(usageRow, "img_source_image_url"),
      width: readNumberColumn(usageRow, "img_width"),
      height: readNumberColumn(usageRow, "img_height"),
      nsfw: readNumberColumn(usageRow, "img_nsfw"),
      nsfw_level: readNumberColumn(usageRow, "img_nsfw_level"),
      browsing_level: readNumberColumn(usageRow, "img_browsing_level"),
      created_at_on_civitai: readTextColumn(usageRow, "img_created_at_on_civitai"),
      post_id: readNumberColumn(usageRow, "img_post_id"),
      username: readTextColumn(usageRow, "img_username"),
      base_model: readTextColumn(usageRow, "img_base_model"),
      prompt: readTextColumn(usageRow, "img_prompt"),
      negative_prompt: readTextColumn(usageRow, "img_negative_prompt"),
      sampler: readTextColumn(usageRow, "img_sampler"),
      steps: readNumberColumn(usageRow, "img_steps"),
      cfg_scale: readNumberColumn(usageRow, "img_cfg_scale"),
      seed: readTextColumn(usageRow, "img_seed"),
      raw_meta_json: readTextColumn(usageRow, "img_raw_meta_json"),
      imported_by_user_id: readTextColumn(usageRow, "img_imported_by_user_id"),
      imported_at: readTextColumn(usageRow, "img_imported_at"),
      updated_at: readTextColumn(usageRow, "img_updated_at"),
    };

    return {
      ...mapUsageRow(usageRow),
      importedImage: mapImportedImageRow(importedImageRow),
    };
  });

  const common = (resourceType: "model" | "lora") =>
    db.prepare(`
      SELECT other.id AS resource_id, other.name, COUNT(DISTINCT other_usage.imported_image_id) AS count
      FROM image_resource_usages target_usage
      INNER JOIN image_resource_usages other_usage
        ON other_usage.imported_image_id = target_usage.imported_image_id
      INNER JOIN civitai_resources other ON other.id = other_usage.resource_id
      WHERE target_usage.resource_id = ?
        AND other.resource_type = ?
        AND other.id <> ?
      GROUP BY other.id, other.name
      ORDER BY count DESC, other.name ASC
      LIMIT 12
    `).all(resourceId, resourceType, resourceId).map((entry) => ({
      resourceId: readTextColumn(entry, "resource_id") ?? "",
      name: readTextColumn(entry, "name") ?? "",
      count: readNumberColumn(entry, "count") ?? 0,
    }));

  return {
    ...mapResourceListRow(row),
    usages,
    commonCheckpoints: common("model"),
    commonLoras: common("lora"),
  };
}

export function getImportedImageFromSqlite(
  db: SceneForgeSqliteDatabase,
  importedImageId: string,
): ImportedImageRecord | undefined {
  const row = db.prepare("SELECT * FROM imported_images WHERE id = ?").get(importedImageId);
  if (!readTextColumn(row, "id")) {
    return undefined;
  }

  return mapImportedImageRow(row);
}

export function getImportedImageDetailFromSqlite(
  db: SceneForgeSqliteDatabase,
  importedImageId: string,
): ImportedImageDetail | undefined {
  const row = db.prepare(`
    SELECT
      img.*,
      COUNT(iru.id) AS resource_count,
      SUM(CASE WHEN r.resource_type = 'lora' THEN 1 ELSE 0 END) AS lora_count,
      SUM(CASE WHEN r.resource_type = 'model' THEN 1 ELSE 0 END) AS checkpoint_count
    FROM imported_images img
    LEFT JOIN image_resource_usages iru ON iru.imported_image_id = img.id
    LEFT JOIN civitai_resources r ON r.id = iru.resource_id
    WHERE img.id = ?
    GROUP BY img.id
  `).get(importedImageId);

  if (!readTextColumn(row, "id")) {
    return undefined;
  }

  const usages = db.prepare(`
    SELECT *
    FROM image_resource_usages
    WHERE imported_image_id = ?
    ORDER BY created_at ASC
  `).all(importedImageId).map((usageRow) => {
    const usage = mapUsageRow(usageRow);
    return {
      ...usage,
      resource: mapResourceRow(getResourceRowById(db, usage.resourceId)),
    };
  });

  return {
    ...mapImportedImageListRow(row),
    usages,
  };
}
