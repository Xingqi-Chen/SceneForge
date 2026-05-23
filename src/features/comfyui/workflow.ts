import type {
  BasicTextToImageWorkflow,
  ComfyUiNodeConnection,
  ComfyUiNodeInputs,
  ComfyUiTextToImageRequest,
  ComfyUiWorkflow,
  ComfyUiWorkflowNode,
} from "./types";
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
      text: resolvedRequest.positivePrompt,
      clip: clipConnection,
    },
    "Positive Prompt",
  );
  const negativePrompt = builder.addNode(
    "CLIPTextEncode",
    {
      text: resolvedRequest.negativePrompt,
      clip: clipConnection,
    },
    "Negative Prompt",
  );
  const latentImage = builder.addNode(
    "EmptyLatentImage",
    {
      width: resolvedRequest.width,
      height: resolvedRequest.height,
      batch_size: resolvedRequest.batchSize,
    },
    "Empty Latent Image",
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
  const vaeDecode = builder.addNode(
    "VAEDecode",
    {
      samples: builder.connect(sampler, 0),
      vae: builder.connect(checkpoint, 2),
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
      latentImage,
      sampler,
      vaeDecode,
      saveImage,
    },
    outputNodeId: saveImage,
    request: resolvedRequest,
  };
}
