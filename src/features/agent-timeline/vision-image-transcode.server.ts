import fs from "node:fs/promises";

import sharp from "sharp";

import { getGeneratedImagePath } from "@/features/comfyui/generated-image-storage";

import { createTimelineNodeError } from "./state";
import { TimelineNodeExecutionError, type TimelineStoredGeneratedImage } from "./types";

export async function createStoredImageVisionDataUrl(
  stored: TimelineStoredGeneratedImage,
  itemId: string,
  stage: "preview-scoring" | "final-review",
) {
  const filePath = getGeneratedImagePath(stored.filename);
  if (!filePath) {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "image_storage_invalid",
      "A managed image reference is invalid and could not be prepared for Vision review.",
      { itemId, stage, recoverable: true },
    ));
  }

  let sourceBytes: Buffer;
  try {
    sourceBytes = await fs.readFile(/*turbopackIgnore: true*/ filePath);
  } catch {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "image_storage_failed",
      "A managed image could not be read for Vision review.",
      { itemId, stage, recoverable: true },
    ));
  }

  try {
    const reviewBytes = await sharp(sourceBytes)
      .rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${reviewBytes.toString("base64")}`;
  } catch {
    throw new TimelineNodeExecutionError(createTimelineNodeError(
      "image_storage_failed",
      "A managed image could not be transcoded for Vision review.",
      { itemId, stage, recoverable: true },
    ));
  }
}
