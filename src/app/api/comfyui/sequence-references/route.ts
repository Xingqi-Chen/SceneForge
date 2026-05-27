import { NextResponse } from "next/server";

import {
  ComfyUiSequenceReferenceStorageError,
  storeSequenceReferenceImage,
} from "@/features/comfyui/sequence-reference-storage";

export const runtime = "nodejs";

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      error: {
        message,
      },
    },
    { status },
  );
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const dataUrl = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { dataUrl?: unknown }).dataUrl
    : undefined;
  if (typeof dataUrl !== "string") {
    return errorResponse("dataUrl is required.", 400);
  }

  try {
    return NextResponse.json(await storeSequenceReferenceImage(dataUrl));
  } catch (error) {
    if (error instanceof ComfyUiSequenceReferenceStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    console.error("[SceneForge] [comfyui] failed to store sequence reference", { error });
    return errorResponse("Unexpected sequence reference storage failure.", 500);
  }
}
