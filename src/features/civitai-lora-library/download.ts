import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type {
  CivitaiLibrarySettings,
  CivitaiModelStorageKind,
  CivitaiResourceDownloadStatus,
  CivitaiResourceRecord,
} from "./types";

type DownloadableCivitaiResource = Pick<
  CivitaiResourceRecord,
  "id" | "resourceType" | "name" | "versionName" | "baseModel" | "civitaiModelVersionId" | "downloadUrl" | "filesJson"
>;

type CivitaiFileMetadata = {
  name: string | null;
  downloadUrl: string | null;
  expectedSha256: string | null;
  displayHash: string | null;
  extension: string;
};

type StreamWriteResult = {
  bytesWritten: number;
  sha256: string;
};

type CivitaiResourceDownloadStatusOptions = {
  verifyChecksum?: boolean;
};

const DEFAULT_MODEL_EXTENSION = ".safetensors";
const KNOWN_MODEL_EXTENSIONS = new Set([".safetensors", ".ckpt", ".pt", ".bin"]);
const WINDOWS_RESERVED_FILE_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const DIFFUSION_MODEL_PATTERN =
  /\b(?:anima|flux(?:\s*1)?|sd\s*3(?:\.\d+)?|stable\s+diffusion\s+3(?:\.\d+)?|qwen(?:\s+image)?|z\s+image|lumina)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readHashes(file: Record<string, unknown>): Record<string, unknown> {
  return isRecord(file.hashes) ? file.hashes : {};
}

function readHash(hashes: Record<string, unknown>, key: string): string | null {
  const value = hashes[key];
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function isModelFile(file: Record<string, unknown>) {
  const type = readString(file, "type")?.toLowerCase();
  return !type || type === "model";
}

function getFileRecords(filesJson: unknown): Record<string, unknown>[] {
  if (!Array.isArray(filesJson)) {
    return [];
  }

  return filesJson.filter(isRecord);
}

function selectPrimaryModelFile(filesJson: unknown): Record<string, unknown> | null {
  const files = getFileRecords(filesJson);
  if (files.length === 0) {
    return null;
  }

  return (
    files.find((file) => readBoolean(file, "primary") && isModelFile(file)) ??
    files.find((file) => readBoolean(file, "primary")) ??
    files.find(isModelFile) ??
    files[0] ??
    null
  );
}

function extensionFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return normalizeExtension(path.extname(url.pathname));
  } catch {
    return normalizeExtension(path.extname(value.split("?")[0] ?? ""));
  }
}

function normalizeExtension(extension: string | null | undefined): string | null {
  if (!extension) {
    return null;
  }

  const normalized = extension.toLowerCase();
  if (!/^\.[a-z0-9]{1,16}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getModelFileExtension(fileName: string | null, downloadUrl: string | null) {
  const fromName = normalizeExtension(path.extname(fileName ?? ""));
  if (fromName && KNOWN_MODEL_EXTENSIONS.has(fromName)) {
    return fromName;
  }

  const fromUrl = extensionFromUrl(downloadUrl);
  if (fromUrl && KNOWN_MODEL_EXTENSIONS.has(fromUrl)) {
    return fromUrl;
  }

  return fromName ?? fromUrl ?? DEFAULT_MODEL_EXTENSION;
}

function sanitizeFileNameSegment(value: string | null | undefined, fallback: string) {
  const sanitized = (value ?? "")
    .replace(WINDOWS_RESERVED_FILE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return (sanitized || fallback).slice(0, 80);
}

function makeDisplayHash(resource: DownloadableCivitaiResource, file: Record<string, unknown> | null) {
  const hashes = file ? readHashes(file) : {};
  return (
    readHash(hashes, "AutoV2") ??
    readHash(hashes, "SHA256")?.slice(0, 12) ??
    readHash(hashes, "CRC32") ??
    readHash(hashes, "BLAKE3")?.slice(0, 12) ??
    resource.civitaiModelVersionId?.toString() ??
    null
  );
}

function getDiffusionModelFamilyText(resource: DownloadableCivitaiResource) {
  const metadata = getCivitaiResourceFileMetadata(resource);
  return [
    resource.name,
    resource.versionName,
    resource.baseModel,
    metadata.name,
    metadata.downloadUrl,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .replace(/[_-]+/g, " ");
}

export function getCivitaiModelStorageKind(resource: DownloadableCivitaiResource): CivitaiModelStorageKind {
  if (resource.resourceType !== "model") {
    return "checkpoint";
  }

  return DIFFUSION_MODEL_PATTERN.test(getDiffusionModelFamilyText(resource))
    ? "diffusion"
    : "checkpoint";
}

export function getCivitaiResourceDownloadLabel(resource: DownloadableCivitaiResource) {
  if (resource.resourceType === "lora") {
    return "LoRA";
  }

  return getCivitaiModelStorageKind(resource) === "diffusion" ? "Diffusion model" : "Checkpoint";
}

export function getCivitaiResourceConfiguredDownloadPath(
  resource: DownloadableCivitaiResource,
  settings: CivitaiLibrarySettings,
) {
  if (resource.resourceType === "lora") {
    return settings.loraDownloadPath;
  }

  if (resource.resourceType === "model" && getCivitaiModelStorageKind(resource) === "diffusion") {
    return settings.diffusionModelPath;
  }

  return resource.resourceType === "model" ? settings.checkpointDownloadPath : "";
}

export function getCivitaiResourceFileMetadata(resource: DownloadableCivitaiResource): CivitaiFileMetadata {
  const primaryFile = selectPrimaryModelFile(resource.filesJson);
  const hashes = primaryFile ? readHashes(primaryFile) : {};
  const fileName = primaryFile ? readString(primaryFile, "name") : null;
  const downloadUrl = (primaryFile ? readString(primaryFile, "downloadUrl") : null) ?? resource.downloadUrl;

  return {
    name: fileName,
    downloadUrl,
    expectedSha256: readHash(hashes, "SHA256"),
    displayHash: makeDisplayHash(resource, primaryFile),
    extension: getModelFileExtension(fileName, downloadUrl),
  };
}

export function makeCivitaiResourceTargetFileName(resource: DownloadableCivitaiResource): string {
  const metadata = getCivitaiResourceFileMetadata(resource);
  const fallbackName = resource.resourceType === "model" ? "civitai-checkpoint" : "civitai-lora";
  const parts = [
    sanitizeFileNameSegment(resource.name, fallbackName),
    sanitizeFileNameSegment(resource.versionName, `Version ${resource.civitaiModelVersionId ?? "unknown"}`),
    resource.civitaiModelVersionId === null ? null : `mv${resource.civitaiModelVersionId}`,
    metadata.displayHash,
  ].filter((part): part is string => Boolean(part));

  return `${parts.join("__")}${metadata.extension}`;
}

export async function calculateFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function directoryExists(directoryPath: string) {
  try {
    const stats = await fsp.stat(directoryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function getCivitaiResourceTargetPath(resource: DownloadableCivitaiResource, downloadPath: string) {
  const directoryPath = path.resolve(downloadPath);
  return path.join(directoryPath, makeCivitaiResourceTargetFileName(resource));
}

export async function getCivitaiResourceDownloadStatus(
  resource: DownloadableCivitaiResource,
  downloadPath: string,
  options: CivitaiResourceDownloadStatusOptions = {},
): Promise<CivitaiResourceDownloadStatus> {
  const configuredPath = downloadPath.trim();
  const metadata = getCivitaiResourceFileMetadata(resource);
  const targetFileName = makeCivitaiResourceTargetFileName(resource);
  const label = getCivitaiResourceDownloadLabel(resource);
  const verifyChecksum = options.verifyChecksum === true;

  if (!configuredPath) {
    return {
      resourceId: resource.id,
      status: "path_missing",
      message: `${label} 下载路径未设置。`,
      pathConfigured: false,
      directoryExists: false,
      targetFileName,
      targetPath: null,
      fileExists: false,
      checksumType: metadata.expectedSha256 ? "SHA256" : null,
      expectedSha256: metadata.expectedSha256,
      actualSha256: null,
      checksumMatches: null,
      downloadUrl: metadata.downloadUrl,
    };
  }

  const targetPath = getCivitaiResourceTargetPath(resource, configuredPath);
  const hasDirectory = await directoryExists(configuredPath);
  if (!hasDirectory) {
    return {
      resourceId: resource.id,
      status: "directory_missing",
      message: `${label} 下载目录不存在，请先创建目录或修改设置。`,
      pathConfigured: true,
      directoryExists: false,
      targetFileName,
      targetPath,
      fileExists: false,
      checksumType: metadata.expectedSha256 ? "SHA256" : null,
      expectedSha256: metadata.expectedSha256,
      actualSha256: null,
      checksumMatches: null,
      downloadUrl: metadata.downloadUrl,
    };
  }

  const fileExists = await pathExists(targetPath);
  if (!fileExists) {
    return {
      resourceId: resource.id,
      status: "not_downloaded",
      message: `${label} 文件尚未下载。`,
      pathConfigured: true,
      directoryExists: true,
      targetFileName,
      targetPath,
      fileExists: false,
      checksumType: metadata.expectedSha256 ? "SHA256" : null,
      expectedSha256: metadata.expectedSha256,
      actualSha256: null,
      checksumMatches: null,
      downloadUrl: metadata.downloadUrl,
    };
  }

  if (!metadata.expectedSha256) {
    return {
      resourceId: resource.id,
      status: "unverified",
      message: `${label} 文件已存在，但 Civitai 未提供 SHA256，无法校验。`,
      pathConfigured: true,
      directoryExists: true,
      targetFileName,
      targetPath,
      fileExists: true,
      checksumType: null,
      expectedSha256: null,
      actualSha256: null,
      checksumMatches: null,
      downloadUrl: metadata.downloadUrl,
    };
  }

  if (!verifyChecksum) {
    return {
      resourceId: resource.id,
      status: "unverified",
      message: `${label} 文件已存在，点击校验以确认 SHA256。`,
      pathConfigured: true,
      directoryExists: true,
      targetFileName,
      targetPath,
      fileExists: true,
      checksumType: "SHA256",
      expectedSha256: metadata.expectedSha256,
      actualSha256: null,
      checksumMatches: null,
      downloadUrl: metadata.downloadUrl,
    };
  }

  const actualSha256 = await calculateFileSha256(targetPath);
  const matches = actualSha256.toLowerCase() === metadata.expectedSha256;

  return {
    resourceId: resource.id,
    status: matches ? "verified" : "checksum_mismatch",
    message: matches ? `${label} 文件已下载并通过 SHA256 校验。` : `本地 ${label} 文件与 Civitai SHA256 不一致。`,
    pathConfigured: true,
    directoryExists: true,
    targetFileName,
    targetPath,
    fileExists: true,
    checksumType: "SHA256",
    expectedSha256: metadata.expectedSha256,
    actualSha256,
    checksumMatches: matches,
    downloadUrl: metadata.downloadUrl,
  };
}

export async function writeReadableStreamToFile(
  stream: ReadableStream<Uint8Array>,
  filePath: string,
): Promise<StreamWriteResult> {
  const hash = crypto.createHash("sha256");
  const reader = stream.getReader();
  const output = fs.createWriteStream(filePath, { flags: "w" });
  let bytesWritten = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      bytesWritten += chunk.byteLength;
      hash.update(chunk);
      if (!output.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            output.off("error", onError);
            resolve();
          };
          const onError = (error: Error) => {
            output.off("drain", onDrain);
            reject(error);
          };

          output.once("drain", onDrain);
          output.once("error", onError);
        });
      }
    }
  } catch (error) {
    output.destroy();
    throw error;
  } finally {
    reader.releaseLock();
  }

  await new Promise<void>((resolve, reject) => {
    output.end((error?: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  return {
    bytesWritten,
    sha256: hash.digest("hex"),
  };
}
