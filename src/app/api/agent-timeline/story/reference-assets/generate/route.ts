import { NextResponse } from "next/server";

import {
  generateStoryReferencePlate,
  sanitizeStoryWorkflowState,
  StoryApiValidationError,
} from "@/features/agent-timeline/story-api";
import { createStoryReferenceComfyUiGenerationAdapter } from "@/features/agent-timeline/story-reference-comfyui";

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
  const referenceId = isRecord(payload) && typeof payload.referenceId === "string" ? payload.referenceId.trim() : "";

  if (!workflow) {
    return errorResponse("A valid story-graph workflow is required.", 400);
  }

  if (!referenceId) {
    return errorResponse("referenceId is required.", 400);
  }

  try {
    const result = await generateStoryReferencePlate({
      workflow,
      referenceId,
      generatePlate: createStoryReferenceComfyUiGenerationAdapter(),
    });

    return NextResponse.json({
      workflow: result,
    });
  } catch (error) {
    if (error instanceof StoryApiValidationError) {
      return errorResponse(error.message, error.status, error.details);
    }

    console.error("[SceneForge] [agent-timeline] Story reference generation action failed", { error });
    return errorResponse(
      error instanceof Error ? error.message : "Unexpected Story reference generation failure.",
      500,
    );
  }
}
