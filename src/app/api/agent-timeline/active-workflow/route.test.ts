import { afterEach, describe, expect, it, vi } from "vitest";

const diskMocks = vi.hoisted(() => ({
  deleteActiveTimelineWorkflowFromDisk: vi.fn(),
  loadActiveTimelineWorkflowFromDisk: vi.fn(),
  saveActiveTimelineWorkflowToDisk: vi.fn(),
}));

vi.mock("@/features/agent-timeline/timeline-workflow-local-disk", () => diskMocks);

import { createTimelineWorkflowRecord } from "@/features/agent-timeline/timeline-workflow-persistence";
import { createTimelineWorkflowState } from "@/features/agent-timeline/state";

import { DELETE, GET, PUT } from "./route";

function createRecord() {
  return createTimelineWorkflowRecord({
    workflow: createTimelineWorkflowState({
      workflowId: "timeline-api-record",
      sceneRequest: "A restored scene",
      now: () => "2026-06-05T00:00:00.000Z",
    }),
    sceneRequest: "A restored scene",
    selectedPromptProfile: "illustrious",
    selectedImageCount: 1,
    selectedNodeId: "scene-input",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(diskMocks).forEach((mock) => mock.mockReset());
});

describe("/api/agent-timeline/active-workflow", () => {
  it("does not serialize raw load errors in 500 responses", async () => {
    diskMocks.loadActiveTimelineWorkflowFromDisk.mockRejectedValue(
      Object.assign(new Error("failed at C:\\Users\\Brandon\\secret-path"), {
        path: "C:\\Users\\Brandon\\secret-path",
      }),
    );

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        message: "Unable to load the active timeline workflow.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret-path");
  });

  it("returns 404 when no active workflow exists", async () => {
    diskMocks.loadActiveTimelineWorkflowFromDisk.mockResolvedValue(undefined);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.message).toBe("No active timeline workflow has been saved.");
  });

  it("loads the active workflow record", async () => {
    const record = createRecord();
    diskMocks.loadActiveTimelineWorkflowFromDisk.mockResolvedValue(record);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.workflowId).toBe("timeline-api-record");
  });

  it("saves a valid active workflow record", async () => {
    const record = createRecord();

    const response = await PUT(
      new Request("http://localhost/api/agent-timeline/active-workflow", {
        method: "PUT",
        body: JSON.stringify(record),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(diskMocks.saveActiveTimelineWorkflowToDisk).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.objectContaining({
          workflowId: "timeline-api-record",
        }),
      }),
    );
  });

  it("rejects invalid active workflow records", async () => {
    const response = await PUT(
      new Request("http://localhost/api/agent-timeline/active-workflow", {
        method: "PUT",
        body: JSON.stringify({ workflow: { workflowId: "" } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(diskMocks.saveActiveTimelineWorkflowToDisk).not.toHaveBeenCalled();
  });

  it("does not serialize raw save errors in 500 responses", async () => {
    diskMocks.saveActiveTimelineWorkflowToDisk.mockRejectedValue(
      Object.assign(new Error("failed at C:\\Users\\Brandon\\secret-path"), {
        path: "C:\\Users\\Brandon\\secret-path",
      }),
    );

    const response = await PUT(
      new Request("http://localhost/api/agent-timeline/active-workflow", {
        method: "PUT",
        body: JSON.stringify(createRecord()),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        message: "Unable to save the active timeline workflow.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret-path");
  });

  it("clears the active workflow record", async () => {
    diskMocks.deleteActiveTimelineWorkflowFromDisk.mockResolvedValue(true);

    const response = await DELETE();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(diskMocks.deleteActiveTimelineWorkflowFromDisk).toHaveBeenCalledTimes(1);
  });

  it("does not serialize raw delete errors in 500 responses", async () => {
    diskMocks.deleteActiveTimelineWorkflowFromDisk.mockRejectedValue(
      Object.assign(new Error("failed at C:\\Users\\Brandon\\secret-path"), {
        path: "C:\\Users\\Brandon\\secret-path",
      }),
    );

    const response = await DELETE();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        message: "Unable to clear the active timeline workflow.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret-path");
  });
});
