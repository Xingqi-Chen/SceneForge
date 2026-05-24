import type {
  BasicTextToImageWorkflow,
  ComfyUiNodeConnection,
  ComfyUiNodeInputs,
  ComfyUiTextToImageRequest,
  ComfyUiWorkflow,
  ComfyUiWorkflowNode,
} from "./types";
import { getComfyUiLatentImageNodeTitle } from "./latent-image-node";
import { resolveComfyUiTextToImageRequest } from "./validation";

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
      positive: builder.connect(positivePrompt, 0),
      negative: builder.connect(negativePrompt, 0),
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
  let ultralyticsDetectorProvider: string | undefined;
  let faceDetailer: string | undefined;

  if (resolvedRequest.faceDetailer.enabled) {
    ultralyticsDetectorProvider = builder.addNode(
      "UltralyticsDetectorProvider",
      {
        model_name: resolvedRequest.faceDetailer.detectorModelName,
      },
      "Face Detector",
    );
    faceDetailer = builder.addNode(
      "FaceDetailer",
      {
        image: outputImageConnection,
        model: modelConnection,
        clip: clipConnection,
        vae: vaeConnection,
        guide_size: resolvedRequest.faceDetailer.guideSize,
        guide_size_for: resolvedRequest.faceDetailer.guideSizeFor ? "bbox" : "crop_region",
        max_size: resolvedRequest.faceDetailer.maxSize,
        seed: resolvedRequest.seed,
        steps: resolvedRequest.faceDetailer.steps,
        cfg: resolvedRequest.faceDetailer.cfg,
        sampler_name: resolvedRequest.faceDetailer.samplerName,
        scheduler: resolvedRequest.faceDetailer.scheduler,
        positive: builder.connect(positivePrompt, 0),
        negative: builder.connect(negativePrompt, 0),
        denoise: resolvedRequest.faceDetailer.denoise,
        feather: resolvedRequest.faceDetailer.feather,
        noise_mask: resolvedRequest.faceDetailer.noiseMask,
        force_inpaint: resolvedRequest.faceDetailer.forceInpaint,
        bbox_threshold: resolvedRequest.faceDetailer.bboxThreshold,
        bbox_dilation: resolvedRequest.faceDetailer.bboxDilation,
        bbox_crop_factor: resolvedRequest.faceDetailer.bboxCropFactor,
        sam_detection_hint: resolvedRequest.faceDetailer.samDetectionHint,
        sam_dilation: resolvedRequest.faceDetailer.samDilation,
        sam_threshold: resolvedRequest.faceDetailer.samThreshold,
        sam_bbox_expansion: resolvedRequest.faceDetailer.samBBoxExpansion,
        sam_mask_hint_threshold: resolvedRequest.faceDetailer.samMaskHintThreshold,
        sam_mask_hint_use_negative: resolvedRequest.faceDetailer.samMaskHintUseNegative,
        drop_size: resolvedRequest.faceDetailer.dropSize,
        bbox_detector: builder.connect(ultralyticsDetectorProvider, 0),
        wildcard: resolvedRequest.faceDetailer.wildcard,
        cycle: resolvedRequest.faceDetailer.cycle,
      },
      "FaceDetailer",
    );
    outputImageConnection = builder.connect(faceDetailer, 0);
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
      latentImage,
      sampler,
      vaeDecode,
      ...(ultralyticsDetectorProvider ? { ultralyticsDetectorProvider } : {}),
      ...(faceDetailer ? { faceDetailer } : {}),
      saveImage,
    },
    outputNodeId: saveImage,
    request: resolvedRequest,
  };
}
