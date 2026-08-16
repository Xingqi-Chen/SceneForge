// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CivitaiResourceRecord } from "./types";
import type { SceneForgeSqliteDatabase } from "@/features/persistence/sqlite-storage";

const getDownloadStatusMock = vi.hoisted(() => vi.fn());
const getConfiguredPathMock = vi.hoisted(() => vi.fn());
const getCheckpointMock = vi.hoisted(() => vi.fn());
const getImageMock = vi.hoisted(() => vi.fn());
const listImageLoraUsagesMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/civitai-lora-library/download", () => ({
  getCivitaiResourceDownloadStatus: getDownloadStatusMock,
  isCivitaiResourceDownloadReady: (status: unknown) => status === "ready",
}));

vi.mock("@/features/civitai-lora-library/resource-files", () => ({
  getCivitaiResourceConfiguredDownloadPath: getConfiguredPathMock,
}));

vi.mock("@/features/persistence/sqlite-storage", () => ({
  getCivitaiResourceDetailFromSqlite: getCheckpointMock,
  getImportedImageFromSqlite: getImageMock,
  listImportedImageLoraUsagesFromSqlite: listImageLoraUsagesMock,
  loadCivitaiLibrarySettingsFromSqlite: loadSettingsMock,
}));

import {
  CivitaiImageResourceSelectionError,
  selectImportedImageResourcesFromSqlite,
} from "./image-resource-selection.server";

function resource(
  id: string,
  resourceType: "lora" | "model",
  overrides: Partial<CivitaiResourceRecord> = {},
): CivitaiResourceRecord {
  return {
    id,
    resourceType,
    civitaiModelId: 1,
    civitaiModelVersionId: 2,
    name: id,
    versionName: "v1",
    hash: null,
    baseModel: "Illustrious",
    trainedWords: [],
    tags: [],
    description: null,
    creator: null,
    downloadUrl: null,
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
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

const db = { close: vi.fn() } as unknown as SceneForgeSqliteDatabase;
const checkpoint = resource("checkpoint-current", "model");

async function select(overrides: Partial<Parameters<typeof selectImportedImageResourcesFromSqlite>[0]> = {}) {
  return selectImportedImageResourcesFromSqlite({
    checkpointBaseModel: "Illustrious",
    checkpointId: checkpoint.id,
    db,
    importedImageId: "image-current",
    ...overrides,
  });
}

describe("selectImportedImageResourcesFromSqlite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCheckpointMock.mockReturnValue(checkpoint);
    getImageMock.mockReturnValue({ id: "image-current", baseModel: "Illustrious" });
    listImageLoraUsagesMock.mockReturnValue([]);
    loadSettingsMock.mockReturnValue({
      checkpointDownloadPath: "C:\\private\\checkpoints",
      diffusionModelPath: "C:\\private\\diffusion_models",
      loraDownloadPath: "C:\\private\\loras",
    });
    getConfiguredPathMock.mockImplementation((entry: CivitaiResourceRecord) =>
      entry.resourceType === "model" ? "C:\\private\\checkpoints" : "C:\\private\\loras",
    );
    getDownloadStatusMock.mockResolvedValue("ready");
  });

  it.each([
    ["checkpoint_not_found", undefined, 404],
    ["checkpoint_wrong_type", resource("not-a-checkpoint", "lora"), 422],
    ["checkpoint_base_model_missing", resource("no-base", "model", { baseModel: " " }), 422],
  ] as const)("rejects invalid current checkpoint state: %s", async (code, value, statusCode) => {
    getCheckpointMock.mockReturnValue(value);

    await expect(select()).rejects.toMatchObject({ code, statusCode });
    expect(getImageMock).not.toHaveBeenCalled();
    expect(listImageLoraUsagesMock).not.toHaveBeenCalled();
  });

  it("rejects stale checkpoint base context before reading image usages", async () => {
    await expect(select({ checkpointBaseModel: "Anima" })).rejects.toMatchObject({
      code: "checkpoint_context_mismatch",
      statusCode: 409,
    });
    expect(getDownloadStatusMock).not.toHaveBeenCalled();
    expect(getImageMock).not.toHaveBeenCalled();
  });

  it("requires the current checkpoint itself to remain ready", async () => {
    getDownloadStatusMock.mockResolvedValueOnce("not-ready");

    await expect(select()).rejects.toMatchObject({
      code: "checkpoint_not_ready",
      statusCode: 422,
    });
    expect(getDownloadStatusMock).toHaveBeenCalledWith(checkpoint, "C:\\private\\checkpoints");
    expect(getImageMock).not.toHaveBeenCalled();
  });

  it.each([
    ["image_not_found", undefined, 404],
    ["image_base_model_mismatch", { id: "image-current", baseModel: "Anima" }, 409],
  ] as const)("rejects invalid image context: %s", async (code, image, statusCode) => {
    getImageMock.mockReturnValue(image);

    await expect(select()).rejects.toMatchObject({ code, statusCode });
    expect(listImageLoraUsagesMock).not.toHaveBeenCalled();
  });

  it("keeps the checkpoint and returns all ready same-base LoRAs without exposing configured paths", async () => {
    const loras = Array.from({ length: 6 }, (_, index) => resource(`lora-${index + 1}`, "lora"));
    listImageLoraUsagesMock.mockReturnValue([
      ...loras.map((entry) => ({ resource: entry })),
      { resource: resource("lora-not-ready", "lora") },
      { resource: resource("lora-mismatch", "lora", { baseModel: "Anima" }) },
    ]);
    getDownloadStatusMock.mockImplementation(async (entry: CivitaiResourceRecord) =>
      entry.id === "lora-not-ready" ? "not-ready" : "ready",
    );

    const result = await select();

    expect(result.checkpointId).toBe(checkpoint.id);
    expect(result.loraIds).toEqual(loras.map(({ id }) => id));
    expect(result.loraIds).toHaveLength(6);
    expect(result.warnings.map(({ reason }) => reason)).toEqual(["not_ready", "base_model_mismatch"]);
    expect(JSON.stringify(result)).not.toContain("C:\\private");
    expect(listImageLoraUsagesMock).toHaveBeenCalledWith(db, "image-current");
  });

  it("treats zero eligible LoRAs as a successful empty replacement", async () => {
    listImageLoraUsagesMock.mockReturnValue([
      { resource: resource("lora-not-ready", "lora") },
    ]);
    getDownloadStatusMock.mockImplementation(async (entry: CivitaiResourceRecord) =>
      entry.resourceType === "model" ? "ready" : "not-ready",
    );

    await expect(select()).resolves.toMatchObject({
      checkpointId: checkpoint.id,
      loraIds: [],
      warnings: [{ reason: "not_ready" }],
    });
  });

  it("uses typed errors for all expected validation failures", () => {
    const error = new CivitaiImageResourceSelectionError("safe", {
      code: "checkpoint_not_ready",
      statusCode: 422,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CivitaiImageResourceSelectionError");
  });
});
