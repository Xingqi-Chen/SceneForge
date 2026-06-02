// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CivitaiLibrarySettings, CivitaiResourceRecord, CivitaiResourceUpsertInput } from "@/features/civitai-lora-library";
import {
  getCivitaiResourceConfiguredDownloadPath,
  makeCivitaiResourceTargetFileName,
} from "@/features/civitai-lora-library";
import {
  openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite,
  upsertCivitaiResourceToSqlite,
  type SceneForgeSqliteDatabase,
} from "@/features/persistence/sqlite-storage";

import { GET } from "./route";

function makeResourceInput(
  resourceType: "lora" | "model",
  name: string,
  overrides: Partial<CivitaiResourceUpsertInput> = {},
): CivitaiResourceUpsertInput {
  return {
    resourceType,
    civitaiModelId: Math.floor(Math.random() * 100000),
    civitaiModelVersionId: Math.floor(Math.random() * 100000),
    name,
    versionName: "v1",
    hash: `${name}-hash`,
    baseModel: "Illustrious",
    trainedWords: resourceType === "lora" ? [`${name} trigger`] : [],
    tags: [],
    description: null,
    creator: "resource creator",
    downloadUrl: "https://download.test/model.safetensors",
    filesJson: null,
    officialImagesJson: null,
    category: resourceType === "lora" ? "style" : null,
    categories: resourceType === "lora" ? ["style"] : [],
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

describe("Civitai resources route", () => {
  let tempDir: string;
  let db: SceneForgeSqliteDatabase;
  let settings: CivitaiLibrarySettings;
  let previousSqliteFile: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-resources-"));
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    db = await openSceneForgeSqliteDatabase();
    settings = {
      checkpointDownloadPath: path.join(tempDir, "checkpoints"),
      controlNetModelPath: path.join(tempDir, "controlnet"),
      diffusionModelPath: path.join(tempDir, "diffusion"),
      loraDownloadPath: path.join(tempDir, "loras"),
    };
    await Promise.all(Object.values(settings).map((directory) => fs.mkdir(directory, { recursive: true })));
    saveCivitaiLibrarySettingsToSqlite(db, settings);
  });

  afterEach(async () => {
    db.close();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function markDownloaded(resource: CivitaiResourceRecord) {
    const downloadPath = getCivitaiResourceConfiguredDownloadPath(resource, settings);
    await fs.writeFile(path.join(downloadPath, makeCivitaiResourceTargetFileName(resource)), "downloaded");
  }

  it("filters resource lists to downloaded local files when requested", async () => {
    const downloaded = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Downloaded Checkpoint"),
    ).resource;
    const missing = upsertCivitaiResourceToSqlite(
      db,
      makeResourceInput("model", "Missing Checkpoint"),
    ).resource;
    await markDownloaded(downloaded);

    const response = await GET(
      new Request("http://localhost/api/civitai-lora-library/resources?resourceType=model&downloaded=ready"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items.map((item: { id: string }) => item.id)).toEqual([downloaded.id]);
    expect(payload.items.map((item: { id: string }) => item.id)).not.toContain(missing.id);
  });
});
