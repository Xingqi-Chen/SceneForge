import { NextResponse } from "next/server";

import {
  ComfyUiApiError,
  createComfyUiClient,
  readComfyUiKSamplerOptions,
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

export async function GET() {
  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const objectInfo = await client.getObjectInfo();

    return NextResponse.json(readComfyUiKSamplerOptions(objectInfo));
  } catch (error) {
    if (error instanceof ComfyUiApiError) {
      console.error("[SceneForge] [comfyui] failed to load KSampler options", {
        statusCode: error.statusCode,
        details: error.details,
      });

      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] unexpected KSampler option load failure", { error });

    return errorResponse("Unexpected ComfyUI KSampler option request failure.", 500);
  }
}
