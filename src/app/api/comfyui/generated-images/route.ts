import { NextResponse } from "next/server";

import {
  ComfyUiApiError,
  createComfyUiClient,
} from "@/features/comfyui";
import {
  ComfyUiGeneratedImageStorageError,
  deleteComfyUiLocalImage,
  sanitizeComfyUiViewImageReference,
  storeGeneratedImage,
} from "@/features/comfyui/generated-image-storage";
import type { ComfyUiViewImageReference } from "@/features/comfyui/types";

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

async function tryDeleteSavedSourceImage(image: ComfyUiViewImageReference) {
  if (image.type !== "temp") {
    return {
      attempted: false,
      deleted: false,
      reason: "Only ComfyUI temporary preview files are deleted after saving.",
    };
  }

  try {
    await deleteComfyUiLocalImage(image);
    return {
      attempted: true,
      deleted: true,
    };
  } catch (error) {
    if (error instanceof ComfyUiGeneratedImageStorageError) {
      return {
        attempted: true,
        deleted: false,
        error: error.message,
      };
    }

    console.error("[SceneForge] [comfyui] failed to delete saved source image", { error });
    return {
      attempted: true,
      deleted: false,
      error: "Unexpected ComfyUI temporary image cleanup failure.",
    };
  }
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  try {
    const image = sanitizeComfyUiViewImageReference(
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { image?: unknown }).image
        : null,
    );
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const response = await fetch(client.buildViewUrl(image), {
      cache: "no-store",
      headers: {
        accept: "image/*",
        ...(process.env.COMFYUI_API_KEY ? { authorization: `Bearer ${process.env.COMFYUI_API_KEY}` } : {}),
      },
    });

    if (!response.ok) {
      const details = await response.text().catch(() => null);
      return errorResponse("ComfyUI image request failed.", response.status || 502, details);
    }

    const result = await storeGeneratedImage(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("content-type"),
    );
    const sourceDeletion = await tryDeleteSavedSourceImage(image);

    return NextResponse.json({
      ...result,
      sourceDeletion,
    });
  } catch (error) {
    if (error instanceof ComfyUiGeneratedImageStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    if (error instanceof ComfyUiApiError) {
      return errorResponse(error.message, error.statusCode ?? 500, error.details);
    }

    console.error("[SceneForge] [comfyui] failed to save generated image", { error });
    return errorResponse("Unexpected ComfyUI generated image save failure.", 500);
  }
}
