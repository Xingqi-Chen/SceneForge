import { NextResponse } from "next/server";

import {
  ComfyUiApiError,
  createComfyUiClient,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiTextToImageRequest,
} from "@/features/comfyui";

export const runtime = "nodejs";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";

function readRequiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * This is a no-queue capability probe for the visible Krea reference-adapter
 * control. Queue-time validation repeats this check because object_info can
 * change after the UI has been open.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ available: false, reason: "Krea adapter preflight requires valid JSON." }, { status: 400 });
  }

  const input = typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const checkpointName = readRequiredString(input.checkpointName);
  const modelBaseModel = readRequiredString(input.modelBaseModel);
  if (!checkpointName || !modelBaseModel || input.modelStorageKind !== "diffusion") {
    return NextResponse.json({
      available: false,
      reason: "Select a ready Krea 2 Turbo diffusion checkpoint to check the reference adapter.",
    });
  }

  const validation = validateComfyUiTextToImageRequest({
    checkpointName,
    modelBaseModel,
    modelStorageKind: "diffusion",
    workflowProfile: "krea2",
    positivePrompt: "Krea style reference preflight",
    width: 1024,
    height: 1024,
    steps: 8,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
    krea2StyleReference: {
      imageName: "sceneforge-krea-style-reference-preflight.png",
    },
  });
  if (!validation.ok) {
    return NextResponse.json({ available: false, reason: validation.message });
  }

  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const objectInfo = await client.getObjectInfo();
    const objectValidation = validateComfyUiRequestAgainstObjectInfo(validation.request, objectInfo);
    return NextResponse.json(objectValidation.errors.length === 0
      ? {
          available: true,
          reason: "Krea style-reference adapter verified for this local Krea 2 Turbo checkpoint.",
        }
      : {
          available: false,
          reason: objectValidation.errors.join(" "),
        });
  } catch (error) {
    const reason = error instanceof ComfyUiApiError
      ? "ComfyUI is unavailable for Krea adapter preflight. Prompt-only style remains available."
      : "Krea adapter preflight failed. Prompt-only style remains available.";
    return NextResponse.json({ available: false, reason });
  }
}
