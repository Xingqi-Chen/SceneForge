import { NextResponse } from "next/server";

import {
  loadPromptBindingsFromDisk,
  savePromptBindingsToDisk,
} from "@/features/persistence/prompt-bindings-local-disk";
import { sanitizeGlobalPromptBindingsPayload } from "@/features/persistence/project-serialization";

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
    const state = await loadPromptBindingsFromDisk();
    return NextResponse.json(state);
  } catch (error) {
    console.error("[SceneForge] [persistence] failed to read shared prompt bindings", { error });
    return errorResponse("无法读取共享词库绑定关系。", 500, error);
  }
}

export async function PUT(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求体必须是有效的 JSON。", 400);
  }

  if (!payload || typeof payload !== "object") {
    return errorResponse("词库绑定关系数据格式无效。", 400);
  }

  try {
    const normalized = sanitizeGlobalPromptBindingsPayload(payload);
    await savePromptBindingsToDisk(normalized);
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    console.error("[SceneForge] [persistence] failed to write shared prompt bindings", { error });
    return errorResponse("无法写入共享词库绑定关系。", 500, error);
  }
}
