const CIVITAI_IMAGE_HOSTS = new Set(["image.civitai.com", "imagecache.civitai.com"]);
const CIVITAI_IMAGE_VARIANT_SEGMENT = /\/(?:original=true|width=\d+(?:,[^/]*)?)\//;

export function getCivitaiImageVariantUrl(url: string | null | undefined, width = 512): string | null {
  if (!url || width <= 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!CIVITAI_IMAGE_HOSTS.has(parsed.hostname) || !CIVITAI_IMAGE_VARIANT_SEGMENT.test(parsed.pathname)) {
    return null;
  }

  parsed.pathname = parsed.pathname.replace(CIVITAI_IMAGE_VARIANT_SEGMENT, `/width=${Math.round(width)}/`);
  return parsed.toString();
}
