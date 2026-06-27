import { afterEach, describe, expect, it, vi } from "vitest";

const diskMocks = vi.hoisted(() => ({
  listNamedTimelineWorkflowSummariesFromDisk: vi.fn(),
  saveNamedTimelineWorkflowToDisk: vi.fn(),
  TimelineWorkflowStorageValidationError: class TimelineWorkflowStorageValidationError extends Error {},
}));

vi.mock("@/features/agent-timeline/timeline-workflow-local-disk", () => diskMocks);

import { createTimelineWorkflowRecord } from "@/features/agent-timeline/timeline-workflow-persistence";
import { createTimelineWorkflowState } from "@/features/agent-timeline/state";

import { GET, PUT } from "./route";

function createRecord() {
  return createTimelineWorkflowRecord({
    workflow: createTimelineWorkflowState({
      workflowId: "timeline-named-api",
      sceneRequest: "A named API scene",
      now: () => "2026-06-05T00:00:00.000Z",
    }),
    sceneRequest: "A named API scene",
    selectedPromptProfile: "illustrious",
    selectedImageCount: 1,
    selectedNodeId: "scene-input",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(diskMocks).forEach((mock) => {
    if (typeof mock === "function" && "mockReset" in mock) {
      mock.mockReset();
    }
  });
});

describe("/api/agent-timeline/workflows", () => {
  it("lists named workflow summaries", async () => {
    diskMocks.listNamedTimelineWorkflowSummariesFromDisk.mockResolvedValue([
      {
        id: "workflow-newest",
        name: "Newest",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:02:00.000Z",
        workflowMode: "story-graph",
      },
    ]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflows).toHaveLength(1);
    expect(payload.workflows[0].id).toBe("workflow-newest");
    expect(payload.workflows[0].workflowMode).toBe("story-graph");
  });

  it("saves a named workflow record", async () => {
    const record = createRecord();
    const savedRecord = {
      ...record,
      projectId: "workflow-api-save",
      name: "Named API workflow",
      updatedAt: "2026-06-05T00:02:00.000Z",
    };
    diskMocks.saveNamedTimelineWorkflowToDisk.mockResolvedValue(savedRecord);

    const response = await PUT(
      new Request("http://localhost/api/agent-timeline/workflows", {
        method: "PUT",
        body: JSON.stringify({
          id: "workflow-api-save",
          name: "Named API workflow",
          record,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.record.projectId).toBe("workflow-api-save");
    expect(payload.summary.workflowMode).toBe("single-image");
    expect(diskMocks.saveNamedTimelineWorkflowToDisk).toHaveBeenCalledWith({
      id: "workflow-api-save",
      name: "Named API workflow",
      record: expect.objectContaining({
        workflow: expect.objectContaining({ workflowId: "timeline-named-api" }),
      }),
    });
  });

  it("rejects invalid named workflow records", async () => {
    const response = await PUT(
      new Request("http://localhost/api/agent-timeline/workflows", {
        method: "PUT",
        body: JSON.stringify({ record: { workflow: { workflowId: "" } } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(diskMocks.saveNamedTimelineWorkflowToDisk).not.toHaveBeenCalled();
  });

  it("maps storage validation errors to 400", async () => {
    diskMocks.saveNamedTimelineWorkflowToDisk.mockRejectedValue(
      new diskMocks.TimelineWorkflowStorageValidationError("Timeline workflow id is invalid."),
    );

    const response = await PUT(
      new Request("http://localhost/api/agent-timeline/workflows", {
        method: "PUT",
        body: JSON.stringify({
          id: "../escape",
          record: createRecord(),
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("Timeline workflow id is invalid.");
  });

  it("does not serialize raw disk errors in 500 responses", async () => {
    diskMocks.listNamedTimelineWorkflowSummariesFromDisk.mockRejectedValue(
      Object.assign(new Error("failed at C:\\Users\\Brandon\\secret-path"), {
        path: "C:\\Users\\Brandon\\secret-path",
      }),
    );

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error.message).toBe("Unable to list timeline workflows.");
    expect(JSON.stringify(payload)).not.toContain("secret-path");
  });
});
