import { describe, expect, it } from "vitest";

import {
  readComfyUiKSamplerOptions,
  summarizeComfyUiErrorDetails,
  validateComfyUiInpaintRequestAgainstObjectInfo,
  validateComfyUiRequestAgainstObjectInfo,
} from "./object-info";

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
  EmptyLatentImage: {},
  EmptySD3LatentImage: {},
  CLIPTextEncode: {},
  VAEDecode: {},
  PreviewImage: {},
  FaceDetailer: {},
  UltralyticsDetectorProvider: {
    input: {
      required: {
        model_name: [["bbox/face_yolov8s.pt", "bbox/hand_yolov8s.pt", "bbox/person_yolov8n.pt"], {}],
      },
    },
  },
};

const objectInfoWithAnima = {
  ...objectInfo,
  UNETLoader: {
    input: {
      required: {
        unet_name: [["pencil-xl-diffusion.safetensors", "Anima Pencil XL.safetensors"], {}],
        weight_dtype: [["default", "fp8_e4m3fn"], {}],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [["qwen_3_06b_base.safetensors"], {}],
        type: [["qwen_image"], {}],
        device: [["default", "cpu"], {}],
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
            "other-controlnet.safetensors",
          ],
          {},
        ],
      },
    },
  },
};

const objectInfoWithIpAdapter = {
  ...objectInfo,
  LoadImage: {},
  ImageBatch: {},
  IPAdapterAdvanced: {},
  IPAdapterUnifiedLoader: {},
  IPAdapterUnifiedLoaderFaceID: {},
};

const objectInfoWithAnimaControlNet = {
  ...objectInfoWithAnima,
  ...objectInfoWithControlNet,
};

const objectInfoWithAnimaIpAdapter = {
  ...objectInfoWithAnima,
  ...objectInfoWithIpAdapter,
};

const objectInfoWithInpaint = {
  ...objectInfo,
  LoadImage: {},
  LoadImageMask: {},
  SetLatentNoiseMask: {},
  VAEEncode: {},
  VAEEncodeTiled: {},
  VAEEncodeForInpaint: {},
  VAEDecode: {},
  VAEDecodeTiled: {},
};

const objectInfoWithAnimaInpaint = {
  ...objectInfoWithInpaint,
  UNETLoader: {
    input: {
      required: {
        unet_name: [["pencil-xl-diffusion.safetensors"], {}],
        weight_dtype: [["default", "fp8_e4m3fn"], {}],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [["qwen_3_06b_base.safetensors"], {}],
        type: [["qwen_image"], {}],
      },
      optional: {
        device: [["default", "cpu"], {}],
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

describe("ComfyUI object info helpers", () => {
  it("reads KSampler options from current object_info", () => {
    expect(
      readComfyUiKSamplerOptions({
        KSampler: {
          input: {
            required: {
              sampler_name: [["euler", "dpmpp_2m_sde_heun_gpu"], {}],
              scheduler: ["COMBO", { options: ["normal", "kl_optimal"] }],
            },
          },
        },
      }),
    ).toEqual({
      samplers: ["euler", "dpmpp_2m_sde_heun_gpu"],
      schedulers: ["normal", "kl_optimal"],
    });
  });

  it("reads KSampler options when object_info exposes them as optional inputs", () => {
    expect(
      readComfyUiKSamplerOptions({
        KSampler: {
          input: {
            required: {},
            optional: {
              sampler_name: [["euler_cfg_pp"], {}],
              scheduler: ["COMBO", { options: ["linear_quadratic"] }],
            },
          },
        },
      }),
    ).toEqual({
      samplers: ["euler_cfg_pp"],
      schedulers: ["linear_quadratic"],
    });
  });

  it("normalizes common sampler display names", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M",
          scheduler: "Karras",
          width: 1024,
          height: 1024,
          loras: [{ loraName: "style.safetensors", strengthModel: 0.7 }],
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M Karras",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M SDE",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        {
          ...objectInfo,
          KSampler: {
            input: {
              required: {
                sampler_name: [["dpmpp_2m_sde"], {}],
                scheduler: [["normal"], {}],
              },
            },
          },
        },
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m_sde",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
            detectorModelName: "bbox/face_yolov8m.pt",
          },
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/face_yolov8s.pt",
        },
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M SDE Karras",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        {
          ...objectInfo,
          KSampler: {
            input: {
              required: {
                sampler_name: [["dpmpp_2m_sde"], {}],
                scheduler: [["normal", "karras"], {}],
              },
            },
          },
        },
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m_sde",
        scheduler: "karras",
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 2M SDE",
          scheduler: "normal",
          width: 1024,
          height: 1024,
        },
        {
          ...objectInfo,
          KSampler: {
            input: {
              required: {
                sampler_name: [["dpmpp_2m_sde_gpu"], {}],
                scheduler: [["normal"], {}],
              },
            },
          },
        },
      ),
    ).toMatchObject({
      errors: [],
      request: {
        samplerName: "dpmpp_2m_sde_gpu",
      },
    });
  });

  it("keeps character references when IPAdapter nodes are available", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "model.safetensors",
        positivePrompt: "scene",
        characterReferences: [
          {
            id: "hero",
            name: "Hero",
            images: [
              { imageName: "hero-front.png" },
              { imageName: "hero-side.png" },
            ],
          },
        ],
      },
      objectInfoWithIpAdapter,
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.request.characterReferences?.[0]).toMatchObject({
      id: "hero",
    });
  });

  it("disables character references instead of failing when IPAdapter nodes are missing", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "model.safetensors",
        positivePrompt: "scene",
        characterReferences: [
          {
            id: "hero",
            name: "Hero",
            images: [{ imageName: "hero-front.png" }],
          },
        ],
      },
      objectInfo,
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain("Character reference");
    expect(result.request.characterReferences?.[0]).toMatchObject({
      enabled: false,
      id: "hero",
    });
  });

  it("reports unavailable models and invalid latent dimensions before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "missing.safetensors",
          positivePrompt: "scene",
          samplerName: "DPM++ 4M",
          scheduler: "normal",
          width: 1025,
          height: 1024,
          loras: [{ loraName: "missing-lora.safetensors", strengthModel: 0.7 }],
        },
        objectInfo,
      ).errors,
    ).toEqual([
      "LoRA 1 is not available in ComfyUI: missing-lora.safetensors",
      "Checkpoint is not available in ComfyUI: missing.safetensors",
      "Sampler is not available in ComfyUI: DPM++ 4M",
      "width must be between 16 and 16384 and divisible by 8 for ComfyUI EmptyLatentImage.",
    ]);
  });

  it("validates Anima UNET, CLIP, and VAE options without requiring CheckpointLoaderSimple", () => {
    const animaOnlyObjectInfo: Record<string, unknown> = { ...objectInfoWithAnima };
    delete animaOnlyObjectInfo.CheckpointLoaderSimple;
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        samplerName: "DPM++ 2M",
        scheduler: "Karras",
        loras: [{ loraName: "style.safetensors", strengthModel: 0.7 }],
      },
      animaOnlyObjectInfo,
    );

    expect(result).toMatchObject({
      errors: [],
      request: {
        checkpointName: "pencil-xl-diffusion.safetensors",
        workflowProfile: "anima",
        clipName: "qwen_3_06b_base.safetensors",
        clipDevice: "default",
        vaeName: "qwen_image_vae.safetensors",
        unetWeightDtype: "default",
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        latentImageNode: "EmptyLatentImage",
      },
    });
  });

  it("validates Anima ControlNet add-ons without falling back to CheckpointLoaderSimple", () => {
    const animaOnlyObjectInfo: Record<string, unknown> = { ...objectInfoWithAnimaControlNet };
    delete animaOnlyObjectInfo.CheckpointLoaderSimple;
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        controlNets: [
          {
            type: "depth",
            enabled: true,
            imageName: "SceneForge/depth.png",
          },
        ],
      },
      animaOnlyObjectInfo,
    );

    expect(result).toMatchObject({
      errors: [],
      request: {
        checkpointName: "pencil-xl-diffusion.safetensors",
        workflowProfile: "anima",
        controlNets: [
          {
            type: "depth",
            enabled: true,
            modelName: "control_v11f1p_sd15_depth.pth",
          },
        ],
      },
    });
  });

  it("reports missing Anima ControlNet nodes and models before queueing", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        controlNets: [
          {
            type: "openpose",
            enabled: true,
            imageName: "SceneForge/openpose.png",
          },
        ],
      },
      objectInfoWithAnima,
    );

    expect(result.errors).toEqual([
      "LoadImage node is not available in ComfyUI. It is required for ControlNet images.",
      "ControlNetLoader node is not available in ComfyUI. Install ControlNet support to use ControlNet.",
      "ControlNetApplyAdvanced node is not available in ComfyUI. Update ComfyUI or install ControlNet support.",
      "OpenPose ControlNet model is not available in ComfyUI.",
    ]);
    expect(result.errors).not.toContain("Anima text-to-image profile does not support ControlNet yet.");
    expect(result.errors).not.toContain("Checkpoint is not available in ComfyUI: pencil-xl-diffusion.safetensors");
  });

  it("validates Anima character references without falling back to CheckpointLoaderSimple", () => {
    const animaOnlyObjectInfo: Record<string, unknown> = { ...objectInfoWithAnimaIpAdapter };
    delete animaOnlyObjectInfo.CheckpointLoaderSimple;
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        characterReferences: [
          {
            id: "hero",
            name: "Hero",
            images: [{ imageName: "hero.png" }],
          },
        ],
      },
      animaOnlyObjectInfo,
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.request).toMatchObject({
      workflowProfile: "anima",
      characterReferences: [
        {
          id: "hero",
          name: "Hero",
        },
      ],
    });
  });

  it("blocks Anima character references when IPAdapter nodes are missing", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        characterReferences: [
          {
            id: "hero",
            name: "Hero",
            images: [{ imageName: "hero.png" }],
          },
        ],
      },
      objectInfoWithAnima,
    );

    expect(result.errors).toEqual([
      "Character reference \"Hero\" requires ComfyUI nodes for Anima: LoadImage, IPAdapterAdvanced, IPAdapterUnifiedLoader. Install ComfyUI_IPAdapter_plus to use character references with Anima.",
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.request.characterReferences?.[0]).toMatchObject({
      id: "hero",
    });
    expect(result.request.characterReferences?.[0]?.enabled).toBeUndefined();
  });

  it("validates and normalizes Anima detailer add-ons before queueing", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        faceDetailer: {
          enabled: true,
        },
        handDetailer: {
          enabled: true,
        },
      },
      objectInfoWithAnima,
    );

    expect(result).toMatchObject({
      errors: [],
      request: {
        workflowProfile: "anima",
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

  it("reports missing Anima detailer custom nodes before queueing", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        faceDetailer: {
          enabled: true,
        },
      },
      {
        ...objectInfoWithAnima,
        FaceDetailer: undefined,
        UltralyticsDetectorProvider: undefined,
      },
    );

    expect(result.errors).toEqual([
      "FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use FaceDetailer.",
      "UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use FaceDetailer.",
      "FaceDetailer detector model is not available in ComfyUI.",
    ]);
    expect(result.errors).not.toContain("Anima text-to-image profile does not support FaceDetailer yet.");
  });

  it("uses fixed Anima CLIP and VAE settings without explicit request selections", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
      },
      objectInfoWithAnima,
    );

    expect(result.errors).toEqual([]);
    expect(result.request).toMatchObject({
      workflowProfile: "anima",
      clipName: "qwen_3_06b_base.safetensors",
      clipDevice: "default",
      vaeName: "qwen_image_vae.safetensors",
      unetWeightDtype: "default",
    });
  });

  it("does not require Anima CLIP device when the local CLIPLoader omits that input", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
      },
      {
        ...objectInfoWithAnima,
        CLIPLoader: {
          input: {
            required: {
              clip_name: [["qwen_3_06b_base.safetensors"], {}],
              type: [["qwen_image"], {}],
            },
          },
        },
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.request).toMatchObject({
      checkpointName: "pencil-xl-diffusion.safetensors",
      clipName: "qwen_3_06b_base.safetensors",
      vaeName: "qwen_image_vae.safetensors",
    });
    expect(result.request.clipDevice).toBeUndefined();
  });

  it("resolves Anima CLIP device when ComfyUI exposes it as an optional input", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
      },
      {
        ...objectInfoWithAnima,
        CLIPLoader: {
          input: {
            required: {
              clip_name: [["qwen_3_06b_base.safetensors"], {}],
              type: [["qwen_image"], {}],
            },
            optional: {
              device: [["default", "cpu"], { advanced: true }],
            },
          },
        },
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.request).toMatchObject({
      clipDevice: "default",
    });
  });

  it("reports missing Anima required input fields before queueing", () => {
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
      },
      {
        ...objectInfoWithAnima,
        UNETLoader: {
          input: {
            required: {
              unet_name: [["pencil-xl-diffusion.safetensors"], {}],
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
            required: {},
          },
        },
      },
    );

    expect(result.errors).toEqual([
      "UNETLoader.weight_dtype input is not available in ComfyUI object_info.",
      "VAELoader.vae_name input is not available in ComfyUI object_info.",
      "Anima UNET weight dtype is not available in ComfyUI: default",
      "Anima VAE model is not available in ComfyUI: qwen_image_vae.safetensors",
    ]);
  });

  it("reports missing Anima profile nodes and files before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "Anima Pencil XL.safetensors",
          modelBaseModel: "Anima",
          modelStorageKind: "diffusion",
          positivePrompt: "scene",
        },
        {
          ...objectInfoWithAnima,
          UNETLoader: undefined,
          CLIPLoader: {
            input: {
              required: {
                clip_name: [["other-clip.safetensors"], {}],
                type: [["sdxl"], {}],
                device: [["cpu"], {}],
              },
            },
          },
          VAELoader: {
            input: {
              required: {
                vae_name: [["other-vae.safetensors"], {}],
              },
            },
          },
        },
      ).errors,
    ).toEqual([
      "UNETLoader node is not available in ComfyUI.",
      "Anima UNET model is not available in ComfyUI: Anima Pencil XL.safetensors",
      "Anima UNET weight dtype is not available in ComfyUI: default",
      "Anima CLIP model is not available in ComfyUI: qwen_3_06b_base.safetensors",
      "Anima CLIP type is not available in ComfyUI: qwen_image",
      "Anima CLIP device is not available in ComfyUI: default",
      "Anima VAE model is not available in ComfyUI: qwen_image_vae.safetensors",
    ]);
  });

  it("keeps unknown diffusion models on the fallback checkpoint profile", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          modelBaseModel: "Flux.1 D",
          modelStorageKind: "diffusion",
          positivePrompt: "scene",
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        checkpointName: "model.safetensors",
      },
    });
  });

  it("validates the requested latent image node before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          latentImageNode: "EmptySD3LatentImage",
        },
        {
          ...objectInfo,
          EmptySD3LatentImage: undefined,
        },
      ).errors,
    ).toEqual(["Latent image node is not available in ComfyUI: EmptySD3LatentImage"]);
  });

  it("validates and normalizes FaceDetailer detector settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
          },
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        faceDetailer: {
          enabled: true,
          detectorModelName: "bbox/face_yolov8s.pt",
        },
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
            detectorModelName: "missing.pt",
          },
        },
        objectInfo,
      ).errors,
    ).toEqual(["FaceDetailer detector model is not available in ComfyUI: missing.pt"]);
  });

  it("validates and normalizes HandDetailer detector settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          handDetailer: {
            enabled: true,
          },
        },
        objectInfo,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        handDetailer: {
          enabled: true,
          detectorModelName: "bbox/hand_yolov8s.pt",
        },
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          handDetailer: {
            enabled: true,
            detectorModelName: "missing.pt",
          },
        },
        objectInfo,
      ).errors,
    ).toEqual(["HandDetailer detector model is not available in ComfyUI: missing.pt"]);
  });

  it("validates and normalizes ControlNet OpenPose settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNet: {
            enabled: true,
            openPoseSvg: "<svg />",
          },
        },
        objectInfoWithControlNet,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        controlNets: [
          {
            enabled: true,
            modelName: "control_v11p_sd15_openpose.pth",
            type: "openpose",
          },
        ],
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNet: {
            enabled: true,
            modelName: "missing-controlnet.safetensors",
            openPoseSvg: "<svg />",
          },
        },
        objectInfoWithControlNet,
      ).errors,
    ).toEqual(["OpenPose ControlNet model is not available in ComfyUI: missing-controlnet.safetensors"]);
  });

  it("validates and normalizes ControlNet Depth settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "depth",
              enabled: true,
              svg: "<svg />",
            },
          ],
        },
        objectInfoWithControlNet,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        controlNets: [
          {
            enabled: true,
            modelName: "control_v11f1p_sd15_depth.pth",
            type: "depth",
          },
        ],
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "depth",
              enabled: true,
              svg: "<svg />",
            },
          ],
        },
        {
          ...objectInfoWithControlNet,
          ControlNetLoader: {
            input: {
              required: {
                control_net_name: [["control_v11p_sd15_openpose.pth"], {}],
              },
            },
          },
        },
      ).errors,
    ).toEqual(["Depth ControlNet model is not available in ComfyUI."]);
  });

  it("validates and normalizes ControlNet Normal settings before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "normal",
              enabled: true,
              imageDataUrl: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        objectInfoWithControlNet,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        controlNets: [
          {
            enabled: true,
            modelName: "control_v11p_sd15_normalbae.pth",
            type: "normal",
          },
        ],
      },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNets: [
            {
              type: "normal",
              enabled: true,
              imageDataUrl: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        {
          ...objectInfoWithControlNet,
          ControlNetLoader: {
            input: {
              required: {
                control_net_name: [["control_v11f1p_sd15_depth.pth"], {}],
              },
            },
          },
        },
      ).errors,
    ).toEqual(["Normal ControlNet model is not available in ComfyUI."]);
  });

  it("reports missing ControlNet nodes before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          controlNet: {
            enabled: true,
            openPoseSvg: "<svg />",
          },
        },
        objectInfo,
      ).errors,
    ).toEqual([
      "LoadImage node is not available in ComfyUI. It is required for ControlNet images.",
      "ControlNetLoader node is not available in ComfyUI. Install ControlNet support to use ControlNet.",
      "ControlNetApplyAdvanced node is not available in ComfyUI. Update ComfyUI or install ControlNet support.",
      "OpenPose ControlNet model is not available in ComfyUI.",
    ]);
  });

  it("reports missing FaceDetailer custom nodes before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          faceDetailer: {
            enabled: true,
          },
        },
        {
          ...objectInfo,
          FaceDetailer: undefined,
          UltralyticsDetectorProvider: undefined,
        },
      ).errors,
    ).toEqual([
      "FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use FaceDetailer.",
      "UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use FaceDetailer.",
      "FaceDetailer detector model is not available in ComfyUI.",
    ]);
  });

  it("reports missing HandDetailer custom nodes before queueing", () => {
    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "scene",
          handDetailer: {
            enabled: true,
          },
        },
        {
          ...objectInfo,
          FaceDetailer: undefined,
          UltralyticsDetectorProvider: undefined,
        },
      ).errors,
    ).toEqual([
      "FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use HandDetailer.",
      "UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use HandDetailer.",
      "HandDetailer detector model is not available in ComfyUI.",
    ]);
  });

  it("validates latent noise mask inpaint nodes before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          samplerName: "DPM++ 2M",
          scheduler: "Karras",
        },
        objectInfoWithInpaint,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        checkpointName: "model.safetensors",
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        inpaintMode: "latent-noise-mask",
      },
    });

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
        },
        {
          ...objectInfoWithInpaint,
          SetLatentNoiseMask: undefined,
        },
      ).errors,
    ).toContain("SetLatentNoiseMask node is not available in ComfyUI. It is required for latent noise mask inpaint mode.");
  });

  it("validates Anima inpaint nodes and model files without requiring CheckpointLoaderSimple", () => {
    const animaOnlyObjectInfo: Record<string, unknown> = { ...objectInfoWithAnimaInpaint };
    delete animaOnlyObjectInfo.CheckpointLoaderSimple;
    const result = validateComfyUiInpaintRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "continue the previous shot",
        sourceImage: { filename: "source.png", type: "output" },
        maskName: "mask.png",
        samplerName: "DPM++ 2M",
        scheduler: "Karras",
      },
      animaOnlyObjectInfo,
    );

    expect(result).toMatchObject({
      errors: [],
      request: {
        checkpointName: "pencil-xl-diffusion.safetensors",
        workflowProfile: "anima",
        clipName: "qwen_3_06b_base.safetensors",
        clipDevice: "default",
        vaeName: "qwen_image_vae.safetensors",
        unetWeightDtype: "default",
        samplerName: "dpmpp_2m",
        scheduler: "karras",
      },
    });
  });

  it("reports missing Anima inpaint profile files without requiring CheckpointLoaderSimple", () => {
    const result = validateComfyUiInpaintRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "repair hands",
        sourceImage: { filename: "source.png", type: "output" },
        maskName: "mask.png",
      },
      {
        ...objectInfoWithAnimaInpaint,
        UNETLoader: undefined,
        CLIPLoader: {
          input: {
            required: {
              clip_name: [["other-clip.safetensors"], {}],
              type: [["sdxl"], {}],
            },
          },
        },
        VAELoader: {
          input: {
            required: {
              vae_name: [["other-vae.safetensors"], {}],
            },
          },
        },
      },
    );

    expect(result.errors).toEqual(expect.arrayContaining([
      "UNETLoader node is not available in ComfyUI.",
      "Anima UNET model is not available in ComfyUI: pencil-xl-diffusion.safetensors",
      "Anima CLIP model is not available in ComfyUI: qwen_3_06b_base.safetensors",
      "Anima CLIP type is not available in ComfyUI: qwen_image",
      "Anima VAE model is not available in ComfyUI: qwen_image_vae.safetensors",
    ]));
    expect(result.errors).not.toContain("Checkpoint is not available in ComfyUI: pencil-xl-diffusion.safetensors");
  });

  it("validates and normalizes Anima inpaint detailer settings before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "pencil-xl-diffusion.safetensors",
          modelBaseModel: "Anima",
          modelStorageKind: "diffusion",
          positivePrompt: "repair hands",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          faceDetailer: {
            enabled: true,
          },
          handDetailer: {
            enabled: true,
          },
        },
        objectInfoWithAnimaInpaint,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        workflowProfile: "anima",
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

  it("reports missing Anima inpaint detailer custom nodes before queueing", () => {
    const result = validateComfyUiInpaintRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "repair hands",
        sourceImage: { filename: "source.png", type: "output" },
        maskName: "mask.png",
        handDetailer: {
          enabled: true,
        },
      },
      {
        ...objectInfoWithAnimaInpaint,
        FaceDetailer: undefined,
        UltralyticsDetectorProvider: undefined,
      },
    );

    expect(result.errors).toEqual([
      "FaceDetailer node is not available in ComfyUI. Install ComfyUI Impact Pack to use HandDetailer.",
      "UltralyticsDetectorProvider node is not available in ComfyUI. Install ComfyUI Impact Subpack to use HandDetailer.",
      "HandDetailer detector model is not available in ComfyUI.",
    ]);
    expect(result.errors).not.toContain("Anima inpaint profile does not support HandDetailer yet.");
  });

  it("validates and normalizes inpaint detailer settings before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          faceDetailer: {
            enabled: true,
          },
          handDetailer: {
            enabled: true,
          },
        },
        objectInfoWithInpaint,
      ),
    ).toMatchObject({
      errors: [],
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

  it("validates VAE inpaint nodes before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          inpaintMode: "vae-inpaint",
        },
        objectInfoWithInpaint,
      ).errors,
    ).toEqual([]);

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          inpaintMode: "vae-inpaint",
        },
        {
          ...objectInfoWithInpaint,
          VAEEncodeForInpaint: undefined,
        },
      ).errors,
      ).toContain("VAEEncodeForInpaint node is not available in ComfyUI. It is required for VAE inpaint mode.");
  });

  it("validates high-res lanczos inpaint nodes before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "lanczos",
            scaleBy: 2,
          },
        },
        objectInfoWithHighResInpaint,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        upscaleBeforeInpaint: {
          enabled: true,
          mode: "lanczos",
          scaleBy: 2,
          modelName: "RealESRGAN_x2plus.pth",
        },
      },
    });

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "lanczos",
            scaleBy: 2,
          },
        },
        objectInfoWithInpaint,
      ).errors,
    ).toEqual([
      "ImageScaleBy node is not available in ComfyUI. It is required for high-res inpaint upscaling.",
      "MaskToImage node is not available in ComfyUI. It is required to upscale high-res inpaint masks.",
      "ImageToMask node is not available in ComfyUI. It is required to restore high-res inpaint masks.",
    ]);
  });

  it("validates model-based 2x high-res inpaint before queueing", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "aniscale2-x2",
            scaleBy: 2,
          },
        },
        objectInfoWithHighResInpaint,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        upscaleBeforeInpaint: {
          enabled: true,
          mode: "aniscale2-x2",
          scaleBy: 2,
          modelName: "2x_AniScale2_ESRGAN_i16_110K.pth",
        },
      },
    });

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "aniscale2-x2",
            scaleBy: 2,
          },
        },
        {
          ...objectInfoWithHighResInpaint,
          UpscaleModelLoader: {
            input: {
              required: {
                model_name: ["COMBO", { options: ["other-upscale.safetensors"] }],
              },
            },
          },
        },
      ).errors,
    ).toContain("2x upscale model is not available in ComfyUI: 2x_AniScale2_ESRGAN_i16_110K.pth");
  });

  it("validates local-region high-res inpaint nodes and bounds", () => {
    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          imageWidth: 512,
          imageHeight: 512,
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "lanczos",
            scaleBy: 2,
            strategy: "local-region",
            localRegion: {
              x: 64,
              y: 80,
              width: 192,
              height: 160,
              source: "mask-bounds",
              padding: 128,
              feather: 32,
            },
          },
        },
        objectInfoWithLocalRegionInpaint,
      ),
    ).toMatchObject({
      errors: [],
      request: {
        upscaleBeforeInpaint: {
          enabled: true,
          strategy: "local-region",
          localRegion: {
            x: 64,
            y: 80,
            width: 192,
            height: 160,
          },
        },
      },
    });

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          imageWidth: 512,
          imageHeight: 512,
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "lanczos",
            scaleBy: 2,
            strategy: "local-region",
            localRegion: {
              x: 480,
              y: 80,
              width: 64,
              height: 160,
              source: "mask-bounds",
              padding: 128,
              feather: 32,
            },
          },
        },
        objectInfoWithLocalRegionInpaint,
      ).errors,
    ).toContain("localRegion must stay inside the source image bounds.");

    expect(
      validateComfyUiInpaintRequestAgainstObjectInfo(
        {
          checkpointName: "model.safetensors",
          positivePrompt: "replace the window",
          sourceImage: { filename: "source.png", type: "output" },
          maskName: "mask.png",
          upscaleBeforeInpaint: {
            enabled: true,
            mode: "lanczos",
            scaleBy: 2,
            strategy: "local-region",
            localRegion: {
              x: 64,
              y: 80,
              width: 192,
              height: 160,
              source: "mask-bounds",
              padding: 128,
              feather: 32,
            },
          },
        },
        objectInfoWithHighResInpaint,
      ).errors,
    ).toEqual([
      "ImageCrop node is not available in ComfyUI. It is required for local-region high-res inpaint.",
      "CropMask node is not available in ComfyUI. It is required for local-region high-res inpaint masks.",
      "FeatherMask node is not available in ComfyUI. It is required to blend local-region inpaint patches.",
      "ImageCompositeMasked node is not available in ComfyUI. It is required to paste local-region inpaint patches.",
    ]);
  });

  it("summarizes nested ComfyUI node errors", () => {
    expect(
      summarizeComfyUiErrorDetails({
        node_errors: {
          "2": {
            class_type: "LoraLoader",
            errors: [
              {
                message: "Value not in list",
                details: "lora_name: missing.safetensors",
                extra_info: { input_name: "lora_name" },
              },
            ],
          },
        },
      }),
    ).toEqual(["Node 2 (LoraLoader): lora_name: Value not in list lora_name: missing.safetensors"]);
  });
});
