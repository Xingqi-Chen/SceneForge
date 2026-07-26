import type {
  ComfyUiClient,
} from "./client";
import type { ComfyUiTextToImageRequest } from "./types";

import { parseComfyUiImageDataUrl } from "./image-data-url";

function getSourceImageExtension(mimeSubtype: string) {
  return mimeSubtype === "jpeg" || mimeSubtype === "jpg" ? "jpg" : mimeSubtype;
}

function getSourceImageMimeType(mimeSubtype: string) {
  return `image/${mimeSubtype === "jpg" ? "jpeg" : mimeSubtype}`;
}

export function parseComfyUiSourceImageDataUrl(dataUrl: string) {
  const parsed = parseComfyUiImageDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("sourceImageDataUrl must be a PNG, JPEG, or WEBP data URL.");
  }

  return {
    bytes: Buffer.from(parsed.base64, "base64"),
    extension: getSourceImageExtension(parsed.mimeSubtype),
    mimeType: getSourceImageMimeType(parsed.mimeSubtype),
  };
}

export async function uploadComfyUiTextToImageSourceImage(
  client: ComfyUiClient,
  request: ComfyUiTextToImageRequest,
): Promise<ComfyUiTextToImageRequest> {
  if (!request.sourceImageDataUrl || request.imageName) {
    return request;
  }

  const parsed = parseComfyUiSourceImageDataUrl(request.sourceImageDataUrl);
  const uploaded = await client.uploadImage({
    filename: `sceneforge-img2img-source-${Date.now()}.${parsed.extension}`,
    bytes: parsed.bytes,
    mimeType: parsed.mimeType,
    overwrite: true,
    type: "input",
  });

  return {
    ...request,
    imageName: uploaded.imageName,
  };
}
