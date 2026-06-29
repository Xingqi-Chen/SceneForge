import { NextResponse } from "next/server";

import {
  assertStoryReferenceAssetActionTarget,
  sanitizeStoryWorkflowState,
  StoryApiValidationError,
  uploadStoryReferenceAsset,
} from "@/features/agent-timeline/story-api";
import {
  ComfyUiSequenceReferenceStorageError,
  storeSequenceReferenceImage,
} from "@/features/comfyui/sequence-reference-storage";

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
  const dataUrl = isRecord(payload) && typeof payload.dataUrl === "string" ? payload.dataUrl : "";
  const approve = isRecord(payload) && payload.approve === true;

  if (!workflow) {
    return errorResponse("A valid story-graph workflow is required.", 400);
  }

  if (!referenceId) {
    return errorResponse("referenceId is required.", 400);
  }

  if (!dataUrl) {
    return errorResponse("dataUrl is required.", 400);
  }

  try {
    assertStoryReferenceAssetActionTarget({
      workflow,
      referenceId,
    });
    const stored = await storeSequenceReferenceImage(dataUrl);
    const result = uploadStoryReferenceAsset({
      workflow,
      referenceId,
      approve,
      assetReference: {
        byteLength: stored.byteLength,
        contentType: stored.contentType,
        filename: stored.filename,
        source: "uploaded",
        url: stored.url,
      },
    });

    return NextResponse.json({
      workflow: result,
    });
  } catch (error) {
    if (error instanceof ComfyUiSequenceReferenceStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    if (error instanceof StoryApiValidationError) {
      return errorResponse(error.message, error.status, error.details);
    }

    console.error("[SceneForge] [agent-timeline] Story reference upload action failed", { error });
    return errorResponse(
      error instanceof Error ? error.message : "Unexpected Story reference upload failure.",
      500,
    );
  }
}
