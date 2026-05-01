import { NextResponse } from "next/server";

import {
  createLiteLlmClient,
  isLlmChatRequest,
  LiteLlmError,
  type LlmChatRequest,
} from "../../../../features/llm";

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

function resolveDefaultModel(payload: LlmChatRequest) {
  if (payload.purpose === "prompt-library-classification") {
    return process.env.LITELLM_CLASSIFICATION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  return process.env.LITELLM_DEFAULT_MODEL;
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

  const chatRequest: LlmChatRequest = payload;
  const defaultModel = resolveDefaultModel(chatRequest);

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel,
    });

    const completion = await client.completeChat({
      ...chatRequest,
      model: chatRequest.model ?? defaultModel,
    });

    return NextResponse.json(completion);
  } catch (error) {
    if (error instanceof LiteLlmError) {
      console.error("[SceneForge] [llm] LiteLLM request failed", {
        statusCode: error.statusCode,
        details: error.details,
      });

      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [llm] unexpected LLM proxy failure", error);

    return errorResponse("Unexpected LLM request failure.", 500);
  }
}

