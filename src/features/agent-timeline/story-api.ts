import {
  createStoryExecutionRequestBatch,
  type StoryResourcePlan,
  type StoryRenderPlan,
} from "./story-planning";
import {
  executeStoryShotGraph,
  markStoryShotAndDownstreamStale,
  type StoryShotExecutionAdapter,
  type StoryShotGraphExecutionState,
} from "./story-execution";
import {
  completeStoryNode,
  confirmStoryGeneration,
  markStoryNodeRunning,
  refreshStoryWorkflowReadiness,
  type StoryWorkflowState,
} from "./story-state";
import {
  createStoryConsistencyCheckFromWorkflow,
  getStoryRenderPlanFromWorkflow,
  isStoryResourcePlanExecutable,
} from "./story-llm-adapters";
import { storyGraphWorkflowMode, storyWorkflowDefinition } from "./story-workflow";
import type { StoryShotId } from "./story-types";

export type StoryResultDisplay = {
  errors: StoryShotGraphExecutionState["errors"];
  finalReferences: NonNullable<StoryShotGraphExecutionState["shots"][number]["resultReference"]>[];
  nsfwContext: StoryRenderPlan["nsfwContext"];
  previewReferences: [];
  status: "pending" | "complete" | "partial" | "error";
  storyId: string;
  updatedAt?: string;
};

export class StoryApiValidationError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "StoryApiValidationError";
    this.status = status;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeStoryWorkflowState(value: unknown): StoryWorkflowState | null {
  if (!isRecord(value) || value.workflowMode !== storyGraphWorkflowMode) {
    return null;
  }

  if (
    typeof value.workflowId !== "string" ||
    typeof value.storyId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.generationConfirmed !== "boolean" ||
    !isRecord(value.nodes)
  ) {
    return null;
  }

  const nodes: Record<string, unknown> = {};
  for (const nodeId of storyWorkflowDefinition.nodeIds) {
    const node = value.nodes[nodeId];
    if (!isRecord(node) || node.nodeId !== nodeId || typeof node.status !== "string" || typeof node.updatedAt !== "string") {
      return null;
    }

    nodes[nodeId] = node;
  }

  return refreshStoryWorkflowReadiness({
    workflowId: value.workflowId,
    workflowMode: storyGraphWorkflowMode,
    storyId: value.storyId,
    nodes: nodes as StoryWorkflowState["nodes"],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    generationConfirmed: value.generationConfirmed,
  });
}

function getSubmittedExecutionStateForRegeneration(workflow: StoryWorkflowState): StoryShotGraphExecutionState | undefined {
  const execution = workflow.nodes["shot-graph-execution"].result;
  return isRecord(execution) && Array.isArray(execution.shots)
    ? execution as StoryShotGraphExecutionState
    : undefined;
}

function assertGateReady(workflow: StoryWorkflowState): {
  renderPlan: StoryRenderPlan;
  resourcePlan: StoryResourcePlan;
} {
  if (workflow.workflowMode !== storyGraphWorkflowMode) {
    throw new StoryApiValidationError("Story generation requires workflowMode story-graph.");
  }

  const gate = workflow.nodes["generation-gate"];
  const gateResult = gate.result;
  const renderPlan = getStoryRenderPlanFromWorkflow(workflow);
  const consistency = createStoryConsistencyCheckFromWorkflow(workflow, () => workflow.updatedAt);

  if (!isRecord(gateResult) || gateResult.ready !== true || gate.status !== "done") {
    throw new StoryApiValidationError("Story generation gate is not ready.", 400, {
      gateStatus: gate.status,
      gateResult,
    });
  }

  if (!consistency.passed) {
    throw new StoryApiValidationError("Story consistency checks must pass before generation.", 400, {
      issues: consistency.issues,
    });
  }

  const resourcePlan = workflow.nodes["resource-plan"].result;
  if (!isRecord(resourcePlan) || !isStoryResourcePlanExecutable(resourcePlan as StoryResourcePlan)) {
    throw new StoryApiValidationError("Story resource plan is not executable.", 400);
  }

  if (renderPlan.shots.length === 0) {
    throw new StoryApiValidationError("Story render plan does not contain any shots.", 400);
  }

  return {
    renderPlan,
    resourcePlan: resourcePlan as StoryResourcePlan,
  };
}

function createStoryResultDisplayFromExecution({
  execution,
  renderPlan,
}: {
  execution: StoryShotGraphExecutionState;
  renderPlan: StoryRenderPlan;
}): StoryResultDisplay {
  const finalReferences = execution.shots.flatMap((shot) => (shot.resultReference ? [shot.resultReference] : []));
  const status = execution.status === "done"
    ? "complete"
    : finalReferences.length > 0
      ? "partial"
      : "error";

  return {
    errors: execution.errors,
    finalReferences,
    nsfwContext: renderPlan.nsfwContext,
    previewReferences: [],
    status,
    storyId: renderPlan.storyId,
    updatedAt: execution.updatedAt,
  };
}

export async function confirmAndExecuteStoryGeneration({
  executeShot,
  now,
  workflow,
}: {
  executeShot: StoryShotExecutionAdapter;
  now?: () => string;
  workflow: StoryWorkflowState;
}) {
  const { renderPlan, resourcePlan } = assertGateReady(workflow);
  const batch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });
  let nextWorkflow = confirmStoryGeneration(workflow, { now });
  nextWorkflow = markStoryNodeRunning(nextWorkflow, "shot-graph-execution", { now });
  // Confirmation starts a fresh server-side execution. The submitted workflow may
  // contain client-controlled execution results, so do not use them as sources.
  const execution = await executeStoryShotGraph(batch, executeShot, {
    now,
  });
  nextWorkflow = completeStoryNode(nextWorkflow, "shot-graph-execution", execution, "system", { now });
  nextWorkflow = completeStoryNode(
    nextWorkflow,
    "story-result-display",
    createStoryResultDisplayFromExecution({ execution, renderPlan }),
    "system",
    { now },
  );

  return nextWorkflow;
}

export async function regenerateStoryShot({
  executeShot,
  now,
  shotId,
  workflow,
}: {
  executeShot: StoryShotExecutionAdapter;
  now?: () => string;
  shotId: StoryShotId;
  workflow: StoryWorkflowState;
}) {
  const { renderPlan, resourcePlan } = assertGateReady(workflow);
  const batch = createStoryExecutionRequestBatch({ mode: "final", renderPlan, resourcePlan });
  const existingExecution = getSubmittedExecutionStateForRegeneration(workflow);
  if (!existingExecution) {
    throw new StoryApiValidationError("Story shot execution state is required before regenerating a shot.", 400);
  }

  const staleExecution = markStoryShotAndDownstreamStale({
    batch,
    now,
    selectedShotId: shotId,
    state: existingExecution,
  });
  let nextWorkflow = completeStoryNode(workflow, "shot-graph-execution", staleExecution, "system", { now });
  nextWorkflow = markStoryNodeRunning(nextWorkflow, "shot-graph-execution", { now });
  const execution = await executeStoryShotGraph(batch, executeShot, {
    initialState: staleExecution,
    now,
  });

  nextWorkflow = completeStoryNode(nextWorkflow, "shot-graph-execution", execution, "system", { now });
  nextWorkflow = completeStoryNode(
    nextWorkflow,
    "story-result-display",
    createStoryResultDisplayFromExecution({ execution, renderPlan }),
    "system",
    { now },
  );

  return nextWorkflow;
}
