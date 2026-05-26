// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("ComfyUI upscale models route", () => {
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

  it("reports available supported 2x upscale models from object_info", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.COMFYUI_API_KEY = "secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(input).toBe("http://comfyui.test/object_info");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer secret",
      });

      return Response.json({
        UpscaleModelLoader: {
          input: {
            required: {
              model_name: [
                "COMBO",
                { options: ["other.safetensors", "RealESRGAN_x2plus.pth", "2x_AniScale2_ESRGAN_i16_110K.pth"] },
              ],
            },
          },
        },
      });
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload).toEqual({
      models: ["other.safetensors", "RealESRGAN_x2plus.pth", "2x_AniScale2_ESRGAN_i16_110K.pth"],
      modelUpscaleOptions: [
        {
          available: true,
          label: "RealESRGAN x2",
          mode: "real-esrgan-x2",
          modelName: "RealESRGAN_x2plus.pth",
        },
        {
          available: true,
          label: "AniScale2 x2",
          mode: "aniscale2-x2",
          modelName: "2x_AniScale2_ESRGAN_i16_110K.pth",
        },
      ],
    });
  });
});
