import { NextResponse } from "next/server";

import {
  ComfyUiGeneratedImageStorageError,
  deleteComfyUiLocalImage,
  sanitizeComfyUiViewImageReference,
} from "@/features/comfyui/generated-image-storage";

export const runtime = "nodejs";

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

export async function DELETE(request: Request) {
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
    await deleteComfyUiLocalImage(image);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof ComfyUiGeneratedImageStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    console.error("[SceneForge] [comfyui] failed to delete ComfyUI image file", { error });
    return errorResponse("Unexpected ComfyUI image delete failure.", 500);
  }
}
