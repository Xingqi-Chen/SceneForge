import { NextResponse } from "next/server";

import {
  createEmptyRunSceneSuggestion,
  RunSceneSuggestionError,
} from "@/features/agent-timeline/run-scene-suggestion.server";
import { isPromptProfileId } from "@/shared/prompt-profile";
import {
  isRunVisualStyle,
  normalizeRunVisualStyle,
} from "@/features/agent-timeline/run-visual-style";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!isRecord(payload) ||
      !isPromptProfileId(payload.promptProfile) ||
      (payload.visualStyle !== undefined && !isRunVisualStyle(payload.visualStyle)) ||
      (payload.nsfw !== undefined && typeof payload.nsfw !== "boolean")) {
    return NextResponse.json(
      { error: { message: "A valid Run prompt profile is required." } },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await createEmptyRunSceneSuggestion({
      promptProfile: payload.promptProfile,
      nsfw: payload.nsfw === true,
      ...(payload.visualStyle !== undefined
        ? { visualStyle: normalizeRunVisualStyle(payload.visualStyle) }
        : {}),
    }));
  } catch (error) {
    if (error instanceof RunSceneSuggestionError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.code === "llm_unavailable"
              ? "Empty Run suggestion is temporarily unavailable."
              : error.message,
          },
        },
        { status: error.statusCode },
      );
    }
    console.error("[SceneForge] [timeline] unexpected empty Run suggestion failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: { message: "Unexpected empty Run suggestion failure." } },
      { status: 500 },
    );
  }
}
