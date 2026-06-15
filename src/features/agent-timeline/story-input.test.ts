import { describe, expect, it } from "vitest";

import {
  createStoryInputFromStartRequest,
  createStoryPlanningArtifacts,
  startStoryGraphWorkflow,
} from "./story-input";
import { confirmStoryGeneration, setStoryNodeManualResult } from "./story-state";
import { canRunCommonWorkflowNode } from "./workflow-definition";
import { storyWorkflowDefinition } from "./story-workflow";

const now = () => "2026-06-14T00:00:00.000Z";

describe("story input workflow start", () => {
  it("normalizes user input into typed StoryInput with settings and NSFW context", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A four-shot gothic chapel sequence.",
      storyId: "story-1",
      targetShotCount: 4.4,
      nsfwEnabled: true,
      now,
      settingsSnapshot: {
        promptProfile: "anima",
      },
    });

    expect(input).toMatchObject({
      storyId: "story-1",
      rawIntent: "A four-shot gothic chapel sequence.",
      title: undefined,
      targetShotCount: 4,
      audienceRating: "explicit",
      nsfwContext: {
        enabled: true,
        audienceRating: "explicit",
        contentWarnings: [],
        rationale: "NSFW is enabled in SceneForge settings.",
      },
      settingsSnapshot: {
        source: "story-form",
        planningMode: "deterministic-local",
        promptProfile: "anima",
        targetShotCount: 4,
        audienceRating: "explicit",
        nsfwEnabled: true,
      },
    });
  });

  it("leaves target shot count unset when the user lets the workflow decide", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A moody station encounter.",
      storyId: "story-auto-shots",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(input.targetShotCount).toBeUndefined();
    expect(input.audienceRating).toBe("safe");
    expect(input.nsfwContext).toMatchObject({
      enabled: false,
      audienceRating: "safe",
      rationale: "NSFW is disabled in SceneForge settings.",
    });
    expect(artifacts.outline.beats).toHaveLength(3);
    expect(artifacts.shots).toHaveLength(3);
  });

  it("creates inspectable planning artifacts from a user-started story input", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A courier crosses a neon market and finds a hidden map.",
      targetShotCount: 5,
      storyId: "story-2",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(artifacts.bible.storyId).toBe("story-2");
    expect(artifacts.outline.beats).toHaveLength(5);
    expect(artifacts.shots).toHaveLength(5);
    expect(artifacts.dependencyGraph.edges).toHaveLength(4);
    expect(artifacts.resourcePlan.checkpoint.resource.id).toBe("story-planning-fallback-checkpoint");
    expect(JSON.stringify(artifacts.resourcePlan)).not.toContain("nsfw");
    expect(artifacts.generationGate).toMatchObject({
      confirmationRequired: true,
      ready: true,
      executionAvailable: true,
      renderPlanShotCount: 5,
    });
    expect(artifacts.execution).toMatchObject({
      readyShotIds: ["shot-1", "shot-2", "shot-3", "shot-4", "shot-5"],
      status: "ready",
    });
  });

  it("uses supplied local resource candidates from the settings snapshot without model NSFW metadata", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot neon arcade conversation.",
      targetShotCount: 2,
      storyId: "story-resources",
      now,
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "local-checkpoint",
              name: "Local Arcade Checkpoint",
              baseModel: "Illustrious",
              modelFileName: "arcade.safetensors",
              nsfw: true,
              modelNsfw: true,
            },
          ],
          loras: [
            {
              id: "local-lora",
              name: "Neon Cabinet LoRA",
              baseModel: "Illustrious",
              modelFileName: "neon-cabinet.safetensors",
              trainedWords: ["neon arcade"],
              aiNsfwLevel: "explicit",
              nsfwLevel: 5,
            },
          ],
        },
      },
    });
    const artifacts = createStoryPlanningArtifacts(input, now());
    const resourcePlanJson = JSON.stringify(artifacts.resourcePlan);
    const renderPlanJson = JSON.stringify(artifacts.renderPlan);

    expect(artifacts.resourcePlan.checkpoint.resource).toEqual({
      id: "local-checkpoint",
      name: "Local Arcade Checkpoint",
      baseModel: "Illustrious",
      modelFileName: "arcade.safetensors",
    });
    expect(artifacts.resourcePlan.loras[0]?.resource).toEqual({
      id: "local-lora",
      name: "Neon Cabinet LoRA",
      baseModel: "Illustrious",
      modelFileName: "neon-cabinet.safetensors",
      trainedWords: ["neon arcade"],
    });
    expect(artifacts.resourcePlan.recommendationReason).toBe("Use validated local candidates from the Story Graph settings snapshot.");
    expect(artifacts.resourcePlan.warnings).toEqual([]);
    expect(resourcePlanJson).not.toContain("nsfw");
    expect(resourcePlanJson).not.toContain("Nsfw");
    expect(renderPlanJson).not.toContain("modelNsfw");
    expect(renderPlanJson).not.toContain("aiNsfwLevel");
  });

  it("starts a story-graph workflow with confirmation-gated shot execution", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A three-shot market chase.",
      storyId: "story-3",
      workflowId: "workflow-3",
      now,
    });

    expect(workflow).toMatchObject({
      workflowId: "workflow-3",
      workflowMode: "story-graph",
      storyId: "story-3",
      generationConfirmed: false,
    });
    expect(workflow.nodes["story-input"]).toMatchObject({
      status: "manual",
      source: "manual",
      result: expect.objectContaining({
        rawIntent: "A three-shot market chase.",
      }),
    });
    expect(workflow.nodes["story-bible"].status).toBe("done");
    expect(workflow.nodes["generation-gate"]).toMatchObject({
      status: "done",
      result: expect.objectContaining({
        confirmationRequired: true,
        executionAvailable: true,
      }),
    });
    expect(workflow.nodes["shot-graph-execution"]).toMatchObject({
      status: "blocked",
      error: {
        code: "confirmation_required",
        message: "Confirm generation before starting Story Graph shot execution.",
      },
    });
    expect(
      canRunCommonWorkflowNode({
        dag: storyWorkflowDefinition.dependencyDag,
        executableNodeIds: storyWorkflowDefinition.executableNodeIds,
        nodeId: "shot-graph-execution",
        nodes: workflow.nodes,
        reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
      }),
    ).toBe(false);

    const confirmed = confirmStoryGeneration(workflow, { now });

    expect(confirmed.generationConfirmed).toBe(true);
    expect(confirmed.nodes["shot-graph-execution"]).toMatchObject({
      status: "ready",
      error: undefined,
    });
    expect(
      canRunCommonWorkflowNode({
        dag: storyWorkflowDefinition.dependencyDag,
        executableNodeIds: storyWorkflowDefinition.executableNodeIds,
        nodeId: "shot-graph-execution",
        nodes: confirmed.nodes,
        reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
      }),
    ).toBe(true);
  });

  it("preserves shared stale propagation for manual edits on a user-started workflow", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A three-shot market chase.",
      storyId: "story-manual-edit",
      workflowId: "workflow-manual-edit",
      now,
    });
    const shots = workflow.nodes["storyboard-shots"].result;

    if (!Array.isArray(shots)) {
      throw new Error("Expected storyboard shots to be generated.");
    }

    const edited = setStoryNodeManualResult(
      workflow,
      "storyboard-shots",
      shots.map((shot) => (shot.id === "shot-2" ? { ...shot, title: "Market chase close-up" } : shot)),
      {
        now: () => "2026-06-14T00:00:01.000Z",
        scope: {
          artifactType: "storyboard-shots",
          kind: "shot",
          shotId: "shot-2",
          storyId: "story-manual-edit",
        },
      },
    );

    expect(edited.nodes["storyboard-shots"]).toMatchObject({
      status: "manual",
      source: "manual",
      manualEdit: {
        scope: {
          kind: "shot",
          shotId: "shot-2",
          storyId: "story-manual-edit",
        },
        staleShotIds: [],
      },
    });
    expect(edited.nodes["story-safety-plan"].status).toBe("stale");
    expect(edited.nodes["resource-plan"].status).toBe("stale");
    expect(edited.nodes["generation-gate"].status).toBe("stale");
    expect(edited.generationConfirmed).toBe(false);
    expect(
      canRunCommonWorkflowNode({
        dag: storyWorkflowDefinition.dependencyDag,
        executableNodeIds: storyWorkflowDefinition.executableNodeIds,
        nodeId: "shot-graph-execution",
        nodes: edited.nodes,
        reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
      }),
    ).toBe(false);
  });

  it("requires a fresh confirmation after manual generation gate edits", () => {
    const workflow = startStoryGraphWorkflow({
      rawIntent: "A three-shot market chase.",
      storyId: "story-gate-edit",
      workflowId: "workflow-gate-edit",
      now,
    });
    const confirmed = confirmStoryGeneration(workflow, { now });
    const gatePreview = confirmed.nodes["generation-gate"].result;

    if (!gatePreview || typeof gatePreview !== "object") {
      throw new Error("Expected generation gate preview.");
    }

    const edited = setStoryNodeManualResult(
      confirmed,
      "generation-gate",
      {
        ...gatePreview,
        blockingReason: "Manual gate review changed the request preview.",
      },
      {
        now: () => "2026-06-14T00:00:01.000Z",
        scope: {
          artifactType: "generation-gate",
          kind: "story",
          storyId: "story-gate-edit",
        },
      },
    );

    expect(edited.generationConfirmed).toBe(false);
    expect(edited.nodes["shot-graph-execution"]).toMatchObject({
      status: "blocked",
      error: {
        code: "confirmation_required",
      },
    });
    expect(
      canRunCommonWorkflowNode({
        dag: storyWorkflowDefinition.dependencyDag,
        executableNodeIds: storyWorkflowDefinition.executableNodeIds,
        nodeId: "shot-graph-execution",
        nodes: edited.nodes,
        reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
      }),
    ).toBe(false);

    const reconfirmed = confirmStoryGeneration(edited, {
      now: () => "2026-06-14T00:00:02.000Z",
    });

    expect(reconfirmed.generationConfirmed).toBe(true);
    expect(reconfirmed.nodes["shot-graph-execution"]).toMatchObject({
      status: "ready",
      error: undefined,
    });
    expect(
      canRunCommonWorkflowNode({
        dag: storyWorkflowDefinition.dependencyDag,
        executableNodeIds: storyWorkflowDefinition.executableNodeIds,
        nodeId: "shot-graph-execution",
        nodes: reconfirmed.nodes,
        reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
      }),
    ).toBe(true);
  });
});
