import { NextResponse } from "next/server";

import { AgentDraftError, generateAgentSingleImageDraft } from "@/features/agent";

export const runtime = "nodejs";

function errorResponse(error: AgentDraftError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    },
    { status: error.statusCode },
  );
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse(
      new AgentDraftError("Request body must be valid JSON.", {
        code: "agent_request_invalid",
        statusCode: 400,
      }),
    );
  }

  try {
    return NextResponse.json(await generateAgentSingleImageDraft(payload));
  } catch (error) {
    if (error instanceof AgentDraftError) {
      return errorResponse(error);
    }

    console.error("[SceneForge] [agent] unexpected draft route failure", error);

    return errorResponse(
      new AgentDraftError("Unexpected Agent draft failure.", {
        code: "agent_unexpected",
        statusCode: 500,
      }),
    );
  }
}
