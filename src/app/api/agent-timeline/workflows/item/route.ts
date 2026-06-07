import { NextResponse } from "next/server";

import {
  deleteNamedTimelineWorkflowFromDisk,
  loadNamedTimelineWorkflowFromDisk,
  renameNamedTimelineWorkflowOnDisk,
  TimelineWorkflowStorageValidationError,
} from "@/features/agent-timeline/timeline-workflow-local-disk";

export const runtime = "nodejs";

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      error: {
        message,
      },
    },
    { status },
  );
}

function getId(request: Request) {
  return new URL(request.url).searchParams.get("id") ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  try {
    const record = await loadNamedTimelineWorkflowFromDisk(getId(request));

    if (!record) {
      return errorResponse("Timeline workflow was not found.", 404);
    }

    return NextResponse.json(record);
  } catch (error) {
    if (error instanceof TimelineWorkflowStorageValidationError) {
      return errorResponse(error.message, 400);
    }

    console.error("[SceneForge] [agent-timeline] failed to load named workflow", { error });
    return errorResponse("Unable to load the timeline workflow.", 500);
  }
}

export async function PATCH(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isRecord(payload) || typeof payload.name !== "string" || !payload.name.trim()) {
    return errorResponse("Timeline workflow name is required.", 400);
  }

  try {
    const record = await renameNamedTimelineWorkflowOnDisk(getId(request), payload.name);

    if (!record) {
      return errorResponse("Timeline workflow was not found.", 404);
    }

    return NextResponse.json({ ok: true as const, record });
  } catch (error) {
    if (error instanceof TimelineWorkflowStorageValidationError) {
      return errorResponse(error.message, 400);
    }

    console.error("[SceneForge] [agent-timeline] failed to rename named workflow", { error });
    return errorResponse("Unable to rename the timeline workflow.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const removed = await deleteNamedTimelineWorkflowFromDisk(getId(request));

    if (!removed) {
      return errorResponse("Timeline workflow was not found.", 404);
    }

    return NextResponse.json({ ok: true as const });
  } catch (error) {
    if (error instanceof TimelineWorkflowStorageValidationError) {
      return errorResponse(error.message, 400);
    }

    console.error("[SceneForge] [agent-timeline] failed to delete named workflow", { error });
    return errorResponse("Unable to delete the timeline workflow.", 500);
  }
}
