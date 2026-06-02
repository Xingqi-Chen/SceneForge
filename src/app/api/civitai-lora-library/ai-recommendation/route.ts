import { NextResponse } from "next/server";

import {
  CivitaiAiRecommendationError,
  recommendCivitaiResourceCombination,
} from "@/features/civitai-lora-library/ai-recommendation";
import { openSceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";
import { isPromptProfileId } from "@/shared/prompt-profile";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMaxLoras(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePromptProfile(value: unknown) {
  return isPromptProfileId(value) ? value : undefined;
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isRecord(payload) || typeof payload.desiredEffect !== "string") {
    return errorResponse("Request body must include desiredEffect.", 400);
  }

  const db = await openSceneForgeSqliteDatabase();
  try {
    const recommendation = await recommendCivitaiResourceCombination({
      db,
      desiredEffect: payload.desiredEffect,
      maxLoras: normalizeMaxLoras(payload.maxLoras),
      promptProfile: normalizePromptProfile(payload.promptProfile),
    });

    return NextResponse.json(recommendation);
  } catch (error) {
    if (error instanceof CivitaiAiRecommendationError) {
      return errorResponse(error.message, error.statusCode, error.details);
    }

    console.error("[SceneForge] [civitai-lora-library] failed to recommend Civitai combination", { error });
    return errorResponse("AI 推荐失败，请稍后重试。", 500, error);
  } finally {
    db.close();
  }
}
