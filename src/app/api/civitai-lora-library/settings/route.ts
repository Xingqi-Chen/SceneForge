import { NextResponse } from "next/server";

import { validateCivitaiLibrarySettingsPayload } from "@/features/civitai-lora-library/settings";
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
    return errorResponse("Unable to read Civitai library settings.", 500, error);
  } finally {
    db.close();
  }
}

export async function PUT(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!payload || typeof payload !== "object") {
    return errorResponse("Civitai library settings must be an object.", 400);
  }

  const validation = validateCivitaiLibrarySettingsPayload(payload);
  if (!validation.ok) {
    return errorResponse("One or more Civitai paths are invalid.", 400, validation.errors);
  }

  const db = await openSceneForgeSqliteDatabase();

  try {
    const settings = saveCivitaiLibrarySettingsToSqlite(db, validation.settings);
    return NextResponse.json({ ok: true as const, settings });
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to write settings", { error });
    return errorResponse("Unable to write Civitai library settings.", 500, error);
  } finally {
    db.close();
  }
}
