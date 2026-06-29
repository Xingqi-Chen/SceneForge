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
        resourceCandidates: {
          checkpoints: [
            {
              id: "local-checkpoint",
              name: "Local Checkpoint",
              baseModel: "Anima",
              modelFileName: "local.safetensors",
            },
          ],
          loras: [],
        },
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
        img2imgDenoise: 0.9,
        promptProfile: "anima",
        resourceCandidateCounts: {
          checkpoints: 1,
          loras: 0,
        },
        targetShotCount: 4,
        audienceRating: "explicit",
        nsfwEnabled: true,
      },
    });
    expect(JSON.stringify(input.settingsSnapshot)).not.toContain("resourceCandidates");
  });

  it("normalizes Story img2img denoise from start settings", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot chase using a source image handoff.",
      storyId: "story-img2img-denoise",
      now,
      settingsSnapshot: {
        img2imgDenoise: 0.73,
      },
    });

    expect(input.settingsSnapshot).toMatchObject({
      img2imgDenoise: 0.73,
    });

    const fallbackInput = createStoryInputFromStartRequest({
      rawIntent: "A second two-shot chase using a source image handoff.",
      storyId: "story-img2img-denoise-default",
      now,
      settingsSnapshot: {
        img2imgDenoise: "bad" as never,
      },
    });

    expect(fallbackInput.settingsSnapshot).toMatchObject({
      img2imgDenoise: 0.9,
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

  it("leaves raw story structure for LLM judgment instead of estimating automatic shot count", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A courier waits for a bus, then rushes through an alley, finally returns a book.",
      storyId: "story-llm-count",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(input.targetShotCount).toBeUndefined();
    expect(input.storySegments).toBeUndefined();
    expect(artifacts.outline.beats).toHaveLength(1);
    expect(artifacts.shots).toHaveLength(1);
  });

  it("keeps explicit Beat and Final image labels in rawIntent for the LLM instead of parsing storySegments", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: courierStory,
      storyId: "story-explicit-beats",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(input.rawIntent).toContain("Beat 1:");
    expect(input.rawIntent).toContain("Final image:");
    expect(input.targetShotCount).toBeUndefined();
    expect(input.storyContext).toBeUndefined();
    expect(input.storySegments).toBeUndefined();
    expect(artifacts.outline.beats).toHaveLength(1);
    expect(artifacts.shots).toHaveLength(1);
    expect(artifacts.generationGate.renderPlanShotCount).toBe(1);
  });

  it("keeps inline Beat labels in rawIntent for the LLM instead of parsing storySegments", () => {
    const inlineStory = "Context before the labeled sequence. Beat 1: The student finds the missing photo at her desk. Beat 2: The student reprints the photo at the copy shop. Beat 3: The student finishes the collage at a cafe table. Beat 4: The student offers the wrapped collage on a side street. Final image: Her friend opens the collage in sunset light.";
    const input = createStoryInputFromStartRequest({
      rawIntent: inlineStory,
      storyId: "story-inline-beats",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(input.rawIntent).toContain("Beat 1:");
    expect(input.rawIntent).toContain("Final image:");
    expect(input.targetShotCount).toBeUndefined();
    expect(input.storyContext).toBeUndefined();
    expect(input.storySegments).toBeUndefined();
    expect(artifacts.outline.beats).toHaveLength(1);
    expect(artifacts.shots).toHaveLength(1);
    expect(artifacts.generationGate.renderPlanShotCount).toBe(1);
  });

  it("uses explicit target shot count without parsing labeled story text", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: courierStory,
      targetShotCount: 2,
      storyId: "story-explicit-target",
      now,
    });
    const artifacts = createStoryPlanningArtifacts(input, now());

    expect(input.storySegments).toBeUndefined();
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
    const resourceCandidates = {
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
    };
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot neon arcade conversation.",
      targetShotCount: 2,
      storyId: "story-resources",
      now,
      settingsSnapshot: {
        resourceCandidates,
      },
    });
    const artifacts = createStoryPlanningArtifacts(input, now(), resourceCandidates);
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
    expect(input.settingsSnapshot).toMatchObject({
      resourceCandidateCounts: {
        checkpoints: 1,
        loras: 1,
      },
    });
    expect(JSON.stringify(input.settingsSnapshot)).not.toContain("resourceCandidates");
    expect(resourcePlanJson).not.toContain("nsfw");
    expect(resourcePlanJson).not.toContain("Nsfw");
    expect(renderPlanJson).not.toContain("\"resources\"");
    expect(renderPlanJson).toContain("\"resourceRefs\"");
    expect(renderPlanJson).not.toContain("modelNsfw");
    expect(renderPlanJson).not.toContain("aiNsfwLevel");
  });

  it("drops Story style parameters when no checkpoint is selected", () => {
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot neon arcade conversation.",
      storyId: "story-parameter-only-style",
      now,
      settingsSnapshot: {
        stylePalette: {
          loras: [],
          parameters: {
            width: 832,
            height: 1216,
            steps: 31,
            cfg: 4.25,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.88,
            seed: 12345,
          },
        },
      },
    });

    expect(input.settingsSnapshot).not.toHaveProperty("stylePalette");
  });

  it("uses Story input style resources and saved parameters for local planning artifacts", () => {
    const resourceCandidates = {
      checkpoints: [
        {
          id: "checkpoint-default",
          name: "Default Checkpoint",
          baseModel: "Illustrious",
          modelFileName: "default.safetensors",
        },
        {
          id: "checkpoint-manual",
          name: "Manual Checkpoint",
          baseModel: "Illustrious",
          modelFileName: "manual.safetensors",
        },
      ],
      loras: [
        {
          id: "lora-enabled",
          name: "Enabled LoRA",
          baseModel: "Illustrious",
          modelFileName: "enabled-lora.safetensors",
          averageWeight: 0.55,
        },
        {
          id: "lora-disabled",
          name: "Disabled LoRA",
          baseModel: "Illustrious",
          modelFileName: "disabled-lora.safetensors",
          averageWeight: 0.75,
        },
      ],
    };
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot neon arcade conversation.",
      targetShotCount: 2,
      storyId: "story-style-palette",
      now,
      settingsSnapshot: {
        resourceCandidates,
        stylePalette: {
          checkpointId: "checkpoint-manual",
          loras: [
            { id: "lora-enabled", enabled: true, strengthModel: 0.82, strengthClip: 0.44 },
            { id: "lora-disabled", enabled: false, strengthModel: 0.75, strengthClip: 0.75 },
          ],
          parameters: {
            width: 832,
            height: 1216,
            steps: 31,
            cfg: 4.25,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.88,
            seed: 12345,
          },
        },
      },
    });
    const artifacts = createStoryPlanningArtifacts(input, now(), resourceCandidates);

    expect(input.settingsSnapshot).toMatchObject({
      stylePalette: {
        checkpointId: "checkpoint-manual",
        loras: [
          { id: "lora-enabled", enabled: true, strengthModel: 0.82, strengthClip: 0.44 },
          { id: "lora-disabled", enabled: false, strengthModel: 0.75, strengthClip: 0.75 },
        ],
        parameters: {
          width: 832,
          height: 1216,
          steps: 31,
          cfg: 4.25,
          samplerName: "euler",
          scheduler: "normal",
          denoise: 0.88,
          seed: 12345,
        },
      },
    });
    expect(artifacts.resourcePlan.checkpoint.resource.id).toBe("checkpoint-manual");
    expect(artifacts.resourcePlan.loras).toHaveLength(1);
    expect(artifacts.resourcePlan.loras[0]).toMatchObject({
      resource: {
        id: "lora-enabled",
        storyInputStrengthModel: 0.82,
        storyInputStrengthClip: 0.44,
      },
      suggestedWeight: 0.82,
    });
    expect(artifacts.parameterPlan.defaults).toMatchObject({
      width: 832,
      height: 1216,
      steps: 31,
      cfg: 4.25,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 0.88,
      seed: 12345,
    });
  });

  it("uses Anima sampler defaults for local Story planning artifacts", () => {
    const resourceCandidates = {
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
    };
    const input = createStoryInputFromStartRequest({
      rawIntent: "A two-shot anime rooftop conversation.",
      targetShotCount: 2,
      storyId: "story-anima-resources",
      now,
      settingsSnapshot: {
        resourceCandidates,
      },
    });
    const artifacts = createStoryPlanningArtifacts(input, now(), resourceCandidates);

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
    expect(artifacts.generationGate.requestPreview[0]).toMatchObject({
      animaPromptParts: artifacts.renderPlan.shots[0]?.animaPromptParts,
      sourceMode: "none",
      sourceShotIds: [],
    });
    expect(artifacts.renderPlan.shots[0]?.outputAnchors).toMatchObject({
      source: {
        mode: "none",
        sourceShotIds: [],
      },
    });
    expect(artifacts.renderPlan.shots[0]?.outputAnchors.subject.length).toBeGreaterThan(0);
  });

  it("keeps local Story planning dimensions neutral for aspect keywords", () => {
    const animaResourceCandidates = {
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
    };
    const portraitInput = createStoryInputFromStartRequest({
      rawIntent: "A vertical full body anime courier portrait sequence.",
      targetShotCount: 1,
      storyId: "story-portrait-dimensions",
      now,
      settingsSnapshot: {
        resourceCandidates: animaResourceCandidates,
      },
    });
    const landscapeInput = createStoryInputFromStartRequest({
      rawIntent: "A wide cinematic chase through a rainy market.",
      targetShotCount: 1,
      storyId: "story-landscape-dimensions",
      now,
    });
    const portraitArtifacts = createStoryPlanningArtifacts(portraitInput, now(), animaResourceCandidates);
    const landscapeArtifacts = createStoryPlanningArtifacts(landscapeInput, now());

    expect(portraitArtifacts.generationGate.requestPreview[0]?.parameters).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(landscapeArtifacts.generationGate.requestPreview[0]?.parameters).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(portraitArtifacts.renderPlan.shots[0]?.parameters).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(landscapeArtifacts.renderPlan.shots[0]?.parameters).toMatchObject({
      width: 1024,
      height: 1024,
    });
  });

  it("keeps full output anchors in the render plan and full prompt previews in the generation gate", () => {
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
    const anchors = artifacts.renderPlan.shots[0]?.outputAnchors;

    expect(preview?.positivePromptPreview.length).toBe(
      artifacts.renderPlan.shots[0]?.positivePrompt.replace(/\s+/g, " ").trim().length,
    );
    expect(preview?.positivePromptPreview).toContain("distant police barricades along the bridge route");
    expect(preview?.animaPromptParts).toEqual(artifacts.renderPlan.shots[0]?.animaPromptParts);
    expect(preview).not.toHaveProperty("positivePrompt");
    expect(preview).not.toHaveProperty("negativePrompt");
    expect(preview).not.toHaveProperty("outputAnchors");
    expect(JSON.stringify(anchors)).toContain("lifting the bicycle through a narrow alley");
    expect(JSON.stringify(anchors)).toContain("distant police barricades along the bridge route");
    expect(anchors?.negative).not.toEqual(
      expect.arrayContaining(["non-consensual", "sexualized minor", "childlike face"]),
    );
    expect(JSON.stringify(anchors)).toContain("One hand gripping the bike frame as he squeezes past");
    expect(JSON.stringify(anchors)).not.toContain("sexualized minors");
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
