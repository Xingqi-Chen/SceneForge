// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Civitai cached image route", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-images-"));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("@/features/civitai-lora-library/image-assets");
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  async function importRoute() {
    vi.doMock("@/features/civitai-lora-library/image-assets", () => ({
      getCivitaiCachedImageContentType: () => "image/webp",
      getCivitaiCachedImagePath: (filename: string) =>
        /^[a-f0-9]{32}\.webp$/i.test(filename) ? path.join(tempDir, filename) : null,
    }));

    return import("./route");
  }

  it("serves cached images addressed by query filename", async () => {
    const filename = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp";
    await fs.writeFile(path.join(tempDir, filename), new Uint8Array([1, 2, 3]));
    const { GET } = await importRoute();

    const response = await GET(new Request(`http://localhost/api/civitai-lora-library/images?filename=${filename}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it("serves cached images addressed by the legacy path URL after rewrite", async () => {
    const filename = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp";
    await fs.writeFile(path.join(tempDir, filename), new Uint8Array([4, 5, 6]));
    const { GET } = await importRoute();

    const response = await GET(new Request(`http://localhost/api/civitai-lora-library/images/${filename}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([4, 5, 6]).buffer);
  });

  it("rejects invalid image filenames", async () => {
    const { GET } = await importRoute();

    const response = await GET(new Request("http://localhost/api/civitai-lora-library/images/not-a-valid-name"));

    expect(response.status).toBe(400);
  });
});
