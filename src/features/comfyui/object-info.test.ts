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

const objectInfoWithKrea2 = {
  ...objectInfoWithAnima,
  LoadImage: {
    input: {
      required: {
        image: [["SceneForge/krea-source.png"], {}],
      },
    },
  },
  ImageScale: {
    input: {
      required: {
        image: ["IMAGE", {}],
        upscale_method: [["lanczos"], {}],
        width: ["INT", {}],
        height: ["INT", {}],
        crop: [["disabled"], {}],
      },
    },
  },
  VAEEncode: {
    input: {
      required: {
        pixels: ["IMAGE", {}],
        vae: ["VAE", {}],
      },
    },
  },
  UNETLoader: {
    input: {
      required: {
        unet_name: [["krea-2-turbo-unet.safetensors"], {}],
        weight_dtype: [["default"], {}],
      },
    },
  },
  CLIPLoader: {
    input: {
      required: {
        clip_name: [["qwen3vl_4b_fp8_scaled.safetensors"], {}],
        type: [["krea2"], {}],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        sampler_name: [["euler"], {}],
        scheduler: [["simple"], {}],
      },
    },
  },
  LoraLoaderModelOnly: {
    input: {
      required: {
        model: ["MODEL", {}],
        lora_name: [["krea-style.safetensors"], {}],
        strength_model: ["FLOAT", {}],
      },
    },
  },
  SaveImage: {},
};

const objectInfoWithKrea2Repair = {
  ...objectInfoWithKrea2,
  CLIPTextEncode: {
    input: {
      required: {
        text: ["STRING", {}],
      },
      optional: {
        clip: ["CLIP", {}],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        seed: ["INT", {}],
        steps: ["INT", {}],
        cfg: ["FLOAT", {}],
        sampler_name: [["euler"], {}],
        scheduler: [["simple"], {}],
        denoise: ["FLOAT", {}],
      },
      optional: {
        model: ["MODEL", {}],
        positive: ["CONDITIONING", {}],
        negative: ["CONDITIONING", {}],
        latent_image: ["LATENT", {}],
      },
    },
  },
  LoadImageMask: {
    input: {
      required: {
        image: ["STRING", {}],
        channel: [["red", "green", "blue"], {}],
      },
    },
  },
  ImageScaleBy: {
    input: {
      required: {
        upscale_method: [["lanczos", "nearest-exact"], {}],
        scale_by: ["FLOAT", {}],
      },
      optional: {
        image: ["IMAGE", {}],
      },
    },
  },
  MaskToImage: {
    input: {
      optional: {
        mask: ["MASK", {}],
      },
    },
  },
  ImageToMask: {
    input: {
      required: {
        channel: [["red", "green", "blue"], {}],
      },
      optional: {
        image: ["IMAGE", {}],
      },
    },
  },
  VAEEncodeTiled: {
    input: {
      required: {
        tile_size: ["INT", {}],
        overlap: ["INT", {}],
        temporal_size: ["INT", {}],
        temporal_overlap: ["INT", {}],
      },
      optional: {
        pixels: ["IMAGE", {}],
        vae: ["VAE", {}],
      },
    },
  },
  SetLatentNoiseMask: {
    input: {
      optional: {
        samples: ["LATENT", {}],
        mask: ["MASK", {}],
      },
    },
  },
  VAEDecodeTiled: {
    input: {
      required: {
        tile_size: ["INT", {}],
        overlap: ["INT", {}],
        temporal_size: ["INT", {}],
        temporal_overlap: ["INT", {}],
      },
      optional: {
        samples: ["LATENT", {}],
        vae: ["VAE", {}],
      },
    },
  },
  ImageCrop: {
    input: {
      required: {
        x: ["INT", {}],
        y: ["INT", {}],
        width: ["INT", {}],
        height: ["INT", {}],
      },
      optional: {
        image: ["IMAGE", {}],
      },
    },
  },
  CropMask: {
    input: {
      required: {
        x: ["INT", {}],
        y: ["INT", {}],
        width: ["INT", {}],
        height: ["INT", {}],
      },
      optional: {
        mask: ["MASK", {}],
      },
    },
  },
  FeatherMask: {
    input: {
      required: {
        left: ["INT", {}],
        top: ["INT", {}],
        right: ["INT", {}],
        bottom: ["INT", {}],
      },
      optional: {
        mask: ["MASK", {}],
      },
    },
  },
  ImageScale: {
    input: {
      required: {
        upscale_method: [["lanczos"], {}],
        width: ["INT", {}],
        height: ["INT", {}],
        crop: [["disabled"], {}],
      },
      optional: {
        image: ["IMAGE", {}],
      },
    },
  },
  ImageCompositeMasked: {
    input: {
      required: {
        x: ["INT", {}],
        y: ["INT", {}],
        resize_source: ["BOOLEAN", {}],
      },
      optional: {
        destination: ["IMAGE", {}],
        source: ["IMAGE", {}],
        mask: ["MASK", {}],
      },
    },
  },
  PreviewImage: {
    input: {
      optional: {
        images: ["IMAGE", {}],
      },
    },
  },
};

const krea2RepairRequest = {
  checkpointName: "krea-2-turbo-unet.safetensors",
  modelBaseModel: "Krea 2",
  modelStorageKind: "diffusion" as const,
  positivePrompt: "repair the hand holding the cup",
  sourceImage: { filename: "source.png", type: "output" as const },
  maskName: "mask.png",
  imageWidth: 64,
  imageHeight: 64,
  samplerName: "euler",
  scheduler: "simple",
  workflowProfile: "krea2" as const,
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
  LoadImage: {
    input: {
      required: {
        image: [["hero.png"], {}],
      },
    },
  },
  ImageBatch: {
    input: {
      required: {
        image1: ["IMAGE", {}],
        image2: ["IMAGE", {}],
      },
    },
  },
  AnimaIPAdapterLoader: {
    input: {
      required: {
        ip_adapter_name: [["ip_adapter-Character_Reference-10.safetensors"], {}],
        auto_download: ["BOOLEAN", {}],
      },
    },
  },
  AnimaIPAdapterApply: {
    input: {
      required: {
        model: ["MODEL", {}],
        ip_adapter: ["IPADAPTER", {}],
        ref_image: ["IMAGE", {}],
        strength: ["FLOAT", {}],
        ref_image_size: ["INT", {}],
        siglip_layer: ["INT", {}],
        ip_cfg_scale: ["FLOAT", {}],
        ip_cfg_separate: ["BOOLEAN", {}],
        gray_null: ["BOOLEAN", {}],
        use_lora: ["BOOLEAN", {}],
      },
    },
  },
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

  it.each([
    ["default Illustrious", {
      checkpointName: "model.safetensors",
      modelBaseModel: "Illustrious",
      positivePrompt: "scene",
    }, objectInfo, "Character reference \"Run character reference\" requires ComfyUI nodes"],
    ["Anima", {
      checkpointName: "pencil-xl-diffusion.safetensors",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion" as const,
      positivePrompt: "scene",
    }, objectInfoWithAnima, "Anima character references require LuciferTC9527/ComfyUI-Anima_IP-Adapter"],
  ] as const)("fails closed instead of silently disabling a strict selected character on %s", (
    _label,
    baseRequest,
    unavailableObjectInfo,
    expectedError,
  ) => {
    const result = validateComfyUiRequestAgainstObjectInfo({
      ...baseRequest,
      strictCharacterReferences: true,
      characterReferences: [{
        id: "run-character-reference",
        name: "Run character reference",
        images: [{ imageName: "sceneforge-character-preflight.png", weight: 0.8 }],
        weight: 0.8,
        startPercent: 0,
        endPercent: 1,
      }],
    }, unavailableObjectInfo);

    expect(result.errors.join(" ")).toContain(expectedError);
    expect(result.warnings).toEqual([]);
    expect(result.request.characterReferences?.[0]).toMatchObject({ id: "run-character-reference" });
    expect(result.request.characterReferences?.[0]?.enabled).toBeUndefined();
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

  it("resolves an Anima UNET from checkpoint filename aliases", () => {
    const animaOnlyObjectInfo: Record<string, unknown> = { ...objectInfoWithAnima };
    delete animaOnlyObjectInfo.CheckpointLoaderSimple;
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
        checkpointNameAliases: ["pencil-xl-diffusion.safetensors"],
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        samplerName: "DPM++ 2M",
        scheduler: "Karras",
      },
      animaOnlyObjectInfo,
    );

    expect(result.errors).toEqual([]);
    expect(result.request).toMatchObject({
      checkpointName: "pencil-xl-diffusion.safetensors",
      workflowProfile: "anima",
      clipName: "qwen_3_06b_base.safetensors",
      vaeName: "qwen_image_vae.safetensors",
      samplerName: "dpmpp_2m",
      scheduler: "karras",
    });
  });

  it("does not guess an Anima UNET when the requested filename and aliases do not match", () => {
    const animaOnlyObjectInfo: Record<string, unknown> = {
      ...objectInfoWithAnima,
      UNETLoader: {
        input: {
          required: {
            unet_name: [["pencil-xl-diffusion.safetensors"], {}],
            weight_dtype: [["default", "fp8_e4m3fn"], {}],
          },
        },
      },
    };
    delete animaOnlyObjectInfo.CheckpointLoaderSimple;
    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
        checkpointNameAliases: ["missing-anima-file.safetensors"],
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        samplerName: "DPM++ 2M",
        scheduler: "Karras",
      },
      animaOnlyObjectInfo,
    );

    expect(result.errors).toContain(
      "Anima UNET model is not available in ComfyUI: Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors",
    );
    expect(result.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining("using the only available Anima UNET model")]));
    expect(result.request.checkpointName).toBe("Anima__base-v1.0__mv2945208__bd43b7cffe.safetensors");
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

  it("blocks Anima character references when the dedicated plugin nodes are missing", () => {
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
      "Anima character references require LuciferTC9527/ComfyUI-Anima_IP-Adapter. Missing ComfyUI nodes: LoadImage, AnimaIPAdapterLoader, AnimaIPAdapterApply. Install or update the plugin, then restart ComfyUI.",
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.request.characterReferences?.[0]).toMatchObject({
      id: "hero",
    });
    expect(result.request.characterReferences?.[0]?.enabled).toBeUndefined();
  });

  it.each([
    "AnimaIPAdapterLoader",
    "AnimaIPAdapterApply",
  ] as const)("reports a missing dedicated Anima character-reference %s node", (missingNode) => {
    const incompleteObjectInfo: Record<string, unknown> = { ...objectInfoWithAnimaIpAdapter };
    delete incompleteObjectInfo[missingNode];

    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        characterReferences: [{
          id: "hero",
          name: "Hero",
          images: [{ imageName: "hero.png" }],
        }],
      },
      incompleteObjectInfo,
    );

    expect(result.errors).toContain(
      `Anima character references require LuciferTC9527/ComfyUI-Anima_IP-Adapter. Missing ComfyUI nodes: ${missingNode}. Install or update the plugin, then restart ComfyUI.`,
    );
  });

  it.each([
    ["AnimaIPAdapterLoader", "ip_adapter_name"],
    ["AnimaIPAdapterLoader", "auto_download"],
    ["AnimaIPAdapterApply", "model"],
    ["AnimaIPAdapterApply", "ip_adapter"],
    ["AnimaIPAdapterApply", "ref_image"],
    ["AnimaIPAdapterApply", "strength"],
    ["AnimaIPAdapterApply", "ref_image_size"],
    ["AnimaIPAdapterApply", "siglip_layer"],
    ["AnimaIPAdapterApply", "ip_cfg_scale"],
    ["AnimaIPAdapterApply", "ip_cfg_separate"],
    ["AnimaIPAdapterApply", "gray_null"],
    ["AnimaIPAdapterApply", "use_lora"],
  ] as const)("reports a missing required %s.%s input port", (classType, inputName) => {
    const incompleteObjectInfo = structuredClone(objectInfoWithAnimaIpAdapter) as Record<string, {
      input?: { required?: Record<string, unknown> };
    }>;
    delete incompleteObjectInfo[classType]?.input?.required?.[inputName];

    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        characterReferences: [{
          id: "hero",
          name: "Hero",
          images: [{ imageName: "hero.png" }],
        }],
      },
      incompleteObjectInfo,
    );

    expect(result.errors).toContain(`${classType}.${inputName} input is not available in ComfyUI object_info.`);
  });

  it("requires the exact Anima character-reference adapter filename", () => {
    const objectInfoWithWrongAdapter = {
      ...objectInfoWithAnimaIpAdapter,
      AnimaIPAdapterLoader: {
        input: {
          required: {
            ip_adapter_name: [["ip_adapter-Character_Reference.safetensors"], {}],
            auto_download: ["BOOLEAN", {}],
          },
        },
      },
    };

    const result = validateComfyUiRequestAgainstObjectInfo(
      {
        checkpointName: "pencil-xl-diffusion.safetensors",
        modelBaseModel: "Anima",
        modelStorageKind: "diffusion",
        positivePrompt: "scene",
        characterReferences: [{
          id: "hero",
          name: "Hero",
          images: [{ imageName: "hero.png" }],
        }],
      },
      objectInfoWithWrongAdapter,
    );

    expect(result.errors).toContain(
      "Anima character-reference adapter is not available in ComfyUI: ip_adapter-Character_Reference-10.safetensors. Place the exact file in ComfyUI/models/ipadapter/ and restart ComfyUI.",
    );
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

  it("validates Krea 2's fixed local files and fails closed for missing nodes or unsupported inputs", () => {
    const validRequest = {
      checkpointName: "krea-2-turbo-unet.safetensors",
      workflowProfile: "krea2" as const,
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
      positivePrompt: "a quiet station",
      samplerName: "euler",
      scheduler: "simple",
      loras: [{ loraName: "krea-style.safetensors", strengthModel: 0.7 }],
    };

    expect(validateComfyUiRequestAgainstObjectInfo(validRequest, objectInfoWithKrea2)).toMatchObject({
      errors: [],
      request: {
        checkpointName: "krea-2-turbo-unet.safetensors",
        clipName: "qwen3vl_4b_fp8_scaled.safetensors",
        vaeName: "qwen_image_vae.safetensors",
        loras: [{ loraName: "krea-style.safetensors", strengthModel: 0.7 }],
      },
    });

    expect(validateComfyUiRequestAgainstObjectInfo({
      ...validRequest,
      imageName: "SceneForge/krea-source.png",
      width: 1040,
      height: 1024,
    }, objectInfoWithKrea2)).toMatchObject({ errors: [] });

    const redCraftRequest = {
      ...validRequest,
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
    };
    const redCraftObjectInfo = {
      ...objectInfoWithKrea2,
      UNETLoader: {
        input: {
          required: {
            unet_name: [["RedCraft_v4_fp8_scaled.safetensors"], {}],
            weight_dtype: [["default"], {}],
          },
        },
      },
    };
    expect(validateComfyUiRequestAgainstObjectInfo(redCraftRequest, redCraftObjectInfo)).toMatchObject({
      errors: [],
      request: { checkpointName: "RedCraft_v4_fp8_scaled.safetensors", workflowProfile: "krea2" },
    });

    expect(
      validateComfyUiRequestAgainstObjectInfo(validRequest, {
        ...objectInfoWithKrea2,
        CLIPLoader: {
          input: {
            required: {
              clip_name: [["qwen3vl_4b_fp8_scaled.safetensors"], {}],
              type: [["qwen_image"], {}],
            },
          },
        },
        VAELoader: { input: { required: { vae_name: [["other-vae.safetensors"], {}] } } },
        LoraLoaderModelOnly: undefined,
      }),
    ).toMatchObject({
      errors: expect.arrayContaining([
        "Krea 2 CLIP type is not available in ComfyUI: krea2",
        "Krea 2 VAE model is not available in ComfyUI: qwen_image_vae.safetensors",
        "LoraLoaderModelOnly node is not available in ComfyUI. It is required when Krea LoRAs are enabled.",
      ]),
    });

    const requiredNode = (inputNames: readonly string[]) => ({
      input: {
        required: Object.fromEntries(inputNames.map((inputName) => [inputName, ["ANY", {}]])),
      },
    });
    const detailerGraphInputs = [
      "image", "model", "clip", "vae", "guide_size", "guide_size_for", "max_size", "seed", "steps", "cfg",
      "sampler_name", "scheduler", "positive", "negative", "denoise", "feather", "noise_mask", "force_inpaint",
      "bbox_threshold", "bbox_dilation", "bbox_crop_factor", "sam_detection_hint", "sam_dilation", "sam_threshold",
      "sam_bbox_expansion", "sam_mask_hint_threshold", "sam_mask_hint_use_negative", "drop_size", "bbox_detector",
      "wildcard", "cycle",
    ];
    const objectInfoWithKrea2DetailerGraph = {
      ...objectInfoWithKrea2,
      CLIPTextEncode: requiredNode(["text", "clip"]),
      EmptyLatentImage: requiredNode(["width", "height", "batch_size"]),
      KSampler: {
        input: {
          required: {
            ...objectInfoWithKrea2.KSampler.input.required,
            model: ["MODEL", {}],
            positive: ["CONDITIONING", {}],
            negative: ["CONDITIONING", {}],
            latent_image: ["LATENT", {}],
          },
        },
      },
      VAEDecode: requiredNode(["samples", "vae"]),
      FaceDetailer: requiredNode(detailerGraphInputs),
      SaveImage: requiredNode(["filename_prefix", "images"]),
    };
    const kreaDetailerRequest = {
      ...validRequest,
      faceDetailer: { enabled: true, detectorModelName: "bbox/face_yolov8s.pt" },
      handDetailer: { enabled: false, detectorModelName: "bbox/hand_yolov8s.pt" },
    };

    expect(validateComfyUiRequestAgainstObjectInfo(
      kreaDetailerRequest,
      objectInfoWithKrea2DetailerGraph,
    ).errors).toEqual([]);

    expect(validateComfyUiRequestAgainstObjectInfo(kreaDetailerRequest, {
      ...objectInfoWithKrea2DetailerGraph,
      UNETLoader: {
        input: { required: { unet_name: [["other-unet.safetensors"], {}], weight_dtype: [["default"], {}] } },
      },
      CLIPLoader: {
        input: { required: { clip_name: [["other-clip.safetensors"], {}], type: [["krea2"], {}] } },
      },
      VAELoader: { input: { required: { vae_name: [["other-vae.safetensors"], {}] } } },
      UltralyticsDetectorProvider: { input: { required: { model_name: [["bbox/other.pt"], {}] } } },
      FaceDetailer: requiredNode(detailerGraphInputs.filter((inputName) => inputName !== "cycle")),
    }).errors).toEqual(expect.arrayContaining([
      "Krea 2 UNET model is not available in ComfyUI: krea-2-turbo-unet.safetensors",
      "Krea 2 CLIP model is not available in ComfyUI: qwen3vl_4b_fp8_scaled.safetensors",
      "Krea 2 VAE model is not available in ComfyUI: qwen_image_vae.safetensors",
      "FaceDetailer detector model is not available in ComfyUI: bbox/face_yolov8s.pt",
      "FaceDetailer.cycle input is not available in ComfyUI object_info.",
    ]));

    expect(
      validateComfyUiRequestAgainstObjectInfo(
        {
          ...validRequest,
          characterReferences: [{
            enabled: true,
            name: "reference",
            images: [{ imageName: "reference.png" }],
          }],
        },
        objectInfoWithKrea2,
      ).errors,
    ).toEqual(expect.arrayContaining([
      "Krea 2 Turbo does not support entity or character references.",
    ]));
  });

  it("requires the verified Krea reference adapter nodes, inputs, and fixed adapter file", () => {
    const request = {
      checkpointName: "krea-2-turbo-unet.safetensors",
      workflowProfile: "krea2" as const,
      modelBaseModel: "Krea 2",
      modelStorageKind: "diffusion" as const,
      positivePrompt: "a quiet station",
      krea2StyleReference: { imageName: "sceneforge-krea-style.png" },
    };
    const compatibleObjectInfo = {
      ...objectInfoWithKrea2,
      LoadImage: { input: { required: { image: [["sceneforge-krea-style.png"], {}] } } },
      LoraLoaderModelOnly: {
        input: { required: {
          model: ["MODEL", {}],
          lora_name: [["krea-style.safetensors", "krea2_style_reference.safetensors"], {}],
          strength_model: ["FLOAT", {}],
        } },
      },
      TextEncodeKrea2OstrisEdit: {
        input: { required: {
          clip: ["CLIP", {}], prompt: ["STRING", {}], vae: ["VAE", {}], image1: ["IMAGE", {}],
        } },
      },
      Krea2OstrisEditModelPatch: { input: { required: { model: ["MODEL", {}], kv_cache: ["BOOLEAN", {}] } } },
    };

    expect(validateComfyUiRequestAgainstObjectInfo(request, compatibleObjectInfo).errors).toEqual([]);
    expect(validateComfyUiRequestAgainstObjectInfo(request, {
      ...compatibleObjectInfo,
      TextEncodeKrea2OstrisEdit: { input: { required: { clip: ["CLIP", {}], prompt: ["STRING", {}] } } },
      Krea2OstrisEditModelPatch: undefined,
    }).errors).toEqual(expect.arrayContaining([
      "Krea2OstrisEditModelPatch node is not available in ComfyUI.",
      "TextEncodeKrea2OstrisEdit.vae input is not available in ComfyUI object_info.",
      "TextEncodeKrea2OstrisEdit.image1 input is not available in ComfyUI object_info.",
    ]));

    const reIdRequest = {
      ...request,
      checkpointName: "RedCraft_v4_fp8_scaled.safetensors",
      clipName: "qwen3vl_4b_fp8_scaled.safetensors",
      vaeName: "qwen_image_vae.safetensors",
      unetWeightDtype: "default",
      steps: 8,
      cfg: 1,
      samplerName: "euler",
      scheduler: "simple",
      krea2StyleReference: undefined,
      krea2ReId: { imageName: "sceneforge-krea-reid.png" },
      krea2ReIdDescriptor: {
        version: 2,
        referenceDigest: `sha256:${"a".repeat(64)}`,
        loraName: "krea2_reid_rank32.safetensors" as const,
        strengthModel: 1 as const,
        kvCache: true as const,
        imageCount: 1 as const,
      } as never,
    };
    const reIdCompatibleObjectInfo = {
      ...compatibleObjectInfo,
      UNETLoader: {
        input: { required: {
          unet_name: [["RedCraft_v4_fp8_scaled.safetensors"], {}],
          weight_dtype: [["default"], {}],
        } },
      },
      CLIPLoader: {
        input: { required: {
          clip_name: [["qwen3vl_4b_fp8_scaled.safetensors"], {}],
          type: [["krea2"], {}],
        } },
      },
      VAELoader: { input: { required: { vae_name: [["qwen_image_vae.safetensors"], {}] } } },
      LoadImage: { input: { required: { image: [["sceneforge-krea-reid.png"], {}] } } },
      ImageScaleToTotalPixels: {
        input: { required: {
          image: ["IMAGE", {}],
          upscale_method: [["area"], {}],
          megapixels: ["FLOAT", {}],
          resolution_steps: ["INT", {}],
        } },
      },
      LoraLoaderModelOnly: {
        input: { required: {
          model: ["MODEL", {}],
          lora_name: [["krea2_reid_rank32.safetensors"], {}],
          strength_model: ["FLOAT", {}],
        } },
      },
      TextEncodeKrea2OstrisEdit: {
        input: { required: {
          clip: ["CLIP", {}], prompt: ["STRING", {}], vae: ["VAE", {}], image1: ["IMAGE", {}],
        } },
      },
      FluxKontextMultiReferenceLatentMethod: {
        input: { required: {
          conditioning: ["CONDITIONING", {}],
          reference_latents_method: [["index_timestep_zero"], {}],
        } },
      },
    };
    expect(validateComfyUiRequestAgainstObjectInfo(reIdRequest, reIdCompatibleObjectInfo).errors).toEqual([]);

    const missing = validateComfyUiRequestAgainstObjectInfo(reIdRequest, {
      ...reIdCompatibleObjectInfo,
      LoraLoaderModelOnly: {
        input: { required: {
          model: ["MODEL", {}],
          lora_name: [["krea2_style_reference.safetensors"], {}],
        } },
      },
      TextEncodeKrea2OstrisEdit: {
        input: { required: { clip: ["CLIP", {}], prompt: ["STRING", {}], vae: ["VAE", {}] } },
      },
      Krea2OstrisEditModelPatch: {
        input: { required: { model: ["MODEL", {}] } },
      },
      FluxKontextMultiReferenceLatentMethod: {
        input: { required: { conditioning: ["CONDITIONING", {}] } },
      },
    }).errors;
    expect(missing).toEqual(expect.arrayContaining([
      "LoraLoaderModelOnly.strength_model input is not available in ComfyUI object_info.",
      "TextEncodeKrea2OstrisEdit.image1 input is not available in ComfyUI object_info.",
      "Krea2OstrisEditModelPatch.kv_cache input is not available in ComfyUI object_info.",
      "FluxKontextMultiReferenceLatentMethod.reference_latents_method input is not available in ComfyUI object_info.",
      "Krea2 ReID adapter is not available in ComfyUI: krea2_reid_rank32.safetensors",
    ]));

    expect(validateComfyUiRequestAgainstObjectInfo({ ...reIdRequest, steps: 6 }, reIdCompatibleObjectInfo).errors)
      .toContain("Krea2 ReID requires steps=8, cfg=1, sampler=euler, scheduler=simple, and denoise=1 from noise.");
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

  it("accepts the Krea repair preflight when ImageCompositeMasked.mask is optional", () => {
    const result = validateComfyUiInpaintRequestAgainstObjectInfo(
      krea2RepairRequest,
      objectInfoWithKrea2Repair,
    );

    expect(result).toMatchObject({
      errors: [],
      request: {
        checkpointName: "krea-2-turbo-unet.safetensors",
        workflowProfile: "krea2",
      },
    });
  });

  it("validates enabled Krea Repair Detailer ports and detector models before queueing", () => {
    const detailerInputs = [
      "image", "model", "clip", "vae", "guide_size", "guide_size_for", "max_size", "seed", "steps", "cfg",
      "sampler_name", "scheduler", "positive", "negative", "denoise", "feather", "noise_mask", "force_inpaint",
      "bbox_threshold", "bbox_dilation", "bbox_crop_factor", "sam_detection_hint", "sam_dilation", "sam_threshold",
      "sam_bbox_expansion", "sam_mask_hint_threshold", "sam_mask_hint_use_negative", "drop_size", "bbox_detector",
      "wildcard", "cycle",
    ];
    const withDetailers = {
      ...objectInfoWithKrea2Repair,
      FaceDetailer: {
        input: {
          required: Object.fromEntries(detailerInputs.map((inputName) => [inputName, ["ANY", {}]])),
        },
      },
      UltralyticsDetectorProvider: {
        input: {
          required: {
            model_name: [["bbox/face_yolov8s.pt", "bbox/hand_yolov8s.pt"], {}],
          },
        },
      },
    };
    const request = {
      ...krea2RepairRequest,
      faceDetailer: { enabled: true, detectorModelName: "bbox/face_yolov8s.pt" },
      handDetailer: { enabled: false, detectorModelName: "bbox/hand_yolov8s.pt" },
    };

    expect(validateComfyUiInpaintRequestAgainstObjectInfo(request, withDetailers)).toMatchObject({
      errors: [],
      request: {
        faceDetailer: { enabled: true, detectorModelName: "bbox/face_yolov8s.pt" },
        handDetailer: { enabled: false },
        workflowProfile: "krea2",
      },
    });
    expect(validateComfyUiInpaintRequestAgainstObjectInfo(request, {
      ...withDetailers,
      FaceDetailer: {
        input: {
          required: Object.fromEntries(
            detailerInputs
              .filter((inputName) => inputName !== "cycle")
              .map((inputName) => [inputName, ["ANY", {}]]),
          ),
        },
      },
      UltralyticsDetectorProvider: {
        input: { required: { model_name: [["bbox/other.pt"], {}] } },
      },
    }).errors).toEqual(expect.arrayContaining([
      "FaceDetailer detector model is not available in ComfyUI: bbox/face_yolov8s.pt",
      "FaceDetailer.cycle input is not available in ComfyUI object_info.",
    ]));
  });

  it("fails closed when the optional ImageCompositeMasked mask port is absent", () => {
    const objectInfoWithoutCompositeMask = {
      ...objectInfoWithKrea2Repair,
      ImageCompositeMasked: {
        input: {
          ...objectInfoWithKrea2Repair.ImageCompositeMasked.input,
          optional: {
            destination: ["IMAGE", {}],
            source: ["IMAGE", {}],
          },
        },
      },
    };

    const result = validateComfyUiInpaintRequestAgainstObjectInfo(
      krea2RepairRequest,
      objectInfoWithoutCompositeMask,
    );

    expect(result.errors).toEqual([
      "ImageCompositeMasked.mask input is not available in ComfyUI object_info.",
    ]);
  });

  it.each([
    [
      "the nearest-exact ImageScaleBy option",
      {
        ImageScaleBy: {
          input: { required: { upscale_method: [["lanczos"], {}] } },
        },
      },
      "ImageScaleBy nearest-exact upscale method is not available in ComfyUI. It is required for high-res inpaint masks.",
    ],
    [
      "the KSampler seed input",
      {
        KSampler: {
          input: { required: { sampler_name: [["euler"], {}], scheduler: [["simple"], {}] } },
        },
      },
      "KSampler.seed input is not available in ComfyUI object_info.",
    ],
    [
      "the KSampler steps input",
      {
        KSampler: {
          input: { required: { seed: ["INT", {}], sampler_name: [["euler"], {}], scheduler: [["simple"], {}] } },
        },
      },
      "KSampler.steps input is not available in ComfyUI object_info.",
    ],
    [
      "the KSampler cfg input",
      {
        KSampler: {
          input: { required: { seed: ["INT", {}], steps: ["INT", {}], sampler_name: [["euler"], {}], scheduler: [["simple"], {}] } },
        },
      },
      "KSampler.cfg input is not available in ComfyUI object_info.",
    ],
    [
      "the KSampler denoise input",
      {
        KSampler: {
          input: { required: { seed: ["INT", {}], steps: ["INT", {}], cfg: ["FLOAT", {}], sampler_name: [["euler"], {}], scheduler: [["simple"], {}] } },
        },
      },
      "KSampler.denoise input is not available in ComfyUI object_info.",
    ],
  ])("fails the Krea repair object_info preflight when it lacks %s", (_label, override, expectedError) => {
    const result = validateComfyUiInpaintRequestAgainstObjectInfo(
      {
        checkpointName: "krea-2-turbo-unet.safetensors",
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        positivePrompt: "repair the hand holding the cup",
        sourceImage: { filename: "source.png", type: "output" },
        maskName: "mask.png",
        samplerName: "euler",
        scheduler: "simple",
        workflowProfile: "krea2",
      },
      { ...objectInfoWithKrea2, ...override },
    );

    expect(result.errors).toContain(expectedError);
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
