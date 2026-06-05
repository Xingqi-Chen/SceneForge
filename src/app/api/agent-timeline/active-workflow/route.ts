import { NextResponse } from "next/server";

import {
  deleteActiveTimelineWorkflowFromDisk,
  loadActiveTimelineWorkflowFromDisk,
  saveActiveTimelineWorkflowToDisk,
} from "@/features/agent-timeline/timeline-workflow-local-disk";
import { sanitizeTimelineWorkflowRecord } from "@/features/agent-timeline/timeline-workflow-persistence";

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

export async function GET() {
  try {
    const record = await loadActiveTimelineWorkflowFromDisk();

    if (!record) {
      return NextResponse.json(
        {
          error: { message: "No active timeline workflow has been saved." },
        },
        { status: 404 },
      );
    }

    return NextResponse.json(record);
  } catch (error) {
    console.error("[SceneForge] [agent-timeline] failed to load active workflow", { error });
    return errorResponse("Unable to load the active timeline workflow.", 500);
  }
}

export async function PUT(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const record = sanitizeTimelineWorkflowRecord(payload);
  if (!record) {
    return errorResponse("Timeline workflow record is invalid.", 400);
  }

  try {
    await saveActiveTimelineWorkflowToDisk(record);
    return NextResponse.json({ ok: true as const, record });
  } catch (error) {
    console.error("[SceneForge] [agent-timeline] failed to save active workflow", { error });
    return errorResponse("Unable to save the active timeline workflow.", 500);
  }
}

export async function DELETE() {
  try {
    await deleteActiveTimelineWorkflowFromDisk();
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    console.error("[SceneForge] [agent-timeline] failed to clear active workflow", { error });
    return errorResponse("Unable to clear the active timeline workflow.", 500);
  }
}
