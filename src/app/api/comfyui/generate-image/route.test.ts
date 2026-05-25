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

const objectInfoWithFaceDetailer = {
  ...objectInfo,
  FaceDetailer: {},
  UltralyticsDetectorProvider: {
    input: {
      required: {
        model_name: [["bbox/face_yolov8s.pt"], {}],
      },
    },
  },
};

const objectInfoWithControlNet = {
  ...objectInfo,
  LoadImage: {},
  ControlNetApplyAdvanced: {},
  ControlNetLoader: {
    input: {
      required: {
        control_net_name: [
          [
            "control_v11p_sd15_openpose.pth",
            "control_v11f1p_sd15_depth.pth",
            "control_v11p_sd15_normalbae.pth",
          ],
          {},
        ],
      },
    },
  },
};

const openPoseSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#000" /></svg>';
const depthSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#888" /></svg>';
const normalPngDataUrl = "data:image/png;base64,aGVsbG8=";

function readUploadedControlNetType(body: BodyInit | null | undefined) {
  if (!(body instanceof FormData)) {
    return "openpose";
  }

  const image = body.get("image");
  const filename = image && typeof image === "object" && "name" in image && typeof image.name === "string"
    ? image.name
    : "";

  if (filename.includes("depth")) {
    return "depth";
  }

  if (filename.includes("normal")) {
    return "normal";
  }

  return "openpose";
}

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

  it("queues a text-to-image workflow with FaceDetailer when enabled", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithFaceDetailer);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["7"].class_type).toBe("UltralyticsDetectorProvider");
      expect(body.prompt["7"].inputs.model_name).toBe("bbox/face_yolov8s.pt");
      expect(body.prompt["8"].class_type).toBe("FaceDetailer");
      expect(body.prompt["8"].inputs.image).toEqual(["6", 0]);
      expect(body.prompt["8"].inputs.guide_size_for).toBe("bbox");
      expect(body.prompt["8"].inputs.bbox_detector).toEqual(["7", 0]);
      expect(body.prompt["9"].inputs.images).toEqual(["8", 0]);

      return Response.json({
        prompt_id: "prompt-face",
        number: 10,
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
          faceDetailer: {
            enabled: true,
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(payload).toMatchObject({
      promptId: "prompt-face",
      outputNodeId: "9",
      nodeIds: {
        ultralyticsDetectorProvider: "7",
        faceDetailer: "8",
        saveImage: "9",
      },
      request: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/face_yolov8s.pt",
        },
      },
    });
  });

  it("uploads an OpenPose image and queues a ControlNet workflow when enabled", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithControlNet);
      }

      if (input === "http://comfyui.test/upload/image") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          accept: "application/json",
        });
        expect(init?.body).toBeInstanceOf(FormData);
        return Response.json({
          name: "uploaded-openpose.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["4"]).toMatchObject({
        class_type: "LoadImage",
        inputs: {
          image: "SceneForge/uploaded-openpose.png",
        },
      });
      expect(body.prompt["5"]).toMatchObject({
        class_type: "ControlNetLoader",
        inputs: {
          control_net_name: "control_v11p_sd15_openpose.pth",
        },
      });
      expect(body.prompt["6"]).toMatchObject({
        class_type: "ControlNetApplyAdvanced",
        inputs: {
          positive: ["2", 0],
          negative: ["3", 0],
          control_net: ["5", 0],
          image: ["4", 0],
          strength: 0.8,
          start_percent: 0,
          end_percent: 1,
        },
      });
      expect(body.prompt["8"].inputs.positive).toEqual(["6", 0]);
      expect(body.prompt["8"].inputs.negative).toEqual(["6", 1]);

      return Response.json({
        prompt_id: "prompt-controlnet",
        number: 11,
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
          controlNet: {
            enabled: true,
            strength: 0.8,
            openPoseSvg,
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(payload).toMatchObject({
      promptId: "prompt-controlnet",
      outputNodeId: "10",
      nodeIds: {
        controlNets: [{ type: "openpose", image: "4", loader: "5", apply: "6" }],
        controlNetImage: "4",
        controlNetLoader: "5",
        controlNetApply: "6",
        saveImage: "10",
      },
      request: {
        controlNets: [
          {
            enabled: true,
            imageName: "SceneForge/uploaded-openpose.png",
            modelName: "control_v11p_sd15_openpose.pth",
            svg: "",
            type: "openpose",
          },
        ],
      },
    });
  });

  it("uploads OpenPose and Depth images and queues chained ControlNet nodes", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithControlNet);
      }

      if (input === "http://comfyui.test/upload/image") {
        expect(init?.method).toBe("POST");
        const type = readUploadedControlNetType(init?.body);
        return Response.json({
          name: type === "depth" ? "uploaded-depth.png" : "uploaded-openpose.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["4"].inputs.image).toBe("SceneForge/uploaded-openpose.png");
      expect(body.prompt["5"].inputs.control_net_name).toBe("control_v11p_sd15_openpose.pth");
      expect(body.prompt["7"].inputs.image).toBe("SceneForge/uploaded-depth.png");
      expect(body.prompt["8"].inputs.control_net_name).toBe("control_v11f1p_sd15_depth.pth");
      expect(body.prompt["9"].inputs.positive).toEqual(["6", 0]);
      expect(body.prompt["11"].inputs.positive).toEqual(["9", 0]);

      return Response.json({
        prompt_id: "prompt-controlnet-depth",
        number: 12,
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
          controlNets: [
            {
              type: "openpose",
              enabled: true,
              strength: 0.8,
              svg: openPoseSvg,
            },
            {
              type: "depth",
              enabled: true,
              strength: 0.65,
              svg: depthSvg,
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(payload).toMatchObject({
      promptId: "prompt-controlnet-depth",
      outputNodeId: "13",
      nodeIds: {
        controlNets: [
          { type: "openpose", image: "4", loader: "5", apply: "6" },
          { type: "depth", image: "7", loader: "8", apply: "9" },
        ],
        saveImage: "13",
      },
      request: {
        controlNets: [
          {
            type: "openpose",
            modelName: "control_v11p_sd15_openpose.pth",
            imageName: "SceneForge/uploaded-openpose.png",
            svg: "",
          },
          {
            type: "depth",
            modelName: "control_v11f1p_sd15_depth.pth",
            imageName: "SceneForge/uploaded-depth.png",
            svg: "",
          },
        ],
      },
    });
  });

  it("uploads OpenPose, Depth, and Normal images and queues chained ControlNet nodes", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithControlNet);
      }

      if (input === "http://comfyui.test/upload/image") {
        expect(init?.method).toBe("POST");
        const type = readUploadedControlNetType(init?.body);
        return Response.json({
          name: type === "normal"
            ? "uploaded-normal.png"
            : type === "depth"
              ? "uploaded-depth.png"
              : "uploaded-openpose.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["4"].inputs.image).toBe("SceneForge/uploaded-openpose.png");
      expect(body.prompt["7"].inputs.image).toBe("SceneForge/uploaded-depth.png");
      expect(body.prompt["10"].inputs.image).toBe("SceneForge/uploaded-normal.png");
      expect(body.prompt["11"].inputs.control_net_name).toBe("control_v11p_sd15_normalbae.pth");
      expect(body.prompt["12"].inputs.positive).toEqual(["9", 0]);
      expect(body.prompt["14"].inputs.positive).toEqual(["12", 0]);

      return Response.json({
        prompt_id: "prompt-controlnet-normal",
        number: 13,
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
          controlNets: [
            {
              type: "normal",
              enabled: true,
              strength: 0.7,
              imageDataUrl: normalPngDataUrl,
            },
            {
              type: "openpose",
              enabled: true,
              strength: 0.8,
              svg: openPoseSvg,
            },
            {
              type: "depth",
              enabled: true,
              strength: 0.65,
              svg: depthSvg,
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(payload).toMatchObject({
      promptId: "prompt-controlnet-normal",
      outputNodeId: "16",
      nodeIds: {
        controlNets: [
          { type: "openpose", image: "4", loader: "5", apply: "6" },
          { type: "depth", image: "7", loader: "8", apply: "9" },
          { type: "normal", image: "10", loader: "11", apply: "12" },
        ],
        saveImage: "16",
      },
      request: {
        controlNets: [
          {
            type: "openpose",
            imageName: "SceneForge/uploaded-openpose.png",
            imageDataUrl: "",
            svg: "",
          },
          {
            type: "depth",
            imageName: "SceneForge/uploaded-depth.png",
            imageDataUrl: "",
            svg: "",
          },
          {
            type: "normal",
            imageName: "SceneForge/uploaded-normal.png",
            imageDataUrl: "",
            modelName: "control_v11p_sd15_normalbae.pth",
            svg: "",
          },
        ],
      },
    });
  });

  it("accepts a disabled FaceDetailer config with blank optional string fields", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfo);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt["7"].class_type).toBe("SaveImage");
      expect(body.prompt["8"]).toBeUndefined();

      return Response.json({
        prompt_id: "prompt-disabled-face",
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
          faceDetailer: {
            enabled: false,
            detectorModelName: "",
            samplerName: "",
            scheduler: "",
            wildcard: "",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(payload).toMatchObject({
      promptId: "prompt-disabled-face",
      outputNodeId: "7",
      request: {
        faceDetailer: {
          enabled: false,
          detectorModelName: "bbox/face_yolov8m.pt",
          samplerName: "euler",
          scheduler: "normal",
          wildcard: "",
        },
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
