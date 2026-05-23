// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const objectInfo = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [["model.safetensors"], {}],
      },
    },
  },
  LoraLoader: {
    input: {
      required: {
        lora_name: [["style.safetensors"], {}],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        sampler_name: [["euler", "dpmpp_2m"], {}],
        scheduler: [["normal", "karras"], {}],
      },
    },
  },
};

describe("ComfyUI generate image route", () => {
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

  it("returns 400 for invalid request bodies", async () => {
    const response = await POST(
      new Request("http://localhost/api/comfyui/generate-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "",
          positivePrompt: "a scene",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toContain("checkpointName");
  });

  it("queues a text-to-image workflow through ComfyUI", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.COMFYUI_API_KEY = "secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        expect(init?.method).toBeUndefined();
        return Response.json(objectInfo);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer secret",
      });

      const body = JSON.parse(String(init?.body));
      expect(body.client_id).toBe("client-1");
      expect(body.prompt["1"].inputs.ckpt_name).toBe("model.safetensors");
      expect(body.prompt["2"].inputs.text).toBe("a scene");
      expect(body.prompt["5"].inputs.seed).toBe(123);

      return Response.json({
        prompt_id: "prompt-123",
        number: 9,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/generate-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "model.safetensors",
          positivePrompt: "a scene",
          seed: 123,
          clientId: "client-1",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(payload).toMatchObject({
      clientId: "client-1",
      promptId: "prompt-123",
      number: 9,
      nodeErrors: {},
      outputNodeId: "7",
      nodeIds: {
        saveImage: "7",
      },
      request: {
        seed: 123,
      },
    });
  });

  it("returns readable validation errors before queueing unavailable ComfyUI options", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(input).toBe("http://comfyui.test/object_info");
      return Response.json(objectInfo);
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/generate-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "missing.safetensors",
          positivePrompt: "a scene",
          samplerName: "DPM++ 4M",
          width: 1025,
          height: 1024,
          loras: [{ loraName: "missing-lora.safetensors", strengthModel: 0.7 }],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload.error.message).toContain("current ComfyUI");
    expect(payload.error.details.errors).toEqual([
      "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
      "Checkpoint is not available in ComfyUI: missing.safetensors",
      "Sampler is not available in ComfyUI: DPM++ 4M",
      "width must be between 16 and 16384 and divisible by 8 for ComfyUI EmptyLatentImage.",
    ]);
  });
});
