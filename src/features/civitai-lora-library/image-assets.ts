import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getCivitaiImageVariantUrl } from "./image-url";

const IMAGE_CACHE_DIR = path.join(process.cwd(), "data", "civitai-lora-library", "images");
const IMAGE_ROUTE_PREFIX = "/api/civitai-lora-library/images";
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_SIZE = 768;
const OFFICIAL_REFERENCE_MAX_IMAGE_SIZE = 512;
const CIVITAI_DOWNLOAD_VARIANT_SIZE = 512;
const OFFICIAL_REFERENCE_CACHE_CONCURRENCY = 4;
const CACHE_FILENAME_PATTERN = /^[a-f0-9]{32}\.webp$/i;

const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getImageExtension(url: string, contentType: string | null) {
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLocaleLowerCase();
  if (normalizedContentType && CONTENT_TYPE_EXTENSIONS.has(normalizedContentType)) {
    return CONTENT_TYPE_EXTENSIONS.get(normalizedContentType)!;
  }

  const pathname = new URL(url).pathname.toLocaleLowerCase();
  const match = /\.(jpe?g|png|webp|gif)$/.exec(pathname);
  if (!match?.[1]) {
    return "jpg";
  }

  return match[1] === "jpeg" ? "jpg" : match[1];
}

function getCachedFilename(url: string, contentType: string | null, cacheKey?: string) {
  const hash = crypto.createHash("sha256").update(`${cacheKey ?? "shared"}:${url}`).digest("hex").slice(0, 32);
  if (contentType === "image/webp") {
    return `${hash}.webp`;
  }

  return `${hash}.${getImageExtension(url, contentType)}`;
}

function getLocalCachedFilename(url: string | null | undefined) {
  if (!url?.startsWith(`${IMAGE_ROUTE_PREFIX}/`)) {
    return null;
  }

  const filename = url.split(/[?#]/)[0]?.slice(`${IMAGE_ROUTE_PREFIX}/`.length);
  return filename && getCivitaiCachedImagePath(filename) ? filename : null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );

  return results;
}

export function getCivitaiCachedImagePath(filename: string) {
  if (!/^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/i.test(filename)) {
    return null;
  }

  return path.join(IMAGE_CACHE_DIR, filename);
}

export function getCivitaiCachedImageContentType(filename: string) {
  const extension = filename.split(".").pop()?.toLocaleLowerCase();
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  return "image/jpeg";
}

export async function cleanupLegacyOriginalCachedImages(): Promise<void> {
  const files = await fs.readdir(IMAGE_CACHE_DIR).catch(() => []);
  await Promise.all(
    files
      .filter((file) => /^[a-f0-9]{32}\.(?:jpg|jpeg|png|gif)$/i.test(file))
      .map((file) => fs.rm(path.join(IMAGE_CACHE_DIR, file), { force: true }).catch(() => undefined)),
  );
}

async function downscaleImage(bytes: Uint8Array, maxSize: number) {
  return sharp(bytes)
    .rotate()
    .resize({
      width: maxSize,
      height: maxSize,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer();
}

async function downloadAndStoreCivitaiImageUrl(url: string, filePath: string, maxSize: number) {
  const downloadUrl = getCivitaiImageVariantUrl(url, CIVITAI_DOWNLOAD_VARIANT_SIZE) ?? url;
  let response: Response;
  try {
    response = await fetch(downloadUrl, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        referer: "https://civitai.com/",
        "user-agent": "SceneForge/1.0 (+https://civitai.com)",
      },
    });
  } catch {
    return downloadUrl === url ? false : downloadAndStoreCivitaiImageUrlOriginal(url, filePath, maxSize);
  }
  if (!response.ok) {
    if (downloadUrl === url) {
      return false;
    }
    return downloadAndStoreCivitaiImageUrlOriginal(url, filePath, maxSize);
  }

  const contentType = response.headers.get("content-type");
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLocaleLowerCase();
  if (normalizedContentType && !normalizedContentType.startsWith("image/")) {
    if (downloadUrl === url) {
      return false;
    }
    return downloadAndStoreCivitaiImageUrlOriginal(url, filePath, maxSize);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    if (downloadUrl === url) {
      return false;
    }
    return downloadAndStoreCivitaiImageUrlOriginal(url, filePath, maxSize);
  }

  try {
    const resizedBytes = await downscaleImage(bytes, maxSize);
    await fs.mkdir(IMAGE_CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, resizedBytes);
    return true;
  } catch {
    return downloadUrl === url ? false : downloadAndStoreCivitaiImageUrlOriginal(url, filePath, maxSize);
  }
}

async function downloadAndStoreCivitaiImageUrlOriginal(url: string, filePath: string, maxSize: number) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        referer: "https://civitai.com/",
        "user-agent": "SceneForge/1.0 (+https://civitai.com)",
      },
    });
  } catch {
    return false;
  }
  if (!response.ok) {
    return false;
  }

  const contentType = response.headers.get("content-type");
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLocaleLowerCase();
  if (normalizedContentType && !normalizedContentType.startsWith("image/")) {
    return false;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    return false;
  }

  try {
    const resizedBytes = await downscaleImage(bytes, maxSize);
    await fs.mkdir(IMAGE_CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, resizedBytes);
    return true;
  } catch {
    return false;
  }
}

function getSourceUrl(entry: Record<string, unknown>) {
  return typeof entry.sourceUrl === "string"
    ? entry.sourceUrl
    : typeof entry.url === "string"
      ? entry.url
      : typeof entry.imageUrl === "string"
        ? entry.imageUrl
        : null;
}

export async function cleanupUnreferencedCachedImages(referencedLocalUrls: Set<string>): Promise<void> {
  if (referencedLocalUrls.size === 0) {
    return;
  }

  const referencedFilenames = new Set(
    [...referencedLocalUrls]
      .map((url) => getLocalCachedFilename(url))
      .filter((filename): filename is string => Boolean(filename)),
  );
  const files = await fs.readdir(IMAGE_CACHE_DIR).catch(() => []);
  await Promise.all(
    files
      .filter((file) => CACHE_FILENAME_PATTERN.test(file) && !referencedFilenames.has(file))
      .map((file) => fs.rm(path.join(IMAGE_CACHE_DIR, file), { force: true }).catch(() => undefined)),
  );
}

export async function cacheCivitaiImageUrl(
  url: string | null | undefined,
  options: { cacheKey?: string; maxSize?: number } = {},
): Promise<string | null> {
  if (!url) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const filename = getCachedFilename(url, "image/webp", options.cacheKey);
  const localUrl = `${IMAGE_ROUTE_PREFIX}/${filename}`;
  const cachedFilePath = path.join(IMAGE_CACHE_DIR, filename);
  try {
    const stat = await fs.stat(cachedFilePath);
    if (stat.isFile() && stat.size > 0) {
      return localUrl;
    }
  } catch {
    // Cache miss. Fetch and downscale the source image below.
  }

  try {
    return (await downloadAndStoreCivitaiImageUrl(url, cachedFilePath, options.maxSize ?? DEFAULT_MAX_IMAGE_SIZE))
      ? localUrl
      : null;
  } catch {
    return null;
  }
}

export async function repairMissingCivitaiImageCache(
  references: Array<{ sourceUrl: string; localUrl: string }>,
): Promise<{ checked: number; repaired: number; failed: number; skipped: number }> {
  const results = await Promise.all(
    references.map(async (reference): Promise<"repaired" | "failed" | "skipped"> => {
      const filename = getLocalCachedFilename(reference.localUrl);
      if (!filename) {
        return "skipped";
      }

      const filePath = path.join(IMAGE_CACHE_DIR, filename);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && stat.size > 0) {
          return "skipped";
        }
      } catch {
        // Missing cache file. Recreate it from the original Civitai image below.
      }

      try {
        return (await downloadAndStoreCivitaiImageUrl(reference.sourceUrl, filePath, OFFICIAL_REFERENCE_MAX_IMAGE_SIZE))
          ? "repaired"
          : "failed";
      } catch {
        return "failed";
      }
    }),
  );

  return {
    checked: references.length,
    repaired: results.filter((result) => result === "repaired").length,
    failed: results.filter((result) => result === "failed").length,
    skipped: results.filter((result) => result === "skipped").length,
  };
}

export const repairMissingOfficialImageCache = repairMissingCivitaiImageCache;

export function extractCivitaiImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const url = typeof entry.url === "string" ? entry.url : typeof entry.imageUrl === "string" ? entry.imageUrl : null;
      if (!url) {
        return null;
      }

      const type = typeof entry.type === "string" ? entry.type.toLocaleLowerCase() : "";
      const mimeType =
        typeof entry.mimeType === "string"
          ? entry.mimeType.toLocaleLowerCase()
          : typeof entry.mime === "string"
            ? entry.mime.toLocaleLowerCase()
            : "";
      const urlWithoutQuery = url.split("?")[0]?.toLocaleLowerCase() ?? url.toLocaleLowerCase();
      if (
        type === "video" ||
        type === "animated" ||
        mimeType.startsWith("video/") ||
        /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(urlWithoutQuery)
      ) {
        return null;
      }

      return url;
    })
    .filter((url): url is string => Boolean(url));
}

export function extractCivitaiImageSourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (isRecord(entry) ? getSourceUrl(entry) : null))
    .filter((url): url is string => Boolean(url));
}

export async function cacheSelectedOfficialImages(
  officialImagesJson: unknown,
  selectedUrls: Set<string> | null,
  options: {
    cacheKey: string;
  },
): Promise<unknown> {
  if (!Array.isArray(officialImagesJson)) {
    return officialImagesJson;
  }

  type CachedOfficialImageEntry = Record<string, unknown> & {
    sourceUrl: string;
    url: string;
    cached: true;
  };

  const candidates = officialImagesJson.filter((entry): entry is Record<string, unknown> => {
    if (!isRecord(entry)) {
      return false;
    }

    const sourceUrl = getSourceUrl(entry);
    return Boolean(sourceUrl && (!selectedUrls || selectedUrls.has(sourceUrl)));
  });

  const entries = await mapWithConcurrency<Record<string, unknown>, CachedOfficialImageEntry | null>(
    candidates,
    OFFICIAL_REFERENCE_CACHE_CONCURRENCY,
    async (entry) => {
      const sourceUrl = getSourceUrl(entry);
      if (!sourceUrl) {
        return null;
      }

      const localUrl = await cacheCivitaiImageUrl(sourceUrl, {
        cacheKey: options.cacheKey,
        maxSize: OFFICIAL_REFERENCE_MAX_IMAGE_SIZE,
      });
      if (!localUrl) {
        return null;
      }

      return {
        ...entry,
        sourceUrl,
        url: localUrl,
        cached: true,
      };
    },
  );

  return entries.filter((entry): entry is CachedOfficialImageEntry => Boolean(entry));
}
