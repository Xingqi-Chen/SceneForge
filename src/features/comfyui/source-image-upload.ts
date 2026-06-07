import type {
  ComfyUiClient,
} from "./client";
import type { ComfyUiTextToImageRequest } from "./types";

const SOURCE_IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

function getSourceImageExtension(mimeSubtype: string) {
  return mimeSubtype === "jpeg" || mimeSubtype === "jpg" ? "jpg" : mimeSubtype;
}

function getSourceImageMimeType(mimeSubtype: string) {
  return `image/${mimeSubtype === "jpg" ? "jpeg" : mimeSubtype}`;
}

export function parseComfyUiSourceImageDataUrl(dataUrl: string) {
  const match = SOURCE_IMAGE_DATA_URL_PATTERN.exec(dataUrl.trim());

  if (!match) {
    throw new Error("sourceImageDataUrl must be a PNG, JPEG, or WEBP data URL.");
  }

  const mimeSubtype = match[1];
  const base64 = match[2];

  if (!mimeSubtype || !base64) {
    throw new Error("sourceImageDataUrl must include image bytes.");
  }

  return {
    bytes: Buffer.from(base64, "base64"),
    extension: getSourceImageExtension(mimeSubtype),
    mimeType: getSourceImageMimeType(mimeSubtype),
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
