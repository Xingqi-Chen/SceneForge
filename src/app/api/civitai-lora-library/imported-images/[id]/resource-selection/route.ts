import { NextResponse } from "next/server";

import {
  CivitaiImageResourceSelectionError,
  selectImportedImageResourcesFromSqlite,
} from "@/features/civitai-lora-library/image-resource-selection.server";
import { openSceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const searchParams = new URL(request.url).searchParams;
  const checkpointId = searchParams.get("checkpointId")?.trim() ?? "";
  const checkpointBaseModel = searchParams.get("checkpointBaseModel")?.trim() ?? "";
  if (!checkpointId || checkpointId.length > 200) {
    return errorResponse("A valid current checkpoint ID is required.", 400, "invalid_checkpoint_id");
  }
  if (!checkpointBaseModel || checkpointBaseModel.length > 200) {
    return errorResponse("The current checkpoint base model is required.", 400, "invalid_checkpoint_base_model");
  }

  const { id } = await context.params;
  const importedImageId = id.trim();
  if (!importedImageId) {
    return errorResponse("Imported image not found.", 404, "image_not_found");
  }

  let db: Awaited<ReturnType<typeof openSceneForgeSqliteDatabase>> | undefined;
  try {
    db = await openSceneForgeSqliteDatabase();
    return NextResponse.json(await selectImportedImageResourcesFromSqlite({
      checkpointBaseModel,
      checkpointId,
      db,
      importedImageId,
    }));
  } catch (error) {
    if (error instanceof CivitaiImageResourceSelectionError) {
      return errorResponse(error.message, error.statusCode, error.code);
    }

    console.error("[SceneForge] [civitai-lora-library] failed to select resources from imported image", {
      error,
    });
    return errorResponse("Unable to select resources from this imported image.", 500, "resource_selection_failed");
  } finally {
    db?.close();
  }
}
