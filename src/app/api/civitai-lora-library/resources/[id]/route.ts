import { NextResponse } from "next/server";

import {
  getCivitaiResourceDetailFromSqlite,
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
    const detail = getCivitaiResourceDetailFromSqlite(db, id);
    if (!detail) {
      return errorResponse("未找到该 Civitai LoRA 资源。", 404);
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to read resource detail", { error });
    return errorResponse("无法读取 Civitai LoRA 详情。", 500, error);
  } finally {
    db.close();
  }
}
