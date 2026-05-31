// @vitest-environment node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeCivitaiResourceTargetFileName,
  type CivitaiResourceUpsertInput,
} from "@/features/civitai-lora-library";
import {
  openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

import { GET, POST } from "./route";

function sha256(value: string | Uint8Array) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeResourceInput(
  expectedContent = "expected",
  overrides: Partial<CivitaiResourceUpsertInput> = {},
): CivitaiResourceUpsertInput {
  return {
    resourceType: "lora",
    civitaiModelId: 123,
    civitaiModelVersionId: 456,
    name: "Route Test LoRA",
    versionName: "v1",
    hash: "ABCDEF1234",
    baseModel: "Pony",
    trainedWords: [],
    tags: [],
    description: null,
    creator: null,
    downloadUrl: "https://civitai.test/download/model.safetensors",
    filesJson: [
      {
        primary: true,
        name: "model.safetensors",
        type: "Model",
        downloadUrl: "https://civitai.test/download/model.safetensors",
        hashes: {
          SHA256: sha256(expectedContent),
          AutoV2: "ABCDEF1234",
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
    ...overrides,
  };
}

describe("Civitai LoRA download route", () => {
  let tempDir: string;
  let loraDir: string;
  let checkpointDir: string;
  let diffusionDir: string;
  let db: SceneForgeSqliteDatabase;
  let resourceId: string;
  let previousSqliteFile: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-lora-route-"));
    loraDir = path.join(tempDir, "loras");
    checkpointDir = path.join(tempDir, "checkpoints");
    diffusionDir = path.join(tempDir, "diffusion_models");
    await fs.mkdir(loraDir, { recursive: true });
    await fs.mkdir(checkpointDir, { recursive: true });
    await fs.mkdir(diffusionDir, { recursive: true });
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    db = await openSceneForgeSqliteDatabase();
    saveCivitaiLibrarySettingsToSqlite(db, {
      loraDownloadPath: loraDir,
      checkpointDownloadPath: checkpointDir,
      diffusionModelPath: diffusionDir,
    });
    resourceId = upsertCivitaiResourceToSqlite(db, makeResourceInput()).resource.id;
  });

  afterEach(async () => {
    db.close();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    vi.unstubAllGlobals();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function context() {
    return { params: Promise.resolve({ id: resourceId }) };
  }

  it("loads status without checksum work and skips redundant downloads after explicit verification", async () => {
    const resource = upsertCivitaiResourceToSqlite(db, makeResourceInput()).resource;
    const targetPath = path.join(loraDir, makeCivitaiResourceTargetFileName(resource));
    await fs.writeFile(targetPath, "expected");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const statusResponse = await GET(new Request("http://localhost/api"), context());
    await expect(statusResponse.json()).resolves.toMatchObject({
      status: "unverified",
      checksumMatches: null,
      actualSha256: null,
      targetPath,
    });

    const verifyResponse = await GET(new Request("http://localhost/api?verify=1"), context());
    await expect(verifyResponse.json()).resolves.toMatchObject({
      status: "verified",
      checksumMatches: true,
      targetPath,
    });

    const downloadResponse = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download" }),
      }),
      context(),
    );
    await expect(downloadResponse.json()).resolves.toMatchObject({
      status: "verified",
      action: "download",
      skipped: true,
      bytesWritten: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched manual uploads without replacing the existing file", async () => {
    const resource = upsertCivitaiResourceToSqlite(db, makeResourceInput()).resource;
    const targetPath = path.join(loraDir, makeCivitaiResourceTargetFileName(resource));
    await fs.writeFile(targetPath, "original");
    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "different",
      }),
      context(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("SHA256"),
      },
    });
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("original");
  });

  it("overwrites an existing file after a matching manual upload", async () => {
    const resource = upsertCivitaiResourceToSqlite(db, makeResourceInput()).resource;
    const targetPath = path.join(loraDir, makeCivitaiResourceTargetFileName(resource));
    await fs.writeFile(targetPath, "original");

    const response = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "expected",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "verified",
      action: "upload",
      overwritten: true,
      bytesWritten: "expected".length,
    });
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("expected");
  });

  it("uses the checkpoint download path for model resources", async () => {
    const checkpointResource = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("expected", {
        resourceType: "model",
        name: "Route Test Checkpoint",
        category: null,
        categories: [],
      }),
    ).resource;
    resourceId = checkpointResource.id;
    const targetPath = path.join(checkpointDir, makeCivitaiResourceTargetFileName(checkpointResource));
    await fs.writeFile(targetPath, "expected");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const statusResponse = await GET(new Request("http://localhost/api"), context());
    await expect(statusResponse.json()).resolves.toMatchObject({
      status: "unverified",
      checksumMatches: null,
      actualSha256: null,
      targetPath,
    });

    const verifyResponse = await GET(new Request("http://localhost/api?verify=true"), context());
    await expect(verifyResponse.json()).resolves.toMatchObject({
      status: "verified",
      checksumMatches: true,
      targetPath,
    });

    const downloadResponse = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download" }),
      }),
      context(),
    );
    await expect(downloadResponse.json()).resolves.toMatchObject({
      status: "verified",
      action: "download",
      skipped: true,
      bytesWritten: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the diffusion model download path for Anima model resources", async () => {
    const diffusionResource = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("expected", {
        resourceType: "model",
        name: "Anima Pencil XL",
        versionName: "Diffusion model",
        category: null,
        categories: [],
      }),
    ).resource;
    resourceId = diffusionResource.id;
    const targetPath = path.join(diffusionDir, makeCivitaiResourceTargetFileName(diffusionResource));
    await fs.writeFile(targetPath, "expected");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const statusResponse = await GET(new Request("http://localhost/api"), context());
    await expect(statusResponse.json()).resolves.toMatchObject({
      status: "unverified",
      checksumMatches: null,
      actualSha256: null,
      targetPath,
    });

    const verifyResponse = await GET(new Request("http://localhost/api?verify=true"), context());
    await expect(verifyResponse.json()).resolves.toMatchObject({
      status: "verified",
      checksumMatches: true,
      targetPath,
    });

    const downloadResponse = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download" }),
      }),
      context(),
    );
    await expect(downloadResponse.json()).resolves.toMatchObject({
      status: "verified",
      action: "download",
      skipped: true,
      bytesWritten: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing path when a diffusion model path is not configured", async () => {
    saveCivitaiLibrarySettingsToSqlite(db, {
      loraDownloadPath: loraDir,
      checkpointDownloadPath: checkpointDir,
      diffusionModelPath: "",
    });
    const diffusionResource = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("expected", {
        resourceType: "model",
        name: "Anima Pencil XL",
        category: null,
        categories: [],
      }),
    ).resource;
    resourceId = diffusionResource.id;

    const statusResponse = await GET(new Request("http://localhost/api"), context());
    await expect(statusResponse.json()).resolves.toMatchObject({
      status: "path_missing",
      pathConfigured: false,
      targetPath: null,
    });
  });
});
