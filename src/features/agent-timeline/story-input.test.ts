import { describe, expect, it } from "vitest";

import {
  createStoryInputFromStartRequest,
  createStoryPlanningArtifacts,
  estimateStoryShotCount,
  parseExplicitStorySegments,
  startStoryGraphWorkflow,
} from "./story-input";
import { confirmStoryGeneration, setStoryNodeManualResult } from "./story-state";
import { canRunCommonWorkflowNode } from "./workflow-definition";
import { storyWorkflowDefinition } from "./story-workflow";

const now = () => "2026-06-14T00:00:00.000Z";
const courierStory = [
  "Characters: teenage courier in a yellow rain jacket, carrying a cake box.",
  "Beat 1: The courier pedals into a wet market alley with the cake box strapped to his backpack.",
  "Beat 2: The backpack strap snaps and he catches the falling bakery box in the wet market alley.",
  "Beat 3: He abandons the bicycle, tucks the box under his rain jacket, runs through a blocked crosswalk, and reaches the apartment stairwell.",
  "Beat 4: He smooths the crushed box corner and knocks at the apartment door with a forced calm expression.",
  "Final image: The courier holds the battered cake box beside a little girl in a party hat and her relieved father.",
].join("\n");

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
    expect(artifacts.outline.beats).toHaveLength(1);
    expect(artifacts.shots).toHaveLength(1);
  });

  it("estimates automatic shot count from explicit events instead of defaulting to three", () => {
    expect(estimateStoryShotCount("A moody station encounter.")).toBe(1);
    expect(estimateStoryShotCount("A courier waits for a bus, then rushes through an alley, finally returns a book.")).toBe(3);
    expect(estimateStoryShotCount("A courier crosses a neon market and finds a hidden map.")).toBe(2);
    expect(estimateStoryShotCount("A four-shot gothic chapel sequence.")).toBe(4);
    expect(estimateStoryShotCount("A 12-shot gothic chapel sequence.")).toBe(12);
    expect(estimateStoryShotCount("A 12 panels gothic chapel sequence.")).toBe(12);
    expect(estimateStoryShotCount("A 30-shot gothic chapel sequence.")).toBe(24);
  });

  it("uses explicit Beat and Final image labels as visual segments when shot count is automatic", () => {
    const parsed = parseExplicitStorySegments(courierStory);
    const input = createStoryInputFromStartRequest({
      rawIntent: courierStory,
      storyId: "story-explicit-beats",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(parsed.context).toContain("teenage courier in a yellow rain jacket");
    expect(parsed.segments.map((segment) => segment.title)).toEqual([
      "Beat 1",
      "Beat 2",
      "Beat 3",
      "Beat 4",
      "Final image",
    ]);
    expect(estimateStoryShotCount(courierStory)).toBe(5);
    expect(input.targetShotCount).toBeUndefined();
    expect(input.storySegments).toHaveLength(5);
    expect(artifacts.outline.beats.map((beat) => beat.title)).toEqual([
      "Beat 1",
      "Beat 2",
      "Beat 3",
      "Beat 4",
      "Final image",
    ]);
    expect(artifacts.shots).toHaveLength(5);
    expect(artifacts.generationGate.renderPlanShotCount).toBe(5);
    expect(artifacts.generationGate.requestPreview[4]?.positivePrompt).toContain("little girl");
    expect(artifacts.generationGate.requestPreview[4]?.positivePrompt).toContain("relieved father");
  });

  it("lets an explicit target shot count override detected story segments", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: courierStory,
      targetShotCount: 2,
      storyId: "story-explicit-target",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(input.storySegments).toHaveLength(5);
    expect(artifacts.outline.beats).toHaveLength(2);
    expect(artifacts.shots).toHaveLength(2);
    expect(artifacts.generationGate.renderPlanShotCount).toBe(2);
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

  it("uses Anima sampler defaults for local Story planning artifacts", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot anime rooftop conversation.",
      targetShotCount: 2,
      storyId: "story-anima-resources",
      now,
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "anima-checkpoint",
              name: "Anima Checkpoint",
              baseModel: "Anima",
              modelBaseModel: "Anima",
              modelFileName: "anima.safetensors",
            },
          ],
          loras: [],
        },
      },
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(artifacts.parameterPlan.defaults).toMatchObject({
      steps: 36,
      cfg: 4.5,
      samplerName: "er_sde",
      scheduler: "simple",
    });
    expect(artifacts.generationGate.requestPreview[0]?.parameters).toMatchObject({
      steps: 36,
      cfg: 4.5,
      samplerName: "er_sde",
      scheduler: "simple",
    });
    expect(artifacts.generationGate.requestPreview[0]?.outputAnchors).toMatchObject({
      source: {
        mode: "none",
        sourceShotIds: [],
      },
    });
    expect(artifacts.generationGate.requestPreview[0]?.outputAnchors.subject.length).toBeGreaterThan(0);
  });

  it("infers local Story planning dimensions from the requested aspect", () => {
    const portraitInput = createStoryInputFromStartRequest({
      rawIntent: "A vertical full body anime courier portrait sequence.",
      targetShotCount: 1,
      storyId: "story-portrait-dimensions",
      now,
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "anima-checkpoint",
              name: "Anima Checkpoint",
              baseModel: "Anima",
              modelBaseModel: "Anima",
              modelFileName: "anima.safetensors",
            },
          ],
          loras: [],
        },
      },
    });
    const landscapeInput = createStoryInputFromStartRequest({
      rawIntent: "A wide cinematic chase through a rainy market.",
      targetShotCount: 1,
      storyId: "story-landscape-dimensions",
      now,
    });
    const portraitArtifacts = createStoryPlanningArtifacts(portraitInput, now());
    const landscapeArtifacts = createStoryPlanningArtifacts(landscapeInput, now());

    expect(portraitArtifacts.generationGate.requestPreview[0]?.parameters).toMatchObject({
      width: 832,
      height: 1216,
    });
    expect(landscapeArtifacts.generationGate.requestPreview[0]?.parameters).toMatchObject({
      width: 1216,
      height: 832,
    });
    expect(portraitArtifacts.renderPlan.shots[0]?.parameters).toMatchObject({
      width: 832,
      height: 1216,
    });
    expect(landscapeArtifacts.renderPlan.shots[0]?.parameters).toMatchObject({
      width: 1216,
      height: 832,
    });
  });

  it("puts compact output anchors into the generation gate request preview", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent:
        "One hand gripping the bike frame as he squeezes past market crates, lifting the bicycle through a narrow alley, with distant police barricades along the bridge route.",
      targetShotCount: 1,
      storyId: "story-compact-anchors",
      now,
      nsfwEnabled: true,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());
    const preview = artifacts.generationGate.requestPreview[0];

    expect(preview?.outputAnchors.action).toContain("lifting bicycle through narrow alley");
    expect(preview?.outputAnchors.environment).toContain("distant police barricades near bridge route");
    expect(preview?.outputAnchors.negative).not.toEqual(
      expect.arrayContaining(["non-consensual", "sexualized minor", "childlike face"]),
    );
    expect(JSON.stringify(preview?.outputAnchors)).not.toContain("One hand gripping the bike frame as he squeezes past");
    expect(JSON.stringify(preview?.outputAnchors)).not.toContain("sexualized minors");
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
