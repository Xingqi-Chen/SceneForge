import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_LLM_LOG_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "logs", "llm-chat.jsonl");

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
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
    await fs.appendFile(/*turbopackIgnore: true*/ filePath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error("[SceneForge] [llm] failed to write local LLM log", {
      filePath,
      error: serializeErrorForLlmLog(error),
    });
  }
}
