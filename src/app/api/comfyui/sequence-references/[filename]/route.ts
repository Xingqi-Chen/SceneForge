import { NextResponse } from "next/server";

import {
  ComfyUiSequenceReferenceStorageError,
  readSequenceReferenceImage,
} from "@/features/comfyui/sequence-reference-storage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    filename: string;
  }>;
};

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

export async function GET(_request: Request, context: RouteContext) {
  const { filename } = await context.params;

  try {
    const image = await readSequenceReferenceImage(filename);
    return new Response(image.bytes, {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": image.contentType,
      },
    });
  } catch (error) {
    if (error instanceof ComfyUiSequenceReferenceStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    return errorResponse("Sequence reference image not found.", 404);
  }
}
