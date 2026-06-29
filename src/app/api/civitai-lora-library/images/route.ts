import { createCivitaiCachedImageResponse } from "./image-response";

export const runtime = "nodejs";

const IMAGE_PATH_PREFIX = "/api/civitai-lora-library/images/";

function getRequestedFilename(request: Request) {
  const url = new URL(request.url);
  const queryFilename = url.searchParams.get("filename");
  if (queryFilename) {
    return queryFilename;
  }

  if (!url.pathname.startsWith(IMAGE_PATH_PREFIX)) {
    return null;
  }

  const pathFilename = url.pathname.slice(IMAGE_PATH_PREFIX.length);
  return pathFilename && !pathFilename.includes("/") ? decodeURIComponent(pathFilename) : null;
}

export async function GET(request: Request) {
  const filename = getRequestedFilename(request);
  return createCivitaiCachedImageResponse(filename);
}
