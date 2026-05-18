import { NextResponse } from "next/server";

import {
  getImportedImageDetailFromSqlite,
  openSceneForgeSqliteDatabase,
  updateImportedImageLoraUsageWeightsFromSqlite,
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await openSceneForgeSqliteDatabase();

  try {
    const image = getImportedImageDetailFromSqlite(db, id);
    if (!image) {
      return errorResponse("Imported image not found.", 404);
    }

    return NextResponse.json(image);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to read imported image", { error });
    return errorResponse("Unable to read imported image.", 500, error);
  } finally {
    db.close();
  }
}

function parseWeightUpdates(payload: unknown): Array<{ usageId: string; weight: number | null }> | null {
  if (!payload || typeof payload !== "object" || !("weights" in payload)) {
    return null;
  }

  const weights = (payload as { weights?: unknown }).weights;
  if (!Array.isArray(weights)) {
    return null;
  }

  const parsed: Array<{ usageId: string; weight: number | null }> = [];
  for (const entry of weights) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const usageId = (entry as { usageId?: unknown }).usageId;
    const weight = (entry as { weight?: unknown }).weight;
    if (typeof usageId !== "string" || usageId.trim().length === 0) {
      return null;
    }
    if (weight !== null && (typeof weight !== "number" || !Number.isFinite(weight))) {
      return null;
    }

    parsed.push({ usageId, weight });
  }

  return parsed;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json().catch(() => null);
  const weights = parseWeightUpdates(payload);
  if (!weights) {
    return errorResponse("Invalid LoRA weight payload.", 400);
  }

  const db = await openSceneForgeSqliteDatabase();

  try {
    const image = updateImportedImageLoraUsageWeightsFromSqlite(db, id, weights);
    if (!image) {
      return errorResponse("Imported image not found.", 404);
    }

    return NextResponse.json(image);
  } catch (error) {
    console.error("[SceneForge] [civitai-lora-library] failed to update imported image LoRA weights", { error });
    return errorResponse("Unable to update LoRA weights.", 500, error);
  } finally {
    db.close();
  }
}
