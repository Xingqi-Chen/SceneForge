import type { CivitaiResourceDownloadStatus } from "@/features/civitai-lora-library";

export type ComfyUiGenerationDownloadReadiness = "checking" | "ready" | "needs_download" | "blocked";

export function getComfyUiGenerationDownloadReadiness(
  status: CivitaiResourceDownloadStatus | null,
): ComfyUiGenerationDownloadReadiness {
  if (!status) {
    return "checking";
  }

  switch (status.status) {
    case "verified":
      return "ready";
    case "unverified":
      return status.fileExists ? "ready" : "needs_download";
    case "not_downloaded":
    case "checksum_mismatch":
      return "needs_download";
    case "path_missing":
    case "directory_missing":
      return "blocked";
  }
}

export function isComfyUiGenerationResourceReady(status: CivitaiResourceDownloadStatus | null) {
  return getComfyUiGenerationDownloadReadiness(status) === "ready";
}

export function shouldDownloadComfyUiGenerationResource(status: CivitaiResourceDownloadStatus | null) {
  return getComfyUiGenerationDownloadReadiness(status) === "needs_download";
}
