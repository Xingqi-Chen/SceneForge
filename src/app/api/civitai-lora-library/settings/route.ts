import { NextResponse } from "next/server";

import {
  loadCivitaiLibrarySettingsFromSqlite,
  openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite,
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

export async function GET() {
  const db = await openSceneForgeSqliteDatabase();

  try {
    return NextResponse.json(loadCivitaiLibrarySettingsFromSqlite(db));
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to read settings", { error });
    return errorResponse("无法读取 Civitai LoRA 收藏库设置。", 500, error);
  } finally {
    db.close();
  }
}

export async function PUT(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求体必须是有效的 JSON。", 400);
  }

  if (!payload || typeof payload !== "object") {
    return errorResponse("Civitai LoRA 收藏库设置格式无效。", 400);
  }

  const db = await openSceneForgeSqliteDatabase();

  try {
    saveCivitaiLibrarySettingsToSqlite(db, payload);
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to write settings", { error });
    return errorResponse("无法写入 Civitai LoRA 收藏库设置。", 500, error);
  } finally {
    db.close();
  }
}
