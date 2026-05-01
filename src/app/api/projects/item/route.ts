import { NextResponse } from "next/server";

import { loadProjectFromDisk } from "@/features/persistence/project-local-disk";

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

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!id) {
    return errorResponse("缺少查询参数 id。", 400);
  }

  try {
    const project = await loadProjectFromDisk(id);

    if (!project) {
      return NextResponse.json(
        {
          error: { message: "未找到该项目。" },
        },
        { status: 404 },
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("[SceneForge] [persistence] failed to load project", { error });
    return errorResponse("无法读取本地项目文件。", 500, error);
  }
}
