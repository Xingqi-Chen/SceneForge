// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("ComfyUI view route", () => {
  const previousBaseUrl = process.env.COMFYUI_BASE_URL;
  const previousApiKey = process.env.COMFYUI_API_KEY;

  afterEach(() => {
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

    vi.restoreAllMocks();
  });

  it("proxies generated images from ComfyUI", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.COMFYUI_API_KEY = "secret";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toBe("http://comfyui.test/view?filename=image.png&subfolder=&type=output");
      expect(init?.headers).toMatchObject({
        accept: "image/*",
        authorization: "Bearer secret",
      });
      expect(init?.cache).toBe("no-store");

      return new Response("png-bytes", {
        headers: {
          "content-type": "image/png",
        },
      });
    });

    const response = await GET(
      new Request("http://localhost/api/comfyui/view?filename=image.png&promptId=prompt-123&subfolder=&type=output"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("content-type")).toBe("image/png");
    await expect(response.text()).resolves.toBe("png-bytes");
  });
});
