// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as DELETE_FILE } from "../files/route";
import { DELETE, GET } from "./[filename]/route";
import { POST } from "./route";

describe("ComfyUI generated image storage routes", () => {
  const previousBaseUrl = process.env.COMFYUI_BASE_URL;
  const previousApiKey = process.env.COMFYUI_API_KEY;
  const previousGeneratedImagesDir = process.env.SCENEFORGE_GENERATED_IMAGES_DIR;
  const previousTempDir = process.env.COMFYUI_TEMP_DIR;
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-generated-images-"));
    process.env.SCENEFORGE_GENERATED_IMAGES_DIR = path.join(tempDir, "generated");
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    delete process.env.COMFYUI_API_KEY;
    delete process.env.COMFYUI_TEMP_DIR;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { force: true, recursive: true });

    if (previousBaseUrl === undefined) {
      delete process.env.COMFYUI_BASE_URL;
    } else {
      process.env.COMFYUI_BASE_URL = previousBaseUrl;
    }

    if (previousApiKey === undefined) {
      delete process.env.COMFYUI_API_KEY;
    } else {
      process.env.COMFYUI_API_KEY = previousApiKey;
    }

    if (previousGeneratedImagesDir === undefined) {
      delete process.env.SCENEFORGE_GENERATED_IMAGES_DIR;
    } else {
      process.env.SCENEFORGE_GENERATED_IMAGES_DIR = previousGeneratedImagesDir;
    }

    if (previousTempDir === undefined) {
      delete process.env.COMFYUI_TEMP_DIR;
    } else {
      process.env.COMFYUI_TEMP_DIR = previousTempDir;
    }
  });

  it("copies a ComfyUI preview image into the SceneForge managed directory", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const comfyTempDir = path.join(tempDir, "comfy-temp");
    const previewFilePath = path.join(comfyTempDir, "preview.png");
    await fs.mkdir(path.dirname(previewFilePath), { recursive: true });
    await fs.writeFile(previewFilePath, bytes);
    process.env.COMFYUI_TEMP_DIR = comfyTempDir;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, {
        headers: { "content-type": "image/png" },
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/comfyui/generated-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: {
            filename: "preview.png",
            type: "temp",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://comfyui.test/view?filename=preview.png&type=temp",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(payload.filename).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(payload.url).toBe(`/api/comfyui/generated-images/${payload.filename}`);
    expect(payload.sourceDeletion).toEqual({ attempted: true, deleted: true });
    await expect(fs.readFile(path.join(process.env.SCENEFORGE_GENERATED_IMAGES_DIR!, payload.filename))).resolves.toEqual(
      Buffer.from(bytes),
    );
    await expect(fs.stat(previewFilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the saved copy and reports cleanup errors when COMFYUI_TEMP_DIR is missing", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, {
        headers: { "content-type": "image/png" },
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/comfyui/generated-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: {
            filename: "preview.png",
            type: "temp",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sourceDeletion).toEqual({
      attempted: true,
      deleted: false,
      error: expect.stringContaining("COMFYUI_TEMP_DIR"),
    });
    await expect(fs.readFile(path.join(process.env.SCENEFORGE_GENERATED_IMAGES_DIR!, payload.filename))).resolves.toEqual(
      Buffer.from(bytes),
    );
  });

  it("rejects unsupported ComfyUI response content types", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not an image", {
        headers: { "content-type": "text/plain" },
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/comfyui/generated-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { filename: "preview.txt", type: "temp" } }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(415);
    expect(payload.error.message).toContain("supported image");
  });

  it("serves and deletes managed generated images", async () => {
    const filename = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
    const filePath = path.join(process.env.SCENEFORGE_GENERATED_IMAGES_DIR!, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, new Uint8Array([1, 2, 3]));

    const getResponse = await GET(new Request(`http://localhost/api/comfyui/generated-images/${filename}`), {
      params: Promise.resolve({ filename }),
    });
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toBe("image/png");
    await expect(getResponse.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);

    const deleteResponse = await DELETE(new Request(`http://localhost/api/comfyui/generated-images/${filename}`, { method: "DELETE" }), {
      params: Promise.resolve({ filename }),
    });
    expect(deleteResponse.status).toBe(200);
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid managed image filenames", async () => {
    const response = await GET(new Request("http://localhost/api/comfyui/generated-images/bad.png"), {
      params: Promise.resolve({ filename: "../bad.png" }),
    });

    expect(response.status).toBe(400);
  });

  it("deletes local ComfyUI temp files only when COMFYUI_TEMP_DIR is configured", async () => {
    const comfyTempDir = path.join(tempDir, "comfy-temp");
    const filePath = path.join(comfyTempDir, "sub", "preview.png");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "temp");
    process.env.COMFYUI_TEMP_DIR = comfyTempDir;

    const response = await DELETE_FILE(
      new Request("http://localhost/api/comfyui/files", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: {
            filename: "preview.png",
            subfolder: "sub",
            type: "temp",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });

    delete process.env.COMFYUI_TEMP_DIR;
    const missingConfigResponse = await DELETE_FILE(
      new Request("http://localhost/api/comfyui/files", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { filename: "preview.png", type: "temp" } }),
      }),
    );
    const payload = await missingConfigResponse.json();

    expect(missingConfigResponse.status).toBe(400);
    expect(payload.error.message).toContain("COMFYUI_TEMP_DIR");
  });

  it("rejects deletion for non-temp ComfyUI files", async () => {
    const response = await DELETE_FILE(
      new Request("http://localhost/api/comfyui/files", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { filename: "legacy.png", type: "output" } }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toContain("temporary files");
  });
});
