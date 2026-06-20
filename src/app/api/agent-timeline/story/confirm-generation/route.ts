import { NextResponse } from "next/server";

import {
  confirmAndExecuteStoryGeneration,
  sanitizeStoryWorkflowState,
  StoryApiValidationError,
} from "@/features/agent-timeline/story-api";
import { createStoryComfyUiExecutionAdapter } from "@/features/agent-timeline/story-comfyui-execution";

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

  const workflow = sanitizeStoryWorkflowState(isRecord(payload) ? payload.workflow : null);
  if (!workflow) {
    return errorResponse("A valid story-graph workflow is required.", 400);
  }

  try {
    const result = await confirmAndExecuteStoryGeneration({
      workflow,
      executeShot: createStoryComfyUiExecutionAdapter(),
    });

    return NextResponse.json({
      workflow: result,
    });
  } catch (error) {
    if (error instanceof StoryApiValidationError) {
      return errorResponse(error.message, error.status, error.details);
    }

    console.error("[SceneForge] [agent-timeline] Story Graph generation failed", { error });
    return errorResponse(
      error instanceof Error ? error.message : "Unexpected Story Graph generation failure.",
      500,
    );
  }
}
