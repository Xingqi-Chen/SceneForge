import { NextResponse } from "next/server";

import {
  ARTIST_STRING_PLATFORMS,
  isArtistStringPlatformId,
  NAI_BOT_ARTISTS_GALLERY_CATEGORIES,
} from "@/features/artist-string-library";
import type { ArtistStringListFilters } from "@/features/artist-string-library";
import {
  listArtistStringCategoryCountsFromSqlite,
  listArtistStringItemsFromSqlite,
  listArtistStringPlatformsFromSqlite,
  openSceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { message, details } }, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const platformParam = params.get("platformId") || ARTIST_STRING_PLATFORMS[0]!.id;
  if (!isArtistStringPlatformId(platformParam)) {
    return errorResponse("Unsupported artist string platform.", 400);
  }

  const filters: ArtistStringListFilters = {
    platformId: platformParam,
    category: params.get("category") || "all",
    query: params.get("query") || undefined,
  };

  const db = await openSceneForgeSqliteDatabase();
  try {
    const syncedPlatforms = new Map(
      listArtistStringPlatformsFromSqlite(db).map((platform) => [platform.id, platform]),
    );
    const platforms = ARTIST_STRING_PLATFORMS.map((platform) => ({
      ...platform,
      sourceUpdatedAtText: syncedPlatforms.get(platform.id)?.sourceUpdatedAtText ?? null,
      syncedAt: syncedPlatforms.get(platform.id)?.syncedAt ?? "",
      rawMetaJson: syncedPlatforms.get(platform.id)?.rawMetaJson ?? null,
    }));
    const counts = new Map(
      listArtistStringCategoryCountsFromSqlite(db, platformParam).map((category) => [
        category.key,
        category.count,
      ]),
    );
    const categories =
      platformParam === "nai_bot_artists_gallery"
        ? NAI_BOT_ARTISTS_GALLERY_CATEGORIES.map((category) => ({
            ...category,
            count: counts.get(category.key) ?? 0,
          }))
        : listArtistStringCategoryCountsFromSqlite(db, platformParam);

    return NextResponse.json({
      platforms,
      categories,
      items: listArtistStringItemsFromSqlite(db, filters),
    });
  } catch (error) {
    console.error("[SceneForge] [artist-string-library] failed to list items", { error });
    return errorResponse("Unable to read artist string library.", 500, error);
  } finally {
    db.close();
  }
}
