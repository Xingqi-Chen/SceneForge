export const commonWorkflowDefinitionVersion = 1;

export type CommonWorkflowDefinitionVersion = 1 | 2 | 3;

export type CommonWorkflowMode = "single-image" | "story-graph";

export const commonWorkflowNodeStatuses = [
  "blocked",
  "ready",
  "running",
  "done",
  "stale",
  "error",
  "manual",
] as const;

export type CommonWorkflowNodeStatus = (typeof commonWorkflowNodeStatuses)[number];

export type CommonWorkflowNodeSource = "ai" | "manual" | "system";

export type CommonWorkflowNodeError<TCode extends string = string> = {
  code: TCode;
  message: string;
  details?: unknown;
};

export type CommonWorkflowManualEditState = {
  editedAt: string;
  staleNodeIds: string[];
};

export type CommonWorkflowNodeResult<
  TNodeId extends string = string,
  TResult = unknown,
  TErrorCode extends string = string,
> = {
  nodeId: TNodeId;
  status: CommonWorkflowNodeStatus;
  result?: TResult;
  error?: CommonWorkflowNodeError<TErrorCode>;
  updatedAt: string;
  source: CommonWorkflowNodeSource;
  manualEdit?: CommonWorkflowManualEditState;
};

export type CommonWorkflowNodeMap<TNodeId extends string = string> = Record<
  TNodeId,
  CommonWorkflowNodeResult<TNodeId>
>;

export type CommonWorkflowArtifactScope =
  | {
      kind: "workflow";
    }
  | {
      kind: "story";
      storyId?: string;
    }
  | {
      kind: "shot";
      shotId: string;
      storyId?: string;
    };

export type CommonWorkflowArtifact<TValue = unknown> = {
  artifactType: string;
  scope: CommonWorkflowArtifactScope;
  value: TValue;
};

export type CommonWorkflowNodeAdapterResult<
  TValue = unknown,
  TArtifactValue = unknown,
> =
  | {
      value: TValue;
      source: CommonWorkflowNodeSource;
      artifacts?: CommonWorkflowArtifact<TArtifactValue>[];
    }
  | {
      value: TValue;
      source?: CommonWorkflowNodeSource;
      artifacts: CommonWorkflowArtifact<TArtifactValue>[];
    };

export type CommonWorkflowNodeExecutionContext<
  TNodeId extends string = string,
  TWorkflowState = unknown,
> = {
  nodeId: TNodeId;
  workflow: TWorkflowState;
  dependencies: CommonWorkflowNodeResult<TNodeId>[];
  artifactScope?: CommonWorkflowArtifactScope;
};

export type CommonWorkflowNodeAdapter<
  TNodeId extends string = string,
  TWorkflowState = unknown,
  TValue = unknown,
  TArtifactValue = unknown,
> = (
  context: CommonWorkflowNodeExecutionContext<TNodeId, TWorkflowState>,
) =>
  | Promise<CommonWorkflowNodeAdapterResult<TValue, TArtifactValue> | TValue>
  | CommonWorkflowNodeAdapterResult<TValue, TArtifactValue>
  | TValue;

export type CommonWorkspaceRoute = {
  key: string;
  scope?: CommonWorkflowArtifactScope["kind"];
};

export type CommonRawJsonDisplayContract = {
  enabled: boolean;
  label?: string;
};

export type CommonAiRetryAffordance = {
  enabled: boolean;
  label: string;
  retryableStatuses?: CommonWorkflowNodeStatus[];
};

export type CommonManualEditContract = {
  enabled: boolean;
  label: string;
  inputKind: "text" | "json" | "visual" | "custom";
  marksDownstreamStale: boolean;
};

export type CommonWorkflowNodeMetadata<TNodeId extends string = string> = {
  nodeId: TNodeId;
  title: string;
  description?: string;
  workspace: CommonWorkspaceRoute;
  rawJson: CommonRawJsonDisplayContract;
  aiRetry: CommonAiRetryAffordance;
  manualEdit: CommonManualEditContract;
};

export type CommonWorkflowDagEdge<TNodeId extends string = string> = {
  from: TNodeId;
  to: TNodeId;
};

export type CommonWorkflowDependencyDag<TNodeId extends string = string> = Record<TNodeId, readonly TNodeId[]>;

export type CommonWorkflowDefinition<TNodeId extends string = string> = {
  mode: CommonWorkflowMode;
  version: CommonWorkflowDefinitionVersion;
  nodeIds: readonly TNodeId[];
  executableNodeIds: readonly TNodeId[];
  reservedNodeIds: readonly TNodeId[];
  metadata: Record<TNodeId, CommonWorkflowNodeMetadata<TNodeId>>;
  dependencyDag: CommonWorkflowDependencyDag<TNodeId>;
  adapterFactory?: unknown;
};

export type CommonWorkflowDagValidationIssue<TNodeId extends string = string> = {
  nodeId?: TNodeId;
  message: string;
};

const completeDependencyStatuses = new Set<CommonWorkflowNodeStatus>(["done", "manual"]);
const runnableNodeStatuses = new Set<CommonWorkflowNodeStatus>(["ready", "stale"]);

export function buildCommonWorkflowDependencyDag<TNodeId extends string>(
  nodeIds: readonly TNodeId[],
  edges: readonly CommonWorkflowDagEdge<TNodeId>[],
): CommonWorkflowDependencyDag<TNodeId> {
  const dependencies = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, [] as TNodeId[]])) as Record<
    TNodeId,
    TNodeId[]
  >;

  for (const edge of edges) {
    dependencies[edge.to]?.push(edge.from);
  }

  return dependencies;
}

export function getCommonWorkflowNodeDependencies<TNodeId extends string>(
  nodeId: TNodeId,
  dag: CommonWorkflowDependencyDag<TNodeId>,
) {
  return dag[nodeId] ?? [];
}

export function getCommonWorkflowDependentNodeIds<TNodeId extends string>(
  nodeId: TNodeId,
  nodeIds: readonly TNodeId[],
  dag: CommonWorkflowDependencyDag<TNodeId>,
) {
  return nodeIds.filter((candidateId) => getCommonWorkflowNodeDependencies(candidateId, dag).includes(nodeId));
}

export function getCommonWorkflowDownstreamClosure<TNodeId extends string>(
  nodeId: TNodeId,
  nodeIds: readonly TNodeId[],
  dag: CommonWorkflowDependencyDag<TNodeId>,
) {
  const visited = new Set<TNodeId>();
  const queue = [...getCommonWorkflowDependentNodeIds(nodeId, nodeIds, dag)];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    queue.push(...getCommonWorkflowDependentNodeIds(current, nodeIds, dag));
  }

  return nodeIds.filter((candidateId) => visited.has(candidateId));
}

function visitCommonDagForCycles<TNodeId extends string>(
  nodeId: TNodeId,
  dag: CommonWorkflowDependencyDag<TNodeId>,
  visiting: Set<TNodeId>,
  visited: Set<TNodeId>,
  issues: CommonWorkflowDagValidationIssue<TNodeId>[],
) {
  if (visited.has(nodeId)) {
    return;
  }

  if (visiting.has(nodeId)) {
    issues.push({ nodeId, message: "Workflow dependency DAG contains a cycle." });
    return;
  }

  visiting.add(nodeId);

  for (const dependencyId of getCommonWorkflowNodeDependencies(nodeId, dag)) {
    visitCommonDagForCycles(dependencyId, dag, visiting, visited, issues);
  }

  visiting.delete(nodeId);
  visited.add(nodeId);
}

export function validateCommonWorkflowDependencyDag<TNodeId extends string>(
  nodeIds: readonly TNodeId[],
  dag: CommonWorkflowDependencyDag<TNodeId>,
) {
  const issues: CommonWorkflowDagValidationIssue<TNodeId>[] = [];
  const nodeIdSet = new Set<TNodeId>(nodeIds);
  const dagNodeIds = Object.keys(dag) as TNodeId[];

  for (const nodeId of nodeIds) {
    if (!dagNodeIds.includes(nodeId)) {
      issues.push({ nodeId, message: "Workflow dependency DAG is missing a node." });
    }
  }

  for (const nodeId of dagNodeIds) {
    if (!nodeIdSet.has(nodeId)) {
      issues.push({ nodeId, message: `Workflow dependency DAG contains unknown node "${nodeId}".` });
      continue;
    }

    for (const dependencyId of getCommonWorkflowNodeDependencies(nodeId, dag)) {
      if (!nodeIdSet.has(dependencyId)) {
        issues.push({ nodeId, message: `Workflow dependency DAG contains unknown dependency "${dependencyId}".` });
      }

      if (dependencyId === nodeId) {
        issues.push({ nodeId, message: "Workflow dependency DAG contains a self-dependency." });
      }
    }
  }

  const visiting = new Set<TNodeId>();
  const visited = new Set<TNodeId>();

  for (const nodeId of nodeIds) {
    visitCommonDagForCycles(nodeId, dag, visiting, visited, issues);
  }

  return issues;
}

export function areCommonWorkflowDependenciesSatisfied<TNodeId extends string>(
  nodes: CommonWorkflowNodeMap<TNodeId>,
  nodeId: TNodeId,
  dag: CommonWorkflowDependencyDag<TNodeId>,
) {
  return getCommonWorkflowNodeDependencies(nodeId, dag).every((dependencyId) =>
    completeDependencyStatuses.has(nodes[dependencyId].status),
  );
}

export function canRunCommonWorkflowNode<TNodeId extends string>({
  dag,
  executableNodeIds,
  nodeId,
  nodes,
  reservedNodeIds = [],
}: {
  dag: CommonWorkflowDependencyDag<TNodeId>;
  executableNodeIds: readonly TNodeId[];
  nodeId: TNodeId;
  nodes: CommonWorkflowNodeMap<TNodeId>;
  reservedNodeIds?: readonly TNodeId[];
}) {
  if (!executableNodeIds.includes(nodeId) || reservedNodeIds.includes(nodeId)) {
    return false;
  }

  if (!areCommonWorkflowDependenciesSatisfied(nodes, nodeId, dag)) {
    return false;
  }

  return runnableNodeStatuses.has(nodes[nodeId].status);
}

export function refreshCommonWorkflowReadiness<TNodeId extends string>({
  dag,
  executableNodeIds,
  nodeIds,
  nodes,
  reservedNodeIds = [],
}: {
  dag: CommonWorkflowDependencyDag<TNodeId>;
  executableNodeIds: readonly TNodeId[];
  nodeIds: readonly TNodeId[];
  nodes: CommonWorkflowNodeMap<TNodeId>;
  reservedNodeIds?: readonly TNodeId[];
}) {
  const nextNodes = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, { ...nodes[nodeId] }])) as CommonWorkflowNodeMap<
    TNodeId
  >;
  let changed = false;

  for (const nodeId of nodeIds) {
    const node = nextNodes[nodeId];

    if (node.status === "done" || node.status === "manual" || node.status === "running" || node.status === "error") {
      continue;
    }

    if (node.status === "stale") {
      continue;
    }

    const nextStatus =
      areCommonWorkflowDependenciesSatisfied(nextNodes, nodeId, dag) &&
      executableNodeIds.includes(nodeId) &&
      !reservedNodeIds.includes(nodeId)
        ? "ready"
        : "blocked";

    if (node.status !== nextStatus) {
      nextNodes[nodeId] = {
        ...node,
        status: nextStatus,
        error: nextStatus === "ready" ? undefined : node.error,
      };
      changed = true;
    }
  }

  return changed ? nextNodes : nodes;
}

export function setCommonWorkflowNodeManualResult<TNodeId extends string, TResult>({
  dag,
  nodeId,
  nodeIds,
  nodes,
  result,
  updatedAt,
  trackManualEdit = true,
}: {
  dag: CommonWorkflowDependencyDag<TNodeId>;
  nodeId: TNodeId;
  nodeIds: readonly TNodeId[];
  nodes: CommonWorkflowNodeMap<TNodeId>;
  result: TResult;
  updatedAt: string;
  trackManualEdit?: boolean;
}) {
  const nextNodes = Object.fromEntries(nodeIds.map((candidateId) => [candidateId, { ...nodes[candidateId] }])) as CommonWorkflowNodeMap<
    TNodeId
  >;
  const staleNodeIds = getCommonWorkflowDownstreamClosure(nodeId, nodeIds, dag);

  nextNodes[nodeId] = {
    nodeId,
    status: "manual",
    result,
    source: "manual",
    updatedAt,
    ...(trackManualEdit
      ? {
          manualEdit: {
            editedAt: updatedAt,
            staleNodeIds,
          },
        }
      : {}),
  };

  for (const downstreamNodeId of staleNodeIds) {
    const downstreamNode = nextNodes[downstreamNodeId];
    nextNodes[downstreamNodeId] = {
      ...downstreamNode,
      status: "stale",
      error: undefined,
      updatedAt,
    };
  }

  return {
    nodes: nextNodes,
    staleNodeIds,
  };
}

export function hasCommonWorkflowAdapterValue(value: unknown): value is CommonWorkflowNodeAdapterResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    ("source" in value || "artifacts" in value)
  );
}

export function normalizeCommonWorkflowAdapterResult(value: unknown): CommonWorkflowNodeAdapterResult {
  if (hasCommonWorkflowAdapterValue(value)) {
    return value;
  }

  return {
    value,
    source: "ai",
  };
}
