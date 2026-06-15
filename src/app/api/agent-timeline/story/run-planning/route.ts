import { NextResponse } from "next/server";

import {
  runStoryPlanning,
  type RunStoryPlanningRequest,
} from "@/features/agent-timeline/story-runner";

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

function parseRequest(payload: unknown): RunStoryPlanningRequest | null {
  if (!isRecord(payload) || typeof payload.rawIntent !== "string") {
    return null;
  }

  return {
    rawIntent: payload.rawIntent,
    targetShotCount: typeof payload.targetShotCount === "number" ? payload.targetShotCount : undefined,
    nsfwEnabled: typeof payload.nsfwEnabled === "boolean" ? payload.nsfwEnabled : undefined,
    settingsSnapshot: isRecord(payload.settingsSnapshot) ? payload.settingsSnapshot : undefined,
  };
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const planningRequest = parseRequest(payload);
  if (!planningRequest) {
    return errorResponse("Story planning requires rawIntent.", 400);
  }

  try {
    const workflow = await runStoryPlanning(planningRequest);

    return NextResponse.json({
      workflow,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Story Graph planning failure.";
    console.error("[SceneForge] [agent-timeline] Story Graph planning failed", { error });
    return errorResponse(message, 500);
  }
}
