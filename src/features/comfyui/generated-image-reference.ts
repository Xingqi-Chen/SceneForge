import type { ComfyUiViewImageReference } from "./types";

export const MAX_MANAGED_GENERATED_IMAGE_BYTES = 64 * 1024 * 1024;
export const MANAGED_GENERATED_IMAGE_FILENAME_PATTERN = /^[a-f0-9]{32}\.(?:gif|jpg|jpeg|png|webp)$/i;
const GENERATED_IMAGE_ROUTE_PREFIX = "/api/comfyui/generated-images";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safePathPart(value: unknown, allowSlash: boolean) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.includes(":") ||
      normalized.includes("..") || normalized.split("/").some((part) => !part || part === ".") ||
      (!allowSlash && normalized.includes("/"))) return null;
  return normalized;
}

export function normalizeComfyUiViewImageReference(value: unknown): ComfyUiViewImageReference | null {
  if (!isRecord(value)) return null;
  const filename = safePathPart(value.filename, false);
  const subfolder = safePathPart(value.subfolder, true);
  const type = typeof value.type === "string" && /^(?:input|output|temp)$/.test(value.type.trim())
    ? value.type.trim()
    : value.type === undefined ? undefined : null;
  if (!filename || subfolder === null || type === null) return null;
  return {
    filename,
    ...(subfolder ? { subfolder } : {}),
    ...(type ? { type } : {}),
  };
}

export type SafeStoredGeneratedImageReference = {
  byteLength: number;
  contentType: string;
  filename: string;
  url: string;
};

export function normalizeStoredGeneratedImageReference(value: unknown): SafeStoredGeneratedImageReference | null {
  if (!isRecord(value) || typeof value.filename !== "string" ||
      !MANAGED_GENERATED_IMAGE_FILENAME_PATTERN.test(value.filename) ||
      !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) <= 0 ||
      (value.byteLength as number) > MAX_MANAGED_GENERATED_IMAGE_BYTES) return null;
  const filename = value.filename;
  const extension = filename.split(".").pop()?.toLowerCase();
  const expectedContentTypes = extension === "png" ? ["image/png"]
    : extension === "webp" ? ["image/webp"]
      : extension === "gif" ? ["image/gif"]
        : ["image/jpeg", "image/jpg"];
  if (typeof value.contentType !== "string" || !expectedContentTypes.includes(value.contentType.toLowerCase()) ||
      value.url !== `${GENERATED_IMAGE_ROUTE_PREFIX}/${filename}`) return null;
  return {
    byteLength: value.byteLength as number,
    contentType: value.contentType.toLowerCase(),
    filename,
    url: value.url,
  };
}
