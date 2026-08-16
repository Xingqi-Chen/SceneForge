import { NextResponse } from "next/server";

import {
  CivitaiAiRecommendationError,
  recommendRunCivitaiResourceCombination,
} from "@/features/civitai-lora-library/ai-recommendation";
import { openSceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";
import { isPromptProfileId } from "@/shared/prompt-profile";

export const runtime = "nodejs";

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { message, details } }, { status });
}

type RunResourceErrorClassification =
  | "index_unavailable"
  | "invalid_local_candidates"
  | "invalid_model_output"
  | "request_failed"
  | "unexpected_error";

function classifyRunResourceError(status: number): RunResourceErrorClassification {
  if (status === 400) return "invalid_local_candidates";
  if (status === 409) return "index_unavailable";
  if (status === 502) return "invalid_model_output";
  return "request_failed";
}

function normalizeRunResourceErrorStatus(status: number) {
  return status === 400 || status === 409 || status === 502 ? status : 500;
}

function getRunResourceErrorMessage(classification: RunResourceErrorClassification) {
  if (classification === "index_unavailable") {
    return "Run resource recommendation indexes are unavailable. Rebuild the Civitai indexes and try again.";
  }
  if (classification === "invalid_local_candidates") {
    return "Run resource recommendation could not find usable local candidates.";
  }
  if (classification === "invalid_model_output") {
    return "Run resource recommendation returned unusable model output.";
  }
  return "Unable to recommend local Civitai resources.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthorizedRunResourceRecommendationRequest(value: unknown): value is {
  desiredEffect: string;
  maxLoras: 3;
  promptProfile: "illustrious" | "anima" | "krea2";
  visualStyle: "anime" | "photoreal";
} {
  if (!isRecord(value)) return false;

  const allowedKeys = new Set(["desiredEffect", "maxLoras", "promptProfile", "visualStyle"]);
  return Object.keys(value).every((key) => allowedKeys.has(key)) &&
    typeof value.desiredEffect === "string" &&
    value.desiredEffect.trim().length > 0 &&
    value.maxLoras === 3 &&
    isPromptProfileId(value.promptProfile) &&
    (value.visualStyle === "anime" || value.visualStyle === "photoreal");
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isAuthorizedRunResourceRecommendationRequest(payload)) {
    return errorResponse("Request is not an authorized single-image Run resource recommendation.", 400);
  }

  let db: Awaited<ReturnType<typeof openSceneForgeSqliteDatabase>> | undefined;
  try {
    db = await openSceneForgeSqliteDatabase(undefined, { allowExtensions: true });
    const recommendation = await recommendRunCivitaiResourceCombination({
      db,
      desiredEffect: payload.desiredEffect,
      maxLoras: payload.maxLoras,
      nsfw: false,
      promptProfile: payload.promptProfile,
    });

    return NextResponse.json(recommendation);
  } catch (error) {
    if (error instanceof CivitaiAiRecommendationError) {
      const statusCode = normalizeRunResourceErrorStatus(error.statusCode);
      const classification = classifyRunResourceError(statusCode);
      console.info("[SceneForge] [agent-timeline] Run Civitai recommendation failed", {
        callType: "responses",
        status: "failed",
        httpStatus: statusCode,
        classification,
      });
      return errorResponse(
        getRunResourceErrorMessage(classification),
        statusCode,
        {
          code: "run_resource_recommendation_failed",
          classification,
        },
      );
    }

    console.error("[SceneForge] [agent-timeline] failed to recommend Run Civitai resources", {
      callType: "responses",
      status: "failed",
      httpStatus: 500,
      classification: "unexpected_error" satisfies RunResourceErrorClassification,
    });
    return errorResponse("Unable to recommend local Civitai resources.", 500, {
      code: "run_resource_recommendation_failed",
      classification: "unexpected_error" satisfies RunResourceErrorClassification,
    });
  } finally {
    db?.close();
  }
}
