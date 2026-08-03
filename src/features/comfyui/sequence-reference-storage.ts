import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const COMFYUI_SEQUENCE_REFERENCE_ROUTE_PREFIX = "/api/comfyui/sequence-references";

const DEFAULT_SEQUENCE_REFERENCE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "comfyui-sequence-references");
const SEQUENCE_REFERENCE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)$/i;
const MAX_SEQUENCE_REFERENCE_BYTES = 24 * 1024 * 1024;

const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export class ComfyUiSequenceReferenceStorageError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ComfyUiSequenceReferenceStorageError";
    this.statusCode = statusCode;
  }
}

export function getResolvedSequenceReferenceDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR || DEFAULT_SEQUENCE_REFERENCE_DIR);
}

function assertInsideDirectory(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ComfyUiSequenceReferenceStorageError("Invalid sequence reference path.");
  }
}

export function parseSequenceReferenceDataUrl(value: string): {
  bytes: Buffer;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  extension: string;
} {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value.trim());
  if (!match) {
    throw new ComfyUiSequenceReferenceStorageError("Reference image must be a PNG, JPEG, or WEBP data URL.");
  }

  const contentType = (match[1] === "image/jpg" ? "image/jpeg" : match[1]) as
    "image/png" | "image/jpeg" | "image/webp";
  const extension = CONTENT_TYPE_EXTENSIONS.get(contentType);
  if (!extension) {
    throw new ComfyUiSequenceReferenceStorageError("Unsupported reference image content type.", 415);
  }

  return {
    bytes: Buffer.from(match[2], "base64"),
    contentType,
    extension,
  };
}

export function getSequenceReferencePath(filename: string) {
  if (!SEQUENCE_REFERENCE_FILENAME_PATTERN.test(filename)) {
    return null;
  }

  const root = getResolvedSequenceReferenceDir();
  const target = path.resolve(/*turbopackIgnore: true*/ root, filename);
  assertInsideDirectory(root, target);
  return target;
}

export function getSequenceReferenceContentType(filename: string) {
  const extension = filename.split(".").pop()?.toLocaleLowerCase();
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  return "image/jpeg";
}

export function getSequenceReferenceUrl(filename: string) {
  return `${COMFYUI_SEQUENCE_REFERENCE_ROUTE_PREFIX}/${filename}`;
}

export async function storeSequenceReferenceImage(dataUrl: string) {
  const parsed = parseSequenceReferenceDataUrl(dataUrl);
  return storeSequenceReferenceBytes(parsed.bytes, parsed.contentType);
}

export async function storeSequenceReferenceBytes(
  bytes: Uint8Array,
  contentType: "image/png" | "image/jpeg" | "image/webp",
) {
  const extension = CONTENT_TYPE_EXTENSIONS.get(contentType);
  if (!extension) {
    throw new ComfyUiSequenceReferenceStorageError("Unsupported reference image content type.", 415);
  }
  if (bytes.byteLength === 0) {
    throw new ComfyUiSequenceReferenceStorageError("Reference image is empty.", 400);
  }
  if (bytes.byteLength > MAX_SEQUENCE_REFERENCE_BYTES) {
    throw new ComfyUiSequenceReferenceStorageError("Reference image is too large.", 413);
  }

  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const filename = `${hash}.${extension}`;
  const filePath = getSequenceReferencePath(filename);
  if (!filePath) {
    throw new ComfyUiSequenceReferenceStorageError("Invalid reference image filename.");
  }

  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ filePath, bytes);

  return {
    byteLength: bytes.byteLength,
    contentType,
    filename,
    url: getSequenceReferenceUrl(filename),
  };
}

export async function readSequenceReferenceImage(filename: string) {
  const filePath = getSequenceReferencePath(filename);
  if (!filePath) {
    throw new ComfyUiSequenceReferenceStorageError("Invalid reference image filename.");
  }

  try {
    return {
      bytes: await fs.readFile(/*turbopackIgnore: true*/ filePath),
      contentType: getSequenceReferenceContentType(filename),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ComfyUiSequenceReferenceStorageError("Sequence reference image not found.", 404);
    }

    throw error;
  }
}
