import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import {
  ComfyUiGeneratedImageStorageError,
  deleteGeneratedImage,
  getGeneratedImageContentType,
  getGeneratedImagePath,
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

export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  const filePath = getGeneratedImagePath(filename);
  if (!filePath) {
    return errorResponse("Invalid generated image path.", 400);
  }

  try {
    const bytes = await fs.readFile(filePath);
    return new Response(bytes, {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": getGeneratedImageContentType(filename),
      },
    });
  } catch {
    return errorResponse("Generated image not found.", 404);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;

  try {
    await deleteGeneratedImage(filename);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof ComfyUiGeneratedImageStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    console.error("[SceneForge] [comfyui] failed to delete generated image", { filename, error });
    return errorResponse("Unexpected ComfyUI generated image delete failure.", 500);
  }
}
