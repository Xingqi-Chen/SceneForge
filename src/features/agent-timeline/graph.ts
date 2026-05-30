import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { getTimelineNodeDependencies } from "./dag";
import {
  areTimelineNodeDependenciesSatisfied,
  blockTimelineNode,
  canRunTimelineNode,
  completeTimelineNode,
  createTimelineNodeError,
  createTimelineWorkflowState,
  failTimelineNode,
  markTimelineNodeRunning,
  refreshTimelineReadiness,
} from "./state";
import type {
  TimelineExecutableNodeId,
  TimelineNodeAdapterResult,
  TimelineNodeAdapters,
  TimelineNodeMap,
  TimelineWorkflowState,
} from "./types";

type TimelineWorkflowUpdate = Partial<Omit<TimelineWorkflowState, "nodes">> & {
  nodes?: Partial<TimelineNodeMap>;
};

type TimelineGraphState = {
  workflow: TimelineWorkflowState;
};

type TimelineGraphOptions = {
  now?: () => string;
};

function mergeTimelineWorkflowUpdate(
  current: TimelineWorkflowState,
  update: TimelineWorkflowUpdate | TimelineWorkflowState,
): TimelineWorkflowState {
  return {
    ...current,
    ...update,
    nodes: {
      ...current.nodes,
      ...update.nodes,
    },
  };
}

const TimelineGraphAnnotation = Annotation.Root({
  workflow: Annotation<TimelineWorkflowState, TimelineWorkflowUpdate | TimelineWorkflowState>({
    reducer: mergeTimelineWorkflowUpdate,
    default: () => createTimelineWorkflowState(),
  }),
});

function getNodeOnlyWorkflowUpdate(
  workflow: TimelineWorkflowState,
  nodeId: TimelineExecutableNodeId,
): TimelineWorkflowUpdate {
  return {
    updatedAt: workflow.updatedAt,
    generationConfirmed: workflow.generationConfirmed,
    nodes: {
      [nodeId]: workflow.nodes[nodeId],
    },
  };
}

function hasAdapterValue(value: unknown): value is TimelineNodeAdapterResult {
  return typeof value === "object" && value !== null && "value" in value;
}

function normalizeAdapterResult(value: unknown): TimelineNodeAdapterResult {
  if (hasAdapterValue(value)) {
    return value;
  }

  return {
    value,
    source: "ai",
  };
}

function createTimelineGraphNode(
  nodeId: TimelineExecutableNodeId,
  adapters: TimelineNodeAdapters,
  options: TimelineGraphOptions,
) {
  return async (state: TimelineGraphState): Promise<{ workflow?: TimelineWorkflowUpdate }> => {
    const refreshedWorkflow = refreshTimelineReadiness(state.workflow);

    if (
      nodeId === "generation-gate" &&
      areTimelineNodeDependenciesSatisfied(refreshedWorkflow, nodeId) &&
      !refreshedWorkflow.generationConfirmed
    ) {
      const blockedWorkflow = blockTimelineNode(
        refreshedWorkflow,
        nodeId,
        createTimelineNodeError(
          "confirmation_required",
          "User confirmation is required before ComfyUI execution can start.",
        ),
        options,
      );

      return {
        workflow: getNodeOnlyWorkflowUpdate(blockedWorkflow, nodeId),
      };
    }

    if (!canRunTimelineNode(refreshedWorkflow, nodeId)) {
      return {};
    }

    const adapter = adapters[nodeId];

    if (!adapter) {
      const failedWorkflow = failTimelineNode(
        refreshedWorkflow,
        nodeId,
        createTimelineNodeError(
          "timeline_node_failed",
          `Timeline node "${nodeId}" does not have an executable adapter.`,
        ),
        options,
      );

      return {
        workflow: getNodeOnlyWorkflowUpdate(failedWorkflow, nodeId),
      };
    }

    const runningWorkflow = markTimelineNodeRunning(refreshedWorkflow, nodeId, options);

    try {
      const adapterResult = normalizeAdapterResult(
        await adapter({
          nodeId,
          workflow: runningWorkflow,
          dependencies: getTimelineNodeDependencies(nodeId).map((dependencyId) => runningWorkflow.nodes[dependencyId]),
        }),
      );
      const completedWorkflow = completeTimelineNode(
        runningWorkflow,
        nodeId,
        adapterResult.value,
        adapterResult.source ?? "ai",
        options,
      );

      return {
        workflow: getNodeOnlyWorkflowUpdate(completedWorkflow, nodeId),
      };
    } catch (error) {
      const failedWorkflow = failTimelineNode(runningWorkflow, nodeId, error, options);

      return {
        workflow: getNodeOnlyWorkflowUpdate(failedWorkflow, nodeId),
      };
    }
  };
}

export function createTimelineLangGraph(adapters: TimelineNodeAdapters, options: TimelineGraphOptions = {}) {
  return new StateGraph(TimelineGraphAnnotation)
    .addNode("scene-input", createTimelineGraphNode("scene-input", adapters, options))
    .addNode("scene-prompt", createTimelineGraphNode("scene-prompt", adapters, options))
    .addNode("character-tags", createTimelineGraphNode("character-tags", adapters, options))
    .addNode("character-action", createTimelineGraphNode("character-action", adapters, options))
    .addNode("canvas-binding", createTimelineGraphNode("canvas-binding", adapters, options))
    .addNode("resource-recommendation", createTimelineGraphNode("resource-recommendation", adapters, options))
    .addNode("parameter-recommendation", createTimelineGraphNode("parameter-recommendation", adapters, options))
    .addNode("generation-gate", createTimelineGraphNode("generation-gate", adapters, options))
    .addEdge(START, "scene-input")
    .addEdge("scene-input", "scene-prompt")
    .addEdge("scene-prompt", "character-tags")
    .addEdge("scene-prompt", "character-action")
    .addEdge(["scene-prompt", "character-tags", "character-action"], "canvas-binding")
    .addEdge(["scene-prompt", "character-tags", "character-action"], "resource-recommendation")
    .addEdge(["canvas-binding", "resource-recommendation"], "parameter-recommendation")
    .addEdge("parameter-recommendation", "generation-gate")
    .addEdge("generation-gate", END)
    .compile();
}

export async function executeTimelineGraph(
  workflow: TimelineWorkflowState,
  adapters: TimelineNodeAdapters,
  options: TimelineGraphOptions = {},
) {
  const graph = createTimelineLangGraph(adapters, options);
  const result = await graph.invoke({
    workflow,
  });

  return refreshTimelineReadiness(result.workflow);
}
