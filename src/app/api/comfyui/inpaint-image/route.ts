import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  ComfyUiApiError,
  buildBasicInpaintWorkflow,
  createComfyUiClient,
  summarizeComfyUiErrorDetails,
  validateComfyUiInpaintRequest,
  validateComfyUiInpaintRequestAgainstObjectInfo,
} from "@/features/comfyui";
import type { ComfyUiInpaintRequest, ComfyUiViewImageReference } from "@/features/comfyui";

export const runtime = "nodejs";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";

class InpaintInputError extends Error {
  readonly statusCode = 400;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "InpaintInputError";
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

function sanitizeReturnedRequest(request: ComfyUiInpaintRequest) {
  return {
    ...request,
    maskDataUrl: "",
  };
}

function parsePngDataUrl(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value.trim());

  if (!match) {
    throw new InpaintInputError("maskDataUrl must be a PNG data URL.");
  }

  return Buffer.from(match[1], "base64");
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

async function normalizeInpaintImages(sourceBytes: Buffer, maskBytes: Buffer) {
  try {
    const sourceSharp = sharp(sourceBytes);
    const maskSharp = sharp(maskBytes);
    const [sourceMetadata, maskMetadata] = await Promise.all([
      sourceSharp.metadata(),
      maskSharp.metadata(),
    ]);

    if (!sourceMetadata.width || !sourceMetadata.height) {
      throw new InpaintInputError("Unable to read source image dimensions.");
    }

    if (!maskMetadata.width || !maskMetadata.height) {
      throw new InpaintInputError("Unable to read mask image dimensions.");
    }

    if (sourceMetadata.width !== maskMetadata.width || sourceMetadata.height !== maskMetadata.height) {
      throw new InpaintInputError("Mask dimensions must match the source image dimensions.", {
        source: {
          width: sourceMetadata.width,
          height: sourceMetadata.height,
        },
        mask: {
          width: maskMetadata.width,
          height: maskMetadata.height,
        },
      });
    }

    const [sourcePng, maskPng] = await Promise.all([
      sourceSharp.png().toBuffer(),
      maskSharp.greyscale().png().toBuffer(),
    ]);

    return {
      maskPng,
      sourcePng,
    };
  } catch (error) {
    if (error instanceof InpaintInputError) {
      throw error;
    }

    throw new InpaintInputError("Unable to decode source image or mask PNG data.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function uploadInpaintImages(
  client: ReturnType<typeof createComfyUiClient>,
  request: ComfyUiInpaintRequest,
) {
  if (!request.sourceImage) {
    throw new InpaintInputError("sourceImage is required.");
  }

  if (!request.maskDataUrl) {
    throw new InpaintInputError("maskDataUrl is required.");
  }

  const sourceBytes = await readSourceImageBytes(client, request.sourceImage);
  const maskBytes = parsePngDataUrl(request.maskDataUrl);
  const { maskPng, sourcePng } = await normalizeInpaintImages(sourceBytes, maskBytes);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [sourceUpload, maskUpload] = await Promise.all([
    client.uploadImage({
      filename: `sceneforge-inpaint-source-${suffix}.png`,
      bytes: sourcePng,
      mimeType: "image/png",
      overwrite: true,
      type: "input",
    }),
    client.uploadImage({
      filename: `sceneforge-inpaint-mask-${suffix}.png`,
      bytes: maskPng,
      mimeType: "image/png",
      overwrite: true,
      type: "input",
    }),
  ]);

  return {
    ...request,
    imageName: sourceUpload.imageName,
    maskName: maskUpload.imageName,
  };
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const validation = validateComfyUiInpaintRequest(payload);
  if (!validation.ok) {
    return errorResponse(validation.message, 400, validation.details);
  }

  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateComfyUiInpaintRequestAgainstObjectInfo(validation.request, objectInfo);

    if (objectValidation.errors.length > 0) {
      return errorResponse("ComfyUI inpaint request does not match the current ComfyUI model/node options.", 400, {
        errors: objectValidation.errors,
        warnings: objectValidation.warnings,
      });
    }

    const clientId = readClientId(payload);
    const requestWithImages = await uploadInpaintImages(client, objectValidation.request);
    const workflow = buildBasicInpaintWorkflow(requestWithImages);
    const queued = await client.queuePrompt(workflow.workflow, clientId ? { clientId } : undefined);

    return NextResponse.json({
      clientId,
      promptId: queued.promptId,
      number: queued.number,
      nodeErrors: queued.nodeErrors,
      workflow: workflow.workflow,
      nodeIds: workflow.nodeIds,
      outputNodeId: workflow.outputNodeId,
      request: sanitizeReturnedRequest(workflow.request),
    });
  } catch (error) {
    if (error instanceof InpaintInputError) {
      return errorResponse(error.message, error.statusCode, error.details);
    }

    if (error instanceof ComfyUiApiError) {
      const message = makeComfyUiErrorMessage(error);
      console.error("[SceneForge] [comfyui] ComfyUI inpaint request failed", {
        statusCode: error.statusCode,
        details: JSON.stringify(error.details),
        summary: message,
      });

      return errorResponse(message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] unexpected inpaint failure", { error });

    return errorResponse("Unexpected ComfyUI inpaint request failure.", 500);
  }
}
