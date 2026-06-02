import type { CivitaiLibrarySettings, CivitaiModelStorageKind, CivitaiResourceRecord } from "./types";

export type DownloadableCivitaiResource = Pick<
  CivitaiResourceRecord,
  "id" | "resourceType" | "name" | "versionName" | "baseModel" | "civitaiModelVersionId" | "downloadUrl" | "filesJson"
>;

export type CivitaiFileMetadata = {
  name: string | null;
  downloadUrl: string | null;
  expectedSha256: string | null;
  displayHash: string | null;
  extension: string;
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

function extname(value: string) {
  const cleanValue = value.split(/[?#]/)[0] ?? "";
  const lastSlash = Math.max(cleanValue.lastIndexOf("/"), cleanValue.lastIndexOf("\\"));
  const fileName = cleanValue.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(lastDot) : "";
}

function extensionFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return normalizeExtension(extname(url.pathname));
  } catch {
    return normalizeExtension(extname(value));
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
  const fromName = normalizeExtension(extname(fileName ?? ""));
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

export function makeCivitaiResourceFileNameAliases(resource: DownloadableCivitaiResource): string[] {
  const targetFileName = makeCivitaiResourceTargetFileName(resource);
  const originalFileName = getCivitaiResourceFileMetadata(resource).name;

  return Array.from(
    new Set([targetFileName, originalFileName].filter((value): value is string => Boolean(value))),
  );
}
