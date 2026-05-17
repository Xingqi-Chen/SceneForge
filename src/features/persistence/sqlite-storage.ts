import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

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

const SCHEMA_VERSION = "1";
const PROMPT_LIBRARY_KEY = "prompt-library";
const PROMPT_BINDINGS_KEY = "prompt-bindings";

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

function nowIso(): string {
  return new Date().toISOString();
}

/** Optional absolute path; defaults to `<cwd>/data/sceneforge.sqlite`. */
export function getResolvedSqliteFilePath(): string {
  const override = process.env.SCENEFORGE_SQLITE_FILE?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(process.cwd(), "data", "sceneforge.sqlite");
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
  `);

  db.prepare(`
    INSERT OR IGNORE INTO scene_forge_metadata (key, value)
    VALUES ('schema_version', ?)
  `).run(SCHEMA_VERSION);
}

export async function openSceneForgeSqliteDatabase(
  filePath = getResolvedSqliteFilePath(),
): Promise<SceneForgeSqliteDatabase> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as NodeSqliteModule;
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
