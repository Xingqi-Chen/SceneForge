import { NextResponse } from "next/server";

import {
  createStructuredOutputErrorDetails,
  createLiteLlmClient,
  getLlmResponsesOutputShapeDiagnostic,
  isAuthorizedRunScenePromptResponsesRequest,
  isLlmChatRequest,
  LiteLlmError,
  summarizeLlmResponsesCompletionForLog,
  summarizeLlmResponsesErrorForLog,
  summarizeLlmResponsesRequestForLog,
  summarizeLlmResponseFormatForLog,
  type LlmChatRequest,
} from "../../../../features/llm";
import { appendLlmLocalLog, serializeErrorForLlmLog } from "../../../../features/llm/llm-local-log";
import {
  resolveDefaultModel,
  resolveRequestModel,
} from "../../../../features/llm/model-routing.server";

export { resolveDefaultModel, resolveRequestModel } from "../../../../features/llm/model-routing.server";

export const runtime = "nodejs";

const PREVIEW_SCORING_MODEL_CONFIG_MESSAGE =
  "LITELLM_DEFAULT_MODEL must be configured with a model that supports multimodal image input and permits the content being scored.";

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorResponse(message: string, status: number, details?: unknown, code?: string) {
  return NextResponse.json(
    {
      error: {
        ...(code ? { code } : {}),
        message,
        details,
      },
    },
    { status },
  );
}

export async function POST(request: Request) {
  const requestId = createRequestId();
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
  if (chatRequest.purpose === "single-image-preview-scoring" && !defaultModel) {
    return errorResponse(
      PREVIEW_SCORING_MODEL_CONFIG_MESSAGE,
      503,
      { recoverable: true },
      "llm_config",
    );
  }
  const resolvedRequest: LlmChatRequest = {
    ...chatRequest,
    model: resolveRequestModel(chatRequest),
  };
  const useResponses = Boolean(isAuthorizedRunScenePromptResponsesRequest(resolvedRequest));

  await appendLlmLocalLog({
    ...(useResponses ? { privacy: "responses-safe" as const } : {}),
    requestId,
    timestamp: new Date().toISOString(),
    phase: "request",
    route: "/api/llm/chat",
    payload: useResponses
      ? summarizeLlmResponsesRequestForLog(resolvedRequest)
      : {
          purpose: resolvedRequest.purpose,
          nsfw: resolvedRequest.nsfw,
          model: resolvedRequest.model,
          temperature: resolvedRequest.temperature,
          maxTokens: resolvedRequest.maxTokens,
          responseFormat: summarizeLlmResponseFormatForLog(resolvedRequest.responseFormat),
          messages: resolvedRequest.messages,
        },
  });

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel,
    });

    const completion = useResponses
      ? await client.completeResponse(resolvedRequest)
      : await client.completeChat(resolvedRequest);

    await appendLlmLocalLog({
      ...(useResponses ? { privacy: "responses-safe" as const } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      phase: "response",
      route: "/api/llm/chat",
      payload: useResponses
        ? summarizeLlmResponsesCompletionForLog(completion)
        : { completion },
    });

    return NextResponse.json(completion);
  } catch (error) {
    if (error instanceof LiteLlmError) {
      const structuredOutputDetails = resolvedRequest.responseFormat
        ? createStructuredOutputErrorDetails(
            resolvedRequest.responseFormat,
            error.statusCode,
            getLlmResponsesOutputShapeDiagnostic(error.details),
          )
        : undefined;
      const safeDetails = structuredOutputDetails ?? error.details;
      await appendLlmLocalLog({
        ...(useResponses ? { privacy: "responses-safe" as const } : {}),
        requestId,
        timestamp: new Date().toISOString(),
        phase: "error",
        route: "/api/llm/chat",
        payload: useResponses
          ? {
              ...summarizeLlmResponsesErrorForLog(error),
              details: safeDetails,
            }
          : {
              error: serializeErrorForLlmLog(error),
              statusCode: error.statusCode,
              details: safeDetails,
            },
      });

      console.error(
        "[SceneForge] [llm] LiteLLM request failed",
        useResponses
          ? {
              ...summarizeLlmResponsesErrorForLog(error),
              details: safeDetails,
            }
          : {
              statusCode: error.statusCode,
              details: safeDetails,
            },
      );

      return errorResponse(error.message, error.statusCode ?? 500, safeDetails);
    }

    await appendLlmLocalLog({
      ...(useResponses ? { privacy: "responses-safe" as const } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      phase: "error",
      route: "/api/llm/chat",
      payload: useResponses
        ? summarizeLlmResponsesErrorForLog(error)
        : { error: serializeErrorForLlmLog(error) },
    });

    if (useResponses) {
      console.error(
        "[SceneForge] [llm] unexpected LLM proxy failure",
        summarizeLlmResponsesErrorForLog(error),
      );
    } else {
      console.error("[SceneForge] [llm] unexpected LLM proxy failure", error);
    }

    return errorResponse("Unexpected LLM request failure.", 500);
  }
}
