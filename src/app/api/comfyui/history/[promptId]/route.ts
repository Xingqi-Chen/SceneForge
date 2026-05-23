import { NextResponse } from "next/server";

import {
  ComfyUiApiError,
  createComfyUiClient,
  extractComfyUiHistoryImages,
  isComfyUiPromptHistoryComplete,
  type ComfyUiPromptHistoryResponse,
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

function buildViewProxyUrl(image: { filename: string; subfolder?: string; type?: string }, promptId: string) {
  const params = new URLSearchParams();
  params.set("filename", image.filename);
  params.set("promptId", promptId);

  if (image.subfolder !== undefined) {
    params.set("subfolder", image.subfolder);
  }

  if (image.type !== undefined) {
    params.set("type", image.type);
  }

  return `/api/comfyui/view?${params.toString()}`;
}

export async function GET(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  const { promptId } = await context.params;
  const normalizedPromptId = promptId.trim();

  if (!normalizedPromptId) {
    return errorResponse("promptId is required.", 400);
  }

  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });

    const raw = await client.getHistory(normalizedPromptId);
    const images = extractComfyUiHistoryImages(raw, normalizedPromptId).map((image) => ({
      ...image,
      url: buildViewProxyUrl(image, normalizedPromptId),
    }));
    const payload: ComfyUiPromptHistoryResponse = {
      promptId: normalizedPromptId,
      completed: isComfyUiPromptHistoryComplete(raw, normalizedPromptId),
      images,
      raw,
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof ComfyUiApiError) {
      console.error("[SceneForge] [comfyui] failed to read prompt history", {
        statusCode: error.statusCode,
        details: error.details,
      });

      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] unexpected prompt history failure", { error });

    return errorResponse("Unexpected ComfyUI history request failure.", 500);
  }
}
