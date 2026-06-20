import { NextResponse } from "next/server";

import {
  loadStorySamplerOptionsFromComfyUi,
  runStoryPlanning,
  type RunStoryPlanningRequest,
} from "@/features/agent-timeline/story-runner";
import type {
  StoryWorkflowState,
} from "@/features/agent-timeline/story-state";
import type {
  StoryWorkflowNodeId,
} from "@/features/agent-timeline/story-types";

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
    storyId: typeof payload.storyId === "string" ? payload.storyId : undefined,
    targetShotCount: typeof payload.targetShotCount === "number" ? payload.targetShotCount : undefined,
    nsfwEnabled: typeof payload.nsfwEnabled === "boolean" ? payload.nsfwEnabled : undefined,
    settingsSnapshot: isRecord(payload.settingsSnapshot) ? payload.settingsSnapshot : undefined,
    workflowId: typeof payload.workflowId === "string" ? payload.workflowId : undefined,
  };
}

function wantsStreamingResponse(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/x-ndjson");
}

function createPlanningStream(planningRequest: RunStoryPlanningRequest) {
  const encoder = new TextEncoder();

  function encode(event: unknown) {
    return encoder.encode(`${JSON.stringify(event)}\n`);
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const workflow = await runStoryPlanning(planningRequest, {
          loadSamplerOptions: loadStorySamplerOptionsFromComfyUi,
          onWorkflowUpdate: (updatedWorkflow: StoryWorkflowState, nodeId: StoryWorkflowNodeId) => {
            controller.enqueue(encode({
              nodeId,
              type: "workflow",
              workflow: updatedWorkflow,
            }));
          },
        });

        controller.enqueue(encode({
          type: "done",
          workflow,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected Story Graph planning failure.";
        console.error("[SceneForge] [agent-timeline] Story Graph planning stream failed", { error });
        controller.enqueue(encode({
          error: {
            message,
          },
          type: "error",
        }));
      } finally {
        controller.close();
      }
    },
  });
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

  if (wantsStreamingResponse(request)) {
    return new Response(createPlanningStream(planningRequest), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });
  }

  try {
    const workflow = await runStoryPlanning(planningRequest, {
      loadSamplerOptions: loadStorySamplerOptionsFromComfyUi,
    });

    return NextResponse.json({
      workflow,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Story Graph planning failure.";
    console.error("[SceneForge] [agent-timeline] Story Graph planning failed", { error });
    return errorResponse(message, 500);
  }
}
