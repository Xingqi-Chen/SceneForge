import { NextResponse } from "next/server";

import {
  isArtistStringPlatformId,
  syncArtistStringPlatformToSqlite,
} from "@/features/artist-string-library";
import { openSceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { message, details } }, { status });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const platformId =
    payload && typeof payload === "object" && "platformId" in payload
      ? (payload as { platformId?: unknown }).platformId
      : undefined;

  if (platformId !== undefined && !isArtistStringPlatformId(platformId)) {
    return errorResponse("Unsupported artist string platform.", 400);
  }

  const db = await openSceneForgeSqliteDatabase();
  try {
    const result = await syncArtistStringPlatformToSqlite({
      db,
      platformId,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[SceneForge] [artist-string-library] sync failed", { error });
    return errorResponse(
      error instanceof Error ? error.message : "Unable to sync artist string library.",
      500,
      error,
    );
  } finally {
    db.close();
  }
}
