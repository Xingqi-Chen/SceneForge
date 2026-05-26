// @vitest-environment node

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MIN_COMFYUI_VAE_INPAINT_DENOISE } from "@/features/comfyui";
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
  VAEEncodeTiled: {},
  VAEEncodeForInpaint: {},
  VAEDecode: {},
  VAEDecodeTiled: {},
  FaceDetailer: {},
  UltralyticsDetectorProvider: {
    input: {
      required: {
        model_name: [["bbox/face_yolov8s.pt", "bbox/hand_yolov8s.pt"], {}],
      },
    },
  },
};

const objectInfoWithHighResInpaint = {
  ...objectInfoWithInpaint,
  ImageScaleBy: {
    input: {
      required: {
        upscale_method: [["nearest-exact", "lanczos"], {}],
      },
    },
  },
  MaskToImage: {},
  ImageToMask: {},
  ImageScale: {
    input: {
      required: {
        upscale_method: [["lanczos"], {}],
      },
    },
  },
  UpscaleModelLoader: {
    input: {
      required: {
        model_name: ["COMBO", { options: ["RealESRGAN_x2plus.pth", "2x_AniScale2_ESRGAN_i16_110K.pth"] }],
      },
    },
  },
  ImageUpscaleWithModel: {},
};

const objectInfoWithLocalRegionInpaint = {
  ...objectInfoWithHighResInpaint,
  ImageCrop: {},
  CropMask: {},
  FeatherMask: {},
  ImageCompositeMasked: {},
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

  it("queues a model-based 2x high-res inpaint workflow after uploading source and mask", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const sourcePng = await createPng();
    const maskDataUrl = await createPngDataUrl();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithHighResInpaint);
      }

      if (String(input) === "http://comfyui.test/view?filename=source.png&subfolder=&type=output") {
        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (input === "http://comfyui.test/upload/image") {
        const kind = readUploadedKind(init?.body);

        return Response.json({
          name: kind === "mask" ? "uploaded-mask.png" : "uploaded-source.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["6"]).toMatchObject({
        class_type: "UpscaleModelLoader",
        inputs: {
          model_name: "RealESRGAN_x2plus.pth",
        },
      });
      expect(body.prompt["7"]).toMatchObject({
        class_type: "ImageUpscaleWithModel",
        inputs: {
          image: ["4", 0],
          upscale_model: ["6", 0],
        },
      });
      expect(body.prompt["8"]).toMatchObject({
        class_type: "MaskToImage",
      });
      expect(body.prompt["9"]).toMatchObject({
        class_type: "ImageScaleBy",
        inputs: {
          image: ["8", 0],
          scale_by: 2,
          upscale_method: "nearest-exact",
        },
      });
      expect(body.prompt["11"].inputs.pixels).toEqual(["7", 0]);
      expect(body.prompt["11"]).toMatchObject({
        class_type: "VAEEncodeTiled",
        inputs: {
          overlap: 64,
          temporal_overlap: 8,
          temporal_size: 64,
          tile_size: 512,
        },
      });
      expect(body.prompt["12"].inputs.mask).toEqual(["10", 0]);
      expect(body.prompt["13"].inputs.latent_image).toEqual(["12", 0]);
      expect(body.prompt["14"]).toMatchObject({
        class_type: "VAEDecodeTiled",
        inputs: {
          overlap: 64,
          temporal_overlap: 8,
          temporal_size: 64,
          tile_size: 512,
        },
      });

      return Response.json({
        prompt_id: "prompt-highres-inpaint",
        number: 16,
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
          sourceImage: {
            filename: "source.png",
            subfolder: "",
            type: "output",
          },
          maskDataUrl,
          seed: 123,
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "real-esrgan-x2",
            scaleBy: 2,
            modelName: "RealESRGAN_x2plus.pth",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(payload).toMatchObject({
      promptId: "prompt-highres-inpaint",
      outputNodeId: "15",
      nodeIds: {
        upscaleModelLoader: "6",
        imageUpscaleWithModel: "7",
        maskToImage: "8",
        maskImageScaleBy: "9",
        imageToMask: "10",
        saveImage: "15",
      },
      request: {
        imageHeight: 8,
        imageWidth: 8,
        upscaleBeforeInpaint: {
          enabled: true,
          mode: "real-esrgan-x2",
          scaleBy: 2,
          modelName: "RealESRGAN_x2plus.pth",
        },
      },
    });
  });

  it("queues a local-region high-res inpaint workflow after uploading source and mask", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const sourcePng = await createPng(16, 16);
    const maskDataUrl = await createPngDataUrl(16, 16);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithLocalRegionInpaint);
      }

      if (String(input) === "http://comfyui.test/view?filename=source.png&subfolder=&type=output") {
        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (input === "http://comfyui.test/upload/image") {
        const kind = readUploadedKind(init?.body);

        return Response.json({
          name: kind === "mask" ? "uploaded-mask.png" : "uploaded-source.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["6"]).toMatchObject({
        class_type: "ImageCrop",
        inputs: {
          image: ["4", 0],
          x: 0,
          y: 0,
          width: 8,
          height: 8,
        },
      });
      expect(body.prompt["7"]).toMatchObject({
        class_type: "CropMask",
        inputs: {
          mask: ["5", 0],
          x: 0,
          y: 0,
          width: 8,
          height: 8,
        },
      });
      expect(body.prompt["18"]).toMatchObject({
        class_type: "ImageCompositeMasked",
        inputs: {
          destination: ["4", 0],
          source: ["17", 0],
          x: 0,
          y: 0,
          resize_source: false,
          mask: ["8", 0],
        },
      });

      return Response.json({
        prompt_id: "prompt-local-highres-inpaint",
        number: 17,
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
          sourceImage: {
            filename: "source.png",
            subfolder: "",
            type: "output",
          },
          maskDataUrl,
          seed: 123,
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "lanczos",
            scaleBy: 2,
            strategy: "local-region",
            localRegion: {
              x: 0,
              y: 0,
              width: 8,
              height: 8,
              source: "mask-bounds",
              padding: 128,
              feather: 32,
            },
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(payload).toMatchObject({
      promptId: "prompt-local-highres-inpaint",
      outputNodeId: "19",
      nodeIds: {
        sourceImageCrop: "6",
        maskCrop: "7",
        compositeMaskFeather: "8",
        localPatchScale: "17",
        localComposite: "18",
        saveImage: "19",
      },
      request: {
        imageHeight: 16,
        imageWidth: 16,
        upscaleBeforeInpaint: {
          enabled: true,
          strategy: "local-region",
          localRegion: {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
          },
        },
      },
    });
  });

  it("raises too-low VAE inpaint denoise before queueing to avoid gray mask fills", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const sourcePng = await createPng();
    const maskDataUrl = await createPngDataUrl();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithInpaint);
      }

      if (String(input) === "http://comfyui.test/view?filename=source.png&subfolder=&type=output") {
        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (input === "http://comfyui.test/upload/image") {
        const kind = readUploadedKind(init?.body);

        return Response.json({
          name: kind === "mask" ? "uploaded-mask.png" : "uploaded-source.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["6"]).toMatchObject({
        class_type: "VAEEncodeForInpaint",
        inputs: {
          pixels: ["4", 0],
          mask: ["5", 0],
        },
      });
      expect(body.prompt["7"].inputs.denoise).toBe(MIN_COMFYUI_VAE_INPAINT_DENOISE);

      return Response.json({
        prompt_id: "prompt-vae-denoise",
        number: 17,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/inpaint-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpointName: "model.safetensors",
          positivePrompt: "repair hands",
          sourceImage: {
            filename: "source.png",
            subfolder: "",
            type: "output",
          },
          maskDataUrl,
          seed: 123,
          inpaintMode: "vae-inpaint",
          denoise: 0.2,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      promptId: "prompt-vae-denoise",
      request: {
        denoise: MIN_COMFYUI_VAE_INPAINT_DENOISE,
        inpaintMode: "vae-inpaint",
      },
    });
  });

  it("queues inpaint workflow with HandDetailer before FaceDetailer when enabled", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const sourcePng = await createPng();
    const maskDataUrl = await createPngDataUrl();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithInpaint);
      }

      if (String(input) === "http://comfyui.test/view?filename=source.png&subfolder=&type=output") {
        return new Response(new Uint8Array(sourcePng), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (input === "http://comfyui.test/upload/image") {
        const kind = readUploadedKind(init?.body);

        return Response.json({
          name: kind === "mask" ? "uploaded-mask.png" : "uploaded-source.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["10"]).toMatchObject({
        class_type: "UltralyticsDetectorProvider",
        inputs: {
          model_name: "bbox/hand_yolov8s.pt",
        },
      });
      expect(body.prompt["11"]).toMatchObject({
        class_type: "FaceDetailer",
        _meta: {
          title: "HandDetailer",
        },
        inputs: {
          image: ["9", 0],
          bbox_detector: ["10", 0],
        },
      });
      expect(body.prompt["12"]).toMatchObject({
        class_type: "UltralyticsDetectorProvider",
        inputs: {
          model_name: "bbox/face_yolov8s.pt",
        },
      });
      expect(body.prompt["13"]).toMatchObject({
        class_type: "FaceDetailer",
        _meta: {
          title: "FaceDetailer",
        },
        inputs: {
          image: ["11", 0],
          bbox_detector: ["12", 0],
        },
      });
      expect(body.prompt["14"].inputs.images).toEqual(["13", 0]);

      return Response.json({
        prompt_id: "prompt-inpaint-detailers",
        number: 15,
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
          sourceImage: {
            filename: "source.png",
            subfolder: "",
            type: "output",
          },
          maskDataUrl,
          seed: 123,
          faceDetailer: {
            enabled: true,
          },
          handDetailer: {
            enabled: true,
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(payload).toMatchObject({
      promptId: "prompt-inpaint-detailers",
      outputNodeId: "14",
      nodeIds: {
        handUltralyticsDetectorProvider: "10",
        handDetailer: "11",
        ultralyticsDetectorProvider: "12",
        faceDetailer: "13",
        saveImage: "14",
      },
      request: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/face_yolov8s.pt",
        },
        handDetailer: {
          enabled: true,
          detectorModelName: "bbox/hand_yolov8s.pt",
        },
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
