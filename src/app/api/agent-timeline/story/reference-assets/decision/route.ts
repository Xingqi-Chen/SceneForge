import { NextResponse } from "next/server";

import {
  approveStoryReferenceAsset,
  rejectStoryReferenceAsset,
  sanitizeStoryWorkflowState,
  setStoryReferencePromptOnlyFallback,
  StoryApiValidationError,
} from "@/features/agent-timeline/story-api";

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
  const action = isRecord(payload) && typeof payload.action === "string" ? payload.action.trim() : "";
  const reason = isRecord(payload) && typeof payload.reason === "string" ? payload.reason : "";
  const assetReferenceId = isRecord(payload) && typeof payload.assetReferenceId === "string"
    ? payload.assetReferenceId.trim()
    : undefined;

  if (!workflow) {
    return errorResponse("A valid story-graph workflow is required.", 400);
  }

  if (!referenceId) {
    return errorResponse("referenceId is required.", 400);
  }

  try {
    if (action === "approve") {
      return NextResponse.json({
        workflow: approveStoryReferenceAsset({
          workflow,
          referenceId,
          assetReferenceId,
        }),
      });
    }

    if (action === "reject") {
      return NextResponse.json({
        workflow: rejectStoryReferenceAsset({
          workflow,
          referenceId,
          reason,
        }),
      });
    }

    if (action === "prompt-only") {
      return NextResponse.json({
        workflow: setStoryReferencePromptOnlyFallback({
          workflow,
          referenceId,
          reason,
        }),
      });
    }

    return errorResponse("action must be approve, reject, or prompt-only.", 400);
  } catch (error) {
    if (error instanceof StoryApiValidationError) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected Story reference decision failure.",
      400,
    );
  }
}
