// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendLlmLocalLog } from "./llm-local-log";

describe("appendLlmLocalLog", () => {
  const previousLogFile = process.env.SCENEFORGE_LLM_LOG_FILE;
  const previousLogDir = process.env.SCENEFORGE_LLM_LOG_DIR;
  const previousLogRetentionDays = process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-llm-log-"));
    delete process.env.SCENEFORGE_LLM_LOG_FILE;
    delete process.env.SCENEFORGE_LLM_LOG_DIR;
    delete process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS;
  });

  afterEach(async () => {
    if (previousLogFile === undefined) {
      delete process.env.SCENEFORGE_LLM_LOG_FILE;
    } else {
      process.env.SCENEFORGE_LLM_LOG_FILE = previousLogFile;
    }

    if (previousLogDir === undefined) {
      delete process.env.SCENEFORGE_LLM_LOG_DIR;
    } else {
      process.env.SCENEFORGE_LLM_LOG_DIR = previousLogDir;
    }

    if (previousLogRetentionDays === undefined) {
      delete process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS;
    } else {
      process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = previousLogRetentionDays;
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

  it("writes local LLM logs to category and date files by default", async () => {
    process.env.SCENEFORGE_LLM_LOG_DIR = tempDir;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "off";

    await appendLlmLocalLog({
      requestId: "req-1",
      timestamp: "2026-06-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { prompt: "scene" },
    });

    const logFile = path.join(tempDir, "chat", "2026-06-02.jsonl");
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toContain('"category":"chat"');
    expect(content).toContain('"prompt":"scene"');
  });

  it("does not write split local LLM logs when the log directory is disabled", async () => {
    const previousCwd = process.cwd();
    process.env.SCENEFORGE_LLM_LOG_DIR = "off";

    try {
      process.chdir(tempDir);

      await appendLlmLocalLog({
        requestId: "req-dir-off",
        timestamp: "2026-06-02T00:00:00.000Z",
        phase: "request",
        route: "/api/llm/chat",
        payload: { prompt: "disabled split log" },
      });

      await expect(fs.stat(path.join(tempDir, "off", "chat", "2026-06-02.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("writes unknown local LLM routes to the misc category", async () => {
    process.env.SCENEFORGE_LLM_LOG_DIR = tempDir;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "off";

    await appendLlmLocalLog({
      requestId: "req-unknown",
      timestamp: "2026-06-03T00:00:00.000Z",
      phase: "request",
      route: "unknown-route",
      payload: { prompt: "misc" },
    });

    const logFile = path.join(tempDir, "misc", "2026-06-03.jsonl");
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toContain('"category":"misc"');
    expect(content).toContain('"route":"unknown-route"');
  });

  it("removes split local LLM logs older than the retention window", async () => {
    process.env.SCENEFORGE_LLM_LOG_DIR = tempDir;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "14";

    const categoryDir = path.join(tempDir, "chat");
    const oldLogFile = path.join(categoryDir, "2000-01-01.jsonl");
    const keptLogFile = path.join(categoryDir, "2999-01-01.jsonl");
    await fs.mkdir(categoryDir, { recursive: true });
    await fs.writeFile(oldLogFile, "{}\n", "utf8");
    await fs.writeFile(keptLogFile, "{}\n", "utf8");

    await appendLlmLocalLog({
      requestId: "req-retention",
      timestamp: "2999-01-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { prompt: "retention" },
    });

    await expect(fs.stat(oldLogFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(keptLogFile)).resolves.toBeTruthy();
  });

  it("uses the default split-log retention window when retention is unset", async () => {
    process.env.SCENEFORGE_LLM_LOG_DIR = tempDir;

    const categoryDir = path.join(tempDir, "chat");
    const oldLogFile = path.join(categoryDir, "2000-01-01.jsonl");
    await fs.mkdir(categoryDir, { recursive: true });
    await fs.writeFile(oldLogFile, "{}\n", "utf8");

    await appendLlmLocalLog({
      requestId: "req-default-retention",
      timestamp: "2026-06-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { prompt: "default retention" },
    });

    await expect(fs.stat(oldLogFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps split local LLM logs when retention is disabled", async () => {
    process.env.SCENEFORGE_LLM_LOG_DIR = tempDir;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "off";

    const categoryDir = path.join(tempDir, "chat");
    const oldLogFile = path.join(categoryDir, "2000-01-01.jsonl");
    await fs.mkdir(categoryDir, { recursive: true });
    await fs.writeFile(oldLogFile, "{}\n", "utf8");

    await appendLlmLocalLog({
      requestId: "req-retention-off",
      timestamp: "2026-06-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { prompt: "retention off" },
    });

    await expect(fs.stat(oldLogFile)).resolves.toBeTruthy();
  });

  it("uses a legacy single log file without pruning split logs", async () => {
    const splitLogRoot = path.join(tempDir, "split");
    const legacyLogFile = path.join(tempDir, "legacy", "llm-chat.jsonl");
    const oldSplitLogFile = path.join(splitLogRoot, "chat", "2000-01-01.jsonl");
    process.env.SCENEFORGE_LLM_LOG_DIR = splitLogRoot;
    process.env.SCENEFORGE_LLM_LOG_FILE = legacyLogFile;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "14";
    await fs.mkdir(path.dirname(oldSplitLogFile), { recursive: true });
    await fs.writeFile(oldSplitLogFile, "{}\n", "utf8");

    await appendLlmLocalLog({
      requestId: "req-legacy-file",
      timestamp: "2026-06-02T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: { prompt: "legacy file" },
    });

    await expect(fs.readFile(legacyLogFile, "utf8")).resolves.toContain('"prompt":"legacy file"');
    await expect(fs.stat(oldSplitLogFile)).resolves.toBeTruthy();
    await expect(fs.stat(path.join(splitLogRoot, "chat", "2026-06-02.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("redacts image data URLs before writing local LLM logs", async () => {
    const logFile = path.join(tempDir, "llm-chat.jsonl");
    process.env.SCENEFORGE_LLM_LOG_FILE = logFile;

    await appendLlmLocalLog({
      requestId: "req-image",
      timestamp: "2026-07-05T00:00:00.000Z",
      phase: "request",
      route: "/api/llm/chat",
      payload: {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64,SHOULD_NOT_BE_LOGGED",
                  detail: "high",
                },
              },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/svg+xml,%3Csvg%3ESHOULD_NOT_BE_LOGGED%3C%2Fsvg%3E",
                  detail: "low",
                },
              },
            ],
          },
        ],
      },
    });

    const content = await fs.readFile(logFile, "utf8");
    expect(content).not.toContain("data:image/png;base64");
    expect(content).not.toContain("data:image/svg+xml");
    expect(content).not.toContain("SHOULD_NOT_BE_LOGGED");
    expect(content).toContain("[redacted image data URL]");
    expect(content).toContain('"detail":"high"');
    expect(content).toContain('"detail":"low"');
  });
});
