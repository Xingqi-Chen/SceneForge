import { describe, expect, it } from "vitest";

import {
  createStoryInputFromStartRequest,
  createStoryPlanningArtifacts,
  startStoryGraphWorkflow,
} from "./story-input";
import { setStoryNodeManualResult } from "./story-state";
import { canRunCommonWorkflowNode } from "./workflow-definition";
import { storyWorkflowDefinition } from "./story-workflow";

const now = () => "2026-06-14T00:00:00.000Z";

describe("story input workflow start", () => {
  it("normalizes user input into typed StoryInput with settings and NSFW context", () => {
    const input = createStoryInputFromStartRequest({
      audienceRating: "mature",
      contentWarnings: ["  body horror ", ""],
      nsfwRationale: "Adult horror context.",
      rawIntent: "A four-shot gothic chapel sequence.",
      targetShotCount: 4.4,
      title: "Chapel Sequence",
      storyId: "story-1",
      now,
    });

    expect(input).toMatchObject({
      storyId: "story-1",
      rawIntent: "A four-shot gothic chapel sequence.",
      title: "Chapel Sequence",
      targetShotCount: 4,
      audienceRating: "mature",
      nsfwContext: {
        enabled: true,
        audienceRating: "mature",
        contentWarnings: ["body horror"],
        rationale: "Adult horror context.",
      },
      settingsSnapshot: {
        source: "story-form",
        planningMode: "deterministic-local",
        targetShotCount: 4,
        audienceRating: "mature",
        nsfwEnabled: true,
      },
    });
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
      ready: false,
      executionAvailable: false,
      renderPlanShotCount: 5,
    });
    expect(artifacts.execution).toMatchObject({
      status: "blocked",
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

  it("starts a story-graph workflow and keeps execution non-runnable until T21", () => {
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
        executionAvailable: false,
      }),
    });
    expect(workflow.nodes["shot-graph-execution"]).toMatchObject({
      status: "blocked",
      error: {
        code: "story_execution_unavailable",
        message: "Shot graph execution is unavailable until Track T21.",
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
  });

  it("preserves shared stale propagation for manual edits on a user-started workflow without enabling execution", () => {
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
});
