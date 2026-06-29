import { describe, expect, it, vi } from "vitest";

import { confirmAndExecuteStoryGeneration, sanitizeStoryWorkflowState, StoryApiValidationError } from "./story-api";
import type { StoryShotExecutionAdapter } from "./story-execution";
import { startStoryGraphWorkflow } from "./story-input";
import { createStoryWorkflowState, type StoryWorkflowNodeMap } from "./story-state";

describe("story API workflow sanitizer", () => {
  it("restores legacy Story Graph workflows that are missing entity-card and reference-plan nodes", () => {
    const workflow = createStoryWorkflowState({
      now: () => "2026-06-14T00:00:00.000Z",
      storyId: "story-legacy",
      workflowId: "workflow-legacy",
    });
    const legacyNodes = { ...workflow.nodes } as Partial<StoryWorkflowNodeMap>;
    delete legacyNodes["entity-cards"];
    delete legacyNodes["reference-asset-plan"];

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
    expect(sanitized.nodes["reference-asset-plan"]).toMatchObject({
      nodeId: "reference-asset-plan",
      source: "system",
      status: "blocked",
      updatedAt: workflow.updatedAt,
    });
  });

  it("recomputes the reference asset freeze gate before executing a forged ready gate", async () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A two-shot courier story through a neon market.",
      targetShotCount: 2,
      storyId: "story-forged-ready-gate",
      workflowId: "workflow-forged-ready-gate",
      now: () => "2026-06-14T00:00:00.000Z",
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "checkpoint-local",
              name: "Local Checkpoint",
              baseModel: "Illustrious",
              modelFileName: "local.safetensors",
            },
          ],
          loras: [],
        },
      },
    });
    const gateResult = workflow.nodes["generation-gate"].result as Record<string, unknown>;
    const forgedReadyWorkflow = {
      ...workflow,
      nodes: {
        ...workflow.nodes,
        "generation-gate": {
          ...workflow.nodes["generation-gate"],
          result: {
            ...gateResult,
            blockingReason: "Confirm generation to start shot graph execution.",
            executionAvailable: true,
            ready: true,
          },
        },
      },
    };
    const executeShot: StoryShotExecutionAdapter = vi.fn();
    let error: unknown;

    try {
      await confirmAndExecuteStoryGeneration({
        executeShot,
        workflow: forgedReadyWorkflow,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StoryApiValidationError);
    expect(error).toMatchObject({
      details: {
        blockingReferences: expect.arrayContaining([
          expect.objectContaining({
            entityName: "Main character",
            importance: "required",
            referenceType: "character-face",
            resolutionState: "missing",
          }),
        ]),
      },
      status: 400,
    });
    expect((error as Error).message).toBe("Story reference asset freeze gate is blocked.");
    expect(executeShot).not.toHaveBeenCalled();
  });
});
