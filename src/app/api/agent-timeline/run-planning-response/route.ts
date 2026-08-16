import { NextResponse } from "next/server";

import { isAuthorizedRunPlanningResponsesApiRequest } from "@/features/agent-timeline/run-planning-responses";
import {
  createLiteLlmClient,
  LiteLlmError,
  summarizeLlmResponsesErrorForLog,
} from "@/features/llm";
import {
  appendLlmChatLocalLog,
  createLlmLocalLogRequestId,
} from "@/features/llm/llm-local-log";
import {
  resolveDefaultModel,
  resolveRequestModel,
} from "@/features/llm/model-routing.server";

export const runtime = "nodejs";

const routeName = "agent-timeline/run-planning-response";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { message, details } }, { status });
}

function normalizeErrorStatus(statusCode: number | undefined) {
  return typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

function createSafeRunPlanningErrorDetails(error: LiteLlmError) {
  const summary = summarizeLlmResponsesErrorForLog(error);
  const upstreamStatus = typeof summary.upstreamStatus === "number"
    ? summary.upstreamStatus
    : normalizeErrorStatus(error.statusCode);
  const outputShape = typeof summary.outputShape === "string" ? summary.outputShape : undefined;
  const reason = typeof summary.reason === "string" ? summary.reason : undefined;

  return {
    code: "run_planning_response_failed",
    upstreamStatus,
    ...(outputShape ? { outputShape } : {}),
    ...(reason ? { reason } : {}),
  };
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isAuthorizedRunPlanningResponsesApiRequest(payload)) {
    return errorResponse("Request is not an authorized single-image Run planning call.", 400);
  }

  const requestId = createLlmLocalLogRequestId();
  const defaultModel = resolveDefaultModel(payload.request);
  const resolvedRequest = {
    ...payload.request,
    model: resolveRequestModel(payload.request),
  };
  const logContext = { runPlanningNodeId: payload.nodeId };

  await appendLlmChatLocalLog({
    category: "chat",
    context: logContext,
    phase: "request",
    request: resolvedRequest,
    requestId,
    route: routeName,
    transport: "responses",
  });

  try {
    const client = createLiteLlmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? "",
      apiKey: process.env.LITELLM_API_KEY,
      defaultModel,
    });
    const completion = await client.completeResponse(resolvedRequest);

    await appendLlmChatLocalLog({
      category: "chat",
      completion,
      context: logContext,
      phase: "response",
      requestId,
      route: routeName,
      transport: "responses",
    });

    return NextResponse.json(completion);
  } catch (error) {
    const statusCode = normalizeErrorStatus(error instanceof LiteLlmError ? error.statusCode : undefined);
    await appendLlmChatLocalLog({
      category: "chat",
      context: logContext,
      error,
      phase: "error",
      requestId,
      route: routeName,
      statusCode,
      transport: "responses",
    });

    if (error instanceof LiteLlmError) {
      return errorResponse(
        "Run planning LLM request failed.",
        statusCode,
        createSafeRunPlanningErrorDetails(error),
      );
    }

    console.error("[SceneForge] [agent-timeline] unexpected Run planning LLM failure", {
      callType: "responses",
      status: "unexpected_error",
    });
    return errorResponse("Unexpected LLM request failure.", 500);
  }
}
