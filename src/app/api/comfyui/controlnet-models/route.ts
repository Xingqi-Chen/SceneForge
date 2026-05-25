import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CONTROLNET_MODEL_EXTENSIONS = new Set([".safetensors", ".ckpt", ".pt", ".pth", ".bin"]);
const MAX_SCAN_DEPTH = 4;
const MAX_MODEL_COUNT = 500;

type ControlNetModelOption = {
  label: string;
  value: string;
};

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

function toModelValue(rootPath: string, modelPath: string) {
  return path.relative(rootPath, modelPath).split(path.sep).join("/");
}

async function collectControlNetModels(
  rootPath: string,
  currentPath: string,
  depth: number,
  models: ControlNetModelOption[],
) {
  if (depth > MAX_SCAN_DEPTH || models.length >= MAX_MODEL_COUNT) {
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (models.length >= MAX_MODEL_COUNT) {
      return;
    }

    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      try {
        await collectControlNetModels(rootPath, entryPath, depth + 1, models);
      } catch {
        // Ignore folders the local process cannot read and continue scanning siblings.
      }
      continue;
    }

    if (!entry.isFile() || !CONTROLNET_MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const value = toModelValue(rootPath, entryPath);
    models.push({
      label: value,
      value,
    });
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const modelPath = requestUrl.searchParams.get("path")?.trim() ?? "";

  if (!modelPath) {
    return NextResponse.json({
      modelPath: "",
      models: [],
    });
  }

  const resolvedPath = path.resolve(modelPath);

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return errorResponse("ControlNet 模型路径必须是一个文件夹。", 400);
    }

    const models: ControlNetModelOption[] = [];
    await collectControlNetModels(resolvedPath, resolvedPath, 0, models);
    models.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));

    return NextResponse.json({
      modelPath: resolvedPath,
      models,
    });
  } catch (error) {
    return errorResponse("无法读取 ControlNet 模型路径，请确认目录存在且当前进程有权限访问。", 400, error);
  }
}
