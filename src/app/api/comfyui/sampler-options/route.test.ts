// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("ComfyUI sampler options route", () => {
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

  it("reports current KSampler samplers and schedulers from object_info", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.COMFYUI_API_KEY = "secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(input).toBe("http://comfyui.test/object_info");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer secret",
      });

      return Response.json({
        KSampler: {
          input: {
            required: {
              sampler_name: [["euler", "dpmpp_2m_sde_heun_gpu", "res_multistep_cfg_pp"], {}],
              scheduler: ["COMBO", { options: ["normal", "karras", "kl_optimal"] }],
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
      samplers: ["euler", "dpmpp_2m_sde_heun_gpu", "res_multistep_cfg_pp"],
      schedulers: ["normal", "karras", "kl_optimal"],
    });
  });
});
