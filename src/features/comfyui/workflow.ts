import type {
  BasicInpaintWorkflow,
  BasicSam2MaskWorkflow,
  BasicTextToImageWorkflow,
  ComfyUiNodeConnection,
  ComfyUiNodeInputs,
  ComfyUiInpaintRequest,
  ComfyUiSam2MaskRequest,
  ComfyUiSam2Point,
  ComfyUiTextToImageRequest,
  ComfyUiWorkflow,
  ComfyUiWorkflowNode,
  ResolvedComfyUiFaceDetailerConfig,
} from "./types";
import { getComfyUiLatentImageNodeTitle } from "./latent-image-node";
import {
  isComfyUiInpaintModelUpscaleMode,
  resolveComfyUiInpaintRequest,
  resolveComfyUiSam2MaskRequest,
  resolveComfyUiTextToImageRequest,
} from "./validation";

const HIGH_RES_INPAINT_VAE_TILE_SIZE = 512;
const HIGH_RES_INPAINT_VAE_TILE_OVERLAP = 64;
const HIGH_RES_INPAINT_VAE_TEMPORAL_SIZE = 64;
const HIGH_RES_INPAINT_VAE_TEMPORAL_OVERLAP = 8;

function cloneWorkflowNode(node: ComfyUiWorkflowNode): ComfyUiWorkflowNode {
  return JSON.parse(JSON.stringify(node)) as ComfyUiWorkflowNode;
}

export function createComfyUiNode(
  classType: string,
  inputs: ComfyUiNodeInputs,
  title?: string,
): ComfyUiWorkflowNode {
  return {
    class_type: classType,
    inputs,
    ...(title ? { _meta: { title } } : {}),
  };
}

export class ComfyUiWorkflowBuilder {
  private nextNodeId = 1;
  private readonly nodes = new Map<string, ComfyUiWorkflowNode>();

  addNode(classType: string, inputs: ComfyUiNodeInputs, title?: string): string {
    const nodeId = String(this.nextNodeId);
    this.nextNodeId += 1;
    this.nodes.set(nodeId, createComfyUiNode(classType, inputs, title));
    return nodeId;
  }

  connect(nodeId: string, outputIndex = 0): ComfyUiNodeConnection {
    return [nodeId, outputIndex];
  }

  toWorkflow(): ComfyUiWorkflow {
    return Object.fromEntries(
      Array.from(this.nodes.entries()).map(([nodeId, node]) => [nodeId, cloneWorkflowNode(node)]),
    );
  }
}

function applyPromptPrefix(prefix: string, prompt: string) {
  return prefix ? `${prefix}${prompt}` : prompt;
}

function serializeSam2Points(points: ComfyUiSam2Point[]) {
  return JSON.stringify(points.map((point) => ({ x: point.x, y: point.y })));
}

function getHighResInpaintGrowMaskBy(growMaskBy: number, scaleBy: number, enabled: boolean) {
  return enabled ? Math.max(0, Math.round(growMaskBy * scaleBy)) : growMaskBy;
}

function getTiledVaeInputs() {
  return {
    tile_size: HIGH_RES_INPAINT_VAE_TILE_SIZE,
    overlap: HIGH_RES_INPAINT_VAE_TILE_OVERLAP,
    temporal_size: HIGH_RES_INPAINT_VAE_TEMPORAL_SIZE,
    temporal_overlap: HIGH_RES_INPAINT_VAE_TEMPORAL_OVERLAP,
  };
}

function addDetailerNode({
  builder,
  clipConnection,
  config,
  detectorTitle,
  image,
  modelConnection,
  negativePrompt,
  positivePrompt,
  seed,
  title,
  vaeConnection,
}: {
  builder: ComfyUiWorkflowBuilder;
  clipConnection: ComfyUiNodeConnection;
  config: ResolvedComfyUiFaceDetailerConfig;
  detectorTitle: string;
  image: ComfyUiNodeConnection;
  modelConnection: ComfyUiNodeConnection;
  negativePrompt: string;
  positivePrompt: string;
  seed: number;
  title: string;
  vaeConnection: ComfyUiNodeConnection;
}) {
  const detector = builder.addNode(
    "UltralyticsDetectorProvider",
    {
      model_name: config.detectorModelName,
    },
    detectorTitle,
  );
  const detailer = builder.addNode(
    "FaceDetailer",
    {
      image,
      model: modelConnection,
      clip: clipConnection,
      vae: vaeConnection,
      guide_size: config.guideSize,
      guide_size_for: config.guideSizeFor ? "bbox" : "crop_region",
      max_size: config.maxSize,
      seed,
      steps: config.steps,
      cfg: config.cfg,
      sampler_name: config.samplerName,
      scheduler: config.scheduler,
      positive: builder.connect(positivePrompt, 0),
      negative: builder.connect(negativePrompt, 0),
      denoise: config.denoise,
      feather: config.feather,
      noise_mask: config.noiseMask,
      force_inpaint: config.forceInpaint,
      bbox_threshold: config.bboxThreshold,
      bbox_dilation: config.bboxDilation,
      bbox_crop_factor: config.bboxCropFactor,
      sam_detection_hint: config.samDetectionHint,
      sam_dilation: config.samDilation,
      sam_threshold: config.samThreshold,
      sam_bbox_expansion: config.samBBoxExpansion,
      sam_mask_hint_threshold: config.samMaskHintThreshold,
      sam_mask_hint_use_negative: config.samMaskHintUseNegative,
      drop_size: config.dropSize,
      bbox_detector: builder.connect(detector, 0),
      wildcard: config.wildcard,
      cycle: config.cycle,
    },
    title,
  );

  return {
    detailer,
    detector,
    output: builder.connect(detailer, 0),
  };
}

export function buildBasicTextToImageWorkflow(request: ComfyUiTextToImageRequest): BasicTextToImageWorkflow {
  const resolvedRequest = resolveComfyUiTextToImageRequest(request);
  const builder = new ComfyUiWorkflowBuilder();

  const checkpoint = builder.addNode(
    "CheckpointLoaderSimple",
    {
      ckpt_name: resolvedRequest.checkpointName,
    },
    "Load Checkpoint",
  );
  let modelConnection = builder.connect(checkpoint, 0);
  let clipConnection = builder.connect(checkpoint, 1);
  const loraLoaders = resolvedRequest.loras.map((lora, index) => {
    const loraLoader = builder.addNode(
      "LoraLoader",
      {
        lora_name: lora.loraName,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip,
        model: modelConnection,
        clip: clipConnection,
      },
      `Load LoRA ${index + 1}`,
    );

    modelConnection = builder.connect(loraLoader, 0);
    clipConnection = builder.connect(loraLoader, 1);

    return loraLoader;
  });
  const positivePrompt = builder.addNode(
    "CLIPTextEncode",
    {
      text: applyPromptPrefix(resolvedRequest.promptWrapper.positivePrefix, resolvedRequest.positivePrompt),
      clip: clipConnection,
    },
    "Positive Prompt",
  );
  const negativePrompt = builder.addNode(
    "CLIPTextEncode",
    {
      text: applyPromptPrefix(resolvedRequest.promptWrapper.negativePrefix, resolvedRequest.negativePrompt),
      clip: clipConnection,
    },
    "Negative Prompt",
  );
  let positiveConditioningConnection = builder.connect(positivePrompt, 0);
  let negativeConditioningConnection = builder.connect(negativePrompt, 0);
  const controlNetNodeIds = resolvedRequest.controlNets
    .filter((controlNet) => controlNet.enabled && controlNet.imageName)
    .map((controlNet) => {
      const label = controlNet.type === "depth"
        ? "Depth"
        : controlNet.type === "normal"
          ? "Normal"
          : "OpenPose";
      const controlNetImage = builder.addNode(
        "LoadImage",
        {
          image: controlNet.imageName,
        },
        `Load ${label} Control Image`,
      );
      const controlNetLoader = builder.addNode(
        "ControlNetLoader",
        {
          control_net_name: controlNet.modelName,
        },
        `Load ${label} ControlNet`,
      );
      const controlNetApply = builder.addNode(
        "ControlNetApplyAdvanced",
        {
          positive: positiveConditioningConnection,
          negative: negativeConditioningConnection,
          control_net: builder.connect(controlNetLoader, 0),
          image: builder.connect(controlNetImage, 0),
          strength: controlNet.strength,
          start_percent: controlNet.startPercent,
          end_percent: controlNet.endPercent,
        },
        `Apply ControlNet ${label}`,
      );
      positiveConditioningConnection = builder.connect(controlNetApply, 0);
      negativeConditioningConnection = builder.connect(controlNetApply, 1);

      return {
        type: controlNet.type,
        image: controlNetImage,
        loader: controlNetLoader,
        apply: controlNetApply,
      };
    });

  const latentImage = builder.addNode(
    resolvedRequest.latentImageNode,
    {
      width: resolvedRequest.width,
      height: resolvedRequest.height,
      batch_size: resolvedRequest.batchSize,
    },
    getComfyUiLatentImageNodeTitle(resolvedRequest.latentImageNode),
  );
  const sampler = builder.addNode(
    "KSampler",
    {
      seed: resolvedRequest.seed,
      steps: resolvedRequest.steps,
      cfg: resolvedRequest.cfg,
      sampler_name: resolvedRequest.samplerName,
      scheduler: resolvedRequest.scheduler,
      denoise: resolvedRequest.denoise,
      model: modelConnection,
      positive: positiveConditioningConnection,
      negative: negativeConditioningConnection,
      latent_image: builder.connect(latentImage, 0),
    },
    "KSampler",
  );
  const vaeConnection = builder.connect(checkpoint, 2);
  const vaeDecode = builder.addNode(
    "VAEDecode",
    {
      samples: builder.connect(sampler, 0),
      vae: vaeConnection,
    },
    "Decode Image",
  );
  let outputImageConnection = builder.connect(vaeDecode, 0);
  let handUltralyticsDetectorProvider: string | undefined;
  let handDetailer: string | undefined;
  let ultralyticsDetectorProvider: string | undefined;
  let faceDetailer: string | undefined;

  if (resolvedRequest.handDetailer.enabled) {
    const handDetailerNodes = addDetailerNode({
      builder,
      clipConnection,
      config: resolvedRequest.handDetailer,
      detectorTitle: "Hand Detector",
      image: outputImageConnection,
      modelConnection,
      negativePrompt,
      positivePrompt,
      seed: resolvedRequest.seed,
      title: "HandDetailer",
      vaeConnection,
    });
    handUltralyticsDetectorProvider = handDetailerNodes.detector;
    handDetailer = handDetailerNodes.detailer;
    outputImageConnection = handDetailerNodes.output;
  }

  if (resolvedRequest.faceDetailer.enabled) {
    const faceDetailerNodes = addDetailerNode({
      builder,
      clipConnection,
      config: resolvedRequest.faceDetailer,
      detectorTitle: "Face Detector",
      image: outputImageConnection,
      modelConnection,
      negativePrompt,
      positivePrompt,
      seed: resolvedRequest.seed,
      title: "FaceDetailer",
      vaeConnection,
    });
    ultralyticsDetectorProvider = faceDetailerNodes.detector;
    faceDetailer = faceDetailerNodes.detailer;
    outputImageConnection = faceDetailerNodes.output;
  }
  const saveImage = builder.addNode(
    "SaveImage",
    {
      filename_prefix: resolvedRequest.outputPrefix,
      images: outputImageConnection,
    },
    "Save Image",
  );

  return {
    workflow: builder.toWorkflow(),
    nodeIds: {
      checkpoint,
      loraLoaders,
      positivePrompt,
      negativePrompt,
      ...(controlNetNodeIds.length > 0 ? { controlNets: controlNetNodeIds } : {}),
      ...(controlNetNodeIds[0] ? { controlNetImage: controlNetNodeIds[0].image } : {}),
      ...(controlNetNodeIds[0] ? { controlNetLoader: controlNetNodeIds[0].loader } : {}),
      ...(controlNetNodeIds[0] ? { controlNetApply: controlNetNodeIds[0].apply } : {}),
      latentImage,
      sampler,
      vaeDecode,
      ...(handUltralyticsDetectorProvider ? { handUltralyticsDetectorProvider } : {}),
      ...(handDetailer ? { handDetailer } : {}),
      ...(ultralyticsDetectorProvider ? { ultralyticsDetectorProvider } : {}),
      ...(faceDetailer ? { faceDetailer } : {}),
      saveImage,
    },
    outputNodeId: saveImage,
    request: resolvedRequest,
  };
}

export function buildBasicInpaintWorkflow(request: ComfyUiInpaintRequest): BasicInpaintWorkflow {
  const resolvedRequest = resolveComfyUiInpaintRequest(request);
  const builder = new ComfyUiWorkflowBuilder();

  const checkpoint = builder.addNode(
    "CheckpointLoaderSimple",
    {
      ckpt_name: resolvedRequest.checkpointName,
    },
    "Load Checkpoint",
  );
  let modelConnection = builder.connect(checkpoint, 0);
  let clipConnection = builder.connect(checkpoint, 1);
  const vaeConnection = builder.connect(checkpoint, 2);
  const loraLoaders = resolvedRequest.loras.map((lora, index) => {
    const loraLoader = builder.addNode(
      "LoraLoader",
      {
        lora_name: lora.loraName,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip,
        model: modelConnection,
        clip: clipConnection,
      },
      `Load LoRA ${index + 1}`,
    );

    modelConnection = builder.connect(loraLoader, 0);
    clipConnection = builder.connect(loraLoader, 1);

    return loraLoader;
  });
  const positivePrompt = builder.addNode(
    "CLIPTextEncode",
    {
      text: applyPromptPrefix(resolvedRequest.promptWrapper.positivePrefix, resolvedRequest.positivePrompt),
      clip: clipConnection,
    },
    "Positive Prompt",
  );
  const negativePrompt = builder.addNode(
    "CLIPTextEncode",
    {
      text: applyPromptPrefix(resolvedRequest.promptWrapper.negativePrefix, resolvedRequest.negativePrompt),
      clip: clipConnection,
    },
    "Negative Prompt",
  );
  const sourceImage = builder.addNode(
    "LoadImage",
    {
      image: resolvedRequest.imageName,
    },
    "Load Inpaint Source",
  );
  const maskImage = builder.addNode(
    "LoadImageMask",
    {
      image: resolvedRequest.maskName,
      channel: "red",
    },
    "Load Inpaint Mask",
  );
  let sourceImageConnection = builder.connect(sourceImage, 0);
  let maskConnection = builder.connect(maskImage, 0);
  let sourceImageScaleBy: string | undefined;
  let maskToImage: string | undefined;
  let maskImageScaleBy: string | undefined;
  let imageToMask: string | undefined;
  let upscaleModelLoader: string | undefined;
  let imageUpscaleWithModel: string | undefined;
  let sourceImageCrop: string | undefined;
  let maskCrop: string | undefined;
  let compositeMaskFeather: string | undefined;
  let localCompositeMaskConnection: ComfyUiNodeConnection | undefined;
  const localRegion = resolvedRequest.upscaleBeforeInpaint.enabled && resolvedRequest.upscaleBeforeInpaint.strategy === "local-region"
    ? resolvedRequest.upscaleBeforeInpaint.localRegion
    : undefined;

  if (resolvedRequest.upscaleBeforeInpaint.enabled) {
    if (resolvedRequest.upscaleBeforeInpaint.strategy === "local-region") {
      if (!localRegion) {
        throw new Error("localRegion is required for local-region high-res inpaint.");
      }

      if (!resolvedRequest.imageWidth || !resolvedRequest.imageHeight) {
        throw new Error("imageWidth and imageHeight are required for local-region high-res inpaint.");
      }

      if (
        localRegion.x < 0 ||
        localRegion.y < 0 ||
        localRegion.width <= 0 ||
        localRegion.height <= 0 ||
        localRegion.x + localRegion.width > resolvedRequest.imageWidth ||
        localRegion.y + localRegion.height > resolvedRequest.imageHeight
      ) {
        throw new Error("localRegion must stay inside the source image bounds.");
      }

      sourceImageCrop = builder.addNode(
        "ImageCrop",
        {
          image: sourceImageConnection,
          x: localRegion.x,
          y: localRegion.y,
          width: localRegion.width,
          height: localRegion.height,
        },
        "Crop Local Inpaint Source",
      );
      sourceImageConnection = builder.connect(sourceImageCrop, 0);
      maskCrop = builder.addNode(
        "CropMask",
        {
          mask: maskConnection,
          x: localRegion.x,
          y: localRegion.y,
          width: localRegion.width,
          height: localRegion.height,
        },
        "Crop Local Inpaint Mask",
      );
      maskConnection = builder.connect(maskCrop, 0);
      compositeMaskFeather = builder.addNode(
        "FeatherMask",
        {
          mask: maskConnection,
          left: localRegion.feather,
          top: localRegion.feather,
          right: localRegion.feather,
          bottom: localRegion.feather,
        },
        "Feather Local Composite Mask",
      );
      localCompositeMaskConnection = builder.connect(compositeMaskFeather, 0);
    }

    if (isComfyUiInpaintModelUpscaleMode(resolvedRequest.upscaleBeforeInpaint.mode)) {
      upscaleModelLoader = builder.addNode(
        "UpscaleModelLoader",
        {
          model_name: resolvedRequest.upscaleBeforeInpaint.modelName,
        },
        "Load 2x Upscale Model",
      );
      imageUpscaleWithModel = builder.addNode(
        "ImageUpscaleWithModel",
        {
          upscale_model: builder.connect(upscaleModelLoader, 0),
          image: sourceImageConnection,
        },
        "Upscale Inpaint Source with 2x Model",
      );
      sourceImageConnection = builder.connect(imageUpscaleWithModel, 0);
    } else {
      sourceImageScaleBy = builder.addNode(
        "ImageScaleBy",
        {
          image: sourceImageConnection,
          upscale_method: "lanczos",
          scale_by: resolvedRequest.upscaleBeforeInpaint.scaleBy,
        },
        "Upscale Inpaint Source",
      );
      sourceImageConnection = builder.connect(sourceImageScaleBy, 0);
    }

    maskToImage = builder.addNode(
      "MaskToImage",
      {
        mask: maskConnection,
      },
      "Convert Inpaint Mask to Image",
    );
    maskImageScaleBy = builder.addNode(
      "ImageScaleBy",
      {
        image: builder.connect(maskToImage, 0),
        upscale_method: "nearest-exact",
        scale_by: resolvedRequest.upscaleBeforeInpaint.scaleBy,
      },
      "Upscale Inpaint Mask",
    );
    imageToMask = builder.addNode(
      "ImageToMask",
      {
        image: builder.connect(maskImageScaleBy, 0),
        channel: "red",
      },
      "Restore Inpaint Mask",
    );
    maskConnection = builder.connect(imageToMask, 0);
  }
  let latentImageConnection: ComfyUiNodeConnection;
  let vaeEncode: string | undefined;
  let vaeEncodeForInpaint: string | undefined;
  let setLatentNoiseMask: string | undefined;

  if (resolvedRequest.inpaintMode === "vae-inpaint") {
    vaeEncodeForInpaint = builder.addNode(
      "VAEEncodeForInpaint",
      {
        pixels: sourceImageConnection,
        vae: vaeConnection,
        mask: maskConnection,
        grow_mask_by: getHighResInpaintGrowMaskBy(
          resolvedRequest.growMaskBy,
          resolvedRequest.upscaleBeforeInpaint.scaleBy,
          resolvedRequest.upscaleBeforeInpaint.enabled,
        ),
      },
      "Encode Inpaint Latent",
    );
    latentImageConnection = builder.connect(vaeEncodeForInpaint, 0);
  } else {
    const vaeEncodeClassType = resolvedRequest.upscaleBeforeInpaint.enabled ? "VAEEncodeTiled" : "VAEEncode";
    vaeEncode = builder.addNode(
      vaeEncodeClassType,
      {
        pixels: sourceImageConnection,
        vae: vaeConnection,
        ...(resolvedRequest.upscaleBeforeInpaint.enabled
          ? getTiledVaeInputs()
          : {}),
      },
      resolvedRequest.upscaleBeforeInpaint.enabled ? "Encode Source Latent Tiled" : "Encode Source Latent",
    );
    setLatentNoiseMask = builder.addNode(
      "SetLatentNoiseMask",
      {
        samples: builder.connect(vaeEncode, 0),
        mask: maskConnection,
      },
      "Apply Inpaint Mask",
    );
    latentImageConnection = builder.connect(setLatentNoiseMask, 0);
  }

  const sampler = builder.addNode(
    "KSampler",
    {
      seed: resolvedRequest.seed,
      steps: resolvedRequest.steps,
      cfg: resolvedRequest.cfg,
      sampler_name: resolvedRequest.samplerName,
      scheduler: resolvedRequest.scheduler,
      denoise: resolvedRequest.denoise,
      model: modelConnection,
      positive: builder.connect(positivePrompt, 0),
      negative: builder.connect(negativePrompt, 0),
      latent_image: latentImageConnection,
    },
    "KSampler",
  );
  const vaeDecodeClassType = resolvedRequest.upscaleBeforeInpaint.enabled ? "VAEDecodeTiled" : "VAEDecode";
  const vaeDecode = builder.addNode(
    vaeDecodeClassType,
    {
      samples: builder.connect(sampler, 0),
      vae: vaeConnection,
      ...(resolvedRequest.upscaleBeforeInpaint.enabled
        ? getTiledVaeInputs()
        : {}),
    },
    resolvedRequest.upscaleBeforeInpaint.enabled ? "Decode Image Tiled" : "Decode Image",
  );
  let outputImageConnection = builder.connect(vaeDecode, 0);
  let handUltralyticsDetectorProvider: string | undefined;
  let handDetailer: string | undefined;
  let ultralyticsDetectorProvider: string | undefined;
  let faceDetailer: string | undefined;

  if (resolvedRequest.handDetailer.enabled) {
    const handDetailerNodes = addDetailerNode({
      builder,
      clipConnection,
      config: resolvedRequest.handDetailer,
      detectorTitle: "Hand Detector",
      image: outputImageConnection,
      modelConnection,
      negativePrompt,
      positivePrompt,
      seed: resolvedRequest.seed,
      title: "HandDetailer",
      vaeConnection,
    });
    handUltralyticsDetectorProvider = handDetailerNodes.detector;
    handDetailer = handDetailerNodes.detailer;
    outputImageConnection = handDetailerNodes.output;
  }

  if (resolvedRequest.faceDetailer.enabled) {
    const faceDetailerNodes = addDetailerNode({
      builder,
      clipConnection,
      config: resolvedRequest.faceDetailer,
      detectorTitle: "Face Detector",
      image: outputImageConnection,
      modelConnection,
      negativePrompt,
      positivePrompt,
      seed: resolvedRequest.seed,
      title: "FaceDetailer",
      vaeConnection,
    });
    ultralyticsDetectorProvider = faceDetailerNodes.detector;
    faceDetailer = faceDetailerNodes.detailer;
    outputImageConnection = faceDetailerNodes.output;
  }
  let localPatchScale: string | undefined;
  let localComposite: string | undefined;
  let harmonizeVaeEncode: string | undefined;
  let harmonizeSampler: string | undefined;
  let harmonizeVaeDecode: string | undefined;

  if (localRegion) {
    localPatchScale = builder.addNode(
      "ImageScale",
      {
        image: outputImageConnection,
        upscale_method: "lanczos",
        width: localRegion.width,
        height: localRegion.height,
        crop: "disabled",
      },
      "Resize Local Inpaint Patch",
    );
    localComposite = builder.addNode(
      "ImageCompositeMasked",
      {
        destination: builder.connect(sourceImage, 0),
        source: builder.connect(localPatchScale, 0),
        x: localRegion.x,
        y: localRegion.y,
        resize_source: false,
        mask: localCompositeMaskConnection ?? maskConnection,
      },
      "Composite Local Inpaint Patch",
    );
    outputImageConnection = builder.connect(localComposite, 0);

    if (localRegion.harmonizeAfter.enabled) {
      harmonizeVaeEncode = builder.addNode(
        "VAEEncodeTiled",
        {
          pixels: outputImageConnection,
          vae: vaeConnection,
          ...getTiledVaeInputs(),
        },
        "Encode Harmonized Image Tiled",
      );
      harmonizeSampler = builder.addNode(
        "KSampler",
        {
          seed: resolvedRequest.seed,
          steps: resolvedRequest.steps,
          cfg: resolvedRequest.cfg,
          sampler_name: resolvedRequest.samplerName,
          scheduler: resolvedRequest.scheduler,
          denoise: localRegion.harmonizeAfter.denoise,
          model: modelConnection,
          positive: builder.connect(positivePrompt, 0),
          negative: builder.connect(negativePrompt, 0),
          latent_image: builder.connect(harmonizeVaeEncode, 0),
        },
        "Harmonize Composite",
      );
      harmonizeVaeDecode = builder.addNode(
        "VAEDecodeTiled",
        {
          samples: builder.connect(harmonizeSampler, 0),
          vae: vaeConnection,
          ...getTiledVaeInputs(),
        },
        "Decode Harmonized Image Tiled",
      );
      outputImageConnection = builder.connect(harmonizeVaeDecode, 0);
    }
  }

  const saveImage = builder.addNode(
    "SaveImage",
    {
      filename_prefix: resolvedRequest.outputPrefix,
      images: outputImageConnection,
    },
    "Save Image",
  );

  return {
    workflow: builder.toWorkflow(),
    nodeIds: {
      checkpoint,
      loraLoaders,
      positivePrompt,
      negativePrompt,
      sourceImage,
      maskImage,
      ...(sourceImageCrop ? { sourceImageCrop } : {}),
      ...(maskCrop ? { maskCrop } : {}),
      ...(compositeMaskFeather ? { compositeMaskFeather } : {}),
      ...(sourceImageScaleBy ? { sourceImageScaleBy } : {}),
      ...(maskToImage ? { maskToImage } : {}),
      ...(maskImageScaleBy ? { maskImageScaleBy } : {}),
      ...(imageToMask ? { imageToMask } : {}),
      ...(upscaleModelLoader ? { upscaleModelLoader } : {}),
      ...(imageUpscaleWithModel ? { imageUpscaleWithModel } : {}),
      ...(vaeEncode ? { vaeEncode } : {}),
      ...(vaeEncodeForInpaint ? { vaeEncodeForInpaint } : {}),
      ...(setLatentNoiseMask ? { setLatentNoiseMask } : {}),
      sampler,
      vaeDecode,
      ...(handUltralyticsDetectorProvider ? { handUltralyticsDetectorProvider } : {}),
      ...(handDetailer ? { handDetailer } : {}),
      ...(ultralyticsDetectorProvider ? { ultralyticsDetectorProvider } : {}),
      ...(faceDetailer ? { faceDetailer } : {}),
      ...(localPatchScale ? { localPatchScale } : {}),
      ...(localComposite ? { localComposite } : {}),
      ...(harmonizeVaeEncode ? { harmonizeVaeEncode } : {}),
      ...(harmonizeSampler ? { harmonizeSampler } : {}),
      ...(harmonizeVaeDecode ? { harmonizeVaeDecode } : {}),
      saveImage,
    },
    outputNodeId: saveImage,
    request: resolvedRequest,
  };
}

export function buildSam2MaskWorkflow(request: ComfyUiSam2MaskRequest): BasicSam2MaskWorkflow {
  const resolvedRequest = resolveComfyUiSam2MaskRequest(request);
  const builder = new ComfyUiWorkflowBuilder();
  const sourceImage = builder.addNode(
    "LoadImage",
    {
      image: resolvedRequest.imageName,
    },
    "Load SAM2 Source",
  );
  const sam2Model = builder.addNode(
    "DownloadAndLoadSAM2Model",
    {
      model: resolvedRequest.model,
      segmentor: "single_image",
      device: resolvedRequest.device,
      precision: resolvedRequest.precision,
    },
    "Load SAM2 Model",
  );
  const sam2SegmentationInputs: ComfyUiNodeInputs = {
    sam2_model: builder.connect(sam2Model, 0),
    image: builder.connect(sourceImage, 0),
    keep_model_loaded: resolvedRequest.keepModelLoaded,
    individual_objects: false,
  };

  if (resolvedRequest.positivePoints.length > 0) {
    sam2SegmentationInputs.coordinates_positive = serializeSam2Points(resolvedRequest.positivePoints);
  }

  if (resolvedRequest.positivePoints.length > 0 && resolvedRequest.negativePoints.length > 0) {
    sam2SegmentationInputs.coordinates_negative = serializeSam2Points(resolvedRequest.negativePoints);
  }

  if (resolvedRequest.bbox) {
    sam2SegmentationInputs.bboxes = [[
      resolvedRequest.bbox.x,
      resolvedRequest.bbox.y,
      resolvedRequest.bbox.x + resolvedRequest.bbox.width,
      resolvedRequest.bbox.y + resolvedRequest.bbox.height,
    ]];
  }

  const sam2Segmentation = builder.addNode(
    "Sam2Segmentation",
    sam2SegmentationInputs,
    "SAM2 Segmentation",
  );
  const maskToImage = builder.addNode(
    "MaskToImage",
    {
      mask: builder.connect(sam2Segmentation, 0),
    },
    "Preview SAM2 Mask",
  );
  const saveImage = builder.addNode(
    "SaveImage",
    {
      filename_prefix: resolvedRequest.outputPrefix,
      images: builder.connect(maskToImage, 0),
    },
    "Save SAM2 Mask",
  );

  return {
    workflow: builder.toWorkflow(),
    nodeIds: {
      sourceImage,
      sam2Model,
      sam2Segmentation,
      maskToImage,
      saveImage,
    },
    outputNodeId: saveImage,
    request: resolvedRequest,
  };
}
