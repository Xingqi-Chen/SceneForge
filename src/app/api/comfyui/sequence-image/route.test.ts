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
        sampler_name: [["euler"], {}],
        scheduler: [["normal"], {}],
      },
    },
  },
  EmptyLatentImage: {},
  CLIPTextEncode: {},
  VAEDecode: {},
  IPAdapterAdvanced: {},
  IPAdapterUnifiedLoader: {},
  LoadImage: {},
  PreviewImage: {},
};

const objectInfoWithControlNet = {
  ...objectInfo,
  ControlNetApplyAdvanced: {},
  ControlNetLoader: {
    input: {
      required: {
        control_net_name: [
          [
            "control_v11p_sd15_openpose.pth",
            "control_v11p_sd15_normalbae.pth",
          ],
          {},
        ],
      },
    },
  },
};

const objectInfoWithAnima = {
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
        sampler_name: [["euler"], {}],
        scheduler: [["normal"], {}],
      },
    },
  },
  EmptyLatentImage: {},
  CLIPTextEncode: {},
  VAEDecode: {},
  PreviewImage: {},
  UNETLoader: {
    input: {
      required: {
        unet_name: [["pencil-xl-diffusion.safetensors"], {}],
        weight_dtype: [["default"], {}],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [["qwen_3_06b_base.safetensors"], {}],
        type: [["qwen_image"], {}],
      },
    },
  },
  VAELoader: {
    input: {
      required: {
        vae_name: [["qwen_image_vae.safetensors"], {}],
      },
    },
  },
};

const openPoseSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384"><rect width="512" height="384" fill="#000" /></svg>';
const normalPngDataUrl = "data:image/png;base64,aGVsbG8=";

type PromptBody = {
  client_id?: string;
  prompt: Record<string, {
    class_type: string;
    inputs: Record<string, unknown>;
  }>;
};

function findPromptNode(body: PromptBody, classType: string) {
  return Object.values(body.prompt).find((node) => node.class_type === classType);
}

function readUploadedControlNetType(body: BodyInit | null | undefined) {
  if (!(body instanceof FormData)) {
    return "openpose";
  }

  const image = body.get("image");
  const filename = image && typeof image === "object" && "name" in image && typeof image.name === "string"
    ? image.name
    : "";

  return filename.includes("normal") ? "normal" : "openpose";
}

describe("ComfyUI sequence image route", () => {
  const previousBaseUrl = process.env.COMFYUI_BASE_URL;
  const previousSequenceReferenceDir = process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR;

  afterEach(() => {
    if (previousBaseUrl === undefined) {
      delete process.env.COMFYUI_BASE_URL;
    } else {
      process.env.COMFYUI_BASE_URL = previousBaseUrl;
    }
    if (previousSequenceReferenceDir === undefined) {
      delete process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR;
    } else {
      process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR = previousSequenceReferenceDir;
    }

    vi.restoreAllMocks();
  });

  it("uploads character references and queues one ComfyUI prompt per shot", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const promptBodies: PromptBody[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfo);
      }

      if (input === "http://comfyui.test/upload/image") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(FormData);
        return Response.json({
          name: "hero-reference.png",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body)) as PromptBody;
      promptBodies.push(body);

      return Response.json({
        prompt_id: `prompt-${promptBodies.length}`,
        number: promptBodies.length,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "model.safetensors",
            positivePrompt: "ink comic style",
            negativePrompt: "blurry",
            samplerName: "euler",
            scheduler: "normal",
            width: 1024,
            height: 1024,
          },
          baseSeed: 100,
          characters: [
            {
              id: "hero",
              name: "Hero",
              prompt: "red cape",
              references: [
                {
                  id: "hero-ref",
                  imageDataUrl: "data:image/png;base64,aGVsbG8=",
                },
              ],
            },
          ],
          clientId: "client-seq",
          imageCount: 2,
          sequenceId: "seq-1",
          shots: [
            { id: "shot-1", prompt: "close-up looking left" },
            { id: "shot-2", prompt: "wide alley confrontation" },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(promptBodies).toHaveLength(2);
    expect(promptBodies[0].client_id).toBe("client-seq:shot-1");
    expect(promptBodies[1].client_id).toBe("client-seq:shot-2");
    expect(promptBodies[0].prompt["2"].inputs.text).toBe("ink comic style, Hero: red cape, close-up looking left");
    expect(promptBodies[1].prompt["2"].inputs.text).toBe("ink comic style, Hero: red cape, wide alley confrontation");
    expect(promptBodies[0].prompt["4"]).toMatchObject({
      class_type: "LoadImage",
      inputs: { image: "hero-reference.png" },
    });
    expect(promptBodies[0].prompt["7"].inputs).toMatchObject({
      batch_size: 2,
    });
    expect(promptBodies[0].prompt["8"].inputs).toMatchObject({
      model: ["6", 0],
      seed: 100,
    });
    expect(promptBodies[1].prompt["8"].inputs.seed).toBe(101);
    expect(payload).toMatchObject({
      sequenceId: "seq-1",
      warnings: [],
      shots: [
        {
          characterReferenceIds: ["hero-ref"],
          imageCount: 2,
          promptId: "prompt-1",
          seed: 100,
          shotId: "shot-1",
        },
        {
          characterReferenceIds: ["hero-ref"],
          imageCount: 2,
          promptId: "prompt-2",
          seed: 101,
          shotId: "shot-2",
        },
      ],
    });
  });

  it("uses explicit per-shot requests without leaking base generation settings", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const promptBodies: PromptBody[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfo);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body)) as PromptBody;
      promptBodies.push(body);

      return Response.json({
        prompt_id: `prompt-${promptBodies.length}`,
        number: promptBodies.length,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "model.safetensors",
            positivePrompt: "base global",
            negativePrompt: "base negative",
            samplerName: "euler",
            scheduler: "normal",
            width: 1024,
            height: 1024,
            batchSize: 1,
            seed: 11,
          },
          baseSeed: 900,
          characters: [],
          clientId: "client-seq",
          imageCount: 1,
          sequenceId: "seq-2",
          shots: [
            {
              id: "shot-a",
              prompt: "fallback should not replace explicit positive prompt",
              request: {
                checkpointName: "model.safetensors",
                positivePrompt: "shot A explicit prompt",
                negativePrompt: "shot A negative",
                samplerName: "euler",
                scheduler: "normal",
                width: 768,
                height: 512,
                batchSize: 3,
                seed: 777,
                outputPrefix: "ShotA",
              },
            },
            {
              id: "shot-b",
              prompt: "shot B fallback prompt",
              request: {
                checkpointName: "model.safetensors",
                negativePrompt: "shot B negative",
                samplerName: "euler",
                scheduler: "normal",
                width: 512,
                height: 768,
                outputPrefix: "ShotB",
              },
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(promptBodies).toHaveLength(2);
    expect(promptBodies[0].prompt["2"].inputs.text).toBe("shot A explicit prompt");
    expect(promptBodies[0].prompt["3"].inputs.text).toBe("shot A negative");
    expect(findPromptNode(promptBodies[0], "EmptyLatentImage")?.inputs).toMatchObject({
      batch_size: 3,
      height: 512,
      width: 768,
    });
    expect(findPromptNode(promptBodies[0], "KSampler")?.inputs).toMatchObject({
      seed: 777,
    });
    expect(promptBodies[1].prompt["2"].inputs.text).toBe("base global, shot B fallback prompt");
    expect(promptBodies[1].prompt["3"].inputs.text).toBe("shot B negative");
    expect(findPromptNode(promptBodies[1], "EmptyLatentImage")?.inputs).toMatchObject({
      batch_size: 1,
      height: 768,
      width: 512,
    });
    expect(findPromptNode(promptBodies[1], "KSampler")?.inputs).toMatchObject({
      seed: 901,
    });
    expect(payload.shots).toMatchObject([
      {
        imageCount: 3,
        positivePrompt: "shot A explicit prompt",
        seed: 777,
        shotId: "shot-a",
      },
      {
        imageCount: 1,
        positivePrompt: "base global, shot B fallback prompt",
        seed: 901,
        shotId: "shot-b",
      },
    ]);
  });

  it("inherits Anima workflow metadata into per-shot requests before queueing", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const promptBodies: PromptBody[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithAnima);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body)) as PromptBody;
      promptBodies.push(body);

      return Response.json({
        prompt_id: "prompt-anima-shot",
        number: 1,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "pencil-xl-diffusion.safetensors",
            workflowProfile: "anima",
            modelBaseModel: "Anima",
            modelStorageKind: "diffusion",
            positivePrompt: "base global",
            negativePrompt: "base negative",
            samplerName: "euler",
            scheduler: "normal",
            width: 1024,
            height: 1024,
            batchSize: 1,
            seed: 11,
          },
          baseSeed: 700,
          characters: [],
          clientId: "client-seq",
          imageCount: 1,
          sequenceId: "seq-anima",
          shots: [
            {
              id: "shot-anima",
              prompt: "fallback prompt",
              request: {
                positivePrompt: "shot explicit prompt",
                width: 768,
                height: 512,
              },
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(promptBodies).toHaveLength(1);
    expect(Object.values(promptBodies[0].prompt).some((node) => node.class_type === "CheckpointLoaderSimple")).toBe(false);
    expect(promptBodies[0].prompt["1"]).toMatchObject({
      class_type: "UNETLoader",
      inputs: {
        unet_name: "pencil-xl-diffusion.safetensors",
        weight_dtype: "default",
      },
    });
    expect(promptBodies[0].prompt["2"]).toMatchObject({
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_3_06b_base.safetensors",
        type: "qwen_image",
      },
    });
    expect(promptBodies[0].prompt["3"]).toMatchObject({
      class_type: "VAELoader",
      inputs: {
        vae_name: "qwen_image_vae.safetensors",
      },
    });
    expect(promptBodies[0].prompt["4"].inputs.text).toBe("shot explicit prompt");
    expect(findPromptNode(promptBodies[0], "EmptyLatentImage")?.inputs).toMatchObject({
      batch_size: 1,
      height: 512,
      width: 768,
    });
    expect(payload).toMatchObject({
      sequenceId: "seq-anima",
      shots: [
        {
          imageCount: 1,
          promptId: "prompt-anima-shot",
          request: {
            checkpointName: "pencil-xl-diffusion.safetensors",
            workflowProfile: "anima",
            modelBaseModel: "Anima",
            modelStorageKind: "diffusion",
            clipName: "qwen_3_06b_base.safetensors",
            vaeName: "qwen_image_vae.safetensors",
            unetWeightDtype: "default",
          },
          seed: 700,
          shotId: "shot-anima",
        },
      ],
    });
  });

  it("applies preview mode to sequence shot requests", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const promptBodies: PromptBody[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfo);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body)) as PromptBody;
      promptBodies.push(body);

      return Response.json({
        prompt_id: "prompt-preview-shot",
        number: 1,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "model.safetensors",
            positivePrompt: "base prompt",
            samplerName: "euler",
            scheduler: "normal",
            width: 1024,
            height: 768,
            steps: 30,
            batchSize: 4,
            faceDetailer: {
              enabled: true,
            },
          },
          characters: [],
          imageCount: 4,
          preview: true,
          sequenceId: "seq-preview",
          shots: [
            {
              id: "shot-preview",
              prompt: "preview this shot",
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(promptBodies).toHaveLength(1);
    expect(findPromptNode(promptBodies[0], "EmptyLatentImage")?.inputs).toMatchObject({
      width: 1024,
      height: 768,
      batch_size: 1,
    });
    expect(findPromptNode(promptBodies[0], "KSampler")?.inputs).toMatchObject({
      steps: 10,
    });
    expect(findPromptNode(promptBodies[0], "FaceDetailer")).toBeUndefined();
    expect(payload).toMatchObject({
      sequenceId: "seq-preview",
      shots: [
        {
          imageCount: 1,
          promptId: "prompt-preview-shot",
          request: {
            width: 1024,
            height: 768,
            steps: 10,
            batchSize: 1,
            faceDetailer: {
              enabled: false,
            },
          },
        },
      ],
    });
  });

  it("does not increase low-step sequence preview shot requests", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const promptBodies: PromptBody[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfo);
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body)) as PromptBody;
      promptBodies.push(body);

      return Response.json({
        prompt_id: "prompt-preview-low-steps-shot",
        number: 2,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "model.safetensors",
            positivePrompt: "base prompt",
            samplerName: "euler",
            scheduler: "normal",
            steps: 6,
            batchSize: 4,
          },
          characters: [],
          imageCount: 4,
          preview: true,
          sequenceId: "seq-preview-low-steps",
          shots: [
            {
              id: "shot-preview-low-steps",
              prompt: "preview this shot",
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(findPromptNode(promptBodies[0], "KSampler")?.inputs).toMatchObject({
      steps: 6,
    });
    expect(payload).toMatchObject({
      sequenceId: "seq-preview-low-steps",
      shots: [
        {
          imageCount: 1,
          promptId: "prompt-preview-low-steps-shot",
          request: {
            steps: 6,
            batchSize: 1,
          },
        },
      ],
    });
  });

  it("applies preview mode to sequence ControlNet shot requests", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    const promptBodies: PromptBody[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "http://comfyui.test/object_info") {
        return Response.json(objectInfoWithControlNet);
      }

      if (input === "http://comfyui.test/upload/image") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(FormData);
        const type = readUploadedControlNetType(init?.body);

        return Response.json({
          name: type === "normal" ? "uploaded-normal.png" : "uploaded-openpose.png",
          subfolder: "SceneForge",
          type: "input",
        });
      }

      expect(input).toBe("http://comfyui.test/prompt");
      const body = JSON.parse(String(init?.body)) as PromptBody;
      promptBodies.push(body);

      return Response.json({
        prompt_id: "prompt-preview-controlnet-shot",
        number: 1,
        node_errors: {},
      });
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "model.safetensors",
            positivePrompt: "base prompt",
            samplerName: "euler",
            scheduler: "normal",
            width: 1024,
            height: 768,
            steps: 30,
            batchSize: 4,
            controlNets: [
              {
                type: "openpose",
                enabled: true,
                strength: 0.8,
                svg: openPoseSvg,
              },
              {
                type: "normal",
                enabled: true,
                strength: 0.7,
                imageDataUrl: normalPngDataUrl,
              },
            ],
          },
          characters: [],
          imageCount: 4,
          preview: true,
          sequenceId: "seq-preview-controlnet",
          shots: [
            {
              id: "shot-preview-controlnet",
              prompt: "preview controlnet shot",
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(promptBodies).toHaveLength(1);
    expect(promptBodies[0].prompt["4"].inputs.image).toBe("SceneForge/uploaded-openpose.png");
    expect(promptBodies[0].prompt["7"].inputs.image).toBe("SceneForge/uploaded-normal.png");
    expect(findPromptNode(promptBodies[0], "EmptyLatentImage")?.inputs).toMatchObject({
      width: 1024,
      height: 768,
      batch_size: 1,
    });
    expect(findPromptNode(promptBodies[0], "KSampler")?.inputs).toMatchObject({
      steps: 10,
    });
    expect(payload).toMatchObject({
      sequenceId: "seq-preview-controlnet",
      shots: [
        {
          imageCount: 1,
          outputNodeId: "13",
          promptId: "prompt-preview-controlnet-shot",
          request: {
            width: 1024,
            height: 768,
            steps: 10,
            batchSize: 1,
            controlNets: [
              {
                type: "openpose",
                imageName: "SceneForge/uploaded-openpose.png",
                svg: "",
                imageDataUrl: "",
              },
              {
                type: "normal",
                imageName: "SceneForge/uploaded-normal.png",
                svg: "",
                imageDataUrl: "",
              },
            ],
          },
        },
      ],
    });
  });

  it("returns a clear error when a stored sequence reference image is missing", async () => {
    process.env.COMFYUI_BASE_URL = "http://comfyui.test";
    process.env.SCENEFORGE_SEQUENCE_REFERENCE_DIR = "data/__missing_sequence_references_test__";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(input).toBe("http://comfyui.test/object_info");
      return Response.json(objectInfo);
    });

    const response = await POST(
      new Request("http://localhost/api/comfyui/sequence-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRequest: {
            checkpointName: "model.safetensors",
            positivePrompt: "base prompt",
          },
          characters: [],
          shots: [
            {
              id: "shot-missing-reference",
              prompt: "missing reference",
              characters: [
                {
                  id: "hero-face",
                  mode: "face",
                  name: "Hero face",
                  references: [
                    {
                      id: "missing-ref",
                      storedFilename: "0123456789abcdef0123456789abcdef.png",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.message).toBe("Sequence reference image not found.");
  });
});
