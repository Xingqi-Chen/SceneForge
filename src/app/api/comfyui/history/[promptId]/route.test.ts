// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("ComfyUI history route", () => {
  const previousBaseUrl = process.env.COMFYUI_BASE_URL;

  afterEach(() => {
    if (previousBaseUrl === undefined) {
      delete process.env.COMFYUI_BASE_URL;
    } else {
      process.env.COMFYUI_BASE_URL = previousBaseUrl;
    }

    vi.restoreAllMocks();
  });

  it("proxies prompt history from ComfyUI", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(input).toBe("http://comfyui.test/history/prompt-123");

      return Response.json({
        "prompt-123": {
          outputs: {
            "7": {
              images: [
                {
                  filename: "SceneForge_00001_.png",
                  subfolder: "",
                  type: "output",
                },
              ],
            },
          },
        },
      });
    });

    const response = await GET(new Request("http://localhost/api/comfyui/history/prompt-123"), {
      params: Promise.resolve({ promptId: "prompt-123" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      promptId: "prompt-123",
      completed: true,
      images: [
        {
          nodeId: "7",
          filename: "SceneForge_00001_.png",
          subfolder: "",
          type: "output",
          url: "/api/comfyui/view?filename=SceneForge_00001_.png&promptId=prompt-123&subfolder=&type=output",
        },
      ],
    });
    expect(payload.raw["prompt-123"].outputs["7"].images).toHaveLength(1);
  });
});
