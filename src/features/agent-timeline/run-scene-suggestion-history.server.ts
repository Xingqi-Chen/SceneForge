import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  sanitizeRunSceneSuggestionFingerprint,
  type RunSceneSuggestionFingerprint,
} from "./run-scene-suggestion";

export const RUN_SCENE_SUGGESTION_HISTORY_VERSION = 1 as const;
export const RUN_SCENE_SUGGESTION_HISTORY_LIMIT = 20;
const MAX_HISTORY_BYTES = 64 * 1024;
const HISTORY_FILE_NAME = "history.json";

export type RunSceneSuggestionHistoryRecord = {
  schemaVersion: typeof RUN_SCENE_SUGGESTION_HISTORY_VERSION;
  timestamp: string;
  disposition: "selected" | "not-selected";
  fingerprint: RunSceneSuggestionFingerprint;
};

type RunSceneSuggestionHistoryFile = {
  schemaVersion: typeof RUN_SCENE_SUGGESTION_HISTORY_VERSION;
  records: RunSceneSuggestionHistoryRecord[];
};

let writeQueue = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRunSceneSuggestionHistoryPath() {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    "agent-timeline-run-suggestion-history",
    HISTORY_FILE_NAME,
  );
}

function sanitizeHistoryRecord(value: unknown): RunSceneSuggestionHistoryRecord | null {
  if (!isRecord(value) ||
      value.schemaVersion !== RUN_SCENE_SUGGESTION_HISTORY_VERSION ||
      (value.disposition !== "selected" && value.disposition !== "not-selected") ||
      typeof value.timestamp !== "string" ||
      !Number.isFinite(Date.parse(value.timestamp))) return null;
  const fingerprint = sanitizeRunSceneSuggestionFingerprint(value.fingerprint);
  return fingerprint ? {
    schemaVersion: RUN_SCENE_SUGGESTION_HISTORY_VERSION,
    timestamp: value.timestamp,
    disposition: value.disposition,
    fingerprint,
  } : null;
}

function latestValidHistoryRecords(values: readonly unknown[]) {
  const records: RunSceneSuggestionHistoryRecord[] = [];
  for (let index = values.length - 1;
    index >= 0 && records.length < RUN_SCENE_SUGGESTION_HISTORY_LIMIT;
    index -= 1) {
    const record = sanitizeHistoryRecord(values[index]);
    if (record) records.push(record);
  }
  return records.reverse();
}

export function parseRunSceneSuggestionHistory(value: unknown): RunSceneSuggestionHistoryRecord[] {
  if (!isRecord(value) ||
      value.schemaVersion !== RUN_SCENE_SUGGESTION_HISTORY_VERSION ||
      !Array.isArray(value.records)) return [];
  return latestValidHistoryRecords(value.records);
}

export async function loadRunSceneSuggestionHistory() {
  const filename = getRunSceneSuggestionHistoryPath();
  try {
    const stat = await fs.stat(/*turbopackIgnore: true*/ filename);
    if (!stat.isFile() || stat.size > MAX_HISTORY_BYTES) return [];
    const text = await fs.readFile(/*turbopackIgnore: true*/ filename, "utf8");
    return parseRunSceneSuggestionHistory(JSON.parse(text) as unknown);
  } catch {
    return [];
  }
}

async function writeHistoryFile(records: RunSceneSuggestionHistoryRecord[]) {
  const filename = getRunSceneSuggestionHistoryPath();
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${HISTORY_FILE_NAME}.${randomUUID()}.tmp`);
  const value: RunSceneSuggestionHistoryFile = {
    schemaVersion: RUN_SCENE_SUGGESTION_HISTORY_VERSION,
    records: latestValidHistoryRecords(records),
  };
  await fs.mkdir(/*turbopackIgnore: true*/ directory, { recursive: true });
  try {
    await fs.writeFile(/*turbopackIgnore: true*/ temporary, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(/*turbopackIgnore: true*/ temporary, filename);
  } catch (error) {
    await fs.rm(/*turbopackIgnore: true*/ temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function appendRunSceneSuggestionHistory(
  additions: readonly RunSceneSuggestionHistoryRecord[],
) {
  const operation = writeQueue.then(async () => {
    const existing = await loadRunSceneSuggestionHistory();
    const sanitizedAdditions = additions.flatMap((addition) => {
      const sanitized = sanitizeHistoryRecord(addition);
      return sanitized ? [sanitized] : [];
    });
    await writeHistoryFile([...existing, ...sanitizedAdditions]);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
