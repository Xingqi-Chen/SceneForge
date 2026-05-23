import { NextResponse } from "next/server";

import {
  ComfyUiApiError,
  createComfyUiClient,
  summarizeComfyUiErrorDetails,
  validateComfyUiTextToImageRequest,
  validateComfyUiRequestAgainstObjectInfo,
} from "@/features/comfyui";

export const runtime = "nodejs";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";

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

function makeComfyUiErrorMessage(error: ComfyUiApiError) {
  const summaries = summarizeComfyUiErrorDetails(error.details);
  if (summaries.length === 0) {
    return error.message;
  }

  return `ComfyUI prompt validation failed: ${summaries.join(" | ")}`;
}

function readClientId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const clientId = (value as { clientId?: unknown }).clientId;
  return typeof clientId === "string" && clientId.trim() ? clientId.trim() : undefined;
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const validation = validateComfyUiTextToImageRequest(payload);
  if (!validation.ok) {
    return errorResponse(validation.message, 400, validation.details);
  }

  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateComfyUiRequestAgainstObjectInfo(validation.request, objectInfo);

    if (objectValidation.errors.length > 0) {
      return errorResponse("ComfyUI request does not match the current ComfyUI model/node options.", 400, {
        errors: objectValidation.errors,
        warnings: objectValidation.warnings,
      });
    }

    const clientId = readClientId(payload);
    const result = await client.generateImage(objectValidation.request, clientId ? { clientId } : undefined);

    return NextResponse.json({
      clientId,
      promptId: result.promptId,
      number: result.number,
      nodeErrors: result.nodeErrors,
      workflow: result.workflow,
      nodeIds: result.nodeIds,
      outputNodeId: result.outputNodeId,
      request: result.request,
    });
  } catch (error) {
    if (error instanceof ComfyUiApiError) {
      const message = makeComfyUiErrorMessage(error);
      console.error("[SceneForge] [comfyui] ComfyUI request failed", {
        statusCode: error.statusCode,
        details: JSON.stringify(error.details),
        summary: message,
      });

      return errorResponse(message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] unexpected image generation failure", { error });

    return errorResponse("Unexpected ComfyUI request failure.", 500);
  }
}
