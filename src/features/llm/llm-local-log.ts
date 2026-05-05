import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_LLM_LOG_FILE = path.join(process.cwd(), "data", "logs", "llm-chat.jsonl");

type LlmLocalLogRecord = {
  requestId: string;
  timestamp: string;
  phase: "request" | "response" | "error";
  route: string;
  payload: unknown;
};

function getLlmLogFilePath() {
  return process.env.SCENEFORGE_LLM_LOG_FILE?.trim() || DEFAULT_LLM_LOG_FILE;
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

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error("[SceneForge] [llm] failed to write local LLM log", {
      filePath,
      error: serializeErrorForLlmLog(error),
    });
  }
}
