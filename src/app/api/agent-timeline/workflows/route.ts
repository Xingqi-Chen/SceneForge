import { NextResponse } from "next/server";

import {
  listNamedTimelineWorkflowSummariesFromDisk,
  saveNamedTimelineWorkflowToDisk,
  TimelineWorkflowStorageValidationError,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  try {
    const workflows = await listNamedTimelineWorkflowSummariesFromDisk();
    return NextResponse.json({ workflows });
  } catch (error) {
    console.error("[SceneForge] [agent-timeline] failed to list named workflows", { error });
    return errorResponse("Unable to list timeline workflows.", 500);
  }
}

export async function PUT(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isRecord(payload)) {
    return errorResponse("Timeline workflow save request is invalid.", 400);
  }

  const record = sanitizeTimelineWorkflowRecord(payload.record);
  if (!record) {
    return errorResponse("Timeline workflow record is invalid.", 400);
  }

  try {
    const savedRecord = await saveNamedTimelineWorkflowToDisk({
      id: typeof payload.id === "string" ? payload.id : record.projectId,
      name: typeof payload.name === "string" ? payload.name : record.name,
      record,
    });

    return NextResponse.json({
      ok: true as const,
      record: savedRecord,
      summary: {
        id: savedRecord.projectId ?? "",
        name: savedRecord.name ?? "",
        createdAt: savedRecord.createdAt,
        updatedAt: savedRecord.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof TimelineWorkflowStorageValidationError) {
      return errorResponse(error.message, 400);
    }

    console.error("[SceneForge] [agent-timeline] failed to save named workflow", { error });
    return errorResponse("Unable to save the timeline workflow.", 500);
  }
}
