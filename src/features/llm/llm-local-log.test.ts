// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendLlmLocalLog } from "./llm-local-log";

describe("appendLlmLocalLog", () => {
  const previousLogFile = process.env.SCENEFORGE_LLM_LOG_FILE;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-llm-log-"));
  });

  afterEach(async () => {
    if (previousLogFile === undefined) {
      delete process.env.SCENEFORGE_LLM_LOG_FILE;
    } else {
      process.env.SCENEFORGE_LLM_LOG_FILE = previousLogFile;
    }

    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("does not write a log file when local LLM logging is disabled", async () => {
    const logFile = path.join(tempDir, "llm-chat.jsonl");
    process.env.SCENEFORGE_LLM_LOG_FILE = "off";

    await appendLlmLocalLog({
      requestId: "req-1",
      timestamp: "2026-06-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { logFile },
    });

    await expect(fs.stat(logFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes local LLM logs to the configured file", async () => {
    const logFile = path.join(tempDir, "llm-chat.jsonl");
    process.env.SCENEFORGE_LLM_LOG_FILE = logFile;

    await appendLlmLocalLog({
      requestId: "req-1",
      timestamp: "2026-06-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { prompt: "scene" },
    });

    await expect(fs.readFile(logFile, "utf8")).resolves.toContain('"prompt":"scene"');
  });
});
