// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CIVITAI_IMAGE_UNAVAILABLE_MESSAGE } from "@/features/civitai-lora-library";

import { POST } from "./route";

function makeRequest(imageUrl: unknown): Request {
  return new Request("http://localhost/api/civitai-lora-library/parse-image", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ imageUrl }),
  });
}

describe("Civitai parse-image route", () => {
  let tempDir: string;
  let previousSqliteFile: string | undefined;
  let previousNsfwEnv: string | undefined;
  let previousFetch: typeof fetch;
  let fetchMock = vi.fn<typeof fetch>();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sceneforge-civitai-parse-route-"));
    previousSqliteFile = process.env.SCENEFORGE_SQLITE_FILE;
    previousNsfwEnv = process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
    previousFetch = globalThis.fetch;
    process.env.SCENEFORGE_SQLITE_FILE = path.join(tempDir, "sceneforge.sqlite");
    delete process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
    fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    consoleErrorSpy.mockRestore();
    if (previousSqliteFile === undefined) {
      delete process.env.SCENEFORGE_SQLITE_FILE;
    } else {
      process.env.SCENEFORGE_SQLITE_FILE = previousSqliteFile;
    }
    if (previousNsfwEnv === undefined) {
      delete process.env.SCENEFORGE_SHOW_NSFW_BUTTON;
    } else {
      process.env.SCENEFORGE_SHOW_NSFW_BUTTON = previousNsfwEnv;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.each([
    "https://civitai.red.evil.test/images/135795968",
    "https://images.civitai.red/images/135795968",
    "https://civitai.red/models/135795968",
    "ftp://civitai.red/images/135795968",
    "0",
    "",
    null,
    135795968,
  ])("returns 400 without fetching for illegal input %j", async (imageUrl) => {
    const response = await POST(makeRequest(imageUrl));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: {
        message: expect.any(String),
      },
    });
    expect(JSON.stringify(payload)).not.toContain("details");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves .com SFW metadata while using the fixed lookup query", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [{ id: 29900440, nsfw: false, nsfwLevel: 1 }],
      }),
    );

    const response = await POST(makeRequest("https://www.civitai.com/images/29900440?from=test#preview"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      image: {
        civitaiImageId: 29900440,
        civitaiImagePageUrl: "https://civitai.com/images/29900440",
        nsfw: false,
        nsfwLevel: 1,
      },
      resources: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://civitai.com/api/v1/images?imageId=29900440&nsfw=X",
    );
  });

  it("returns a neutral 404 for an empty upstream image result", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [],
        details: {
          secret: "empty-result-secret",
        },
      }),
    );

    const response = await POST(makeRequest("https://civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        message: CIVITAI_IMAGE_UNAVAILABLE_MESSAGE,
      },
    });
    expect(serialized).not.toContain("empty-result-secret");
    expect(serialized).not.toContain("details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://civitai.com/api/v1/images?imageId=135795968&nsfw=X",
    );
  });

  it("maps upstream client errors without exposing raw details or secrets", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: "raw-upstream-error",
          details: {
            authorization: "Bearer upstream-secret",
          },
        },
        { status: 401 },
      ),
    );

    const response = await POST(makeRequest("https://civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: {
        message: "Civitai request failed.",
      },
    });
    expect(serialized).not.toContain("raw-upstream-error");
    expect(serialized).not.toContain("upstream-secret");
    expect(serialized).not.toContain("details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps unknown failures to a generic response without exposing the thrown error", async () => {
    fetchMock.mockRejectedValue(new Error("unknown-secret-parse-failure"));

    const response = await POST(makeRequest("https://civitai.red/images/135795968"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        message: "解析 Civitai 图片元数据失败。",
      },
    });
    expect(serialized).not.toContain("unknown-secret-parse-failure");
    expect(serialized).not.toContain("details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
