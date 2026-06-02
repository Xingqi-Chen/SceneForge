import { NextResponse } from "next/server";

import { getTimelineNodeDependencies } from "@/features/agent-timeline/dag";
import { executeTimelineGraph } from "@/features/agent-timeline/graph";
import {
  areTimelineNodeDependenciesSatisfied,
  confirmTimelineGeneration,
} from "@/features/agent-timeline/state";
import { createTimelineT8ServerNodeAdapters } from "@/features/agent-timeline/t8-server-adapters";
import {
  timelineNodeIds,
  TimelineNodeExecutionError,
  type TimelineNodeMap,
  type TimelineWorkflowState,
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

function isTimelineWorkflowState(value: unknown): value is TimelineWorkflowState {
  if (
    !isRecord(value) ||
    typeof value.workflowId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.generationConfirmed !== "boolean" ||
    !isRecord(value.nodes)
  ) {
    return false;
  }

  const nodes = value.nodes;

  return timelineNodeIds.every((nodeId) => {
    const node = nodes[nodeId];

    return isRecord(node) && node.nodeId === nodeId && typeof node.status === "string";
  });
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const workflow = isRecord(payload) ? payload.workflow : null;
  if (!isTimelineWorkflowState(workflow)) {
    return errorResponse("A valid timeline workflow is required.", 400);
  }

  if (!areTimelineNodeDependenciesSatisfied(workflow, "generation-gate")) {
    return errorResponse("Generation cannot be confirmed until all gate dependencies are complete.", 400, {
      dependencies: getTimelineNodeDependencies("generation-gate").map((nodeId) => ({
        nodeId,
        status: (workflow.nodes as TimelineNodeMap)[nodeId].status,
      })),
    });
  }

  try {
    const confirmedWorkflow = confirmTimelineGeneration(workflow);
    const result = await executeTimelineGraph(confirmedWorkflow, createTimelineT8ServerNodeAdapters());

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
