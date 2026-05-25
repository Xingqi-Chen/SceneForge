// @vitest-environment node

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const objectInfoWithInpaint = {
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
  LoadImage: {},
  LoadImageMask: {},
  SetLatentNoiseMask: {},
  VAEEncode: {},
  VAEEncodeForInpaint: {},
  VAEDecode: {},
};

async function createPng(width = 8, height = 8, color = "#ffffff") {
  return sharp({
    create: {
      background: color,
      channels: 4,
      height,
      width,
    },
  }).png().toBuffer();
}

async function createPngDataUrl(width = 8, height = 8, color = "#ffffff") {
  const bytes = await createPng(width, height, color);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function readUploadedKind(body: BodyInit | null | undefined) {
  if (!(body instanceof FormData)) {
    return "source";
  }

  const image = body.get("image");
  const filename = image && typeof image === "object" && "name" in image && typeof image.name === "string"
    ? image.name
    : "";

  return filename.includes("mask") ? "mask" : "source";
}

describe("ComfyUI inpaint image route", () => {
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

  it("uploads the source image and mask, then queues a latent noise mask inpaint workflow", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.COMFYUI_API_KEY = "secret";
    const sourcePng = await createPng();
    const maskDataUrl = await createPngDataUrl();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithInpaint);
      }

      if (String(input) === "http://comfyui.test/view?filename=source.png&subfolder=&type=output") {
        expect(init?.headers).toMatchObject({
          accept: "image/*",
          authorization: "Bearer secret",
        });
        expect(init?.cache).toBe("no-store");

        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (input === "http://comfyui.test/upload/image") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(FormData);
        const kind = readUploadedKind(init?.body);

        return Response.json({
          name: kind === "mask" ? "uploaded-mask.png" : "uploaded-source.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.client_id).toBe("client-1");
      expect(body.prompt["4"]).toMatchObject({
        class_type: "LoadImage",
        inputs: {
          image: "SceneForge/uploaded-source.png",
        },
      });
      expect(body.prompt["5"]).toMatchObject({
        class_type: "LoadImageMask",
        inputs: {
          image: "SceneForge/uploaded-mask.png",
          channel: "red",
        },
      });
      expect(body.prompt["7"]).toMatchObject({
        class_type: "SetLatentNoiseMask",
        inputs: {
          samples: ["6", 0],
          mask: ["5", 0],
        },
      });
      expect(body.prompt["8"].inputs.latent_image).toEqual(["7", 0]);

      return Response.json({
        prompt_id: "prompt-inpaint",
        number: 14,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/inpaint-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          negativePrompt: "blurry",
          sourceImage: {
            filename: "source.png",
            subfolder: "",
            type: "output",
          },
          maskDataUrl,
          seed: 123,
          denoise: 0.6,
          clientId: "client-1",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(payload).toMatchObject({
      clientId: "client-1",
      promptId: "prompt-inpaint",
      number: 14,
      outputNodeId: "10",
      nodeIds: {
        sourceImage: "4",
        maskImage: "5",
        setLatentNoiseMask: "7",
        saveImage: "10",
      },
      request: {
        imageName: "SceneForge/uploaded-source.png",
        maskDataUrl: "",
        maskName: "SceneForge/uploaded-mask.png",
      },
    });
  });

  it("returns a readable error when the mask dimensions do not match the source image", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const sourcePng = await createPng(8, 8);
    const maskDataUrl = await createPngDataUrl(4, 4);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithInpaint);
      }

      if (String(input).startsWith("http://comfyui.test/view")) {
        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      throw new Error(`Unexpected fetch ${String(input)}`);
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/inpaint-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: {
            filename: "source.png",
            type: "output",
          },
          maskDataUrl,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("Mask dimensions must match the source image dimensions.");
  });

  it("returns a readable error when the mask data URL is not valid PNG image data", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const sourcePng = await createPng(8, 8);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithInpaint);
      }

      if (String(input).startsWith("http://comfyui.test/view")) {
        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      throw new Error(`Unexpected fetch ${String(input)}`);
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/inpaint-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: {
            filename: "source.png",
            type: "output",
          },
          maskDataUrl: "data:image/png;base64,aGVsbG8=",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("Unable to decode source image or mask PNG data.");
  });
});
