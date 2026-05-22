import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CivitaiResourceRecord } from "./types";
import {
  getCivitaiResourceDownloadStatus,
  getCivitaiResourceFileMetadata,
  makeCivitaiResourceTargetFileName,
} from "./download";

function sha256(value: string | Uint8Array) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeResource(overrides: Partial<CivitaiResourceRecord> = {}): CivitaiResourceRecord {
  return {
    id: "civitai_res_test",
    resourceType: "lora",
    civitaiModelId: 123,
    civitaiModelVersionId: 456,
    name: "Hero:Style/LoRA",
    versionName: "v1:Final",
    hash: "abc123",
    baseModel: "Pony",
    trainedWords: [],
    tags: [],
    description: null,
    creator: null,
    downloadUrl: "https://civitai.test/fallback.safetensors",
    filesJson: [
      {
        name: "preview.txt",
        type: "Training Data",
        downloadUrl: "https://civitai.test/preview.txt",
      },
      {
        primary: true,
        name: "original.safetensors",
        type: "Model",
        downloadUrl: "https://civitai.test/model.safetensors",
        hashes: {
          SHA256: sha256("expected"),
          AutoV2: "BEEFCAFE42",
        },
      },
    ],
    officialImagesJson: null,
    category: "style",
    categories: ["style"],
    usageGuide: null,
    recommendations: [],
    enrichmentStatus: "fallback",
    enrichmentError: null,
    nsfw: null,
    aiNsfwLevel: "unknown",
    aiNsfwConfidence: null,
    aiNsfwReason: null,
    rawVersionJson: null,
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("Civitai LoRA download helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-lora-download-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("selects primary model metadata and creates a readable Windows-safe filename", () => {
    const resource = makeResource();

    expect(getCivitaiResourceFileMetadata(resource)).toMatchObject({
      downloadUrl: "https://civitai.test/model.safetensors",
      expectedSha256: sha256("expected"),
      displayHash: "beefcafe42",
      extension: ".safetensors",
    });
    expect(makeCivitaiResourceTargetFileName(resource)).toBe(
      "Hero Style LoRA__v1 Final__mv456__beefcafe42.safetensors",
    );
  });

  it("defaults to safetensors when metadata does not expose a file extension", () => {
    const resource = makeResource({
      filesJson: [
        {
          primary: true,
          type: "Model",
          downloadUrl: "https://civitai.test/api/download/models/456",
          hashes: { SHA256: sha256("expected") },
        },
      ],
    });

    expect(makeCivitaiResourceTargetFileName(resource)).toBe(
      `Hero Style LoRA__v1 Final__mv456__${sha256("expected").slice(0, 12)}.safetensors`,
    );
  });

  it("checks missing paths, matching checksums, mismatches, and unverified files", async () => {
    const resource = makeResource();
    const targetPath = path.join(tempDir, makeCivitaiResourceTargetFileName(resource));

    await expect(getCivitaiResourceDownloadStatus(resource, "")).resolves.toMatchObject({
      status: "path_missing",
      pathConfigured: false,
    });
    await expect(getCivitaiResourceDownloadStatus(resource, path.join(tempDir, "missing"))).resolves.toMatchObject({
      status: "directory_missing",
      directoryExists: false,
    });
    await expect(getCivitaiResourceDownloadStatus(resource, tempDir)).resolves.toMatchObject({
      status: "not_downloaded",
      fileExists: false,
    });

    await fs.writeFile(targetPath, "expected");
    await expect(getCivitaiResourceDownloadStatus(resource, tempDir)).resolves.toMatchObject({
      status: "unverified",
      fileExists: true,
      checksumType: "SHA256",
      checksumMatches: null,
      actualSha256: null,
    });
    await expect(getCivitaiResourceDownloadStatus(resource, tempDir, { verifyChecksum: true })).resolves.toMatchObject({
      status: "verified",
      fileExists: true,
      checksumMatches: true,
      actualSha256: sha256("expected"),
    });

    await fs.writeFile(targetPath, "different");
    await expect(getCivitaiResourceDownloadStatus(resource, tempDir, { verifyChecksum: true })).resolves.toMatchObject({
      status: "checksum_mismatch",
      checksumMatches: false,
      actualSha256: sha256("different"),
    });

    const unverifiedResource = makeResource({ filesJson: null });
    const unverifiedPath = path.join(tempDir, makeCivitaiResourceTargetFileName(unverifiedResource));
    await fs.writeFile(unverifiedPath, "anything");
    await expect(getCivitaiResourceDownloadStatus(unverifiedResource, tempDir)).resolves.toMatchObject({
      status: "unverified",
      checksumType: null,
      checksumMatches: null,
    });
  });
});
