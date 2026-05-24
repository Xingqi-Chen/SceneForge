import { describe, expect, it } from "vitest";

import { buildBasicTextToImageWorkflow, ComfyUiWorkflowBuilder } from "./workflow";

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
