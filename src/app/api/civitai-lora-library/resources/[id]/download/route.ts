import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  getCivitaiResourceDownloadStatus,
  getCivitaiResourceConfiguredDownloadPath,
  getCivitaiResourceDownloadLabel,
  getCivitaiResourceFileMetadata,
  writeReadableStreamToFile,
  type CivitaiResourceDetail,
  type CivitaiResourceDownloadResult,
} from "@/features/civitai-lora-library";
import {
  getCivitaiResourceDetailFromSqlite,
  loadCivitaiLibrarySettingsFromSqlite,
  openSceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

export const runtime = "nodejs";

class DownloadRouteError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "DownloadRouteError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

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

function assertDownloadableResource(detail: CivitaiResourceDetail) {
  if (detail.resourceType !== "lora" && detail.resourceType !== "model") {
    throw new DownloadRouteError("当前只支持下载 LoRA 与 Checkpoint 资源。", 400);
  }
}

async function loadDownloadContext(resourceId: string) {
  const db = await openSceneForgeSqliteDatabase();

  try {
    const detail = getCivitaiResourceDetailFromSqlite(db, resourceId);
    if (!detail) {
      throw new DownloadRouteError("未找到该 Civitai 资源。", 404);
    }

    const settings = loadCivitaiLibrarySettingsFromSqlite(db);
    return { detail, settings };
  } finally {
    db.close();
  }
}

function assertReadyForWrite(status: Awaited<ReturnType<typeof getCivitaiResourceDownloadStatus>>, label: string) {
  if (status.status === "path_missing") {
    throw new DownloadRouteError(`${label} 下载路径未设置。`, 400, status);
  }

  if (status.status === "directory_missing") {
    throw new DownloadRouteError(`${label} 下载目录不存在，请先创建目录或修改设置。`, 400, status);
  }

  if (!status.targetPath) {
    throw new DownloadRouteError(`无法解析 ${label} 下载目标路径。`, 500, status);
  }
}

function makeTempPath(targetPath: string) {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath) || ".tmp";
  return path.join(directory, `.sceneforge-${crypto.randomUUID()}${extension}.tmp`);
}

async function replaceTargetFile(tempPath: string, targetPath: string) {
  try {
    await fsp.rename(tempPath, targetPath);
  } catch (error) {
    await cleanupTempFile(tempPath);
    throw error;
  }
}

function verifySha256(expectedSha256: string | null, actualSha256: string, mismatchMessage: string) {
  if (expectedSha256 && expectedSha256 !== actualSha256.toLowerCase()) {
    throw new DownloadRouteError(mismatchMessage, 409, {
      expectedSha256,
      actualSha256,
    });
  }
}

async function cleanupTempFile(tempPath: string) {
  await fsp.rm(tempPath, { force: true }).catch(() => undefined);
}

async function downloadCivitaiFile(detail: CivitaiResourceDetail, targetPath: string) {
  const metadata = getCivitaiResourceFileMetadata(detail);
  const label = getCivitaiResourceDownloadLabel(detail);
  if (!metadata.downloadUrl) {
    throw new DownloadRouteError(`该 ${label} 没有可用的 Civitai 下载链接。`, 400);
  }

  const response = await fetch(metadata.downloadUrl, {
    headers: {
      accept: "application/octet-stream",
      ...(process.env.CIVITAI_API_KEY ? { authorization: `Bearer ${process.env.CIVITAI_API_KEY}` } : {}),
    },
  });
  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => null);
    throw new DownloadRouteError(`Civitai ${label} 下载失败。`, response.ok ? 502 : response.status, details);
  }

  const tempPath = makeTempPath(targetPath);
  try {
    const result = await writeReadableStreamToFile(response.body, tempPath);
    verifySha256(metadata.expectedSha256, result.sha256, "下载文件 SHA256 与 Civitai 元数据不一致，未保存。");
    return { ...result, tempPath };
  } catch (error) {
    await cleanupTempFile(tempPath);
    throw error;
  }
}

async function uploadManualStream(detail: CivitaiResourceDetail, stream: ReadableStream<Uint8Array>, targetPath: string) {
  const metadata = getCivitaiResourceFileMetadata(detail);
  const tempPath = makeTempPath(targetPath);

  try {
    const result = await writeReadableStreamToFile(stream, tempPath);
    verifySha256(metadata.expectedSha256, result.sha256, "上传文件 SHA256 与 Civitai 元数据不一致，未保存。");
    return { ...result, tempPath };
  } catch (error) {
    await cleanupTempFile(tempPath);
    throw error;
  }
}

function makeResult(
  status: Awaited<ReturnType<typeof getCivitaiResourceDownloadStatus>>,
  input: {
    action: "download" | "upload";
    skipped: boolean;
    overwritten: boolean;
    bytesWritten: number;
    message: string;
  },
): CivitaiResourceDownloadResult {
  return {
    ...status,
    action: input.action,
    skipped: input.skipped,
    overwritten: input.overwritten,
    bytesWritten: input.bytesWritten,
    message: input.message,
  };
}

async function handleDownload(detail: CivitaiResourceDetail, downloadPath: string) {
  const label = getCivitaiResourceDownloadLabel(detail);
  const currentStatus = await getCivitaiResourceDownloadStatus(detail, downloadPath, { verifyChecksum: true });
  assertReadyForWrite(currentStatus, label);

  if (currentStatus.status === "verified") {
    return makeResult(currentStatus, {
      action: "download",
      skipped: true,
      overwritten: false,
      bytesWritten: 0,
      message: "文件已校验一致，无需重新下载。",
    });
  }

  const targetPath = currentStatus.targetPath!;
  const { tempPath, bytesWritten } = await downloadCivitaiFile(detail, targetPath);
  await replaceTargetFile(tempPath, targetPath);

  const nextStatus = await getCivitaiResourceDownloadStatus(detail, downloadPath, { verifyChecksum: true });
  return makeResult(nextStatus, {
    action: "download",
    skipped: false,
    overwritten: currentStatus.fileExists,
    bytesWritten,
    message: nextStatus.checksumType === "SHA256" ? "下载完成，SHA256 校验通过。" : "下载完成，但 Civitai 未提供 SHA256，无法校验。",
  });
}

async function handleUpload(detail: CivitaiResourceDetail, downloadPath: string, stream: ReadableStream<Uint8Array>) {
  const label = getCivitaiResourceDownloadLabel(detail);
  const currentStatus = await getCivitaiResourceDownloadStatus(detail, downloadPath, { verifyChecksum: true });
  assertReadyForWrite(currentStatus, label);

  const targetPath = currentStatus.targetPath!;
  const { tempPath, bytesWritten } = await uploadManualStream(detail, stream, targetPath);
  await replaceTargetFile(tempPath, targetPath);

  const nextStatus = await getCivitaiResourceDownloadStatus(detail, downloadPath, { verifyChecksum: true });
  return makeResult(nextStatus, {
    action: "upload",
    skipped: false,
    overwritten: currentStatus.fileExists,
    bytesWritten,
    message: nextStatus.checksumType === "SHA256" ? "上传完成，SHA256 校验通过。" : "上传完成，但 Civitai 未提供 SHA256，无法校验。",
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const { detail, settings } = await loadDownloadContext(id);
    assertDownloadableResource(detail);
    const url = new URL(request.url);
    const verifyChecksum = url.searchParams.get("verify") === "1" || url.searchParams.get("verify") === "true";
    return NextResponse.json(
      await getCivitaiResourceDownloadStatus(
        detail,
        getCivitaiResourceConfiguredDownloadPath(detail, settings),
        { verifyChecksum },
      ),
    );
  } catch (error) {
    if (error instanceof DownloadRouteError) {
      return errorResponse(error.message, error.statusCode, error.details);
    }

    console.error("[SceneForge] [civitai-lora-library] failed to read resource download status", { error });
    return errorResponse("无法读取资源下载状态。", 500, error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const { detail, settings } = await loadDownloadContext(id);
    assertDownloadableResource(detail);
    const downloadPath = getCivitaiResourceConfiguredDownloadPath(detail, settings);
    const label = getCivitaiResourceDownloadLabel(detail);

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/octet-stream")) {
      if (!request.body) {
        throw new DownloadRouteError(`请上传有效的 ${label} 文件。`, 400);
      }

      return NextResponse.json(await handleUpload(detail, downloadPath, request.body));
    }

    if (contentType.includes("multipart/form-data")) {
      throw new DownloadRouteError("大文件上传请使用原始二进制流，请刷新页面后重试。", 400);
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object" || (payload as { action?: unknown }).action !== "download") {
      throw new DownloadRouteError("请求体格式无效。", 400);
    }

    return NextResponse.json(await handleDownload(detail, downloadPath));
  } catch (error) {
    if (error instanceof DownloadRouteError) {
      return errorResponse(error.message, error.statusCode, error.details);
    }

    console.error("[SceneForge] [civitai-lora-library] failed to download or upload resource file", { error });
    return errorResponse("资源文件处理失败。", 500, error);
  }
}
