import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ComfyUiViewImageReference } from "./types";

export const COMFYUI_GENERATED_IMAGE_ROUTE_PREFIX = "/api/comfyui/generated-images";

const DEFAULT_GENERATED_IMAGE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "comfyui-generated-images");
const GENERATED_IMAGE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:gif|jpg|jpeg|png|webp)$/i;
const MAX_GENERATED_IMAGE_BYTES = 64 * 1024 * 1024;

const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export class ComfyUiGeneratedImageStorageError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ComfyUiGeneratedImageStorageError";
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getResolvedGeneratedImagesDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SCENEFORGE_GENERATED_IMAGES_DIR || DEFAULT_GENERATED_IMAGE_DIR);
}

export function getResolvedComfyUiTempDir() {
  return process.env.COMFYUI_TEMP_DIR?.trim()
    ? path.resolve(/*turbopackIgnore: true*/ process.env.COMFYUI_TEMP_DIR)
    : null;
}

function assertInsideDirectory(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ComfyUiGeneratedImageStorageError("Invalid image path.");
  }
}

function sanitizePathPart(value: string | undefined, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    normalized.split("/").some((part) => part.length === 0)
  ) {
    throw new ComfyUiGeneratedImageStorageError(`Invalid ${fieldName}.`);
  }

  return normalized;
}

export function sanitizeComfyUiViewImageReference(value: unknown): ComfyUiViewImageReference {
  if (!isRecord(value)) {
    throw new ComfyUiGeneratedImageStorageError("image reference is required.");
  }

  const filename = readOptionalString(value.filename);
  if (!filename) {
    throw new ComfyUiGeneratedImageStorageError("image filename is required.");
  }

  const safeFilename = sanitizePathPart(filename, "filename");
  if (!safeFilename || safeFilename.includes("/")) {
    throw new ComfyUiGeneratedImageStorageError("Invalid image filename.");
  }

  const subfolder = sanitizePathPart(readOptionalString(value.subfolder), "subfolder");
  const type = readOptionalString(value.type);

  return {
    filename: safeFilename,
    ...(subfolder !== undefined ? { subfolder } : {}),
    ...(type !== undefined ? { type } : {}),
  };
}

export function getGeneratedImagePath(filename: string) {
  if (!GENERATED_IMAGE_FILENAME_PATTERN.test(filename)) {
    return null;
  }

  const root = getResolvedGeneratedImagesDir();
  const target = path.resolve(/*turbopackIgnore: true*/ root, filename);
  assertInsideDirectory(root, target);
  return target;
}

export function getGeneratedImageContentType(filename: string) {
  const extension = filename.split(".").pop()?.toLocaleLowerCase();
  if (extension === "gif") {
    return "image/gif";
  }
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  return "image/jpeg";
}

export function getGeneratedImageUrl(filename: string) {
  return `${COMFYUI_GENERATED_IMAGE_ROUTE_PREFIX}/${filename}`;
}

export async function storeGeneratedImage(bytes: Uint8Array, contentType: string | null) {
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLocaleLowerCase() ?? "";
  const extension = CONTENT_TYPE_EXTENSIONS.get(normalizedContentType);

  if (!extension) {
    throw new ComfyUiGeneratedImageStorageError("ComfyUI did not return a supported image content type.", 415);
  }

  if (bytes.byteLength === 0) {
    throw new ComfyUiGeneratedImageStorageError("ComfyUI returned an empty image.", 502);
  }

  if (bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new ComfyUiGeneratedImageStorageError("Generated image is too large to save.", 413);
  }

  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const filename = `${hash}.${extension}`;
  const filePath = getGeneratedImagePath(filename);
  if (!filePath) {
    throw new ComfyUiGeneratedImageStorageError("Invalid generated image filename.");
  }

  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ filePath, bytes);

  return {
    byteLength: bytes.byteLength,
    contentType: normalizedContentType,
    filename,
    url: getGeneratedImageUrl(filename),
  };
}

export async function deleteGeneratedImage(filename: string) {
  const filePath = getGeneratedImagePath(filename);
  if (!filePath) {
    throw new ComfyUiGeneratedImageStorageError("Invalid generated image filename.");
  }

  await fs.rm(/*turbopackIgnore: true*/ filePath, { force: true });
  return { deleted: true };
}

export async function deleteComfyUiLocalImage(reference: ComfyUiViewImageReference) {
  const type = reference.type ?? "";
  if (type !== "temp") {
    throw new ComfyUiGeneratedImageStorageError("Only ComfyUI temporary files can be deleted.", 400);
  }

  const root = getResolvedComfyUiTempDir();
  if (!root) {
    throw new ComfyUiGeneratedImageStorageError(
      "COMFYUI_TEMP_DIR is not configured; cannot delete the ComfyUI temporary file.",
      400,
    );
  }

  const safeReference = sanitizeComfyUiViewImageReference(reference);
  const target = path.resolve(
    /*turbopackIgnore: true*/
    root,
    safeReference.subfolder ?? "",
    safeReference.filename,
  );
  assertInsideDirectory(root, target);

  await fs.rm(/*turbopackIgnore: true*/ target, { force: true });
  return { deleted: true };
}
