import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import {
  getArtistStringCachedImageContentType,
  getArtistStringCachedImagePath,
} from "@/features/artist-string-library";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  const filePath = getArtistStringCachedImagePath(filename);
  if (!filePath) {
    return NextResponse.json({ error: { message: "Invalid image path." } }, { status: 400 });
  }

  try {
    const bytes = await fs.readFile(filePath);
    return new Response(bytes, {
      headers: {
        "content-type": getArtistStringCachedImageContentType(),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: { message: "Image not found." } }, { status: 404 });
  }
}
