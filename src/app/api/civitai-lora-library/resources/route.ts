import { NextResponse } from "next/server";

import type { CivitaiResourceListFilters } from "@/features/civitai-lora-library";
import {
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

  const db = await openSceneForgeSqliteDatabase();
  try {
    return NextResponse.json({ items: listCivitaiResourcesFromSqlite(db, filters) });
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to list resources", { error });
    return errorResponse("无法读取 Civitai LoRA Library。", 500, error);
  } finally {
    db.close();
  }
}
