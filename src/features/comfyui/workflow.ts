import type {
  BasicInpaintWorkflow,
  BasicTextToImageWorkflow,
  ComfyUiNodeConnection,
  ComfyUiNodeInputs,
  ComfyUiInpaintRequest,
  ComfyUiTextToImageRequest,
  ComfyUiWorkflow,
  ComfyUiWorkflowNode,
  ResolvedComfyUiFaceDetailerConfig,
} from "./types";
import { getComfyUiLatentImageNodeTitle } from "./latent-image-node";
import { resolveComfyUiInpaintRequest, resolveComfyUiTextToImageRequest } from "./validation";

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
  let latentImageConnection: ComfyUiNodeConnection;
  let vaeEncode: string | undefined;
  let vaeEncodeForInpaint: string | undefined;
  let setLatentNoiseMask: string | undefined;

  if (resolvedRequest.inpaintMode === "vae-inpaint") {
    vaeEncodeForInpaint = builder.addNode(
      "VAEEncodeForInpaint",
      {
        pixels: builder.connect(sourceImage, 0),
        vae: vaeConnection,
        mask: builder.connect(maskImage, 0),
        grow_mask_by: resolvedRequest.growMaskBy,
      },
      "Encode Inpaint Latent",
    );
    latentImageConnection = builder.connect(vaeEncodeForInpaint, 0);
  } else {
    vaeEncode = builder.addNode(
      "VAEEncode",
      {
        pixels: builder.connect(sourceImage, 0),
        vae: vaeConnection,
      },
      "Encode Source Latent",
    );
    setLatentNoiseMask = builder.addNode(
      "SetLatentNoiseMask",
      {
        samples: builder.connect(vaeEncode, 0),
        mask: builder.connect(maskImage, 0),
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
  const vaeDecode = builder.addNode(
    "VAEDecode",
    {
      samples: builder.connect(sampler, 0),
      vae: vaeConnection,
    },
    "Decode Image",
  );
  const saveImage = builder.addNode(
    "SaveImage",
    {
      filename_prefix: resolvedRequest.outputPrefix,
      images: builder.connect(vaeDecode, 0),
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
      ...(vaeEncode ? { vaeEncode } : {}),
      ...(vaeEncodeForInpaint ? { vaeEncodeForInpaint } : {}),
      ...(setLatentNoiseMask ? { setLatentNoiseMask } : {}),
      sampler,
      vaeDecode,
      saveImage,
    },
    outputNodeId: saveImage,
    request: resolvedRequest,
  };
}
