// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openSceneForgeSqliteDatabase,
  saveCivitaiLibrarySettingsToSqlite,
} from "@/features/persistence/sqlite-storage";

import { GET } from "./route";

describe("ComfyUI ControlNet models route", () => {
  let tempRoot: string | null = null;
  let previousSqliteFile: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { force: true, recursive: true });
      tempRoot = null;
    }

    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    previousSqliteFile = undefined;
  });

  async function makeTempRoot() {
    const parent = path.join(process.cwd(), "data");
    await mkdir(parent, { recursive: true });
    tempRoot = await mkdtemp(path.join(parent, "controlnet-models-test-"));
    return tempRoot;
  }

  it("lists supported model files under the configured directory", async () => {
    const root = await makeTempRoot();
    await mkdir(path.join(root, "depth"));
    await writeFile(path.join(root, "openpose.safetensors"), "model");
    await writeFile(path.join(root, "depth", "depth-controlnet.pth"), "model");
    await writeFile(path.join(root, "notes.txt"), "not a model");

    const response = await GET(
      new Request(`http://localhost/api/comfyui/controlnet-models?path=${encodeURIComponent(root)}`),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.modelPath).toBe(path.resolve(root));
    expect(payload.models).toEqual([
      { label: "depth/depth-controlnet.pth", value: "depth/depth-controlnet.pth" },
      { label: "openpose.safetensors", value: "openpose.safetensors" },
    ]);
  });

  it("uses the shared server-side path setting when no path query is provided", async () => {
    const root = await makeTempRoot();
    await writeFile(path.join(root, "openpose.safetensors"), "model");
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(root, "settings.sqlite");

    const db = await openSceneForgeSqliteDatabase();
    try {
      saveCivitaiLibrarySettingsToSqlite(db, {
        controlNetModelPath: root,
      });
    } finally {
      db.close();
    }

    const response = await GET(new Request("http://localhost/api/comfyui/controlnet-models"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.modelPath).toBe(path.resolve(root));
    expect(payload.models).toEqual([{ label: "openpose.safetensors", value: "openpose.safetensors" }]);
  });

  it("rejects paths that are not folders", async () => {
    const root = await makeTempRoot();
    const filePath = path.join(root, "openpose.safetensors");
    await writeFile(filePath, "model");

    const response = await GET(
      new Request(`http://localhost/api/comfyui/controlnet-models?path=${encodeURIComponent(filePath)}`),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("ControlNet 模型路径必须是一个文件夹。");
  });
});
