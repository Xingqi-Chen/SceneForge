import {
  createStoryGenerationRequestPreview,
  createStoryExecutionRequestBatch,
  getStoryRenderPlanEligibleSourceShotIds,
  type StoryParameterPlan,
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
  setStoryNodeManualResult,
  type StoryWorkflowState,
} from "./story-state";
import {
  createStoryConsistencyCheckFromWorkflow,
  getStoryReferenceAssetPlanFromWorkflow,
  getStoryRenderPlanFromWorkflow,
  isStoryResourcePlanExecutable,
} from "./story-llm-adapters";
import type { StoryGenerationGatePreview } from "./story-input";
import {
  applyStoryReferenceApproval,
  applyStoryReferenceCanonicalPromptEdit,
  applyStoryReferenceGenerationFailure,
  applyStoryReferenceGenerationSuccess,
  applyStoryReferencePromptOnlyFallback,
  applyStoryReferenceRejection,
  applyStoryReferenceUpload,
  evaluateStoryReferenceAssetFreezeGate,
} from "./story-reference-assets";
import type {
  StoryReferencePlateGenerationAdapter,
} from "./story-reference-comfyui";
import { storyGraphWorkflowMode, storyWorkflowDefinition } from "./story-workflow";
import type {
  StoryReferenceAsset,
  StoryReferenceAssetPlan,
  StoryReferenceAssetReference,
  StoryShotId,
} from "./story-types";

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
    const node = value.nodes[nodeId] ?? (nodeId === "entity-cards" || nodeId === "reference-asset-plan"
      ? {
          nodeId,
          status: "blocked",
          source: "system",
          updatedAt: value.updatedAt,
        }
      : undefined);
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

function assertStoryWorkflow(workflow: StoryWorkflowState) {
  if (workflow.workflowMode !== storyGraphWorkflowMode) {
    throw new StoryApiValidationError("Story reference actions require workflowMode story-graph.");
  }
}

function getStoryParameterPlanFromWorkflow(workflow: StoryWorkflowState): StoryParameterPlan {
  const parameterPlan = workflow.nodes["parameter-plan"].result;
  if (!isRecord(parameterPlan) || !isRecord(parameterPlan.defaults)) {
    throw new StoryApiValidationError("Story parameter plan is required for reference generation.", 400);
  }

  return parameterPlan as StoryParameterPlan;
}

function getStoryResourcePlanForReferenceGeneration(workflow: StoryWorkflowState): StoryResourcePlan {
  const resourcePlan = workflow.nodes["resource-plan"].result;
  if (!isRecord(resourcePlan) || !isRecord(resourcePlan.checkpoint)) {
    throw new StoryApiValidationError("Story resource plan is required for reference generation.", 400);
  }

  return resourcePlan as StoryResourcePlan;
}

function findReferenceAsset(plan: StoryReferenceAssetPlan, referenceId: string): StoryReferenceAsset {
  const reference = plan.assets.find((asset) => asset.id === referenceId);
  if (!reference) {
    throw new StoryApiValidationError(`Story reference "${referenceId}" was not found.`, 404);
  }

  return reference;
}

function getReferenceGateBlockingReason({
  assetFreezeGate,
  consistencyPassed,
  executableResourcePlan,
}: {
  assetFreezeGate: ReturnType<typeof evaluateStoryReferenceAssetFreezeGate>;
  consistencyPassed: boolean;
  executableResourcePlan: boolean;
}) {
  if (!assetFreezeGate.ready) {
    return assetFreezeGate.blockingReferences[0]?.reason ?? "Resolve required Story reference assets before generation.";
  }

  if (!consistencyPassed) {
    return "Story consistency checks must pass before generation.";
  }

  if (!executableResourcePlan) {
    return "Story resource plan is not executable.";
  }

  return "Confirm generation to start shot graph execution.";
}

function normalizeCanonicalPromptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function createUpdatedGenerationGate({
  now,
  referenceAssetPlan,
  workflow,
}: {
  now: () => string;
  referenceAssetPlan: StoryReferenceAssetPlan;
  workflow: StoryWorkflowState;
}): StoryGenerationGatePreview {
  const timestamp = now();
  const tentativeWorkflow = {
    ...workflow,
    nodes: {
      ...workflow.nodes,
      "reference-asset-plan": {
        ...workflow.nodes["reference-asset-plan"],
        result: referenceAssetPlan,
      },
    },
  };
  const renderPlan = getStoryRenderPlanFromWorkflow(tentativeWorkflow);
  const consistency = createStoryConsistencyCheckFromWorkflow(tentativeWorkflow, () => timestamp);
  const resourcePlan = getStoryResourcePlanForReferenceGeneration(tentativeWorkflow);
  const executableResourcePlan = isStoryResourcePlanExecutable(resourcePlan);
  const assetFreezeGate = evaluateStoryReferenceAssetFreezeGate(referenceAssetPlan);
  const ready = consistency.passed && executableResourcePlan && assetFreezeGate.ready;

  return {
    storyId: renderPlan.storyId,
    ready,
    executionAvailable: ready,
    assetFreezeGate,
    blockingReason: getReferenceGateBlockingReason({
      assetFreezeGate,
      consistencyPassed: consistency.passed,
      executableResourcePlan,
    }),
    confirmationRequired: true,
    nsfwContext: renderPlan.nsfwContext,
    renderPlanShotCount: renderPlan.shots.length,
    previewEnabled: renderPlan.preview.options.enabled,
    requestPreview: renderPlan.shots.map((shot) =>
      createStoryGenerationRequestPreview(shot, renderPlan.img2imgDenoise, {
        eligibleSourceShotIds: getStoryRenderPlanEligibleSourceShotIds(renderPlan.shots, shot.shotId),
      })),
  };
}

function applyReferenceAssetPlanToWorkflow({
  now,
  referenceAssetPlan,
  source,
  workflow,
}: {
  now?: () => string;
  referenceAssetPlan: StoryReferenceAssetPlan;
  source: StoryWorkflowState["nodes"]["reference-asset-plan"]["source"];
  workflow: StoryWorkflowState;
}) {
  const clock = now ?? (() => new Date().toISOString());
  const updatedAt = clock();
  const generationGate = createUpdatedGenerationGate({
    now: () => updatedAt,
    referenceAssetPlan,
    workflow,
  });
  const nodes = {
    ...workflow.nodes,
    "reference-asset-plan": {
      nodeId: "reference-asset-plan" as const,
      result: referenceAssetPlan,
      source,
      status: source === "manual" ? "manual" as const : "done" as const,
      updatedAt,
    },
    "generation-gate": {
      nodeId: "generation-gate" as const,
      result: generationGate,
      source: "system" as const,
      status: "done" as const,
      updatedAt,
    },
    "shot-graph-execution": {
      ...workflow.nodes["shot-graph-execution"],
      error: {
        code: "confirmation_required",
        message: "Confirm generation before starting Story Graph shot execution.",
      },
      status: "blocked" as const,
      updatedAt,
    },
  };

  return refreshStoryWorkflowReadiness({
    ...workflow,
    generationConfirmed: false,
    nodes,
    updatedAt,
  });
}

function applyReferenceAssetPromptEditToWorkflow({
  now,
  referenceAssetPlan,
  workflow,
}: {
  now?: () => string;
  referenceAssetPlan: StoryReferenceAssetPlan;
  workflow: StoryWorkflowState;
}) {
  const clock = now ?? (() => new Date().toISOString());
  const updatedAt = clock();
  const editedWorkflow = setStoryNodeManualResult(workflow, "reference-asset-plan", referenceAssetPlan, {
    now: () => updatedAt,
    scope: {
      artifactType: "reference-asset-plan",
      kind: "story",
      storyId: workflow.storyId,
    },
  });
  const generationGate = createUpdatedGenerationGate({
    now: () => updatedAt,
    referenceAssetPlan,
    workflow: editedWorkflow,
  });
  const nodes = {
    ...editedWorkflow.nodes,
    "reference-asset-plan": {
      ...editedWorkflow.nodes["reference-asset-plan"],
      result: referenceAssetPlan,
      source: "manual" as const,
      status: "manual" as const,
      updatedAt,
    },
    "generation-gate": {
      ...editedWorkflow.nodes["generation-gate"],
      result: generationGate,
      source: "system" as const,
      status: "stale" as const,
      updatedAt,
    },
  };

  return refreshStoryWorkflowReadiness({
    ...editedWorkflow,
    generationConfirmed: false,
    nodes,
    updatedAt,
  });
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
  const assetFreezeGate = evaluateStoryReferenceAssetFreezeGate(getStoryReferenceAssetPlanFromWorkflow(workflow));

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

  if (!assetFreezeGate.ready) {
    throw new StoryApiValidationError("Story reference asset freeze gate is blocked.", 400, {
      blockingReferences: assetFreezeGate.blockingReferences,
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

export async function generateStoryReferencePlate({
  generatePlate,
  now,
  referenceId,
  workflow,
}: {
  generatePlate: StoryReferencePlateGenerationAdapter;
  now?: () => string;
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);
  const plan = getStoryReferenceAssetPlanFromWorkflow(workflow);
  const reference = findReferenceAsset(plan, referenceId);
  const resourcePlan = getStoryResourcePlanForReferenceGeneration(workflow);
  const parameterPlan = getStoryParameterPlanFromWorkflow(workflow);
  const renderPlan = getStoryRenderPlanFromWorkflow(workflow);

  try {
    const assetReference = await generatePlate({
      nsfwContext: renderPlan.nsfwContext,
      parameterPlan,
      reference,
      resourcePlan,
    });

    return applyReferenceAssetPlanToWorkflow({
      now,
      referenceAssetPlan: applyStoryReferenceGenerationSuccess({
        assetReference,
        now,
        plan,
        referenceId,
      }),
      source: "system",
      workflow,
    });
  } catch (error) {
    return applyReferenceAssetPlanToWorkflow({
      now,
      referenceAssetPlan: applyStoryReferenceGenerationFailure({
        error,
        now,
        plan,
        referenceId,
      }),
      source: "system",
      workflow,
    });
  }
}

export function assertStoryReferenceAssetActionTarget({
  referenceId,
  workflow,
}: {
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);
  findReferenceAsset(getStoryReferenceAssetPlanFromWorkflow(workflow), referenceId);
}

export function uploadStoryReferenceAsset({
  approve = false,
  assetReference,
  now,
  referenceId,
  workflow,
}: {
  approve?: boolean;
  assetReference: StoryReferenceAssetReference;
  now?: () => string;
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);
  const plan = getStoryReferenceAssetPlanFromWorkflow(workflow);
  findReferenceAsset(plan, referenceId);

  return applyReferenceAssetPlanToWorkflow({
    now,
    referenceAssetPlan: applyStoryReferenceUpload({
      approve,
      assetReference,
      now,
      plan,
      referenceId,
    }),
    source: "manual",
    workflow,
  });
}

export function approveStoryReferenceAsset({
  assetReferenceId,
  now,
  referenceId,
  workflow,
}: {
  assetReferenceId?: string;
  now?: () => string;
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);

  return applyReferenceAssetPlanToWorkflow({
    now,
    referenceAssetPlan: applyStoryReferenceApproval({
      assetReferenceId,
      now,
      plan: getStoryReferenceAssetPlanFromWorkflow(workflow),
      referenceId,
    }),
    source: "manual",
    workflow,
  });
}

export function editStoryReferenceCanonicalPrompt({
  canonicalPrompt,
  now,
  referenceId,
  workflow,
}: {
  canonicalPrompt: string;
  now?: () => string;
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);
  const plan = getStoryReferenceAssetPlanFromWorkflow(workflow);
  const reference = findReferenceAsset(plan, referenceId);
  const normalizedPrompt = normalizeCanonicalPromptText(canonicalPrompt);

  if (!normalizedPrompt) {
    throw new StoryApiValidationError("Story reference canonical prompt cannot be empty.", 400);
  }

  if (reference.canonicalPrompt === normalizedPrompt) {
    return workflow;
  }

  return applyReferenceAssetPromptEditToWorkflow({
    now,
    referenceAssetPlan: applyStoryReferenceCanonicalPromptEdit({
      canonicalPrompt: normalizedPrompt,
      plan,
      referenceId,
    }),
    workflow,
  });
}

export function rejectStoryReferenceAsset({
  now,
  reason,
  referenceId,
  workflow,
}: {
  now?: () => string;
  reason?: string;
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);

  return applyReferenceAssetPlanToWorkflow({
    now,
    referenceAssetPlan: applyStoryReferenceRejection({
      now,
      plan: getStoryReferenceAssetPlanFromWorkflow(workflow),
      reason,
      referenceId,
    }),
    source: "manual",
    workflow,
  });
}

export function setStoryReferencePromptOnlyFallback({
  now,
  reason,
  referenceId,
  workflow,
}: {
  now?: () => string;
  reason: string;
  referenceId: string;
  workflow: StoryWorkflowState;
}) {
  assertStoryWorkflow(workflow);

  return applyReferenceAssetPlanToWorkflow({
    now,
    referenceAssetPlan: applyStoryReferencePromptOnlyFallback({
      now,
      plan: getStoryReferenceAssetPlanFromWorkflow(workflow),
      reason,
      referenceId,
    }),
    source: "manual",
    workflow,
  });
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
