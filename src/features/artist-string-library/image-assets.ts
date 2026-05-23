import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const IMAGE_CACHE_DIR = path.join(process.cwd(), "data", "artist-string-library", "images");
const IMAGE_ROUTE_PREFIX = "/api/artist-string-library/images";
const CACHE_FILENAME_PATTERN = /^[a-f0-9]{32}\.webp$/i;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_SIZE = 512;

function getCachedFilename(cacheKey: string, sourceUrl: string) {
  return `${crypto.createHash("sha256").update(`${cacheKey}:${sourceUrl}`).digest("hex").slice(0, 32)}.webp`;
}

function getLocalCachedFilename(url: string | null | undefined) {
  if (!url?.startsWith(`${IMAGE_ROUTE_PREFIX}/`)) {
    return null;
  }

  const filename = url.split(/[?#]/)[0]?.slice(`${IMAGE_ROUTE_PREFIX}/`.length);
  return filename && getArtistStringCachedImagePath(filename) ? filename : null;
}

async function getImageMetadata(filePath: string) {
  const metadata = await sharp(filePath).metadata();
  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
  };
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

export function getArtistStringCachedImagePath(filename: string) {
  if (!CACHE_FILENAME_PATTERN.test(filename)) {
    return null;
  }

  return path.join(IMAGE_CACHE_DIR, filename);
}

export function getArtistStringCachedImageContentType() {
  return "image/webp";
}

export async function cacheArtistStringImageUrl(
  url: string | null | undefined,
  options: { cacheKey: string; maxSize?: number; referer?: string } = { cacheKey: "shared" },
): Promise<{ localUrl: string; width: number | null; height: number | null; cached: boolean } | null> {
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

  const filename = getCachedFilename(options.cacheKey, url);
  const localUrl = `${IMAGE_ROUTE_PREFIX}/${filename}`;
  const filePath = path.join(IMAGE_CACHE_DIR, filename);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile() && stat.size > 0) {
      return { localUrl, ...(await getImageMetadata(filePath)), cached: true };
    }
  } catch {
    // Cache miss. Fetch and downscale below.
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        referer: options.referer ?? parsed.origin,
        "user-agent": "SceneForge/1.0",
      },
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLocaleLowerCase();
  if (contentType && !contentType.startsWith("image/")) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    return null;
  }

  try {
    const resized = await downscaleImage(bytes, options.maxSize ?? DEFAULT_MAX_IMAGE_SIZE);
    await fs.mkdir(IMAGE_CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, resized);
    return { localUrl, ...(await getImageMetadata(filePath)), cached: true };
  } catch {
    return null;
  }
}

export async function cleanupUnreferencedArtistStringCachedImages(
  referencedLocalUrls: Set<string>,
): Promise<void> {
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
