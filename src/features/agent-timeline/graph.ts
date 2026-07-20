import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

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
import { getTimelineWorkflowDefinition } from "./workflow-definitions";
import type {
  TimelineExecutableNodeId,
  TimelineNodeAdapterResult,
  TimelineNodeAdapters,
  TimelineNodeId,
  TimelineNodeMap,
  TimelineWorkflowState,
} from "./types";

export type TimelineWorkflowUpdate = Partial<Omit<TimelineWorkflowState, "nodes">> & {
  nodes?: Partial<TimelineNodeMap>;
};

type TimelineGraphState = {
  workflow: TimelineWorkflowState;
};

type TimelineGraphOptions = {
  now?: () => string;
  onWorkflowUpdate?: (update: TimelineWorkflowUpdate) => void;
  executableNodeIds?: readonly TimelineExecutableNodeId[];
};

type TimelineGraphNodeHandler = ReturnType<typeof createTimelineGraphNode>;

type DynamicTimelineGraphBuilder = {
  addNode(nodeId: TimelineExecutableNodeId, action: TimelineGraphNodeHandler): DynamicTimelineGraphBuilder;
  addEdge(
    startKey: typeof START | TimelineNodeId | TimelineNodeId[],
    endKey: TimelineNodeId | typeof END,
  ): DynamicTimelineGraphBuilder;
  compile(): {
    invoke(input: TimelineGraphState): Promise<TimelineGraphState>;
  };
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
    if (options.executableNodeIds && !options.executableNodeIds.includes(nodeId)) {
      return {};
    }
    const refreshedWorkflow = refreshTimelineReadiness(state.workflow);
    const definition = getTimelineWorkflowDefinition(refreshedWorkflow.workflowMode);

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
    options.onWorkflowUpdate?.(getNodeOnlyWorkflowUpdate(runningWorkflow, nodeId));

    try {
      const adapterResult = normalizeAdapterResult(
        await adapter({
          nodeId,
          workflow: runningWorkflow,
          dependencies: definition.dependencyDag[nodeId].map((dependencyId) => runningWorkflow.nodes[dependencyId]),
        }),
      );
      const completedWorkflow = completeTimelineNode(
        runningWorkflow,
        nodeId,
        adapterResult.value,
        adapterResult.source ?? "ai",
        options,
      );
      options.onWorkflowUpdate?.(getNodeOnlyWorkflowUpdate(completedWorkflow, nodeId));

      return {
        workflow: getNodeOnlyWorkflowUpdate(completedWorkflow, nodeId),
      };
    } catch (error) {
      const failedWorkflow = failTimelineNode(runningWorkflow, nodeId, error, options);
      options.onWorkflowUpdate?.(getNodeOnlyWorkflowUpdate(failedWorkflow, nodeId));

      return {
        workflow: getNodeOnlyWorkflowUpdate(failedWorkflow, nodeId),
      };
    }
  };
}

export function createTimelineLangGraph(adapters: TimelineNodeAdapters, options: TimelineGraphOptions = {}) {
  const definition = getTimelineWorkflowDefinition();
  // LangGraph's builder type accumulates literal node names across chained calls,
  // but this workflow intentionally registers nodes from a runtime definition.
  let graph = new StateGraph(TimelineGraphAnnotation) as unknown as DynamicTimelineGraphBuilder;
  const executableAdapters = definition.adapterFactory(adapters);

  for (const nodeId of definition.executableNodeIds) {
    graph = graph.addNode(nodeId, createTimelineGraphNode(nodeId, executableAdapters, options));
  }

  for (const nodeId of definition.nodeIds) {
    const dependencies = definition.dependencyDag[nodeId];

    if (dependencies.length === 0) {
      graph = graph.addEdge(START, nodeId);
      continue;
    }

    graph = graph.addEdge(dependencies.length === 1 ? dependencies[0] : [...dependencies], nodeId);
  }

  const terminalNodeIds = definition.nodeIds.filter((nodeId) =>
    definition.nodeIds.every((candidateId) => !definition.dependencyDag[candidateId].includes(nodeId)),
  );

  for (const terminalNodeId of terminalNodeIds) {
    graph = graph.addEdge(terminalNodeId, END);
  }

  return graph.compile();
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
