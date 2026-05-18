import type { ImportedImageListFilters } from "@/features/civitai-lora-library";
import {
  listImportedImagesFromSqlite,
  openSceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, details?: unknown) {
  return Response.json(
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
  const db = await openSceneForgeSqliteDatabase();
  const params = new URL(request.url).searchParams;
  const nsfw = params.get("nsfw");
  const resourceCount = params.get("resourceCount");
  const filters: ImportedImageListFilters = {
    baseModel: params.get("baseModel") ?? undefined,
    nsfw: nsfw === "sfw" || nsfw === "nsfw" ? nsfw : "all",
    resourceCount: resourceCount === "none" || resourceCount === "with" ? resourceCount : "all",
    query: params.get("query") ?? undefined,
  };

  try {
    return Response.json({ items: listImportedImagesFromSqlite(db, filters) });
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to list imported images", { error });
    return errorResponse("Unable to read imported Civitai images.", 500, error);
  } finally {
    db.close();
  }
}
