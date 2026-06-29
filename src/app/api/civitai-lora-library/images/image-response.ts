import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import {
  getCivitaiCachedImageContentType,
  getCivitaiCachedImagePath,
} from "@/features/civitai-lora-library/image-assets";

export async function createCivitaiCachedImageResponse(filename: string | null | undefined) {
  if (!filename) {
    return NextResponse.json({ error: { message: "Missing image filename." } }, { status: 400 });
  }

  const filePath = getCivitaiCachedImagePath(filename);
  if (!filePath) {
    return NextResponse.json({ error: { message: "Invalid image path." } }, { status: 400 });
  }

  try {
    const bytes = await fs.readFile(filePath);
    return new Response(bytes, {
      headers: {
        "content-type": getCivitaiCachedImageContentType(filename),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: { message: "Image not found." } }, { status: 404 });
  }
}
