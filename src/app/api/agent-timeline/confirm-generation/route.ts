import { NextResponse } from "next/server";

import { getTimelineNodeDependencies } from "@/features/agent-timeline/dag";
import { executeTimelineGraph } from "@/features/agent-timeline/graph";
import {
  createTimelineGenerationConfirmationFingerprint,
  isTimelineGenerationConfirmationCurrent,
} from "@/features/agent-timeline/generation-confirmation.server";
import {
  resolveTimelineFinalGenerationPolicy,
  timelineFinalGenerationPolicy,
} from "@/features/agent-timeline/final-generation-policy";
import { getRunSceneInputSettings } from "@/features/agent-timeline/run-input-settings";
import {
  areTimelineNodeDependenciesSatisfied,
  confirmTimelineGeneration,
  retryTimelineGenerationFrom,
  type TimelineGenerationRetryNodeId,
} from "@/features/agent-timeline/state";
import { createTimelineT8ServerNodeAdapters } from "@/features/agent-timeline/t8-server-adapters";
import { sanitizeTimelineWorkflowState } from "@/features/agent-timeline/timeline-workflow-persistence";
import {
  TimelineNodeExecutionError,
  type TimelineExecutableNodeId,
  type TimelineNodeMap,
} from "@/features/agent-timeline/types";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        message,
        details,
      },
    },
    { status },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const workflow = sanitizeTimelineWorkflowState(isRecord(payload) ? payload.workflow : null);
  if (!workflow) {
    return errorResponse("A valid timeline workflow is required.", 400);
  }

  if (workflow.workflowMode !== "single-image") {
    return errorResponse("Single-image generation requires a single-image timeline workflow.", 400);
  }

  const action = isRecord(payload) && payload.action === "retry"
    ? "retry"
    : isRecord(payload) && payload.action === "continue" ? "continue" : "confirm";
  const retryNodeId = isRecord(payload) ? payload.retryNodeId : undefined;
  const retryNodeIds = new Set<TimelineGenerationRetryNodeId>([
    "preview-execution",
    "preview-scoring",
    "comfyui-execution",
  ]);
  const requestedStage = isRecord(payload) ? payload.stage : undefined;
  const stage = typeof requestedStage === "string" && retryNodeIds.has(requestedStage as TimelineGenerationRetryNodeId)
    ? requestedStage as TimelineGenerationRetryNodeId
    : action === "retry" && typeof retryNodeId === "string" && retryNodeIds.has(retryNodeId as TimelineGenerationRetryNodeId)
      ? retryNodeId as TimelineGenerationRetryNodeId
      : undefined;

  if (requestedStage !== undefined && !stage) {
    return errorResponse("stage must identify preview execution, preview scoring, or final execution.", 400);
  }

  if (action === "retry" && (typeof retryNodeId !== "string" || !retryNodeIds.has(retryNodeId as TimelineGenerationRetryNodeId))) {
    return errorResponse("retryNodeId must identify preview execution, preview scoring, or final execution.", 400);
  }

  if (action === "retry" && stage !== retryNodeId) {
    return errorResponse("A retry request must target the same stage as retryNodeId.", 400);
  }

  if (action === "confirm" && stage && stage !== "preview-execution" && stage !== "comfyui-execution") {
    return errorResponse("A staged confirmation must start with preview execution or resume at final execution.", 400);
  }

  if (action === "continue" && (!stage || stage === "preview-execution")) {
    return errorResponse("A continuation must target preview scoring or final execution.", 400);
  }

  const gateResult = workflow.nodes["generation-gate"].result;
  if (action !== "confirm" && (!workflow.generationConfirmed || !isRecord(gateResult) || gateResult.confirmed !== true)) {
    return errorResponse("Generation must remain confirmed before retrying a generation phase.", 400);
  }

  if (action !== "confirm" && !isTimelineGenerationConfirmationCurrent(workflow)) {
    return errorResponse(
      "The confirmed generation contract changed or uses a legacy confirmation. Review and confirm the Run again before retrying.",
      409,
      { code: "confirmation_required" },
    );
  }

  if (action === "confirm" && !areTimelineNodeDependenciesSatisfied(workflow, "generation-gate")) {
    return errorResponse("Generation cannot be confirmed until all gate dependencies are complete.", 400, {
      dependencies: getTimelineNodeDependencies("generation-gate").map((nodeId) => ({
        nodeId,
        status: (workflow.nodes as TimelineNodeMap)[nodeId].status,
      })),
    });
  }

  try {
    const parameterResult = workflow.nodes["parameter-recommendation"].result;
    const requestPreview = isRecord(parameterResult) && isRecord(parameterResult.requestPreview)
      ? parameterResult.requestPreview
      : {};
    const sceneInput = workflow.nodes["scene-input"].result;
    const settings = getRunSceneInputSettings(isRecord(sceneInput) ? sceneInput : {});
    const resolvedFinalPolicy = resolveTimelineFinalGenerationPolicy(requestPreview, settings.finalRedrawPreset);
    const runnableWorkflow = action === "retry"
      ? retryTimelineGenerationFrom(workflow, retryNodeId as TimelineGenerationRetryNodeId)
      : action === "confirm" ? confirmTimelineGeneration(workflow, {
          confirmationRequired: false,
          confirmed: true,
          confirmationFingerprint: createTimelineGenerationConfirmationFingerprint(workflow),
          finalPolicyVersion: timelineFinalGenerationPolicy.version,
          finalRedrawPreset: resolvedFinalPolicy.preset,
          finalGenerationFamily: resolvedFinalPolicy.family,
          finalDenoise: resolvedFinalPolicy.denoise,
        }) : workflow;
    if (stage && !areTimelineNodeDependenciesSatisfied(runnableWorkflow, stage)) {
      return errorResponse(`Generation stage "${stage}" cannot run until its dependencies are complete.`, 409, {
        code: "timeline_node_blocked",
        dependencies: getTimelineNodeDependencies(stage).map((nodeId) => ({
          nodeId,
          status: runnableWorkflow.nodes[nodeId].status,
        })),
      });
    }
    const executableNodeIds: readonly TimelineExecutableNodeId[] | undefined = stage === "comfyui-execution"
      ? ["comfyui-execution", "result-display"]
      : stage ? [stage] : undefined;
    const result = await executeTimelineGraph(runnableWorkflow, createTimelineT8ServerNodeAdapters({
      advancePreviewSeedOnRetry: action === "retry" && retryNodeId === "preview-execution",
    }), {
      ...(executableNodeIds ? { executableNodeIds } : {}),
    });

    return NextResponse.json({
      workflow: result,
    });
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      return errorResponse(error.message, 500, {
        code: error.code,
        details: error.details,
      });
    }

    console.error("[SceneForge] [agent-timeline] confirmed generation failed", { error });
    return errorResponse("Unexpected timeline generation failure.", 500);
  }
}
