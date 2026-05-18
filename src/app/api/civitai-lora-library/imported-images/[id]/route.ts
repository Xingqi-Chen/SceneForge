import { NextResponse } from "next/server";

import {
  getImportedImageFromSqlite,
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await openSceneForgeSqliteDatabase();

  try {
    const image = getImportedImageFromSqlite(db, id);
    if (!image) {
      return errorResponse("未找到该导入图片。", 404);
    }

    return NextResponse.json(image);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to read imported image", { error });
    return errorResponse("无法读取导入图片。", 500, error);
  } finally {
    db.close();
  }
}
