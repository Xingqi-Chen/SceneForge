import { describe, expect, it } from "vitest";

import { sanitizeStoryWorkflowState } from "./story-api";
import { createStoryWorkflowState, type StoryWorkflowNodeMap } from "./story-state";

describe("story API workflow sanitizer", () => {
  it("restores legacy Story Graph workflows that are missing entity-card nodes", () => {
    const workflow = createStoryWorkflowState({
      now: () => "2026-06-14T00:00:00.000Z",
      storyId: "story-legacy",
      workflowId: "workflow-legacy",
    });
    const legacyNodes = { ...workflow.nodes } as Partial<StoryWorkflowNodeMap>;
    delete legacyNodes["entity-cards"];

    const sanitized = sanitizeStoryWorkflowState({
      ...workflow,
      nodes: legacyNodes,
    });

    expect(sanitized).not.toBeNull();
    if (!sanitized) {
      throw new Error("Expected legacy Story Graph workflow to sanitize.");
    }

    expect(sanitized.nodes["story-input"]).toMatchObject({
      nodeId: "story-input",
      status: "ready",
    });
    expect(sanitized.nodes["entity-cards"]).toMatchObject({
      nodeId: "entity-cards",
      source: "system",
      status: "blocked",
      updatedAt: workflow.updatedAt,
    });
  });
});
