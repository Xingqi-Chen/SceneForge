import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { completeTimelineNode, createTimelineWorkflowState } from "./state";
import { createTimelineWorkflowRecord } from "./timeline-workflow-persistence";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    promises: fsMocks,
  },
  promises: fsMocks,
}));

import {
  deleteActiveTimelineWorkflowFromDisk,
  deleteNamedTimelineWorkflowFromDisk,
  getResolvedTimelineWorkflowsDir,
  listNamedTimelineWorkflowSummariesFromDisk,
  loadActiveTimelineWorkflowFromDisk,
  loadNamedTimelineWorkflowFromDisk,
  saveActiveTimelineWorkflowToDisk,
  saveNamedTimelineWorkflowToDisk,
  TimelineWorkflowStorageValidationError,
} from "./timeline-workflow-local-disk";

function createRecord() {
  const workflow = completeTimelineNode(
    createTimelineWorkflowState({
      workflowId: "timeline-disk-record",
      sceneRequest: "A persisted disk scene",
      now: () => "2026-06-05T00:00:00.000Z",
    }),
    "resource-recommendation",
    {
      checkpoint: {
        resource: {
          id: "checkpoint-disk",
          apiKey: "super-secret-key",
          modelFileName: "checkpoint.safetensors",
        },
        reason: "Local disk test checkpoint",
      },
      loras: [],
    },
    "ai",
    { now: () => "2026-06-05T00:01:00.000Z" },
  );

  return createTimelineWorkflowRecord({
    workflow,
    sceneRequest: "A persisted disk scene",
    selectedPromptProfile: "illustrious",
    selectedImageCount: 1,
    selectedNodeId: "resource-recommendation",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(fsMocks).forEach((mock) => mock.mockReset());
});

describe("timeline workflow local disk storage", () => {
  it("saves the active workflow record under data/timeline-workflows without persisting secrets", async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);

    await saveActiveTimelineWorkflowToDisk(createRecord());

    const expectedDir = path.join(process.cwd(), "data", "timeline-workflows");
    const expectedFile = path.join(expectedDir, "active-workflow.json");
    expect(getResolvedTimelineWorkflowsDir()).toBe(expectedDir);
    expect(fsMocks.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.writeFile.mock.calls[0]?.[0]).toBe(expectedFile);
    expect(fsMocks.writeFile.mock.calls[0]?.[2]).toBe("utf8");

    const serialized = String(fsMocks.writeFile.mock.calls[0]?.[1]);
    expect(serialized).toContain('"kind": "sceneforge-timeline-workflow"');
    expect(serialized).toContain('"workflowId": "timeline-disk-record"');
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("super-secret-key");
  });

  it("loads and sanitizes the active workflow record from disk", async () => {
    const record = createRecord();
    fsMocks.readFile.mockResolvedValue(JSON.stringify(record));

    const loaded = await loadActiveTimelineWorkflowFromDisk();

    expect(fsMocks.readFile).toHaveBeenCalledWith(
      path.join(process.cwd(), "data", "timeline-workflows", "active-workflow.json"),
      "utf8",
    );
    expect(loaded).toMatchObject({
      kind: "sceneforge-timeline-workflow",
      workflow: {
        workflowId: "timeline-disk-record",
      },
      selectedNodeId: "resource-recommendation",
    });
    expect(loaded?.workflow.nodes["resource-recommendation"].result).toMatchObject({
      checkpoint: {
        resource: {
          apiKey: "[redacted]",
        },
      },
    });
  });

  it("treats a missing active workflow file as empty storage", async () => {
    const missingFileError = Object.assign(new Error("missing"), { code: "ENOENT" });
    fsMocks.readFile.mockRejectedValue(missingFileError);
    fsMocks.unlink.mockRejectedValue(missingFileError);

    await expect(loadActiveTimelineWorkflowFromDisk()).resolves.toBeUndefined();
    await expect(deleteActiveTimelineWorkflowFromDisk()).resolves.toBe(false);
  });

  it("saves named workflow records beside the active autosave record", async () => {
    const record = createRecord();
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    fsMocks.writeFile.mockResolvedValue(undefined);

    const saved = await saveNamedTimelineWorkflowToDisk({
      id: "workflow-local-safe",
      name: "  Saved workflow  ",
      record,
    });

    expect(saved).toMatchObject({
      projectId: "workflow-local-safe",
      name: "Saved workflow",
    });
    expect(fsMocks.writeFile.mock.calls[0]?.[0]).toBe(
      path.join(process.cwd(), "data", "timeline-workflows", "workflow-local-safe.json"),
    );
    expect(String(fsMocks.writeFile.mock.calls[0]?.[1])).toContain('"projectId": "workflow-local-safe"');
    expect(String(fsMocks.writeFile.mock.calls[0]?.[1])).toContain('"name": "Saved workflow"');
  });

  it("lists named workflow summaries by newest update and skips the active autosave", async () => {
    const first = {
      ...createRecord(),
      projectId: "workflow-first",
      name: "First workflow",
      updatedAt: "2026-06-05T00:01:00.000Z",
    };
    const second = {
      ...createRecord(),
      projectId: "workflow-second",
      name: "Second workflow",
      updatedAt: "2026-06-05T00:02:00.000Z",
    };
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.readdir.mockResolvedValue([
      "active-workflow.json",
      "workflow-first.json",
      "workflow-second.json",
      "../bad.json",
    ]);
    fsMocks.readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("workflow-first.json")) {
        return JSON.stringify(first);
      }

      if (filePath.endsWith("workflow-second.json")) {
        return JSON.stringify(second);
      }

      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    const summaries = await listNamedTimelineWorkflowSummariesFromDisk();

    expect(summaries.map((summary) => summary.id)).toEqual(["workflow-second", "workflow-first"]);
    expect(summaries[0]).toMatchObject({
      name: "Second workflow",
      updatedAt: "2026-06-05T00:02:00.000Z",
    });
    expect(fsMocks.readFile).not.toHaveBeenCalledWith(
      path.join(process.cwd(), "data", "timeline-workflows", "active-workflow.json"),
      "utf8",
    );
  });

  it("rejects malformed named workflow ids before disk access", async () => {
    await expect(loadNamedTimelineWorkflowFromDisk("../escape")).rejects.toBeInstanceOf(
      TimelineWorkflowStorageValidationError,
    );
    await expect(deleteNamedTimelineWorkflowFromDisk("active-workflow")).rejects.toBeInstanceOf(
      TimelineWorkflowStorageValidationError,
    );

    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(fsMocks.unlink).not.toHaveBeenCalled();
  });
});
