import { NextResponse } from "next/server";

import { parseCivitaiImageUrl } from "@/features/civitai-lora-library";
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

  const db = await openSceneForgeSqliteDatabase();
  try {
    const result = await parseCivitaiImageUrl({ db, imageUrl });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] parse failed", { error });
    const message = error instanceof Error ? error.message : "解析 Civitai 图片元数据失败。";
    return errorResponse(message, getErrorStatus(error), error);
  } finally {
    db.close();
  }
}
