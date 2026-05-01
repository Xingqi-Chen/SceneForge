import { NextResponse } from "next/server";

import { createLiteLlmClient, isLlmChatRequest, LiteLlmError } from "@/features/llm";

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

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isLlmChatRequest(payload)) {
    return errorResponse("Request body must include non-empty chat messages.", 400);
  }

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel: process.env.LITELLM_DEFAULT_MODEL,
    });

    const completion = await client.completeChat(payload);

    return NextResponse.json(completion);
  } catch (error) {
    if (error instanceof LiteLlmError) {
      console.error("[SceneForge] [generation] LiteLLM request failed", {
        statusCode: error.statusCode,
        details: error.details,
      });

      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [generation] Unexpected LLM request failure", error);

    return errorResponse("Unexpected LLM request failure.", 500);
  }
}

