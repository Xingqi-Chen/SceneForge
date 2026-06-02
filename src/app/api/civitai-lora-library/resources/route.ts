import { NextResponse } from "next/server";

import type { CivitaiResourceListFilters, CivitaiResourceListItem } from "@/features/civitai-lora-library";
import {
  getCivitaiResourceConfiguredDownloadPath,
  getCivitaiResourceDownloadStatus,
  isCivitaiResourceDownloadReady,
} from "@/features/civitai-lora-library";
import {
  loadCivitaiLibrarySettingsFromSqlite,
  listCivitaiResourcesFromSqlite,
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

async function filterDownloadedResources(
  db: Awaited<ReturnType<typeof openSceneForgeSqliteDatabase>>,
  items: CivitaiResourceListItem[],
) {
  const settings = loadCivitaiLibrarySettingsFromSqlite(db);
  const statuses = await Promise.all(
    items.map(async (item) => ({
      item,
      status: await getCivitaiResourceDownloadStatus(
        item,
        getCivitaiResourceConfiguredDownloadPath(item, settings),
      ),
    })),
  );

  return statuses.filter(({ status }) => isCivitaiResourceDownloadReady(status)).map(({ item }) => item);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resourceType = params.get("resourceType");
  const filters: CivitaiResourceListFilters = {
    resourceType: resourceType === "model" ? "model" : "lora",
    category: (params.get("category") ?? "all") as CivitaiResourceListFilters["category"],
    baseModel: params.get("baseModel") || undefined,
    nsfw: (params.get("nsfw") ?? "all") as CivitaiResourceListFilters["nsfw"],
    importedCount: (params.get("importedCount") ?? "all") as CivitaiResourceListFilters["importedCount"],
    query: params.get("query") || undefined,
  };
  const downloaded = params.get("downloaded");

  const db = await openSceneForgeSqliteDatabase();
  try {
    const items = listCivitaiResourcesFromSqlite(db, filters);
    return NextResponse.json({
      items: downloaded === "ready" ? await filterDownloadedResources(db, items) : items,
    });
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to list resources", { error });
    return errorResponse("无法读取 Civitai LoRA Library。", 500, error);
  } finally {
    db.close();
  }
}
