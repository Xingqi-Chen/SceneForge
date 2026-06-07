import { afterEach, describe, expect, it, vi } from "vitest";

const diskMocks = vi.hoisted(() => ({
  deleteNamedTimelineWorkflowFromDisk: vi.fn(),
  loadNamedTimelineWorkflowFromDisk: vi.fn(),
  renameNamedTimelineWorkflowOnDisk: vi.fn(),
  TimelineWorkflowStorageValidationError: class TimelineWorkflowStorageValidationError extends Error {},
}));

vi.mock("@/features/agent-timeline/timeline-workflow-local-disk", () => diskMocks);

import { createTimelineWorkflowRecord } from "@/features/agent-timeline/timeline-workflow-persistence";
import { createTimelineWorkflowState } from "@/features/agent-timeline/state";

import { DELETE, GET, PATCH } from "./route";

function createRecord() {
  return createTimelineWorkflowRecord({
    projectId: "workflow-item-api",
    name: "Item API workflow",
    workflow: createTimelineWorkflowState({
      workflowId: "timeline-item-api",
      sceneRequest: "An item API scene",
      now: () => "2026-06-05T00:00:00.000Z",
    }),
    sceneRequest: "An item API scene",
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

describe("/api/agent-timeline/workflows/item", () => {
  it("loads a named workflow record", async () => {
    diskMocks.loadNamedTimelineWorkflowFromDisk.mockResolvedValue(createRecord());

    const response = await GET(new Request("http://localhost/api/agent-timeline/workflows/item?id=workflow-item-api"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.projectId).toBe("workflow-item-api");
    expect(diskMocks.loadNamedTimelineWorkflowFromDisk).toHaveBeenCalledWith("workflow-item-api");
  });

  it("returns 404 when a named workflow is missing", async () => {
    diskMocks.loadNamedTimelineWorkflowFromDisk.mockResolvedValue(undefined);

    const response = await GET(new Request("http://localhost/api/agent-timeline/workflows/item?id=workflow-missing"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.message).toBe("Timeline workflow was not found.");
  });

  it("renames a named workflow record", async () => {
    diskMocks.renameNamedTimelineWorkflowOnDisk.mockResolvedValue({
      ...createRecord(),
      name: "Renamed workflow",
    });

    const response = await PATCH(
      new Request("http://localhost/api/agent-timeline/workflows/item?id=workflow-item-api", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed workflow" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.record.name).toBe("Renamed workflow");
    expect(diskMocks.renameNamedTimelineWorkflowOnDisk).toHaveBeenCalledWith(
      "workflow-item-api",
      "Renamed workflow",
    );
  });

  it("rejects empty rename payloads", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/agent-timeline/workflows/item?id=workflow-item-api", {
        method: "PATCH",
        body: JSON.stringify({ name: "" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(diskMocks.renameNamedTimelineWorkflowOnDisk).not.toHaveBeenCalled();
  });

  it("deletes a named workflow record", async () => {
    diskMocks.deleteNamedTimelineWorkflowFromDisk.mockResolvedValue(true);

    const response = await DELETE(
      new Request("http://localhost/api/agent-timeline/workflows/item?id=workflow-item-api", {
        method: "DELETE",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(diskMocks.deleteNamedTimelineWorkflowFromDisk).toHaveBeenCalledWith("workflow-item-api");
  });

  it("maps malformed ids to 400", async () => {
    diskMocks.deleteNamedTimelineWorkflowFromDisk.mockRejectedValue(
      new diskMocks.TimelineWorkflowStorageValidationError("Timeline workflow id is invalid."),
    );

    const response = await DELETE(
      new Request("http://localhost/api/agent-timeline/workflows/item?id=..%2Fescape", {
        method: "DELETE",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("Timeline workflow id is invalid.");
  });

  it("does not serialize raw disk errors in 500 responses", async () => {
    diskMocks.loadNamedTimelineWorkflowFromDisk.mockRejectedValue(
      Object.assign(new Error("failed at C:\\Users\\Brandon\\secret-path"), {
        path: "C:\\Users\\Brandon\\secret-path",
      }),
    );

    const response = await GET(new Request("http://localhost/api/agent-timeline/workflows/item?id=workflow-item-api"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error.message).toBe("Unable to load the timeline workflow.");
    expect(JSON.stringify(payload)).not.toContain("secret-path");
  });
});
