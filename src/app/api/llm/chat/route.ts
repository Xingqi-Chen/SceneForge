import { NextResponse } from "next/server";

import {
  createLiteLlmClient,
  isLlmChatRequest,
  LiteLlmError,
  type LlmChatRequest,
} from "../../../../features/llm";
import { appendLlmLocalLog, serializeErrorForLlmLog } from "../../../../features/llm/llm-local-log";

export const runtime = "nodejs";

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

function resolvePurposeDefaultModel(payload: LlmChatRequest) {
  if (payload.purpose === "prompt-library-classification") {
    return process.env.LITELLM_CLASSIFICATION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "scene-prompt-reverse" || payload.purpose === "prompt-tag-reverse") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "stick-figure-pose-generation") {
    return process.env.LITELLM_POSE_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "civitai-resource-enrichment") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "civitai-combination-recommendation") {
    return process.env.LITELLM_CIVITAI_RECOMMENDATION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "stable-diffusion-prompt-generation") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "story-style-reference-analysis") {
    return process.env.LITELLM_VISION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "single-image-preview-scoring") {
    return payload.nsfw === true
      ? process.env.LITELLM_NSFW_MODEL
      : process.env.LITELLM_VISION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "comic-sequence-storyboard") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "comfyui-generation-diagnosis") {
    return process.env.LITELLM_COMFYUI_DIAGNOSIS_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "comfyui-inpaint-diagnosis") {
    return process.env.LITELLM_COMFYUI_DIAGNOSIS_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  return process.env.LITELLM_DEFAULT_MODEL;
}

function isVisionPurposeWithExplicitRouting(payload: LlmChatRequest) {
  return payload.purpose === "story-style-reference-analysis" ||
    payload.purpose === "single-image-preview-scoring";
}

export function resolveDefaultModel(payload: LlmChatRequest) {
  if (isVisionPurposeWithExplicitRouting(payload)) {
    return resolvePurposeDefaultModel(payload);
  }

  if (payload.nsfw === true) {
    return process.env.LITELLM_NSFW_MODEL || resolvePurposeDefaultModel(payload);
  }

  return resolvePurposeDefaultModel(payload);
}

export function resolveRequestModel(payload: LlmChatRequest) {
  const defaultModel = resolveDefaultModel(payload);

  if (payload.purpose === "single-image-preview-scoring" && payload.nsfw === true) {
    return defaultModel;
  }

  if (isVisionPurposeWithExplicitRouting(payload)) {
    return payload.model ?? defaultModel;
  }

  if (payload.nsfw === true && process.env.LITELLM_NSFW_MODEL) {
    return process.env.LITELLM_NSFW_MODEL;
  }

  return payload.model ?? defaultModel;
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
  const resolvedRequest: LlmChatRequest = {
    ...chatRequest,
    model: resolveRequestModel(chatRequest),
  };

  await appendLlmLocalLog({
    requestId,
    timestamp: new Date().toISOString(),
    phase: "request",
    route: "/api/llm/chat",
    payload: {
      purpose: resolvedRequest.purpose,
      nsfw: resolvedRequest.nsfw,
      model: resolvedRequest.model,
      temperature: resolvedRequest.temperature,
      maxTokens: resolvedRequest.maxTokens,
      messages: resolvedRequest.messages,
    },
  });

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel,
    });

    const completion = await client.completeChat(resolvedRequest);

    await appendLlmLocalLog({
      requestId,
      timestamp: new Date().toISOString(),
      phase: "response",
      route: "/api/llm/chat",
      payload: {
        completion,
      },
    });

    return NextResponse.json(completion);
  } catch (error) {
    if (error instanceof LiteLlmError) {
      await appendLlmLocalLog({
        requestId,
        timestamp: new Date().toISOString(),
        phase: "error",
        route: "/api/llm/chat",
        payload: {
          error: serializeErrorForLlmLog(error),
          statusCode: error.statusCode,
          details: error.details,
        },
      });

      console.error("[SceneForge] [llm] LiteLLM request failed", {
        statusCode: error.statusCode,
        details: error.details,
      });

      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    await appendLlmLocalLog({
      requestId,
      timestamp: new Date().toISOString(),
      phase: "error",
      route: "/api/llm/chat",
      payload: {
        error: serializeErrorForLlmLog(error),
      },
    });

    console.error("[SceneForge] [llm] unexpected LLM proxy failure", error);

    return errorResponse("Unexpected LLM request failure.", 500);
  }
}
