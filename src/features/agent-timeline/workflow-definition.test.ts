import { describe, expect, it } from "vitest";

import {
  areCommonWorkflowDependenciesSatisfied,
  buildCommonWorkflowDependencyDag,
  canRunCommonWorkflowNode,
  getCommonWorkflowDownstreamClosure,
  normalizeCommonWorkflowAdapterResult,
  refreshCommonWorkflowReadiness,
  setCommonWorkflowNodeManualResult,
  validateCommonWorkflowDependencyDag,
  type CommonWorkflowArtifact,
  type CommonWorkflowNodeMap,
} from "./workflow-definition";
import { singleImageWorkflowDefinition } from "./workflow-definitions";
import { timelineNodeIds } from "./types";

const nodeIds = ["input", "branch-a", "branch-b", "join", "result"] as const;
type TestNodeId = (typeof nodeIds)[number];

function createNodeMap(): CommonWorkflowNodeMap<TestNodeId> {
  return {
    input: {
      nodeId: "input",
      status: "manual",
      result: "seed",
      source: "manual",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
    "branch-a": {
      nodeId: "branch-a",
      status: "blocked",
      source: "system",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
    "branch-b": {
      nodeId: "branch-b",
      status: "blocked",
      source: "system",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
    join: {
      nodeId: "join",
      status: "blocked",
      source: "system",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
    result: {
      nodeId: "result",
      status: "blocked",
      source: "system",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
  };
}

describe("common workflow definitions", () => {
  it("validates dependency DAGs and derives readiness from completed predecessors", () => {
    const dag = buildCommonWorkflowDependencyDag(nodeIds, [
      { from: "input", to: "branch-a" },
      { from: "input", to: "branch-b" },
      { from: "branch-a", to: "join" },
      { from: "branch-b", to: "join" },
      { from: "join", to: "result" },
    ]);
    const refreshed = refreshCommonWorkflowReadiness({
      dag,
      executableNodeIds: nodeIds,
      nodeIds,
      nodes: createNodeMap(),
    });

    expect(validateCommonWorkflowDependencyDag(nodeIds, dag)).toEqual([]);
    expect(refreshed["branch-a"].status).toBe("ready");
    expect(refreshed["branch-b"].status).toBe("ready");
    expect(refreshed.join.status).toBe("blocked");
    expect(canRunCommonWorkflowNode({
      dag,
      executableNodeIds: nodeIds,
      nodeId: "branch-a",
      nodes: refreshed,
    })).toBe(true);
    expect(areCommonWorkflowDependenciesSatisfied(refreshed, "join", dag)).toBe(false);
  });

  it("does not auto-run errored nodes", () => {
    const dag = buildCommonWorkflowDependencyDag(nodeIds, [
      { from: "input", to: "branch-a" },
    ]);
    const nodes: CommonWorkflowNodeMap<TestNodeId> = {
      ...createNodeMap(),
      "branch-a": {
        nodeId: "branch-a",
        status: "error",
        source: "system",
        updatedAt: "2026-06-14T00:00:01.000Z",
        error: {
          code: "timeline_node_failed",
          message: "Adapter failed.",
        },
      },
    };

    expect(canRunCommonWorkflowNode({
      dag,
      executableNodeIds: nodeIds,
      nodeId: "branch-a",
      nodes,
    })).toBe(false);
  });

  it("marks manual edits and downstream stale nodes while preserving unrelated branches", () => {
    const dag = buildCommonWorkflowDependencyDag(nodeIds, [
      { from: "input", to: "branch-a" },
      { from: "input", to: "branch-b" },
      { from: "branch-a", to: "join" },
      { from: "branch-b", to: "join" },
      { from: "join", to: "result" },
    ]);
    const nodes: CommonWorkflowNodeMap<TestNodeId> = {
      ...createNodeMap(),
      "branch-a": {
        nodeId: "branch-a",
        status: "done",
        result: { value: "old-a" },
        source: "ai",
        updatedAt: "2026-06-14T00:00:01.000Z",
      },
      "branch-b": {
        nodeId: "branch-b",
        status: "done",
        result: { value: "old-b" },
        source: "ai",
        updatedAt: "2026-06-14T00:00:01.000Z",
      },
      join: {
        nodeId: "join",
        status: "done",
        result: { value: "joined" },
        source: "ai",
        updatedAt: "2026-06-14T00:00:02.000Z",
      },
      result: {
        nodeId: "result",
        status: "done",
        result: { value: "result" },
        source: "ai",
        updatedAt: "2026-06-14T00:00:03.000Z",
      },
    };

    const edited = setCommonWorkflowNodeManualResult({
      dag,
      nodeId: "branch-a",
      nodeIds,
      nodes,
      result: { value: "manual-a" },
      updatedAt: "2026-06-14T00:00:04.000Z",
    });

    expect(getCommonWorkflowDownstreamClosure("branch-a", nodeIds, dag)).toEqual(["join", "result"]);
    expect(edited.staleNodeIds).toEqual(["join", "result"]);
    expect(edited.nodes["branch-a"]).toMatchObject({
      status: "manual",
      result: { value: "manual-a" },
      manualEdit: {
        staleNodeIds: ["join", "result"],
      },
    });
    expect(edited.nodes["branch-b"]).toMatchObject({
      status: "done",
      result: { value: "old-b" },
    });
    expect(edited.nodes.join.status).toBe("stale");
    expect(edited.nodes.result.status).toBe("stale");
  });

  it("normalizes adapter results for single and shot-scoped artifacts", () => {
    const shotArtifact: CommonWorkflowArtifact<{ prompt: string }> = {
      artifactType: "shot-prompt",
      scope: {
        kind: "shot",
        storyId: "story-1",
        shotId: "shot-1",
      },
      value: {
        prompt: "wide shot",
      },
    };

    expect(normalizeCommonWorkflowAdapterResult({ prompt: "single artifact" })).toEqual({
      source: "ai",
      value: { prompt: "single artifact" },
    });
    expect(normalizeCommonWorkflowAdapterResult({ value: "plain domain value" })).toEqual({
      source: "ai",
      value: { value: "plain domain value" },
    });
    expect(normalizeCommonWorkflowAdapterResult({
      value: { summary: "story plan" },
      source: "system",
      artifacts: [shotArtifact],
    })).toEqual({
      value: { summary: "story plan" },
      source: "system",
      artifacts: [shotArtifact],
    });
  });

  it("exposes single-image node metadata for definition-driven runtime orchestration", () => {
    expect(singleImageWorkflowDefinition.mode).toBe("single-image");
    expect(singleImageWorkflowDefinition.version).toBe(2);
    expect(singleImageWorkflowDefinition.nodeIds).toEqual(timelineNodeIds);
    expect(singleImageWorkflowDefinition.dependencyDag["generation-gate"]).toEqual([
      "scene-prompt",
      "character-tags",
      "character-action",
      "canvas-binding",
      "resource-recommendation",
      "parameter-recommendation",
    ]);
    expect(singleImageWorkflowDefinition.dependencyDag["preview-execution"]).toEqual(["generation-gate"]);
    expect(singleImageWorkflowDefinition.dependencyDag["preview-scoring"]).toEqual(["preview-execution"]);
    expect(singleImageWorkflowDefinition.dependencyDag["comfyui-execution"]).toEqual(["preview-scoring"]);
    expect(singleImageWorkflowDefinition.adapterFactory({
      "scene-prompt": () => ({ prompt: "adapter" }),
    })["scene-prompt"]).toBeDefined();
    expect(singleImageWorkflowDefinition.metadata["resource-recommendation"]).toMatchObject({
      workspace: {
        key: "resource-recommendation",
        scope: "workflow",
      },
      rawJson: {
        enabled: true,
      },
      aiRetry: {
        enabled: true,
        label: "Suggest resources",
      },
      manualEdit: {
        enabled: true,
        inputKind: "visual",
        marksDownstreamStale: true,
      },
    });
  });
});
