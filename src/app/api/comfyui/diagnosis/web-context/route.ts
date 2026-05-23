import { NextResponse } from "next/server";

import {
  buildComfyUiDiagnosisWebContext,
  buildComfyUiDiagnosisWebQueries,
} from "@/features/editor/ai-prompt/comfyui-diagnosis-web-context";
import type {
  ComfyUiDiagnosisWebContext,
  ComfyUiGenerationDiagnosisConfig,
  ComfyUiGenerationVisualDiagnosisResult,
} from "@/features/editor/ai-prompt/comfyui-generation-diagnosis";
import { createTavilyClient } from "@/features/tavily";

export const runtime = "nodejs";

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        details,
        message,
      },
    },
    { status },
  );
}

function fallbackContext(warnings: string[], queries: string[] = []): ComfyUiDiagnosisWebContext {
  return {
    enabled: false,
    queries,
    sources: [],
    summary: "",
    warnings,
  };
}

function isValidBody(value: unknown): value is {
  config: ComfyUiGenerationDiagnosisConfig;
  userInput?: string;
  visualDiagnosis: ComfyUiGenerationVisualDiagnosisResult;
} {
  return (
    isRecord(value) &&
    isRecord(value.config) &&
    typeof value.config.checkpointName === "string" &&
    typeof value.config.positivePrompt === "string" &&
    Array.isArray(value.config.loras) &&
    isRecord(value.visualDiagnosis) &&
    typeof value.visualDiagnosis.summary === "string" &&
    Array.isArray(value.visualDiagnosis.observations) &&
    (value.userInput === undefined || typeof value.userInput === "string")
  );
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isValidBody(payload)) {
    return errorResponse("Request body must include config and visualDiagnosis.", 400);
  }

  const userInput = payload.userInput ?? "";
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  const queries = buildComfyUiDiagnosisWebQueries(payload.config, payload.visualDiagnosis, userInput);

  if (!apiKey) {
    return NextResponse.json(
      fallbackContext(["TAVILY_API_KEY is not configured; using local diagnosis context."], queries),
    );
  }

  try {
    const client = createTavilyClient({
      apiKey,
      baseUrl: process.env.TAVILY_BASE_URL || DEFAULT_TAVILY_BASE_URL,
    });

    return NextResponse.json(
      await buildComfyUiDiagnosisWebContext({
        client,
        config: payload.config,
        userInput,
        visualDiagnosis: payload.visualDiagnosis,
      }),
    );
  } catch (error) {
    console.error("[SceneForge] [comfyui] Tavily diagnosis web context failed", { error });

    return NextResponse.json(
      fallbackContext(["Tavily web context is unavailable; using local diagnosis context."], queries),
    );
  }
}
