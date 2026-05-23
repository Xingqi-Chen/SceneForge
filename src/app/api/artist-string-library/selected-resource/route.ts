import { NextResponse } from "next/server";

import {
  getArtistStringItemFromSqlite,
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

export async function GET(request: Request) {
  const itemId = new URL(request.url).searchParams.get("id")?.trim() || "";

  if (!itemId) {
    return NextResponse.json({ item: null });
  }

  const db = await openSceneForgeSqliteDatabase();

  try {
    return NextResponse.json({ item: getArtistStringItemFromSqlite(db, itemId) ?? null });
  } catch (error) {
    console.error("[SceneForge] [artist-string-library] failed to read selected resource", { error });
    return errorResponse("无法读取已选画师串资源。", 500, error);
  } finally {
    db.close();
  }
}
