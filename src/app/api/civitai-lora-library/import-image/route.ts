import { NextResponse } from "next/server";

import { importCivitaiImageUrlToSqlite } from "@/features/civitai-lora-library";
import { openSceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        message,
        details,
      },
    },
    { status },
  );
}

function getErrorStatus(error: unknown) {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") {
      if (statusCode === 429) {
        return 429;
      }
      if (statusCode === 404) {
        return 404;
      }
      if (statusCode >= 400 && statusCode < 500) {
        return 502;
      }
    }
  }

  return 500;
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求体必须是有效的 JSON。", 400);
  }

  const imageUrl =
    payload && typeof payload === "object" && "imageUrl" in payload
      ? (payload as { imageUrl?: unknown }).imageUrl
      : null;

  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    return errorResponse("请提供 Civitai image URL。", 400);
  }

  const selectedOfficialImageUrls =
    payload && typeof payload === "object" && "selectedOfficialImageUrls" in payload
      ? (payload as { selectedOfficialImageUrls?: unknown }).selectedOfficialImageUrls
      : undefined;
  const normalizedSelectedOfficialImageUrls = Array.isArray(selectedOfficialImageUrls)
    ? selectedOfficialImageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : undefined;
  const selectedOfficialImages =
    payload && typeof payload === "object" && "selectedOfficialImages" in payload
      ? (payload as { selectedOfficialImages?: unknown }).selectedOfficialImages
      : undefined;
  const normalizedSelectedOfficialImages = Array.isArray(selectedOfficialImages)
    ? selectedOfficialImages
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const resourceKey = (entry as { resourceKey?: unknown }).resourceKey;
          const url = (entry as { url?: unknown }).url;
          return typeof resourceKey === "string" && typeof url === "string" && resourceKey && url
            ? { resourceKey, url }
            : null;
        })
        .filter((entry): entry is { resourceKey: string; url: string } => Boolean(entry))
    : undefined;
  const selectedImportResourceKeys =
    payload && typeof payload === "object" && "selectedImportResourceKeys" in payload
      ? (payload as { selectedImportResourceKeys?: unknown }).selectedImportResourceKeys
      : undefined;
  const normalizedSelectedImportResourceKeys = Array.isArray(selectedImportResourceKeys)
    ? selectedImportResourceKeys.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    : undefined;

  const db = await openSceneForgeSqliteDatabase();
  try {
    const result = await importCivitaiImageUrlToSqlite({
      db,
      imageUrl,
      selectedOfficialImageUrls: normalizedSelectedOfficialImageUrls,
      selectedOfficialImages: normalizedSelectedOfficialImages,
      selectedImportResourceKeys: normalizedSelectedImportResourceKeys,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] import failed", { error });
    const message = error instanceof Error ? error.message : "导入 Civitai 图片元数据失败。";
    return errorResponse(message, getErrorStatus(error), error);
  } finally {
    db.close();
  }
}
