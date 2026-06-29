import { describe, expect, it } from "vitest";

import {
  confirmStoryGeneration,
  createStoryWorkflowState,
  setStoryNodeManualResult,
} from "./story-state";
import type {
  ShotDependencyGraph,
  StoryEntityCards,
  StorySafetyPlan,
  StoryShot,
} from "./story-types";

const now = () => "2026-06-14T00:00:00.000Z";
const editedAt = () => "2026-06-14T00:00:01.000Z";

const shots = [
  {
    id: "shot-1",
    storyId: "story-1",
    order: 1,
    title: "Arrival",
    description: "The hero arrives.",
    characterIds: ["hero"],
    sourceShotIds: [],
    camera: "wide",
    promptIntent: "quiet arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId: "story-1",
    order: 2,
    title: "Signal",
    description: "The hero sees the signal.",
    characterIds: ["hero"],
    sourceShotIds: ["shot-1"],
    camera: "medium",
    promptIntent: "signal reflection",
    continuityNotes: [],
  },
  {
    id: "shot-3",
    storyId: "story-1",
    order: 3,
    title: "Exit",
    description: "The hero leaves.",
    characterIds: ["hero"],
    sourceShotIds: [],
    camera: "wide",
    promptIntent: "station exit",
    continuityNotes: [],
  },
] satisfies StoryShot[];

describe("story workflow state", () => {
  it("does not confirm generation before the generation gate is complete", () => {
    const workflow = createStoryWorkflowState({ now, storyId: "story-1", workflowId: "story-workflow-1" });
    const confirmed = confirmStoryGeneration(workflow, { now: editedAt });

    expect(confirmed.generationConfirmed).toBe(false);
    expect(confirmed.nodes["shot-graph-execution"].status).toBe("blocked");
  });

  it("marks manual story artifacts and Story Graph downstream nodes stale", () => {
    const workflow = createStoryWorkflowState({ now, storyId: "story-1", workflowId: "story-workflow-1" });
    const safetyPlan = {
      storyId: "story-1",
      audienceRating: "safe",
      contentWarnings: [],
      blockedContent: [],
      perShotNotes: [],
    } satisfies StorySafetyPlan;

    const edited = setStoryNodeManualResult(workflow, "story-safety-plan", safetyPlan, {
      now: editedAt,
      scope: {
        artifactType: "story-safety-plan",
        kind: "story",
        storyId: "story-1",
      },
    });

    expect(edited.nodes["story-safety-plan"]).toMatchObject({
      status: "manual",
      manualEdit: {
        scope: {
          kind: "story",
          storyId: "story-1",
        },
        staleNodeIds: [
          "resource-plan",
          "parameter-plan",
          "story-render-plan",
          "story-consistency-check",
          "generation-gate",
          "shot-graph-execution",
          "story-result-display",
        ],
        staleShotIds: [],
      },
    });
    expect(edited.nodes["resource-plan"].status).toBe("stale");
    expect(edited.nodes["plot-state-graph"].status).toBe("blocked");
    expect(edited.generationConfirmed).toBe(false);
  });

  it("records shot-scoped dependency edits without staling unrelated shot branches", () => {
    const workflow = createStoryWorkflowState({ now, storyId: "story-1", workflowId: "story-workflow-1" });
    const graph = {
      storyId: "story-1",
      nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
      edges: [
        { fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" },
      ],
    } satisfies ShotDependencyGraph;

    const edited = setStoryNodeManualResult(workflow, "shot-dependency-graph", graph, {
      now: editedAt,
      scope: {
        artifactType: "shot-dependency-graph",
        kind: "shot",
        shotId: "shot-1",
        storyId: "story-1",
      },
    });

    expect(edited.nodes["shot-dependency-graph"].manualEdit).toMatchObject({
      scope: {
        kind: "shot",
        shotId: "shot-1",
        storyId: "story-1",
      },
      staleShotIds: ["shot-2"],
    });
    expect(edited.nodes["shot-dependency-graph"].manualEdit?.staleShotIds).not.toContain("shot-3");
    expect(edited.nodes["story-consistency-check"].status).toBe("stale");
    expect(edited.nodes["story-safety-plan"].status).toBe("blocked");
  });

  it("tracks only transitive downstream shot ids for the edited dependency scope", () => {
    const workflow = createStoryWorkflowState({ now, storyId: "story-1", workflowId: "story-workflow-1" });
    const graph = {
      storyId: "story-1",
      nodes: [
        { shotId: "shot-1", label: "Arrival" },
        { shotId: "shot-2", label: "Signal" },
        { shotId: "shot-3", label: "Unrelated cutaway" },
        { shotId: "shot-4", label: "Aftermath" },
      ],
      edges: [
        { fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" },
        { fromShotId: "shot-2", toShotId: "shot-4", reason: "continuity" },
      ],
    } satisfies ShotDependencyGraph;

    const edited = setStoryNodeManualResult(workflow, "shot-dependency-graph", graph, {
      now: editedAt,
      scope: {
        artifactType: "shot-dependency-graph",
        kind: "shot",
        shotId: "shot-1",
        storyId: "story-1",
      },
    });

    expect(edited.nodes["shot-dependency-graph"].manualEdit?.staleShotIds).toEqual([
      "shot-2",
      "shot-4",
    ]);
    expect(edited.nodes["shot-dependency-graph"].manualEdit?.staleShotIds).not.toContain("shot-3");
  });

  it("marks entity-card edits stale through render, consistency, and generation gate nodes", () => {
    const workflow = createStoryWorkflowState({ now, storyId: "story-1", workflowId: "story-workflow-1" });
    const entityCards = {
      storyId: "story-1",
      characters: [
        {
          id: "hero",
          name: "Hero",
          role: "Lead",
          description: "A focused traveler.",
          continuityNotes: [],
          outfitIds: ["hero-default-outfit"],
          propIds: [],
          shotIds: ["shot-1"],
          visualAnchors: ["red scarf"],
        },
      ],
      outfits: [
        {
          id: "hero-default-outfit",
          characterId: "hero",
          name: "Default outfit",
          description: "Red scarf and dark coat.",
          continuityNotes: [],
          shotIds: ["shot-1"],
          visualAnchors: ["red scarf"],
        },
      ],
      props: [],
      locations: [],
      planningErrors: [],
    } satisfies StoryEntityCards;

    const edited = setStoryNodeManualResult(workflow, "entity-cards", entityCards, {
      now: editedAt,
      scope: {
        artifactType: "entity-cards",
        kind: "story",
        storyId: "story-1",
      },
    });

    expect(edited.nodes["entity-cards"].manualEdit).toMatchObject({
      staleNodeIds: expect.arrayContaining([
        "story-render-plan",
        "story-consistency-check",
        "generation-gate",
        "shot-graph-execution",
        "story-result-display",
      ]),
      staleShotIds: [],
    });
    expect(edited.nodes["story-render-plan"].status).toBe("stale");
    expect(edited.nodes["story-consistency-check"].status).toBe("stale");
    expect(edited.nodes["generation-gate"].status).toBe("stale");
    expect(edited.generationConfirmed).toBe(false);
  });
});
