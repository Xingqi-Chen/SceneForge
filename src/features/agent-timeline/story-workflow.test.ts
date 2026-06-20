import { describe, expect, it } from "vitest";

import {
  areCommonWorkflowDependenciesSatisfied,
  refreshCommonWorkflowReadiness,
  type CommonWorkflowNodeMap,
} from "./workflow-definition";
import {
  storyWorkflowDefinition,
  validateShotDependencyGraph,
  validateStoryWorkflowDefinition,
} from "./story-workflow";
import {
  storyWorkflowNodeIds,
  type ShotDependencyGraph,
  type StoryShot,
  type StoryWorkflowNodeId,
} from "./story-types";
import { getTimelineWorkflowDefinition } from "./workflow-definitions";
import { timelineNodeIds } from "./types";

const updatedAt = "2026-06-14T00:00:00.000Z";

function createStoryNodeMap(): CommonWorkflowNodeMap<StoryWorkflowNodeId> {
  return Object.fromEntries(
    storyWorkflowNodeIds.map((nodeId) => [
      nodeId,
      {
        nodeId,
        status: nodeId === "story-input" ? "manual" : "blocked",
        result: nodeId === "story-input" ? { rawIntent: "three shots in a quiet station" } : undefined,
        source: nodeId === "story-input" ? "manual" : "system",
        updatedAt,
      },
    ]),
  ) as CommonWorkflowNodeMap<StoryWorkflowNodeId>;
}

const shots = [
  {
    id: "shot-1",
    storyId: "story-1",
    order: 1,
    title: "Arrival",
    description: "The protagonist enters the station.",
    characterIds: ["character-1"],
    sourceShotIds: [],
    camera: "wide shot",
    promptIntent: "quiet station arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId: "story-1",
    order: 2,
    title: "Signal",
    description: "The protagonist notices the signal.",
    characterIds: ["character-1"],
    sourceShotIds: ["shot-1"],
    camera: "medium shot",
    promptIntent: "signal reflection",
    continuityNotes: ["Keep the coat from shot-1."],
  },
] satisfies StoryShot[];

describe("story workflow definition", () => {
  it("defines the inactive Story Graph DAG with required predecessors", () => {
    expect(validateStoryWorkflowDefinition()).toEqual([]);
    expect(storyWorkflowDefinition.mode).toBe("story-graph");
    expect(storyWorkflowDefinition.nodeIds).toEqual(storyWorkflowNodeIds);
    expect(storyWorkflowDefinition.dependencyDag["story-bible"]).toEqual(["story-input"]);
    expect(storyWorkflowDefinition.dependencyDag["storyboard-shots"]).toEqual(["story-outline"]);
    expect(storyWorkflowDefinition.dependencyDag["shot-graph-execution"]).toEqual(["generation-gate"]);
    expect(storyWorkflowDefinition.dependencyDag["story-result-display"]).toEqual(["shot-graph-execution"]);
    expect(storyWorkflowDefinition.reservedNodeIds).toEqual([]);
  });

  it("uses shared readiness helpers for story node predecessors", () => {
    const refreshed = refreshCommonWorkflowReadiness({
      dag: storyWorkflowDefinition.dependencyDag,
      executableNodeIds: storyWorkflowDefinition.executableNodeIds,
      nodeIds: storyWorkflowDefinition.nodeIds,
      nodes: createStoryNodeMap(),
      reservedNodeIds: storyWorkflowDefinition.reservedNodeIds,
    });

    expect(refreshed["story-bible"].status).toBe("ready");
    expect(refreshed["story-outline"].status).toBe("blocked");
    expect(areCommonWorkflowDependenciesSatisfied(refreshed, "story-bible", storyWorkflowDefinition.dependencyDag)).toBe(
      true,
    );
    expect(
      areCommonWorkflowDependenciesSatisfied(refreshed, "story-outline", storyWorkflowDefinition.dependencyDag),
    ).toBe(false);
  });

  it("reports invalid story definitions when required predecessors are missing", () => {
    const invalidDefinition = {
      ...storyWorkflowDefinition,
      dependencyDag: {
        ...storyWorkflowDefinition.dependencyDag,
        "story-bible": [],
      },
    };

    expect(validateStoryWorkflowDefinition(invalidDefinition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "story-bible",
          message: 'Story workflow node "story-bible" must depend on "story-input".',
        }),
      ]),
    );
  });

  it("validates acyclic shot dependency graphs", () => {
    const graph = {
      storyId: "story-1",
      nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
      edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
    } satisfies ShotDependencyGraph;

    expect(validateShotDependencyGraph(graph, shots)).toEqual([]);
  });

  it("rejects shot dependency cycles", () => {
    const graph = {
      storyId: "story-1",
      nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
      edges: [
        { fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" },
        { fromShotId: "shot-2", toShotId: "shot-1", reason: "continuity" },
      ],
    } satisfies ShotDependencyGraph;

    expect(validateShotDependencyGraph(graph, shots)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Shot dependency graph contains a cycle.",
        }),
      ]),
    );
  });

  it("rejects invalid source shot references", () => {
    const graph = {
      storyId: "story-1",
      nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
      edges: [{ fromShotId: "shot-missing", toShotId: "shot-2", reason: "reference" }],
    } satisfies ShotDependencyGraph;
    const invalidShots = [
      shots[0],
      {
        ...shots[1],
        sourceShotIds: ["shot-missing"],
      },
    ] satisfies StoryShot[];

    expect(validateShotDependencyGraph(graph, invalidShots)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shotId: "shot-2",
          message: 'Shot "shot-2" references unknown source shot "shot-missing".',
        }),
        expect.objectContaining({
          shotId: "shot-missing",
          message: 'Shot dependency graph contains unknown source shot "shot-missing".',
        }),
      ]),
    );
  });

  it("keeps the active timeline definition on single-image nodes", () => {
    expect(getTimelineWorkflowDefinition().mode).toBe("single-image");
    expect(getTimelineWorkflowDefinition().nodeIds).toEqual(timelineNodeIds);
  });
});
