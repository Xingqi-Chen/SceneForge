import { NextResponse } from "next/server";

import { repairMissingCivitaiImageCache } from "@/features/civitai-lora-library/image-assets";
import {
  listCivitaiImageCacheReferencesFromSqlite,
  openSceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

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

export async function POST() {
  const db = await openSceneForgeSqliteDatabase();
  try {
    const references = listCivitaiImageCacheReferencesFromSqlite(db);
    const result = await repairMissingCivitaiImageCache(references);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] repair cache failed", { error });
    const message = error instanceof Error ? error.message : "修复 Civitai 图片缓存失败。";
    return errorResponse(message, 500, error);
  } finally {
    db.close();
  }
}
