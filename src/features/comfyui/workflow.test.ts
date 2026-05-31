import { describe, expect, it } from "vitest";

import { MIN_COMFYUI_VAE_INPAINT_DENOISE } from "./inpaint";
import { buildBasicInpaintWorkflow, buildBasicTextToImageWorkflow, buildSam2MaskWorkflow, ComfyUiWorkflowBuilder } from "./workflow";

describe("ComfyUI workflow builder", () => {
  it("creates stable node ids and connection tuples", () => {
    const builder = new ComfyUiWorkflowBuilder();
    const first = builder.addNode("FirstNode", { value: "a" }, "First");
    const second = builder.addNode("SecondNode", { input: builder.connect(first, 2) });

    expect(first).toBe("1");
    expect(second).toBe("2");
    expect(builder.toWorkflow()).toEqual({
      "1": {
        class_type: "FirstNode",
        inputs: { value: "a" },
        _meta: { title: "First" },
      },
      "2": {
        class_type: "SecondNode",
        inputs: { input: ["1", 2] },
      },
    });
  });

  it("builds the default text-to-image workflow", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "a quiet forest",
      seed: 123,
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      latentImage: "4",
      sampler: "5",
      vaeDecode: "6",
      previewImage: "7",
    });
    expect(result.outputNodeId).toBe("7");
    expect(result.request).toMatchObject({
      checkpointName: "dream.safetensors",
      positivePrompt: "a quiet forest",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      seed: 123,
      steps: 30,
      cfg: 7,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 1,
      batchSize: 1,
      latentImageNode: "EmptyLatentImage",
      outputPrefix: "SceneForge",
    });
    expect(result.workflow["5"].inputs).toMatchObject({
      seed: 123,
      steps: 30,
      cfg: 7,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
    });
    expect(result.workflow["7"].inputs).toEqual({
      images: ["6", 0],
    });
  });

  it("builds the Anima text-to-image workflow without CheckpointLoaderSimple", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "pencil-xl-diffusion.safetensors",
      modelBaseModel: "Anima",
      modelStorageKind: "diffusion",
      clipName: "anima-clip.safetensors",
      vaeName: "anima-vae.safetensors",
      positivePrompt: "a quiet forest",
      negativePrompt: "low quality",
      seed: 123,
      loras: [
        {
          loraName: "anima-style.safetensors",
          strengthModel: 0.8,
          strengthClip: 0.7,
        },
      ],
    });

    expect(result.nodeIds).toEqual({
      unetLoader: "1",
      clipLoader: "2",
      vaeLoader: "3",
      loraLoaders: ["4"],
      positivePrompt: "5",
      negativePrompt: "6",
      latentImage: "7",
      sampler: "8",
      vaeDecode: "9",
      previewImage: "10",
    });
    expect(Object.values(result.workflow).some((node) => node.class_type === "CheckpointLoaderSimple")).toBe(false);
    expect(result.workflow["1"]).toMatchObject({
      class_type: "UNETLoader",
      inputs: {
        unet_name: "pencil-xl-diffusion.safetensors",
        weight_dtype: "default",
      },
    });
    expect(result.workflow["2"]).toMatchObject({
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "anima-clip.safetensors",
        type: "stable_diffusion",
        device: "default",
      },
    });
    expect(result.workflow["3"]).toMatchObject({
      class_type: "VAELoader",
      inputs: {
        vae_name: "anima-vae.safetensors",
      },
    });
    expect(result.workflow["4"]).toMatchObject({
      class_type: "LoraLoader",
      inputs: {
        model: ["1", 0],
        clip: ["2", 0],
        lora_name: "anima-style.safetensors",
        strength_model: 0.8,
        strength_clip: 0.7,
      },
    });
    expect(result.workflow["7"]).toMatchObject({
      class_type: "EmptyLatentImage",
      inputs: {
        width: 1024,
        height: 1024,
        batch_size: 1,
      },
    });
    expect(result.workflow["8"].inputs).toMatchObject({
      model: ["4", 0],
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["7", 0],
    });
    expect(result.workflow["9"].inputs).toEqual({
      samples: ["8", 0],
      vae: ["3", 0],
    });
    expect(result.workflow["10"].inputs).toEqual({
      images: ["9", 0],
    });
  });

  it("uses the default profile for unknown diffusion models", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "Flux Model.safetensors",
      modelBaseModel: "Flux.1 D",
      modelStorageKind: "diffusion",
      positivePrompt: "a quiet forest",
      seed: 123,
    });

    expect(result.workflow["1"]).toMatchObject({
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "Flux Model.safetensors",
      },
    });
    expect(Object.values(result.workflow).some((node) => node.class_type === "UNETLoader")).toBe(false);
  });

  it("uses the default profile for checkpoint models even when the filename contains Anima", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "Anima styled checkpoint.safetensors",
      modelBaseModel: "Illustrious",
      modelStorageKind: "checkpoint",
      positivePrompt: "a quiet forest",
      seed: 123,
    });

    expect(result.workflow["1"]).toMatchObject({
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "Anima styled checkpoint.safetensors",
      },
    });
    expect(Object.values(result.workflow).some((node) => node.class_type === "UNETLoader")).toBe(false);
  });

  it("patches the model with IPAdapter character references before sampling", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "comic panel",
      seed: 123,
      characterReferences: [
        {
          id: "hero",
          name: "Hero",
          images: [
            { id: "hero-front", imageName: "hero-front.png" },
            { id: "hero-side", imageName: "hero-side.png" },
          ],
          maskImageName: "hero-mask.png",
          weight: 0.8,
        },
      ],
    });

    expect(result.nodeIds.characterReferences).toEqual([
      {
        characterId: "hero",
        imageLoaders: ["4", "5"],
        imageBatchers: ["6"],
        maskImage: "7",
        loader: "8",
        apply: "9",
      },
    ]);
    expect(result.workflow["4"]).toMatchObject({
      class_type: "LoadImage",
      inputs: { image: "hero-front.png" },
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "ImageBatch",
      inputs: {
        image1: ["4", 0],
        image2: ["5", 0],
      },
    });
    expect(result.workflow["8"]).toMatchObject({
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        model: ["1", 0],
        preset: "PLUS (high strength)",
      },
    });
    expect(result.workflow["9"]).toMatchObject({
      class_type: "IPAdapterAdvanced",
      inputs: {
        model: ["8", 0],
        ipadapter: ["8", 1],
        image: ["6", 0],
        attn_mask: ["7", 1],
        weight: 0.8,
      },
    });
    expect(result.workflow["11"].inputs.model).toEqual(["9", 0]);
  });

  it("uses the IPAdapter Plus Face preset for face reference mode", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "portrait",
      seed: 123,
      characterReferences: [
        {
          id: "hero-face",
          mode: "face",
          name: "Hero Face",
          images: [{ imageName: "hero-face.png" }],
        },
      ],
    });

    expect(result.workflow["5"]).toMatchObject({
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        model: ["1", 0],
        preset: "PLUS FACE (portraits)",
      },
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "IPAdapterAdvanced",
      inputs: {
        image: ["4", 0],
        weight: 0.45,
      },
    });
    expect(result.workflow["8"].inputs.model).toEqual(["6", 0]);
  });

  it("adds FaceDetailer and UltralyticsDetectorProvider when enabled", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "portrait",
      seed: 123,
      faceDetailer: {
        bboxCropFactor: 2.5,
        bboxDilation: 16,
        bboxThreshold: 0.42,
        cfg: 5.5,
        cycle: 2,
        denoise: 0.38,
        enabled: true,
        detectorModelName: "bbox/face_yolov8s.pt",
        dropSize: 12,
        feather: 7,
        forceInpaint: false,
        guideSize: 640,
        guideSizeFor: false,
        maxSize: 1280,
        noiseMask: false,
        samBBoxExpansion: 4,
        samDetectionHint: "rect-4",
        samDilation: 2,
        samMaskHintThreshold: 0.63,
        samMaskHintUseNegative: "Small",
        samThreshold: 0.88,
        samplerName: "dpmpp_2m",
        scheduler: "karras",
        steps: 18,
        wildcard: "[LAB] face detail",
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      latentImage: "4",
      sampler: "5",
      vaeDecode: "6",
      ultralyticsDetectorProvider: "7",
      faceDetailer: "8",
      previewImage: "9",
    });
    expect(result.outputNodeId).toBe("9");
    expect(result.workflow["7"]).toMatchObject({
      class_type: "UltralyticsDetectorProvider",
      inputs: {
        model_name: "bbox/face_yolov8s.pt",
      },
    });
    expect(result.workflow["8"]).toMatchObject({
      class_type: "FaceDetailer",
      inputs: {
        image: ["6", 0],
        model: ["1", 0],
        clip: ["1", 1],
        vae: ["1", 2],
        positive: ["2", 0],
        negative: ["3", 0],
        seed: 123,
        steps: 18,
        cfg: 5.5,
        guide_size: 640,
        guide_size_for: "crop_region",
        max_size: 1280,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 0.38,
        feather: 7,
        noise_mask: false,
        force_inpaint: false,
        bbox_threshold: 0.42,
        bbox_dilation: 16,
        bbox_crop_factor: 2.5,
        sam_detection_hint: "rect-4",
        sam_dilation: 2,
        sam_threshold: 0.88,
        sam_bbox_expansion: 4,
        sam_mask_hint_threshold: 0.63,
        sam_mask_hint_use_negative: "Small",
        drop_size: 12,
        bbox_detector: ["7", 0],
        wildcard: "[LAB] face detail",
        cycle: 2,
      },
    });
    expect(result.workflow["9"].inputs).toEqual({
      images: ["8", 0],
    });
  });

  it("adds HandDetailer as a titled FaceDetailer node when enabled", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "hands",
      seed: 123,
      handDetailer: {
        enabled: true,
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      latentImage: "4",
      sampler: "5",
      vaeDecode: "6",
      handUltralyticsDetectorProvider: "7",
      handDetailer: "8",
      previewImage: "9",
    });
    expect(result.workflow["7"]).toMatchObject({
      class_type: "UltralyticsDetectorProvider",
      inputs: {
        model_name: "bbox/hand_yolov8s.pt",
      },
      _meta: {
        title: "Hand Detector",
      },
    });
    expect(result.workflow["8"]).toMatchObject({
      class_type: "FaceDetailer",
      _meta: {
        title: "HandDetailer",
      },
      inputs: {
        image: ["6", 0],
        bbox_detector: ["7", 0],
      },
    });
    expect(result.workflow["9"].inputs).toEqual({
      images: ["8", 0],
    });
    expect(result.request.handDetailer).toMatchObject({
      enabled: true,
      detectorModelName: "bbox/hand_yolov8s.pt",
    });
  });

  it("runs HandDetailer before FaceDetailer when both are enabled", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "portrait with hands",
      seed: 123,
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/face_yolov8s.pt",
      },
      handDetailer: {
        enabled: true,
        detectorModelName: "bbox/hand_yolov8s.pt",
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      latentImage: "4",
      sampler: "5",
      vaeDecode: "6",
      handUltralyticsDetectorProvider: "7",
      handDetailer: "8",
      ultralyticsDetectorProvider: "9",
      faceDetailer: "10",
      previewImage: "11",
    });
    expect(result.workflow["8"]).toMatchObject({
      class_type: "FaceDetailer",
      _meta: {
        title: "HandDetailer",
      },
      inputs: {
        image: ["6", 0],
        bbox_detector: ["7", 0],
      },
    });
    expect(result.workflow["10"]).toMatchObject({
      class_type: "FaceDetailer",
      _meta: {
        title: "FaceDetailer",
      },
      inputs: {
        image: ["8", 0],
        bbox_detector: ["9", 0],
      },
    });
    expect(result.workflow["11"].inputs).toEqual({
      images: ["10", 0],
    });
  });

  it("builds a latent noise mask inpaint workflow", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "replace the window with a neon sign",
      negativePrompt: "blurry",
      imageName: "SceneForge/source.png",
      maskName: "SceneForge/mask.png",
      seed: 123,
      denoise: 0.62,
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      sourceImage: "4",
      maskImage: "5",
      vaeEncode: "6",
      setLatentNoiseMask: "7",
      sampler: "8",
      vaeDecode: "9",
      previewImage: "10",
    });
    expect(result.outputNodeId).toBe("10");
    expect(result.workflow["4"]).toMatchObject({
      class_type: "LoadImage",
      inputs: {
        image: "SceneForge/source.png",
      },
    });
    expect(result.workflow["5"]).toMatchObject({
      class_type: "LoadImageMask",
      inputs: {
        image: "SceneForge/mask.png",
        channel: "red",
      },
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "VAEEncode",
      inputs: {
        pixels: ["4", 0],
        vae: ["1", 2],
      },
    });
    expect(result.workflow["7"]).toMatchObject({
      class_type: "SetLatentNoiseMask",
      inputs: {
        samples: ["6", 0],
        mask: ["5", 0],
      },
    });
    expect(result.workflow["8"].inputs).toMatchObject({
      seed: 123,
      denoise: 0.62,
      latent_image: ["7", 0],
    });
    expect(result.workflow["10"].inputs).toEqual({
      images: ["9", 0],
    });
  });

  it("upscales source and mask before latent noise mask inpaint with lanczos mode", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "replace the window with a neon sign",
      imageName: "SceneForge/source.png",
      maskName: "SceneForge/mask.png",
      seed: 123,
      upscaleBeforeInpaint: {
        enabled: true,
        mode: "lanczos",
        scaleBy: 2,
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      sourceImage: "4",
      maskImage: "5",
      sourceImageScaleBy: "6",
      maskToImage: "7",
      maskImageScaleBy: "8",
      imageToMask: "9",
      vaeEncode: "10",
      setLatentNoiseMask: "11",
      sampler: "12",
      vaeDecode: "13",
      previewImage: "14",
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "ImageScaleBy",
      inputs: {
        image: ["4", 0],
        scale_by: 2,
        upscale_method: "lanczos",
      },
    });
    expect(result.workflow["7"]).toMatchObject({
      class_type: "MaskToImage",
      inputs: {
        mask: ["5", 0],
      },
    });
    expect(result.workflow["8"]).toMatchObject({
      class_type: "ImageScaleBy",
      inputs: {
        image: ["7", 0],
        scale_by: 2,
        upscale_method: "nearest-exact",
      },
    });
    expect(result.workflow["9"]).toMatchObject({
      class_type: "ImageToMask",
      inputs: {
        channel: "red",
        image: ["8", 0],
      },
    });
    expect(result.workflow["10"].inputs.pixels).toEqual(["6", 0]);
    expect(result.workflow["10"]).toMatchObject({
      class_type: "VAEEncodeTiled",
      inputs: {
        overlap: 64,
        temporal_overlap: 8,
        temporal_size: 64,
        tile_size: 512,
      },
    });
    expect(result.workflow["11"].inputs.mask).toEqual(["9", 0]);
    expect(result.workflow["12"].inputs.latent_image).toEqual(["11", 0]);
    expect(result.workflow["13"]).toMatchObject({
      class_type: "VAEDecodeTiled",
      inputs: {
        overlap: 64,
        temporal_overlap: 8,
        temporal_size: 64,
        tile_size: 512,
      },
    });
  });

  it("runs local-region lanczos high-res inpaint on a crop and composites it back", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "repair the sleeve",
      imageName: "SceneForge/source.png",
      imageWidth: 1024,
      imageHeight: 768,
      maskName: "SceneForge/mask.png",
      seed: 123,
      upscaleBeforeInpaint: {
        enabled: true,
        mode: "lanczos",
        scaleBy: 2,
        strategy: "local-region",
        localRegion: {
          x: 128,
          y: 96,
          width: 320,
          height: 256,
          source: "mask-bounds",
          padding: 128,
          feather: 32,
        },
      },
    });

    expect(result.workflow["6"]).toMatchObject({
      class_type: "ImageCrop",
      inputs: {
        image: ["4", 0],
        x: 128,
        y: 96,
        width: 320,
        height: 256,
      },
    });
    expect(result.workflow["7"]).toMatchObject({
      class_type: "CropMask",
      inputs: {
        mask: ["5", 0],
        x: 128,
        y: 96,
        width: 320,
        height: 256,
      },
    });
    expect(result.workflow["8"]).toMatchObject({
      class_type: "FeatherMask",
      inputs: {
        mask: ["7", 0],
        left: 32,
        top: 32,
        right: 32,
        bottom: 32,
      },
    });
    expect(result.workflow["9"]).toMatchObject({
      class_type: "ImageScaleBy",
      inputs: {
        image: ["6", 0],
        scale_by: 2,
        upscale_method: "lanczos",
      },
    });
    expect(result.workflow["13"]).toMatchObject({
      class_type: "VAEEncodeTiled",
      inputs: {
        pixels: ["9", 0],
      },
    });
    expect(result.workflow["14"].inputs.mask).toEqual(["12", 0]);
    expect(result.workflow["17"]).toMatchObject({
      class_type: "ImageScale",
      inputs: {
        image: ["16", 0],
        width: 320,
        height: 256,
        upscale_method: "lanczos",
        crop: "disabled",
      },
    });
    expect(result.workflow["18"]).toMatchObject({
      class_type: "ImageCompositeMasked",
      inputs: {
        destination: ["4", 0],
        source: ["17", 0],
        x: 128,
        y: 96,
        resize_source: false,
        mask: ["8", 0],
      },
    });
    expect(result.workflow["19"].inputs.images).toEqual(["18", 0]);
  });

  it("can harmonize a local-region composite with a low-denoise global pass", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "repair the sleeve",
      imageName: "SceneForge/source.png",
      imageWidth: 1024,
      imageHeight: 768,
      maskName: "SceneForge/mask.png",
      seed: 123,
      upscaleBeforeInpaint: {
        enabled: true,
        mode: "lanczos",
        scaleBy: 2,
        strategy: "local-region",
        localRegion: {
          x: 128,
          y: 96,
          width: 320,
          height: 256,
          source: "box",
          padding: 128,
          feather: 32,
          harmonizeAfter: {
            enabled: true,
            denoise: 0.12,
          },
        },
      },
    });

    expect(result.workflow["19"]).toMatchObject({
      class_type: "VAEEncodeTiled",
      inputs: {
        pixels: ["18", 0],
      },
    });
    expect(result.workflow["20"]).toMatchObject({
      class_type: "KSampler",
      inputs: {
        denoise: 0.12,
        latent_image: ["19", 0],
      },
    });
    expect(result.workflow["21"]).toMatchObject({
      class_type: "VAEDecodeTiled",
      inputs: {
        samples: ["20", 0],
      },
    });
    expect(result.workflow["22"].inputs.images).toEqual(["21", 0]);
  });

  it("adds HandDetailer before FaceDetailer to an inpaint workflow when enabled", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "fix fingers and face",
      imageName: "SceneForge/source.png",
      maskName: "SceneForge/mask.png",
      seed: 123,
      faceDetailer: {
        enabled: true,
        detectorModelName: "bbox/face_yolov8s.pt",
      },
      handDetailer: {
        enabled: true,
        detectorModelName: "bbox/hand_yolov8s.pt",
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      sourceImage: "4",
      maskImage: "5",
      vaeEncode: "6",
      setLatentNoiseMask: "7",
      sampler: "8",
      vaeDecode: "9",
      handUltralyticsDetectorProvider: "10",
      handDetailer: "11",
      ultralyticsDetectorProvider: "12",
      faceDetailer: "13",
      previewImage: "14",
    });
    expect(result.workflow["11"]).toMatchObject({
      class_type: "FaceDetailer",
      _meta: {
        title: "HandDetailer",
      },
      inputs: {
        image: ["9", 0],
        bbox_detector: ["10", 0],
      },
    });
    expect(result.workflow["13"]).toMatchObject({
      class_type: "FaceDetailer",
      _meta: {
        title: "FaceDetailer",
      },
      inputs: {
        image: ["11", 0],
        bbox_detector: ["12", 0],
      },
    });
    expect(result.workflow["14"].inputs).toEqual({
      images: ["13", 0],
    });
  });

  it("builds a VAE inpaint workflow with LoRA and grow mask", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "new hair style",
      imageName: "SceneForge/source.png",
      maskName: "SceneForge/mask.png",
      inpaintMode: "vae-inpaint",
      growMaskBy: 12,
      seed: 321,
      loras: [
        {
          loraName: "style.safetensors",
          strengthModel: 0.75,
          strengthClip: 0.65,
        },
      ],
      promptWrapper: {
        positivePrefix: "best quality, ",
        negativePrefix: "low quality, ",
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: ["2"],
      positivePrompt: "3",
      negativePrompt: "4",
      sourceImage: "5",
      maskImage: "6",
      vaeEncodeForInpaint: "7",
      sampler: "8",
      vaeDecode: "9",
      previewImage: "10",
    });
    expect(result.workflow["2"]).toMatchObject({
      class_type: "LoraLoader",
      inputs: {
        lora_name: "style.safetensors",
        strength_model: 0.75,
        strength_clip: 0.65,
      },
    });
    expect(result.workflow["3"].inputs.text).toBe("best quality, new hair style");
    expect(result.workflow["4"].inputs.text).toBe("low quality, ");
    expect(result.workflow["7"]).toMatchObject({
      class_type: "VAEEncodeForInpaint",
      inputs: {
        pixels: ["5", 0],
        vae: ["1", 2],
        mask: ["6", 0],
        grow_mask_by: 12,
      },
    });
    expect(result.workflow["8"].inputs).toMatchObject({
      model: ["2", 0],
      positive: ["3", 0],
      negative: ["4", 0],
      latent_image: ["7", 0],
    });
  });

  it("raises too-low denoise for VAE inpaint to avoid gray masked fills", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "repair hands",
      imageName: "SceneForge/source.png",
      maskName: "SceneForge/mask.png",
      inpaintMode: "vae-inpaint",
      denoise: 0.2,
      seed: 321,
    });

    expect(result.request.denoise).toBe(MIN_COMFYUI_VAE_INPAINT_DENOISE);
    expect(result.workflow["7"].inputs.denoise).toBe(MIN_COMFYUI_VAE_INPAINT_DENOISE);
  });

  it("upscales source with a true 2x model and doubles VAE inpaint grow mask", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "new hair style",
      imageName: "SceneForge/source.png",
      maskName: "SceneForge/mask.png",
      inpaintMode: "vae-inpaint",
      growMaskBy: 6,
      seed: 321,
      upscaleBeforeInpaint: {
        enabled: true,
        mode: "aniscale2-x2",
        scaleBy: 2,
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      sourceImage: "4",
      maskImage: "5",
      upscaleModelLoader: "6",
      imageUpscaleWithModel: "7",
      maskToImage: "8",
      maskImageScaleBy: "9",
      imageToMask: "10",
      vaeEncodeForInpaint: "11",
      sampler: "12",
      vaeDecode: "13",
      previewImage: "14",
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "UpscaleModelLoader",
      inputs: {
        model_name: "2x_AniScale2_ESRGAN_i16_110K.pth",
      },
    });
    expect(result.workflow["7"]).toMatchObject({
      class_type: "ImageUpscaleWithModel",
      inputs: {
        image: ["4", 0],
        upscale_model: ["6", 0],
      },
    });
    expect(result.workflow["9"].inputs).toMatchObject({
      image: ["8", 0],
      scale_by: 2,
      upscale_method: "nearest-exact",
    });
    expect(result.workflow["11"]).toMatchObject({
      class_type: "VAEEncodeForInpaint",
      inputs: {
        pixels: ["7", 0],
        mask: ["10", 0],
        grow_mask_by: 12,
      },
    });
    expect(result.workflow["12"].inputs.latent_image).toEqual(["11", 0]);
    expect(result.workflow["13"]).toMatchObject({
      class_type: "VAEDecodeTiled",
      inputs: {
        overlap: 64,
        temporal_overlap: 8,
        temporal_size: 64,
        tile_size: 512,
      },
    });
  });

  it("uses the 2x model only on the local crop in local-region mode", () => {
    const result = buildBasicInpaintWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "new hair style",
      imageName: "SceneForge/source.png",
      imageWidth: 1024,
      imageHeight: 768,
      maskName: "SceneForge/mask.png",
      seed: 321,
      upscaleBeforeInpaint: {
        enabled: true,
        mode: "aniscale2-x2",
        scaleBy: 2,
        strategy: "local-region",
        localRegion: {
          x: 128,
          y: 96,
          width: 256,
          height: 256,
          source: "box",
          padding: 128,
          feather: 24,
        },
      },
    });

    expect(result.workflow["6"].class_type).toBe("ImageCrop");
    expect(result.workflow["9"]).toMatchObject({
      class_type: "UpscaleModelLoader",
      inputs: {
        model_name: "2x_AniScale2_ESRGAN_i16_110K.pth",
      },
    });
    expect(result.workflow["10"]).toMatchObject({
      class_type: "ImageUpscaleWithModel",
      inputs: {
        image: ["6", 0],
        upscale_model: ["9", 0],
      },
    });
    expect(result.workflow["21"]).toBeUndefined();
    expect(result.workflow["20"].inputs.images).toEqual(["19", 0]);
  });

  it("adds OpenPose ControlNet nodes before sampling when an uploaded control image is available", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "pose controlled portrait",
      negativePrompt: "low quality",
      seed: 123,
      controlNet: {
        enabled: true,
        modelName: "control_v11p_sd15_openpose.pth",
        strength: 0.72,
        startPercent: 0.1,
        endPercent: 0.88,
        imageName: "SceneForge/openpose.png",
      },
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: [],
      positivePrompt: "2",
      negativePrompt: "3",
      controlNets: [{ type: "openpose", image: "4", loader: "5", apply: "6" }],
      controlNetImage: "4",
      controlNetLoader: "5",
      controlNetApply: "6",
      latentImage: "7",
      sampler: "8",
      vaeDecode: "9",
      previewImage: "10",
    });
    expect(result.workflow["4"]).toMatchObject({
      class_type: "LoadImage",
      inputs: {
        image: "SceneForge/openpose.png",
      },
    });
    expect(result.workflow["5"]).toMatchObject({
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: "control_v11p_sd15_openpose.pth",
      },
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["2", 0],
        negative: ["3", 0],
        control_net: ["5", 0],
        image: ["4", 0],
        strength: 0.72,
        start_percent: 0.1,
        end_percent: 0.88,
      },
    });
    expect(result.workflow["8"].inputs).toMatchObject({
      positive: ["6", 0],
      negative: ["6", 1],
      latent_image: ["7", 0],
    });
    expect(result.outputNodeId).toBe("10");
  });

  it("adds Depth ControlNet nodes before sampling when an uploaded depth image is available", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "depth controlled portrait",
      seed: 123,
      controlNets: [
        {
          type: "depth",
          enabled: true,
          modelName: "control_v11f1p_sd15_depth.pth",
          strength: 0.66,
          startPercent: 0.05,
          endPercent: 0.9,
          imageName: "SceneForge/depth.png",
        },
      ],
    });

    expect(result.nodeIds.controlNets).toEqual([{ type: "depth", image: "4", loader: "5", apply: "6" }]);
    expect(result.workflow["4"]).toMatchObject({
      class_type: "LoadImage",
      inputs: {
        image: "SceneForge/depth.png",
      },
    });
    expect(result.workflow["5"]).toMatchObject({
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: "control_v11f1p_sd15_depth.pth",
      },
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["2", 0],
        negative: ["3", 0],
        control_net: ["5", 0],
        image: ["4", 0],
        strength: 0.66,
        start_percent: 0.05,
        end_percent: 0.9,
      },
    });
    expect(result.workflow["8"].inputs).toMatchObject({
      positive: ["6", 0],
      negative: ["6", 1],
    });
  });

  it("adds Normal ControlNet nodes before sampling when an uploaded normal image is available", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "normal controlled portrait",
      seed: 123,
      controlNets: [
        {
          type: "normal",
          enabled: true,
          modelName: "control_v11p_sd15_normalbae.pth",
          strength: 0.7,
          startPercent: 0.15,
          endPercent: 0.95,
          imageName: "SceneForge/normal.png",
        },
      ],
    });

    expect(result.nodeIds.controlNets).toEqual([{ type: "normal", image: "4", loader: "5", apply: "6" }]);
    expect(result.workflow["4"]).toMatchObject({
      class_type: "LoadImage",
      inputs: {
        image: "SceneForge/normal.png",
      },
    });
    expect(result.workflow["5"]).toMatchObject({
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: "control_v11p_sd15_normalbae.pth",
      },
    });
    expect(result.workflow["6"]).toMatchObject({
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["2", 0],
        negative: ["3", 0],
        control_net: ["5", 0],
        image: ["4", 0],
        strength: 0.7,
        start_percent: 0.15,
        end_percent: 0.95,
      },
    });
    expect(result.workflow["8"].inputs).toMatchObject({
      positive: ["6", 0],
      negative: ["6", 1],
    });
  });

  it("chains OpenPose before Depth when both ControlNet units are enabled", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "pose and depth controlled portrait",
      seed: 123,
      controlNets: [
        {
          type: "depth",
          enabled: true,
          modelName: "depth.safetensors",
          imageName: "SceneForge/depth.png",
        },
        {
          type: "openpose",
          enabled: true,
          modelName: "openpose.safetensors",
          imageName: "SceneForge/openpose.png",
        },
      ],
    });

    expect(result.nodeIds.controlNets).toEqual([
      { type: "openpose", image: "4", loader: "5", apply: "6" },
      { type: "depth", image: "7", loader: "8", apply: "9" },
    ]);
    expect(result.workflow["6"].inputs).toMatchObject({
      positive: ["2", 0],
      negative: ["3", 0],
    });
    expect(result.workflow["9"].inputs).toMatchObject({
      positive: ["6", 0],
      negative: ["6", 1],
    });
    expect(result.workflow["11"].inputs).toMatchObject({
      positive: ["9", 0],
      negative: ["9", 1],
      latent_image: ["10", 0],
    });
  });

  it("chains OpenPose before Depth before Normal when all ControlNet units are enabled", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "pose depth and normal controlled portrait",
      seed: 123,
      controlNets: [
        {
          type: "normal",
          enabled: true,
          modelName: "normalbae.safetensors",
          imageName: "SceneForge/normal.png",
        },
        {
          type: "depth",
          enabled: true,
          modelName: "depth.safetensors",
          imageName: "SceneForge/depth.png",
        },
        {
          type: "openpose",
          enabled: true,
          modelName: "openpose.safetensors",
          imageName: "SceneForge/openpose.png",
        },
      ],
    });

    expect(result.nodeIds.controlNets).toEqual([
      { type: "openpose", image: "4", loader: "5", apply: "6" },
      { type: "depth", image: "7", loader: "8", apply: "9" },
      { type: "normal", image: "10", loader: "11", apply: "12" },
    ]);
    expect(result.workflow["6"].inputs).toMatchObject({
      positive: ["2", 0],
      negative: ["3", 0],
    });
    expect(result.workflow["9"].inputs).toMatchObject({
      positive: ["6", 0],
      negative: ["6", 1],
    });
    expect(result.workflow["12"].inputs).toMatchObject({
      positive: ["9", 0],
      negative: ["9", 1],
    });
    expect(result.workflow["14"].inputs).toMatchObject({
      positive: ["12", 0],
      negative: ["12", 1],
      latent_image: ["13", 0],
    });
  });

  it("writes custom generation parameters to KSampler and latent nodes", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "scene.ckpt",
      positivePrompt: "cinematic portrait",
      negativePrompt: "low quality",
      width: 768,
      height: 1152,
      seed: 999,
      steps: 42,
      cfg: 6.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
      denoise: 0.72,
      batchSize: 2,
      outputPrefix: "CustomScene",
    });

    expect(result.workflow["4"].inputs).toEqual({
      width: 768,
      height: 1152,
      batch_size: 2,
    });
    expect(result.workflow["5"].inputs).toMatchObject({
      seed: 999,
      steps: 42,
      cfg: 6.5,
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 0.72,
    });
    expect(result.workflow["3"].inputs.text).toBe("low quality");
    expect(result.workflow["7"].inputs.images).toEqual(["6", 0]);
  });

  it("applies configured prompt wrappers before CLIP encoding", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "scene.ckpt",
      positivePrompt: "cinematic portrait",
      negativePrompt: "low quality",
      promptWrapper: {
        positivePrefix: "Positive prefix: ",
        negativePrefix: "Negative prefix: ",
      },
      seed: 999,
    });

    expect(result.workflow["2"].inputs.text).toBe("Positive prefix: cinematic portrait");
    expect(result.workflow["3"].inputs.text).toBe("Negative prefix: low quality");
    expect(result.request.promptWrapper).toEqual({
      positivePrefix: "Positive prefix: ",
      negativePrefix: "Negative prefix: ",
    });
  });

  it("uses the requested latent image node", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "sd3.safetensors",
      positivePrompt: "a quiet forest",
      latentImageNode: "EmptySD3LatentImage",
      seed: 123,
    });

    expect(result.workflow["4"]).toMatchObject({
      class_type: "EmptySD3LatentImage",
      _meta: { title: "Empty SD3 Latent Image" },
    });
    expect(result.request.latentImageNode).toBe("EmptySD3LatentImage");
  });

  it("builds a chained LoRA workflow before text encoding and sampling", () => {
    const result = buildBasicTextToImageWorkflow({
      checkpointName: "dream.safetensors",
      positivePrompt: "a quiet forest",
      seed: 123,
      loras: [
        {
          loraName: "style.safetensors",
          strengthModel: 0.75,
          strengthClip: 0.7,
        },
        {
          loraName: "detail.safetensors",
          strengthModel: 0.5,
        },
      ],
    });

    expect(result.nodeIds).toEqual({
      checkpoint: "1",
      loraLoaders: ["2", "3"],
      positivePrompt: "4",
      negativePrompt: "5",
      latentImage: "6",
      sampler: "7",
      vaeDecode: "8",
      previewImage: "9",
    });
    expect(result.workflow["2"]).toMatchObject({
      class_type: "LoraLoader",
      inputs: {
        lora_name: "style.safetensors",
        strength_model: 0.75,
        strength_clip: 0.7,
        model: ["1", 0],
        clip: ["1", 1],
      },
    });
    expect(result.workflow["3"]).toMatchObject({
      class_type: "LoraLoader",
      inputs: {
        lora_name: "detail.safetensors",
        strength_model: 0.5,
        strength_clip: 0.5,
        model: ["2", 0],
        clip: ["2", 1],
      },
    });
    expect(result.workflow["4"].inputs.clip).toEqual(["3", 1]);
    expect(result.workflow["5"].inputs.clip).toEqual(["3", 1]);
    expect(result.workflow["7"].inputs.model).toEqual(["3", 0]);
  });

  it("builds a SAM2 mask workflow with point and box prompts", () => {
    const result = buildSam2MaskWorkflow({
      imageName: "SceneForge/source.png",
      imageWidth: 1024,
      imageHeight: 768,
      positivePoints: [{ x: 300, y: 420 }],
      negativePoints: [{ x: 120, y: 220 }],
      bbox: {
        x: 240,
        y: 320,
        width: 280,
        height: 180,
      },
    });

    expect(result.nodeIds).toEqual({
      sourceImage: "1",
      sam2Model: "2",
      sam2Segmentation: "3",
      maskToImage: "4",
      saveImage: "5",
    });
    expect(result.outputNodeId).toBe("5");
    expect(result.workflow["1"]).toMatchObject({
      class_type: "LoadImage",
      inputs: {
        image: "SceneForge/source.png",
      },
    });
    expect(result.workflow["2"]).toMatchObject({
      class_type: "DownloadAndLoadSAM2Model",
      inputs: {
        model: "sam2.1_hiera_small.safetensors",
        segmentor: "single_image",
        device: "cuda",
        precision: "fp16",
      },
    });
    expect(result.workflow["3"]).toMatchObject({
      class_type: "Sam2Segmentation",
      inputs: {
        sam2_model: ["2", 0],
        image: ["1", 0],
        keep_model_loaded: true,
        individual_objects: false,
        coordinates_positive: JSON.stringify([{ x: 300, y: 420 }]),
        coordinates_negative: JSON.stringify([{ x: 120, y: 220 }]),
        bboxes: [[240, 320, 520, 500]],
      },
    });
    expect(result.workflow["4"]).toMatchObject({
      class_type: "MaskToImage",
      inputs: {
        mask: ["3", 0],
      },
    });
    expect(result.workflow["5"].inputs).toEqual({
      filename_prefix: "SceneForge_sam_mask",
      images: ["4", 0],
    });
  });
});
