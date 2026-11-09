import { NextResponse } from "next/server";

import {
  createLiteLlmClient,
  LiteLlmError,
  summarizeLlmResponsesCompletionForLog,
  summarizeLlmResponsesErrorForLog,
  summarizeLlmResponsesRequestForLog,
} from "./litellm-client";
import { appendLlmLocalLog, createLlmLocalLogRequestId } from "./llm-local-log";
import { resolveDefaultModel, resolveRequestModel } from "./model-routing.server";
import { isLlmResponsesRequest } from "./validation";
import { createStructuredOutputErrorDetails, getLlmResponsesOutputShapeDiagnostic } from "./run-scene-prompt-response-format";
import type { LlmResponsesRequest } from "./types";

function errorResponse(message: string, status: number, details?: unknown, code?: string) {
  return NextResponse.json({ error: { ...(code ? { code } : {}), message, details } }, { status });
}

/** Both public routes share validation, routing, transport, and privacy behavior. */
export async function handleLlmResponsesRequest(request: Request, route: string) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }
  if (!isLlmResponsesRequest(payload)) {
    return errorResponse("Request body must include valid Responses input or legacy messages without conflicting options.", 400);
  }

  const defaultModel = resolveDefaultModel(payload);
  if (payload.purpose === "single-image-preview-scoring" && !defaultModel) {
    return errorResponse(
      "LITELLM_DEFAULT_MODEL must be configured with a model that supports multimodal image input and permits the content being scored.",
      503,
      { recoverable: true },
      "llm_config",
    );
  }
  const resolvedRequest: LlmResponsesRequest = { ...payload, model: resolveRequestModel(payload) };
  const requestId = createLlmLocalLogRequestId();
  const log = (phase: "request" | "response" | "error", logPayload: unknown) => appendLlmLocalLog({
    privacy: "responses-safe",
    requestId,
    timestamp: new Date().toISOString(),
    phase,
    route,
    payload: logPayload,
  });
  await log("request", summarizeLlmResponsesRequestForLog(resolvedRequest));

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel,
    });
    const completion = await client.completeResponse(resolvedRequest);
    await log("response", summarizeLlmResponsesCompletionForLog(completion));
    return NextResponse.json(completion);
  } catch (error) {
    const summary = summarizeLlmResponsesErrorForLog(error);
    await log("error", summary);
    console.error("[SceneForge] [llm] Responses request failed", summary);
    if (error instanceof LiteLlmError) {
      const status = typeof error.statusCode === "number" && Number.isInteger(error.statusCode) &&
        error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
      const outputShape = getLlmResponsesOutputShapeDiagnostic(error.details);
      const details = resolvedRequest.responseFormat
        ? createStructuredOutputErrorDetails(resolvedRequest.responseFormat, status, outputShape)
        : {
            ...(resolvedRequest.text?.format.type === "json_schema" ? { code: "structured_output_rejected" } : {}),
            upstreamStatus: status,
            ...(outputShape ? { outputShape } : {}),
          };
      return errorResponse("LiteLLM Responses request failed.", status, details);
    }
    return errorResponse("Unexpected LLM request failure.", 500);
  }
}
