import { describe, expect, it } from "vitest";

import {
  completeTimelineNode,
  createTimelineWorkflowState,
  markTimelineNodeRunning,
} from "./state";
import {
  createTimelineWorkflowRecord,
  parseTimelineWorkflowRecordJson,
  sanitizeTimelineWorkflowRecord,
  serializeTimelineWorkflowRecord,
} from "./timeline-workflow-persistence";

describe("timeline workflow persistence", () => {
  it("round-trips an active workflow record without preserving secrets", () => {
    let workflow = createTimelineWorkflowState({
      workflowId: "timeline-persisted",
      sceneRequest: "A glass greenhouse command deck",
      promptProfile: "anima",
      imageCount: 3,
      now: () => "2026-06-05T00:00:00.000Z",
    });
    workflow = completeTimelineNode(
      workflow,
      "resource-recommendation",
      {
        checkpoint: {
          resource: {
            id: "checkpoint-a",
            apiKey: "should-not-persist",
            modelFileName: "checkpoint.safetensors",
          },
          reason: "Local checkpoint",
        },
        loras: [],
      },
      "ai",
      { now: () => "2026-06-05T00:01:00.000Z" },
    );

    const record = createTimelineWorkflowRecord({
      projectId: "workflow-round-trip",
      name: "  Glass greenhouse project  ",
      workflow,
      sceneRequest: "A glass greenhouse command deck",
      selectedPromptProfile: "anima",
      selectedImageCount: 3,
      selectedNodeId: "resource-recommendation",
      outputDisplayModes: {
        "resource-recommendation": "visual",
      },
    });
    const serialized = serializeTimelineWorkflowRecord(record);

    expect(serialized).not.toContain("should-not-persist");
    expect(serialized).toContain("[redacted]");

    const parsed = parseTimelineWorkflowRecordJson(serialized);

    expect(parsed).toMatchObject({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      projectId: "workflow-round-trip",
      name: "Glass greenhouse project",
      sceneRequest: "A glass greenhouse command deck",
      selectedPromptProfile: "anima",
      selectedImageCount: 3,
      selectedNodeId: "resource-recommendation",
      outputDisplayModes: {
        "resource-recommendation": "visual",
      },
      workflow: {
        workflowId: "timeline-persisted",
      },
    });
    expect(parsed?.workflow.nodes["resource-recommendation"].result).toMatchObject({
      checkpoint: {
        resource: {
          apiKey: "[redacted]",
        },
      },
    });
  });

  it("preserves scene input source image data through workflow sanitization", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-source-image",
      sceneRequest: "A source-guided portrait",
      imageCount: 4,
      sourceImage: {
        dataUrl: "data:image/png;base64,aGVsbG8=",
        filename: "source.png",
        height: 768,
        mimeType: "image/png",
        uploadedAt: "2026-06-07T00:00:00.000Z",
        width: 1024,
      },
      now: () => "2026-06-07T00:00:00.000Z",
    });

    const record = createTimelineWorkflowRecord({
      workflow,
      sceneRequest: "A source-guided portrait",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
    });
    const parsed = parseTimelineWorkflowRecordJson(serializeTimelineWorkflowRecord(record));

    expect(parsed?.workflow.nodes["scene-input"].result).toMatchObject({
      imageCount: 1,
      sourceImage: {
        dataUrl: "data:image/png;base64,aGVsbG8=",
        filename: "source.png",
        height: 768,
        mimeType: "image/png",
        width: 1024,
      },
    });
  });

  it("restores interrupted running nodes as visible errors", () => {
    const workflow = markTimelineNodeRunning(
      createTimelineWorkflowState({
        workflowId: "timeline-running",
        sceneRequest: "A running scene",
        now: () => "2026-06-05T00:00:00.000Z",
      }),
      "scene-prompt",
      { now: () => "2026-06-05T00:02:00.000Z" },
    );

    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow,
      sceneRequest: "A running scene",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-prompt",
      outputDisplayModes: {},
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:02:00.000Z",
    });

    expect(parsed?.workflow.nodes["scene-prompt"]).toMatchObject({
      status: "error",
      error: {
        code: "timeline_node_failed",
        message: "This node was interrupted while the workflow was away. Rerun it to continue.",
      },
    });
  });

  it("rejects malformed active workflow records", () => {
    expect(sanitizeTimelineWorkflowRecord({})).toBeNull();
    expect(
      sanitizeTimelineWorkflowRecord({
        kind: "sceneforge-timeline-workflow",
        version: 1,
        workflow: { workflowId: "" },
      }),
    ).toBeNull();
  });

  it("keeps T10 active workflow records without project metadata backward compatible", () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "timeline-no-project-metadata",
      sceneRequest: "A backward compatible active draft",
      now: () => "2026-06-05T00:00:00.000Z",
    });

    const parsed = sanitizeTimelineWorkflowRecord({
      kind: "sceneforge-timeline-workflow",
      version: 1,
      workflow,
      sceneRequest: "A backward compatible active draft",
      selectedPromptProfile: "illustrious",
      selectedImageCount: 1,
      selectedNodeId: "scene-input",
      outputDisplayModes: {},
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    });

    expect(parsed).toMatchObject({
      workflow: {
        workflowId: "timeline-no-project-metadata",
      },
      sceneRequest: "A backward compatible active draft",
    });
    expect(parsed?.projectId).toBeUndefined();
    expect(parsed?.name).toBeUndefined();
  });
});
