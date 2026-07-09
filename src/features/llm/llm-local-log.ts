import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { LlmChatRequest, LlmChatResponse } from "./types";

const DEFAULT_LLM_LOG_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "logs", "llm");
const IMAGE_DATA_URL_PATTERN = /^data:image\//i;
const REDACTED_IMAGE_DATA_URL = "[redacted image data URL]";
const MAX_LOG_REDACTION_DEPTH = 12;
const DEFAULT_LLM_LOG_RETENTION_DAYS = 14;
const DISABLED_CONFIG_VALUES = new Set(["0", "false", "off", "none", "disabled"]);
const DATE_LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export type LlmLocalLogCategory =
  | "chat"
  | "civitai-enrichment"
  | "civitai-recommendation"
  | "story-planning"
  | "misc";

export type LlmLocalLogRecord = {
  category?: LlmLocalLogCategory;
  requestId: string;
  timestamp: string;
  phase: "request" | "response" | "error";
  route: string;
  payload: unknown;
};

type LlmLocalLogTarget =
  | {
      kind: "directory";
      category: LlmLocalLogCategory;
      date: string;
      directoryPath: string;
      filePath: string;
    }
  | {
      kind: "disabled";
    }
  | {
      kind: "file";
      filePath: string;
    };

export type LlmChatLocalLogEntry =
  | {
      category?: LlmLocalLogCategory;
      context?: Record<string, unknown>;
      phase: "request";
      request: LlmChatRequest;
      requestId: string;
      route: string;
      timestamp?: string;
    }
  | {
      category?: LlmLocalLogCategory;
      completion: LlmChatResponse;
      context?: Record<string, unknown>;
      phase: "response";
      requestId: string;
      route: string;
      timestamp?: string;
    }
  | {
      category?: LlmLocalLogCategory;
      context?: Record<string, unknown>;
      details?: unknown;
      error: unknown;
      phase: "error";
      requestId: string;
      route: string;
      statusCode?: number;
      timestamp?: string;
    };

function isDisabledConfigValue(value: string) {
  return DISABLED_CONFIG_VALUES.has(value.trim().toLowerCase());
}

export function createLlmLocalLogRequestId() {
  return randomUUID();
}

export function inferLlmLocalLogCategory(route: string): LlmLocalLogCategory {
  if (route === "/api/llm/chat") {
    return "chat";
  }

  if (route === "civitai-lora-library/enrichment") {
    return "civitai-enrichment";
  }

  if (route === "civitai-lora-library/ai-recommendation") {
    return "civitai-recommendation";
  }

  if (route === "agent-timeline/story-planning") {
    return "story-planning";
  }

  return "misc";
}

function getLogDate(timestamp: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(timestamp) ? timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function getLlmLogRetentionDays() {
  const rawValue = process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS?.trim();
  if (!rawValue) {
    return DEFAULT_LLM_LOG_RETENTION_DAYS;
  }

  if (isDisabledConfigValue(rawValue)) {
    return null;
  }

  const parsed = Number(rawValue);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LLM_LOG_RETENTION_DAYS;
}

function getLlmLogTarget(record: LlmLocalLogRecord): LlmLocalLogTarget {
  const fileOverride = process.env.SCENEFORGE_LLM_LOG_FILE?.trim();
  if (fileOverride) {
    return isDisabledConfigValue(fileOverride)
      ? { kind: "disabled" }
      : { kind: "file", filePath: fileOverride };
  }

  const directoryOverride = process.env.SCENEFORGE_LLM_LOG_DIR?.trim();
  if (directoryOverride && isDisabledConfigValue(directoryOverride)) {
    return { kind: "disabled" };
  }

  const directoryPath = directoryOverride || DEFAULT_LLM_LOG_DIR;
  const category = record.category ?? inferLlmLocalLogCategory(record.route);
  const date = getLogDate(record.timestamp);
  const filePath = path.join(directoryPath, category, `${date}.jsonl`);

  return {
    kind: "directory",
    category,
    date,
    directoryPath,
    filePath,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactLlmLocalLogPayload(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return IMAGE_DATA_URL_PATTERN.test(value.trim()) ? REDACTED_IMAGE_DATA_URL : value;
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_LOG_REDACTION_DEPTH) {
    return "[redacted nested log payload]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLlmLocalLogPayload(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      redactLlmLocalLogPayload(entry, depth + 1),
    ]),
  );
}

export function serializeErrorForLlmLog(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

async function pruneExpiredLlmLocalLogs(directoryPath: string, retentionDays: number) {
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const categoryEntries = await fs.readdir(/*turbopackIgnore: true*/ directoryPath, { withFileTypes: true }).catch(() => []);

  await Promise.all(categoryEntries.map(async (categoryEntry) => {
    if (!categoryEntry.isDirectory()) {
      return;
    }

    const categoryPath = path.join(directoryPath, categoryEntry.name);
    const fileEntries = await fs.readdir(/*turbopackIgnore: true*/ categoryPath, { withFileTypes: true }).catch(() => []);

    await Promise.all(fileEntries.map(async (fileEntry) => {
      if (!fileEntry.isFile()) {
        return;
      }

      const match = DATE_LOG_FILE_PATTERN.exec(fileEntry.name);
      if (!match) {
        return;
      }

      const fileTime = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (!Number.isFinite(fileTime) || fileTime >= cutoffTime) {
        return;
      }

      await fs.rm(/*turbopackIgnore: true*/ path.join(categoryPath, fileEntry.name), { force: true });
    }));
  }));
}

export async function appendLlmLocalLog(record: LlmLocalLogRecord) {
  const target = getLlmLogTarget(record);
  if (target.kind === "disabled") {
    return;
  }

  try {
    const safeRecord = {
      ...record,
      category: record.category ?? inferLlmLocalLogCategory(record.route),
      payload: redactLlmLocalLogPayload(record.payload),
    };

    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(target.filePath), { recursive: true });
    await fs.appendFile(/*turbopackIgnore: true*/ target.filePath, `${JSON.stringify(safeRecord)}\n`, "utf8");

    if (target.kind === "directory") {
      const retentionDays = getLlmLogRetentionDays();
      if (retentionDays !== null) {
        await pruneExpiredLlmLocalLogs(target.directoryPath, retentionDays);
      }
    }
  } catch (error) {
    console.error("[SceneForge] [llm] failed to write local LLM log", {
      filePath: target.filePath,
      error: serializeErrorForLlmLog(error),
    });
  }
}

export async function appendLlmChatLocalLog(entry: LlmChatLocalLogEntry) {
  const timestamp = entry.timestamp ?? new Date().toISOString();

  if (entry.phase === "request") {
    await appendLlmLocalLog({
      category: entry.category,
      requestId: entry.requestId,
      timestamp,
      phase: "request",
      route: entry.route,
      payload: {
        ...entry.context,
        purpose: entry.request.purpose,
        nsfw: entry.request.nsfw,
        model: entry.request.model,
        temperature: entry.request.temperature,
        maxTokens: entry.request.maxTokens,
        messages: entry.request.messages,
      },
    });

    return;
  }

  if (entry.phase === "response") {
    await appendLlmLocalLog({
      category: entry.category,
      requestId: entry.requestId,
      timestamp,
      phase: "response",
      route: entry.route,
      payload: {
        ...entry.context,
        completion: entry.completion,
      },
    });

    return;
  }

  await appendLlmLocalLog({
    category: entry.category,
    requestId: entry.requestId,
    timestamp,
    phase: "error",
    route: entry.route,
    payload: {
      ...entry.context,
      error: serializeErrorForLlmLog(entry.error),
      ...(entry.statusCode !== undefined ? { statusCode: entry.statusCode } : {}),
      ...(entry.details !== undefined ? { details: entry.details } : {}),
    },
  });
}
