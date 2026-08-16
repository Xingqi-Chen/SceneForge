// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const selectResourcesMock = vi.hoisted(() => vi.fn());
const openDatabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/civitai-lora-library/image-resource-selection.server", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/civitai-lora-library/image-resource-selection.server")
  >("@/features/civitai-lora-library/image-resource-selection.server");
  return {
    ...actual,
    selectImportedImageResourcesFromSqlite: selectResourcesMock,
  };
});

vi.mock("@/features/persistence/sqlite-storage", () => ({
  openSceneForgeSqliteDatabase: openDatabaseMock,
}));

import { CivitaiImageResourceSelectionError } from "@/features/civitai-lora-library/image-resource-selection.server";
import { GET } from "./route";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("imported-image resource selection route", () => {
  const db = { close: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    openDatabaseMock.mockResolvedValue(db);
    selectResourcesMock.mockResolvedValue({
      checkpointId: "checkpoint-current",
      loraIds: ["lora-1", "lora-2", "lora-3", "lora-4", "lora-5"],
      warnings: [],
    });
  });

  it("validates required checkpoint params before opening storage", async () => {
    for (const url of [
      "http://localhost/api/image/resource-selection",
      "http://localhost/api/image/resource-selection?checkpointId=checkpoint-current",
      "http://localhost/api/image/resource-selection?checkpointBaseModel=Illustrious",
      `http://localhost/api/image/resource-selection?checkpointId=${"x".repeat(201)}&checkpointBaseModel=Illustrious`,
      `http://localhost/api/image/resource-selection?checkpointId=checkpoint-current&checkpointBaseModel=${"x".repeat(201)}`,
    ]) {
      const response = await GET(new Request(url), context("image-current"));
      expect(response.status).toBe(400);
    }

    expect(openDatabaseMock).not.toHaveBeenCalled();
    expect(selectResourcesMock).not.toHaveBeenCalled();
  });

  it("binds decoded checkpoint ID, base model, and trimmed image ID to the server selection", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/image/resource-selection?checkpointId=checkpoint%2Fcurrent&checkpointBaseModel=Illustrious%20XL",
      ),
      context(" image-current "),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      checkpointId: "checkpoint-current",
      loraIds: ["lora-1", "lora-2", "lora-3", "lora-4", "lora-5"],
    });
    expect(selectResourcesMock).toHaveBeenCalledWith({
      checkpointBaseModel: "Illustrious XL",
      checkpointId: "checkpoint/current",
      db,
      importedImageId: "image-current",
    });
    expect(db.close).toHaveBeenCalledOnce();
  });

  it("fails closed for an empty image ID without opening storage", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/image/resource-selection?checkpointId=checkpoint-current&checkpointBaseModel=Illustrious",
      ),
      context(" "),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "image_not_found", message: "Imported image not found." },
    });
    expect(openDatabaseMock).not.toHaveBeenCalled();
  });

  it("returns safe typed validation failures and closes storage", async () => {
    selectResourcesMock.mockRejectedValue(new CivitaiImageResourceSelectionError(
      "The selected checkpoint changed. Reload the image gallery and try again.",
      { code: "checkpoint_context_mismatch", statusCode: 409 },
    ));

    const response = await GET(
      new Request(
        "http://localhost/api/image/resource-selection?checkpointId=checkpoint-current&checkpointBaseModel=Illustrious",
      ),
      context("image-current"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "checkpoint_context_mismatch",
        message: "The selected checkpoint changed. Reload the image gallery and try again.",
      },
    });
    expect(db.close).toHaveBeenCalledOnce();
  });

  it("redacts absolute paths from unexpected failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    selectResourcesMock.mockRejectedValue(new Error("ENOENT C:\\private\\models\\secret.safetensors"));

    const response = await GET(
      new Request(
        "http://localhost/api/image/resource-selection?checkpointId=checkpoint-current&checkpointBaseModel=Illustrious",
      ),
      context("image-current"),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        code: "resource_selection_failed",
        message: "Unable to select resources from this imported image.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("C:\\private");
    expect(consoleError).toHaveBeenCalledOnce();
    expect(db.close).toHaveBeenCalledOnce();
  });
});
