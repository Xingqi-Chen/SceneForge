import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_LLM_LOG_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "logs", "llm-chat.jsonl");
const IMAGE_DATA_URL_PATTERN = /^data:image\//i;
const REDACTED_IMAGE_DATA_URL = "[redacted image data URL]";
const MAX_LOG_REDACTION_DEPTH = 12;

type LlmLocalLogRecord = {
  requestId: string;
  timestamp: string;
  phase: "request" | "response" | "error";
  route: string;
  payload: unknown;
};

function getLlmLogFilePath() {
  const override = process.env.SCENEFORGE_LLM_LOG_FILE?.trim();
  if (override && ["0", "false", "off", "none", "disabled"].includes(override.toLocaleLowerCase())) {
    return null;
  }

  return override || DEFAULT_LLM_LOG_FILE;
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

export async function appendLlmLocalLog(record: LlmLocalLogRecord) {
  const filePath = getLlmLogFilePath();
  if (!filePath) {
    return;
  }

  try {
    const safeRecord = {
      ...record,
      payload: redactLlmLocalLogPayload(record.payload),
    };

    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
    await fs.appendFile(/*turbopackIgnore: true*/ filePath, `${JSON.stringify(safeRecord)}\n`, "utf8");
  } catch (error) {
    console.error("[SceneForge] [llm] failed to write local LLM log", {
      filePath,
      error: serializeErrorForLlmLog(error),
    });
  }
}
