import { NextResponse } from "next/server";

import {
  COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS,
  ComfyUiApiError,
  createComfyUiClient,
  readComfyUiUpscaleModelOptions,
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
    const models = readComfyUiUpscaleModelOptions(objectInfo);
    const modelUpscaleOptions = Object.entries(COMFYUI_INPAINT_UPSCALE_MODEL_PRESETS).map(([mode, preset]) => ({
      mode,
      label: preset.label,
      modelName: preset.modelName,
      available: models.some((model) => model === preset.modelName),
    }));

    return NextResponse.json({
      models,
      modelUpscaleOptions,
    });
  } catch (error) {
    if (error instanceof ComfyUiApiError) {
      console.error("[SceneForge] [comfyui] failed to load upscale models", {
        statusCode: error.statusCode,
        details: error.details,
      });

      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] unexpected upscale model load failure", { error });

    return errorResponse("Unexpected ComfyUI upscale model request failure.", 500);
  }
}
