import { describe, expect, it } from "vitest";

import { buildBasicInpaintWorkflow, buildBasicTextToImageWorkflow, ComfyUiWorkflowBuilder } from "./workflow";

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
      saveImage: "7",
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
      filename_prefix: "SceneForge",
      images: ["6", 0],
    });
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
      saveImage: "9",
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
      filename_prefix: "SceneForge",
      images: ["8", 0],
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
      saveImage: "10",
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
      filename_prefix: "SceneForge_inpaint",
      images: ["9", 0],
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
      saveImage: "10",
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
      saveImage: "10",
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
    expect(result.workflow["7"].inputs.filename_prefix).toBe("CustomScene");
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
      saveImage: "9",
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
});
