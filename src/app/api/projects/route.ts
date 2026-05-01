import { NextResponse } from "next/server";

import {
  listProjectSummariesFromDisk,
  saveProjectToDisk,
} from "@/features/persistence/project-local-disk";
import type { SceneForgeProject } from "@/shared/types";
import { sanitizeImportedProject } from "@/features/persistence/project-serialization";

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
    const summaries = await listProjectSummariesFromDisk();
    return NextResponse.json(summaries);
  } catch (error) {
    console.error("[SceneForge] [persistence] failed to list projects", { error });
    return errorResponse("无法列出本地项目文件。", 500, error);
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
    return errorResponse("项目数据格式无效。", 400);
  }

  try {
    const project = sanitizeImportedProject(payload as SceneForgeProject);
    await saveProjectToDisk(project);
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    console.error("[SceneForge] [persistence] failed to save project", { error });
    return errorResponse("无法写入本地项目文件。", 500, error);
  }
}
