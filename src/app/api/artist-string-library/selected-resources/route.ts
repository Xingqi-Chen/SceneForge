import { NextResponse } from "next/server";

import {
  getArtistStringItemsFromSqlite,
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

function parseIdList(value: string | null) {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of value.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export async function GET(request: Request) {
  const itemIds = parseIdList(new URL(request.url).searchParams.get("ids"));

  if (itemIds.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const db = await openSceneForgeSqliteDatabase();

  try {
    return NextResponse.json({ items: getArtistStringItemsFromSqlite(db, itemIds) });
  } catch (error) {
    console.error("[SceneForge] [artist-string-library] failed to read selected resources", { error });
    return errorResponse("无法读取已选画师串资源。", 500, error);
  } finally {
    db.close();
  }
}
