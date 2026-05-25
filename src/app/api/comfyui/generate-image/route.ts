import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  ComfyUiApiError,
  createComfyUiClient,
  summarizeComfyUiErrorDetails,
  validateComfyUiTextToImageRequest,
  validateComfyUiRequestAgainstObjectInfo,
} from "@/features/comfyui";
import type { ComfyUiTextToImageRequest } from "@/features/comfyui";

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

function sanitizeReturnedRequest(request: ComfyUiTextToImageRequest) {
  return {
    ...request,
    ...(request.controlNet
      ? {
          controlNet: {
            ...request.controlNet,
            openPoseSvg: "",
            svg: "",
            imageDataUrl: "",
          },
        }
      : {}),
    ...(request.controlNets
      ? {
          controlNets: request.controlNets.map((controlNet) => ({
            ...controlNet,
            svg: "",
            imageDataUrl: "",
          })),
        }
      : {}),
  };
}

function parsePngDataUrl(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value.trim());

  if (!match) {
    throw new Error("ControlNet imageDataUrl must be a PNG data URL.");
  }

  return Buffer.from(match[1], "base64");
}

async function uploadControlNetImages(
  client: ReturnType<typeof createComfyUiClient>,
  request: ComfyUiTextToImageRequest,
) {
  if (!request.controlNets?.some((controlNet) => controlNet.enabled && (controlNet.svg || controlNet.imageDataUrl))) {
    return request;
  }

  const uploadedControlNets = await Promise.all(
    request.controlNets.map(async (controlNet) => {
      if (!controlNet.enabled || (!controlNet.svg && !controlNet.imageDataUrl)) {
        return controlNet;
      }

      const png = controlNet.imageDataUrl
        ? parsePngDataUrl(controlNet.imageDataUrl)
        : await sharp(Buffer.from(controlNet.svg ?? "")).png().toBuffer();
      const uploaded = await client.uploadImage({
        filename: `sceneforge-controlnet-${controlNet.type}-${Date.now()}.png`,
        bytes: png,
        mimeType: "image/png",
        overwrite: true,
        type: "input",
      });

      return {
        ...controlNet,
        imageName: uploaded.imageName,
      };
    }),
  );

  return {
    ...request,
    controlNets: uploadedControlNets,
  };
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
    const requestWithControlImage = await uploadControlNetImages(client, objectValidation.request);
    const result = await client.generateImage(requestWithControlImage, clientId ? { clientId } : undefined);

    return NextResponse.json({
      clientId,
      promptId: result.promptId,
      number: result.number,
      nodeErrors: result.nodeErrors,
      workflow: result.workflow,
      nodeIds: result.nodeIds,
      outputNodeId: result.outputNodeId,
      request: sanitizeReturnedRequest(result.request),
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
