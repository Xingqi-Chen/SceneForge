import { describe, expect, it } from "vitest";

import type { CivitaiResourceDownloadStatus, CivitaiResourceDownloadState } from "@/features/civitai-lora-library";

import {
  getComfyUiGenerationDownloadReadiness,
  isComfyUiGenerationResourceReady,
  shouldDownloadComfyUiGenerationResource,
} from "./comfyui-generation-downloads";

function makeStatus(
  status: CivitaiResourceDownloadState,
  overrides: Partial<CivitaiResourceDownloadStatus> = {},
): CivitaiResourceDownloadStatus {
  return {
    resourceId: "resource-1",
    status,
    message: status,
    pathConfigured: true,
    directoryExists: true,
    targetFileName: "model.safetensors",
    targetPath: "C:\\models\\model.safetensors",
    fileExists: status === "verified" || status === "unverified" || status === "checksum_mismatch",
    checksumType: "SHA256",
    expectedSha256: "expected",
    actualSha256: status === "verified" ? "expected" : null,
    checksumMatches: status === "verified" ? true : null,
    downloadUrl: "https://civitai.test/model.safetensors",
    ...overrides,
  };
}

describe("ComfyUI generation download readiness", () => {
  it("allows verified and existing unverified resources", () => {
    expect(getComfyUiGenerationDownloadReadiness(makeStatus("verified"))).toBe("ready");
    expect(getComfyUiGenerationDownloadReadiness(makeStatus("unverified", { checksumType: null }))).toBe("ready");
    expect(isComfyUiGenerationResourceReady(makeStatus("verified"))).toBe(true);
  });

  it("requires download for missing or checksum-mismatched resources", () => {
    expect(getComfyUiGenerationDownloadReadiness(makeStatus("not_downloaded", { fileExists: false }))).toBe(
      "needs_download",
    );
    expect(getComfyUiGenerationDownloadReadiness(makeStatus("checksum_mismatch"))).toBe("needs_download");
    expect(shouldDownloadComfyUiGenerationResource(makeStatus("checksum_mismatch"))).toBe(true);
  });

  it("blocks when paths are not configured or directories are missing", () => {
    expect(getComfyUiGenerationDownloadReadiness(makeStatus("path_missing", { fileExists: false }))).toBe("blocked");
    expect(getComfyUiGenerationDownloadReadiness(makeStatus("directory_missing", { fileExists: false }))).toBe(
      "blocked",
    );
  });
});
