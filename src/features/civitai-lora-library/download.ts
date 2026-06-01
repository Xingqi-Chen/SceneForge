import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  getCivitaiResourceDownloadLabel,
  getCivitaiResourceFileMetadata,
  makeCivitaiResourceTargetFileName,
  type DownloadableCivitaiResource,
} from "./resource-files";
import type { CivitaiResourceDownloadStatus } from "./types";

export {
  getCivitaiModelStorageKind,
  getCivitaiResourceConfiguredDownloadPath,
  getCivitaiResourceDownloadLabel,
  getCivitaiResourceFileMetadata,
  makeCivitaiResourceTargetFileName,
} from "./resource-files";

type StreamWriteResult = {
  bytesWritten: number;
  sha256: string;
};

type CivitaiResourceDownloadStatusOptions = {
  verifyChecksum?: boolean;
};

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
