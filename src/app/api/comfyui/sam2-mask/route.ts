import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  ComfyUiApiError,
  buildSam2MaskWorkflow,
  createComfyUiClient,
  summarizeComfyUiErrorDetails,
  validateComfyUiSam2MaskRequest,
  validateComfyUiSam2MaskRequestAgainstObjectInfo,
} from "@/features/comfyui";
import type { ComfyUiSam2MaskRequest, ComfyUiViewImageReference } from "@/features/comfyui";

export const runtime = "nodejs";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";

class Sam2MaskInputError extends Error {
  readonly statusCode = 400;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "Sam2MaskInputError";
    this.details = details;
  }
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

async function readSourceImageBytes(
  client: ReturnType<typeof createComfyUiClient>,
  reference: ComfyUiViewImageReference,
) {
  const response = await fetch(client.buildViewUrl(reference), {
    cache: "no-store",
    headers: {
      accept: "image/*",
      ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => null);
    throw new ComfyUiApiError("ComfyUI source image request failed.", {
      statusCode: response.status || 502,
      details,
    });
  }

  return Buffer.from(await response.arrayBuffer());
}

async function uploadSam2SourceImage(
  client: ReturnType<typeof createComfyUiClient>,
  request: ComfyUiSam2MaskRequest,
) {
  if (!request.sourceImage) {
    throw new Sam2MaskInputError("sourceImage is required.");
  }

  const sourceBytes = await readSourceImageBytes(client, request.sourceImage);

  try {
    const sourceMetadata = await sharp(sourceBytes).metadata();
    if (!sourceMetadata.width || !sourceMetadata.height) {
      throw new Sam2MaskInputError("Unable to read source image dimensions.");
    }

    if (sourceMetadata.width !== request.imageWidth || sourceMetadata.height !== request.imageHeight) {
      throw new Sam2MaskInputError("SAM source image dimensions changed before mask generation.", {
        actual: {
          width: sourceMetadata.width,
          height: sourceMetadata.height,
        },
        requested: {
          width: request.imageWidth,
          height: request.imageHeight,
        },
      });
    }

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sourceUpload = await client.uploadImage({
      filename: `sceneforge-sam2-source-${suffix}.png`,
      bytes: await sharp(sourceBytes).png().toBuffer(),
      mimeType: "image/png",
      overwrite: true,
      type: "input",
    });

    return {
      ...request,
      imageName: sourceUpload.imageName,
    };
  } catch (error) {
    if (error instanceof Sam2MaskInputError) {
      throw error;
    }

    throw new Sam2MaskInputError("Unable to decode source image for SAM2 mask generation.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const validation = validateComfyUiSam2MaskRequest(payload);
  if (!validation.ok) {
    return errorResponse(validation.message, 400, validation.details);
  }

  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateComfyUiSam2MaskRequestAgainstObjectInfo(validation.request, objectInfo);

    if (objectValidation.errors.length > 0) {
      return errorResponse("ComfyUI SAM2 mask request does not match the current ComfyUI node options.", 400, {
        errors: objectValidation.errors,
        warnings: objectValidation.warnings,
      });
    }

    const clientId = readClientId(payload);
    const requestWithImage = await uploadSam2SourceImage(client, objectValidation.request);
    const workflow = buildSam2MaskWorkflow(requestWithImage);
    const queued = await client.queuePrompt(workflow.workflow, clientId ? { clientId } : undefined);

    return NextResponse.json({
      clientId,
      promptId: queued.promptId,
      number: queued.number,
      nodeErrors: queued.nodeErrors,
      workflow: workflow.workflow,
      nodeIds: workflow.nodeIds,
      outputNodeId: workflow.outputNodeId,
      request: workflow.request,
      warnings: objectValidation.warnings,
    });
  } catch (error) {
    if (error instanceof Sam2MaskInputError) {
      return errorResponse(error.message, error.statusCode, error.details);
    }

    if (error instanceof ComfyUiApiError) {
      const message = makeComfyUiErrorMessage(error);
      console.error("[SceneForge] [comfyui] ComfyUI SAM2 mask request failed", {
        statusCode: error.statusCode,
        details: JSON.stringify(error.details),
        summary: message,
      });

      return errorResponse(message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] unexpected SAM2 mask failure", { error });

    return errorResponse("Unexpected ComfyUI SAM2 mask request failure.", 500);
  }
}
