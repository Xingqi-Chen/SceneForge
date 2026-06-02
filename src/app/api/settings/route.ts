import { NextResponse } from "next/server";

import { readCentralSettings, updateCentralSettings } from "@/features/settings/central-settings";
import type { CentralSettingsUpdatePayload } from "@/features/settings/types";

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
  try {
    return NextResponse.json(await readCentralSettings());
  } catch (error) {
    console.error("[SceneForge] [settings] failed to read settings", { error });
    return errorResponse("Unable to read SceneForge settings.", 500);
  }
}

export async function PUT(request: Request) {
  let payload: CentralSettingsUpdatePayload;

  try {
    payload = (await request.json()) as CentralSettingsUpdatePayload;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!payload || typeof payload !== "object") {
    return errorResponse("Request body must be an object.", 400);
  }

  let result: Awaited<ReturnType<typeof updateCentralSettings>>;

  try {
    result = await updateCentralSettings(payload);
  } catch (error) {
    console.error("[SceneForge] [settings] failed to update settings", { error });
    return errorResponse("Unable to update SceneForge settings.", 500);
  }

  if (!result.ok) {
    return errorResponse(result.message, result.status, result.details);
  }

  return NextResponse.json(result.payload);
}
