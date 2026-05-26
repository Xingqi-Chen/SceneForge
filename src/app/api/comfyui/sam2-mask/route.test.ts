// @vitest-environment node

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const sam2ObjectInfo = {
  DownloadAndLoadSAM2Model: {
    input: {
      required: {
        model: [["sam2.1_hiera_small.safetensors"], {}],
        device: [["cuda", "cpu", "mps"], {}],
        precision: [["fp16", "bf16", "fp32"], {}],
      },
    },
  },
  Sam2Segmentation: {},
  LoadImage: {},
  MaskToImage: {},
  SaveImage: {},
};

async function createPng(width = 16, height = 12, color = "#ffffff") {
  return sharp({
    create: {
      background: color,
      channels: 4,
      height,
      width,
    },
  }).png().toBuffer();
}

describe("ComfyUI SAM2 mask route", () => {
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

  it("uploads the selected source image and queues a SAM2 mask workflow", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.COMFYUI_API_KEY = "secret";
    const sourcePng = await createPng();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(sam2ObjectInfo);
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

        return Response.json({
          name: "uploaded-source.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.client_id).toBe("client-1");
      expect(body.prompt["1"]).toMatchObject({
        class_type: "LoadImage",
        inputs: {
          image: "SceneForge/uploaded-source.png",
        },
      });
      expect(body.prompt["2"]).toMatchObject({
        class_type: "DownloadAndLoadSAM2Model",
        inputs: {
          model: "sam2.1_hiera_small.safetensors",
          segmentor: "single_image",
          device: "cuda",
          precision: "fp16",
        },
      });
      expect(body.prompt["3"]).toMatchObject({
        class_type: "Sam2Segmentation",
        inputs: {
          sam2_model: ["2", 0],
          image: ["1", 0],
          coordinates_positive: JSON.stringify([{ x: 6, y: 4 }]),
          coordinates_negative: JSON.stringify([{ x: 10, y: 7 }]),
          bboxes: [[2, 3, 12, 9]],
        },
      });
      expect(body.prompt["4"]).toMatchObject({
        class_type: "MaskToImage",
        inputs: {
          mask: ["3", 0],
        },
      });
      expect(body.prompt["5"].inputs).toEqual({
        filename_prefix: "SceneForge_sam_mask",
        images: ["4", 0],
      });

      return Response.json({
        prompt_id: "prompt-sam2",
        number: 9,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sam2-mask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceImage: {
            filename: "source.png",
            subfolder: "",
            type: "output",
          },
          imageWidth: 16,
          imageHeight: 12,
          positivePoints: [{ x: 6, y: 4 }],
          negativePoints: [{ x: 10, y: 7 }],
          bbox: {
            x: 2,
            y: 3,
            width: 10,
            height: 6,
          },
          clientId: "client-1",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(payload).toMatchObject({
      clientId: "client-1",
      promptId: "prompt-sam2",
      number: 9,
      outputNodeId: "5",
      nodeIds: {
        sourceImage: "1",
        sam2Segmentation: "3",
        saveImage: "5",
      },
      request: {
        imageName: "SceneForge/uploaded-source.png",
        imageWidth: 16,
        imageHeight: 12,
      },
    });
  });

  it("returns clear object_info errors before uploading", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(input).toBe("http://comfyui.test/object_info");
      return Response.json({});
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sam2-mask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceImage: {
            filename: "source.png",
          },
          imageWidth: 16,
          imageHeight: 12,
          positivePoints: [{ x: 6, y: 4 }],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(payload.error.details.errors).toContain(
      "DownloadAndLoadSAM2Model node is not available in ComfyUI. It is required for SAM2 mask generation.",
    );
  });
});
