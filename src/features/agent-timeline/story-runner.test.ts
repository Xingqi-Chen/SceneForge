import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiteLlmError } from "@/features/llm";

import { runStoryPlanning } from "./story-runner";
import type { StoryNodeAdapters } from "./story-llm-adapters";

describe("runStoryPlanning", () => {
  const previousLogFile = process.env.SCENEFORGE_LLM_LOG_FILE;
  const previousLogDir = process.env.SCENEFORGE_LLM_LOG_DIR;
  const previousLogRetentionDays = process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-story-log-"));
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

  it("stops after a node fails instead of retrying the errored node automatically", async () => {
    let storyboardCalls = 0;
    const adapters: StoryNodeAdapters = {
      "story-bible": () => ({
        source: "ai",
        value: {
          storyId: "story-retry-guard",
          title: "Retry guard",
          logline: "A test story.",
          genre: [],
          themes: [],
          worldSummary: "",
          visualStyle: "",
          characters: [],
          locations: [],
          continuityRules: [],
        },
      }),
      "story-outline": () => ({
        source: "ai",
        value: {
          storyId: "story-retry-guard",
          beats: [
            {
              id: "beat-1",
              title: "Beat",
              summary: "A single beat.",
              order: 1,
              characterIds: [],
            },
          ],
        },
      }),
      "storyboard-shots": () => {
        storyboardCalls += 1;

        if (storyboardCalls > 1) {
          return {
            source: "ai",
            value: [],
          };
        }

        throw new Error("Storyboard generation failed.");
      },
    };

    const workflow = await runStoryPlanning({
      rawIntent: "A one-shot retry guard story.",
      storyId: "story-retry-guard",
      workflowId: "workflow-retry-guard",
    }, {
      adapters,
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(storyboardCalls).toBe(1);
    expect(workflow.nodes["storyboard-shots"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_node_failed",
        message: "Storyboard generation failed.",
      },
    });
    expect(workflow.nodes["story-safety-plan"].status).toBe("blocked");
  });

  it("stops the current planning pass when a parallel-ready node fails", async () => {
    const calls: string[] = [];
    const adapters: StoryNodeAdapters = {
      "story-bible": () => {
        calls.push("story-bible");

        return {
          source: "ai",
          value: {
            storyId: "story-parallel-failure",
            title: "Parallel failure",
            logline: "A test story.",
            genre: [],
            themes: [],
            worldSummary: "",
            visualStyle: "",
            characters: [],
            locations: [],
            continuityRules: [],
          },
        };
      },
      "story-outline": () => {
        calls.push("story-outline");

        return {
          source: "ai",
          value: {
            storyId: "story-parallel-failure",
            beats: [
              {
                id: "beat-1",
                title: "Beat",
                summary: "A single beat.",
                order: 1,
                characterIds: [],
              },
            ],
          },
        };
      },
      "storyboard-shots": () => {
        calls.push("storyboard-shots");

        return {
          source: "ai",
          value: [
            {
              id: "shot-1",
              storyId: "story-parallel-failure",
              order: 1,
              title: "Shot",
              description: "A single shot.",
              characterIds: [],
              sourceShotIds: [],
              camera: "wide",
              promptIntent: "single shot",
              continuityNotes: [],
            },
          ],
        };
      },
      "story-safety-plan": () => {
        calls.push("story-safety-plan");
        throw new Error("Safety planning failed.");
      },
      "shot-dependency-graph": () => {
        calls.push("shot-dependency-graph");

        return {
          source: "ai",
          value: {
            nodes: [{ shotId: "shot-1", label: "Shot" }],
            edges: [],
          },
        };
      },
      "plot-state-graph": () => {
        calls.push("plot-state-graph");

        return {
          source: "ai",
          value: {
            states: [],
            transitions: [],
          },
        };
      },
      "character-continuity-graph": () => {
        calls.push("character-continuity-graph");

        return {
          source: "ai",
          value: {
            appearances: [],
          },
        };
      },
    };

    const workflow = await runStoryPlanning({
      rawIntent: "A one-shot parallel failure story.",
      storyId: "story-parallel-failure",
      workflowId: "workflow-parallel-failure",
    }, {
      adapters,
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(calls).toEqual([
      "story-bible",
      "story-outline",
      "storyboard-shots",
      "story-safety-plan",
    ]);
    expect(workflow.nodes["story-safety-plan"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_node_failed",
        message: "Safety planning failed.",
      },
    });
    expect(workflow.nodes["shot-dependency-graph"].status).toBe("ready");
    expect(workflow.nodes["plot-state-graph"].status).toBe("ready");
    expect(workflow.nodes["character-continuity-graph"].status).toBe("ready");
    expect(workflow.nodes["resource-plan"].status).toBe("blocked");
  });

  it("writes story planning LLM request, response, and error logs with workflow context", async () => {
    process.env.SCENEFORGE_LLM_LOG_DIR = tempDir;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "off";
    let callCount = 0;

    await runStoryPlanning({
      rawIntent: "A two-node logging story.",
      storyId: "story-log",
      workflowId: "workflow-log",
    }, {
      completeChat: async () => {
        callCount += 1;

        if (callCount === 1) {
          return {
            role: "assistant",
            content: JSON.stringify({
              storyId: "story-log",
              title: "Log Story",
              logline: "A test story for logs.",
              genre: ["test"],
              themes: [],
              worldSummary: "A logging test.",
              visualStyle: "Clean storyboard.",
              characters: [
                {
                  id: "hero",
                  name: "Hero",
                  role: "Lead",
                  description: "A test hero.",
                  continuityNotes: [],
                  visualAnchors: [],
                },
              ],
              locations: [
                {
                  id: "room",
                  name: "Room",
                  description: "A test room.",
                  visualAnchors: [],
                },
              ],
              continuityRules: [],
            }),
          };
        }

        throw new LiteLlmError("outline failed", {
          details: { error: "rate limited" },
          statusCode: 429,
        });
      },
      now: () => "2026-06-14T00:00:00.000Z",
    });

    const categoryDir = path.join(tempDir, "story-planning");
    const logFileNames = await fs.readdir(categoryDir);
    expect(logFileNames).toHaveLength(1);
    const logFileName = logFileNames[0];
    if (!logFileName) {
      throw new Error("Expected a story planning log file.");
    }

    const logContent = await fs.readFile(path.join(categoryDir, logFileName), "utf8");
    const records = logContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        category: string;
        phase: string;
        payload: Record<string, unknown>;
        route: string;
      });

    expect(records).toHaveLength(4);
    expect(records.map((record) => record.phase)).toEqual(["request", "response", "request", "error"]);
    expect(records.every((record) => record.category === "story-planning")).toBe(true);
    expect(records.every((record) => record.route === "agent-timeline/story-planning")).toBe(true);
    expect(records.map((record) => record.payload.nodeId)).toEqual([
      "story-bible",
      "story-bible",
      "story-outline",
      "story-outline",
    ]);
    expect(records.every((record) => record.payload.workflowId === "workflow-log")).toBe(true);
    expect(records.every((record) => record.payload.storyId === "story-log")).toBe(true);
    expect(records[3]?.payload.error).toMatchObject({
      message: "outline failed",
      name: "LiteLlmError",
    });
    expect(records[3]?.payload.statusCode).toBe(429);
    expect(records[3]?.payload.details).toEqual({ error: "rate limited" });
  });

  it("continues Story planning when local LLM log writes fail", async () => {
    const blockedLogRoot = path.join(tempDir, "llm-log-root-file");
    await fs.writeFile(blockedLogRoot, "not a directory", "utf8");
    process.env.SCENEFORGE_LLM_LOG_DIR = blockedLogRoot;
    process.env.SCENEFORGE_LLM_LOG_RETENTION_DAYS = "off";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let callCount = 0;

    try {
      const workflow = await runStoryPlanning({
        rawIntent: "A logging failure story.",
        storyId: "story-log-failure",
        workflowId: "workflow-log-failure",
      }, {
        completeChat: async () => {
          callCount += 1;

          if (callCount === 1) {
            return {
              role: "assistant",
              content: JSON.stringify({
                storyId: "story-log-failure",
                title: "Log Failure Story",
                logline: "A test story for log failures.",
                genre: ["test"],
                themes: [],
                worldSummary: "A logging failure test.",
                visualStyle: "Clean storyboard.",
                characters: [
                  {
                    id: "hero",
                    name: "Hero",
                    role: "Lead",
                    description: "A test hero.",
                    continuityNotes: [],
                    visualAnchors: [],
                  },
                ],
                locations: [
                  {
                    id: "room",
                    name: "Room",
                    description: "A test room.",
                    visualAnchors: [],
                  },
                ],
                continuityRules: [],
              }),
            };
          }

          throw new Error("outline stopped after log failure check");
        },
        now: () => "2026-06-14T00:00:00.000Z",
      });

      expect(callCount).toBe(2);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(workflow.nodes["story-bible"].status).toBe("done");
      expect(workflow.nodes["story-outline"]).toMatchObject({
        status: "error",
        error: {
          code: "llm_upstream",
          message: "outline stopped after log failure check",
        },
      });
      expect(workflow.nodes["storyboard-shots"].status).toBe("blocked");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
