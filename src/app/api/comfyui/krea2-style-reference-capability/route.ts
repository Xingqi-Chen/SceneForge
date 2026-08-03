import { NextResponse } from "next/server";

import {
  ComfyUiApiError,
} from "@/features/comfyui";
import { preflightKrea2ReferenceCapability } from "@/features/comfyui/krea2-reference-capability.server";

export const runtime = "nodejs";

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
  const mode = input.referenceMode === "reid" ? "reid" : "style";
  if (!checkpointName || !modelBaseModel || input.modelStorageKind !== "diffusion") {
    return NextResponse.json({
      available: false,
      reason: "Select a ready Krea 2 Turbo diffusion checkpoint to check the reference adapter.",
    });
  }

  try {
    return NextResponse.json(await preflightKrea2ReferenceCapability({ checkpointName, mode, modelBaseModel }));
  } catch (error) {
    const reason = error instanceof ComfyUiApiError
      ? "ComfyUI is unavailable for Krea reference-adapter preflight. Reference upload and queueing remain blocked."
      : "Krea reference-adapter preflight failed. Reference upload and queueing remain blocked.";
    return NextResponse.json({ available: false, reason });
  }
}
