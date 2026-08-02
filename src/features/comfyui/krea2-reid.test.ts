import { describe, expect, it } from "vitest";

import {
  getComfyUiKrea2ReIdContextIssue,
  getComfyUiKrea2ReIdWorkflowIssues,
  normalizeComfyUiKrea2ReIdDescriptor,
} from "./krea2-reid";
import type { ComfyUiKrea2ReIdDescriptor, ComfyUiWorkflow } from "./types";
import { buildBasicTextToImageWorkflow } from "./workflow";

const EXPERIMENTAL_UNET = "RedCraft_v4_fp8_scaled.safetensors";
const EXPERIMENTAL_CLIP = "qwen3vl_4b_fp8_scaled.safetensors";
const KREA_VAE = "qwen_image_vae.safetensors";

const descriptor = {
  version: 2,
  referenceDigest: `sha256:${"a".repeat(64)}`,
  loraName: "krea2_reid_rank32.safetensors",
  strengthModel: 1,
  kvCache: true,
  imageCount: 1,
} as unknown as ComfyUiKrea2ReIdDescriptor;

// Semantic fixture transcribed from yijunwang2/krea2-reid's pinned official
// ComfyUI workflow (model commit 121fb018..., Ostris nodes 77565661...).
// Keeping it parsed and independent from SceneForge node ids catches topology
// drift without copying the production builder's implementation.
const pinnedOfficialGraph = JSON.parse(`{
  "lora": "krea2_reid_rank32.safetensors",
  "preparedImage": {
    "node": "ImageScaleToTotalPixels",
    "upscale_method": "area",
    "megapixels": 0.140625,
    "resolution_steps": 16
  },
  "encoderCount": 2,
  "latentMethodCount": 2,
  "latentMethod": "index_timestep_zero"
}`) as {
  lora: string;
  preparedImage: { node: string; upscale_method: string; megapixels: number; resolution_steps: number };
  encoderCount: number;
  latentMethodCount: number;
  latentMethod: string;
};

function validWorkflow() {
  return buildBasicTextToImageWorkflow({
    checkpointName: EXPERIMENTAL_UNET,
    clipName: EXPERIMENTAL_CLIP,
    vaeName: KREA_VAE,
    unetWeightDtype: "default",
    modelBaseModel: "Krea 2",
    modelStorageKind: "diffusion",
    workflowProfile: "krea2",
    positivePrompt: "portrait in a new outfit",
    negativePrompt: "blur",
    steps: 8,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
    denoise: 1,
    krea2ReId: { imageName: "prepared-reid.png" },
    krea2ReIdDescriptor: descriptor,
  });
}

describe("Krea2 ReID pinned upstream invariant contract", () => {
  it("normalizes only the advanced server-owned descriptor version", () => {
    expect(normalizeComfyUiKrea2ReIdDescriptor(descriptor)).toEqual(descriptor);
    for (const invalid of [
      undefined,
      null,
      { ...descriptor, version: 1 },
      { ...descriptor, version: 3 },
      { ...descriptor, referenceDigest: "sha256:short" },
      { ...descriptor, loraName: "other.safetensors" },
      { ...descriptor, strengthModel: 0.99 },
      { ...descriptor, kvCache: false },
      { ...descriptor, imageCount: 2 },
      { ...descriptor, imageName: "transport.png" },
    ]) {
      expect(normalizeComfyUiKrea2ReIdDescriptor(invalid)).toBe(invalid === undefined ? undefined : null);
    }
  });

  it("accepts metadata-valid Krea diffusion resources, including FP8 and RedCraft, as Experimental", () => {
    for (const checkpointName of [
      EXPERIMENTAL_UNET,
      "krea-2-turbo-fp8.safetensors",
      "krea2_turbo_int8_convrot.safetensors",
    ]) {
      expect(getComfyUiKrea2ReIdContextIssue({
        checkpointName,
        modelBaseModel: "Krea 2",
        modelStorageKind: "diffusion",
        workflowProfile: "krea2",
        clipName: EXPERIMENTAL_CLIP,
        vaeName: KREA_VAE,
        unetWeightDtype: "default",
      } as never), checkpointName).toBe("");
    }
    expect(getComfyUiKrea2ReIdContextIssue({
      checkpointName: "misleading-krea-name.safetensors",
      modelBaseModel: "Illustrious",
      modelStorageKind: "diffusion",
      workflowProfile: "krea2",
    })).toMatch(/authoritative Krea 2 diffusion-model request context/i);
  });

  it("matches the pinned resource and dual reference-conditioning topology", () => {
    const result = validWorkflow();
    const entries = Object.entries(result.workflow);
    const encoders = entries.filter(([, node]) => node.class_type === "TextEncodeKrea2OstrisEdit");
    const latentMethods = entries.filter(([, node]) => node.class_type === "FluxKontextMultiReferenceLatentMethod");
    const preparedScales = entries.filter(([, node]) => node.class_type === pinnedOfficialGraph.preparedImage.node);
    const sampler = entries.find(([, node]) => node.class_type === "KSampler");
    const vaeLoader = entries.find(([, node]) => node.class_type === "VAELoader");
    const clipLoader = entries.find(([, node]) => node.class_type === "CLIPLoader");
    const unetLoader = entries.find(([, node]) => node.class_type === "UNETLoader");
    const reIdLora = entries.find(([, node]) =>
      node.class_type === "LoraLoaderModelOnly" && node.inputs.lora_name === pinnedOfficialGraph.lora
    );

    expect(unetLoader?.[1].inputs).toMatchObject({
      unet_name: EXPERIMENTAL_UNET,
      weight_dtype: "default",
    });
    expect(clipLoader?.[1].inputs).toMatchObject({
      clip_name: EXPERIMENTAL_CLIP,
      type: "krea2",
    });
    expect(vaeLoader?.[1].inputs.vae_name).toBe(KREA_VAE);
    expect(reIdLora?.[1].inputs.strength_model).toBe(1);
    expect(preparedScales).toHaveLength(1);
    const preparedImageInputs = {
      upscale_method: pinnedOfficialGraph.preparedImage.upscale_method,
      megapixels: pinnedOfficialGraph.preparedImage.megapixels,
      resolution_steps: pinnedOfficialGraph.preparedImage.resolution_steps,
    };
    expect(preparedScales[0]?.[1].inputs).toMatchObject(preparedImageInputs);
    expect(encoders).toHaveLength(pinnedOfficialGraph.encoderCount);
    expect(latentMethods).toHaveLength(pinnedOfficialGraph.latentMethodCount);

    const preparedConnection = [preparedScales[0]?.[0], 0];
    const vaeConnection = [vaeLoader?.[0], 0];
    for (const [, encoder] of encoders) {
      expect(encoder.inputs.image1).toEqual(preparedConnection);
      expect(encoder.inputs.vae).toEqual(vaeConnection);
      expect(encoder.inputs).not.toHaveProperty("image2");
    }
    for (const [, latentMethod] of latentMethods) {
      expect(latentMethod.inputs).toMatchObject({ reference_latents_method: pinnedOfficialGraph.latentMethod });
      expect(encoders.map(([id]) => id)).toContain((latentMethod.inputs.conditioning as [string, number])[0]);
    }
    expect(new Set(latentMethods.map(([, node]) => (node.inputs.conditioning as [string, number])[0])).size).toBe(2);
    expect([sampler?.[1].inputs.positive, sampler?.[1].inputs.negative]).toEqual(expect.arrayContaining(
      latentMethods.map(([id]) => [id, 0]),
    ));
    expect(sampler?.[1].inputs.denoise).toBe(1);
    expect(entries.some(([, node]) => node.class_type === "EmptyLatentImage")).toBe(true);
    expect(entries.some(([, node]) => node.class_type === "VAEEncode")).toBe(false);
    expect(getComfyUiKrea2ReIdWorkflowIssues(result.workflow)).toEqual([]);
  });

  it("rejects exact graph tampering across resources, shared inputs, latent methods, and sampler ports", () => {
    const result = validWorkflow();
    const entries = Object.entries(result.workflow);
    const encoders = entries.filter(([, node]) => node.class_type === "TextEncodeKrea2OstrisEdit");
    const latentMethods = entries.filter(([, node]) => node.class_type === "FluxKontextMultiReferenceLatentMethod");
    const preparedScale = entries.find(([, node]) => node.class_type === "ImageScaleToTotalPixels");
    const cases: Array<[string, (workflow: ComfyUiWorkflow) => void]> = [
      ["LoRA strength", (workflow) => { workflow[result.nodeIds.reIdLora!]!.inputs.strength_model = 0.8; }],
      ["kv_cache", (workflow) => { workflow[result.nodeIds.reIdPatch!]!.inputs.kv_cache = false; }],
      ["missing negative VAE", (workflow) => { delete workflow[encoders[1]![0]]!.inputs.vae; }],
      ["different negative image", (workflow) => { workflow[encoders[1]![0]]!.inputs.image1 = [result.nodeIds.reIdPatch!, 0]; }],
      ["prepared scale megapixels", (workflow) => { workflow[preparedScale![0]]!.inputs.megapixels = 0.25; }],
      ["latent method value", (workflow) => {
        workflow[latentMethods[0]![0]]!.inputs.reference_latents_method = "attention_mask";
      }],
      ["shared latent method", (workflow) => {
        workflow[result.nodeIds.sampler]!.inputs.negative = [latentMethods[0]![0], 0];
      }],
      ["sampler bypass", (workflow) => {
        workflow[result.nodeIds.sampler]!.inputs.positive = [encoders[0]![0], 0];
      }],
      ["extra reference", (workflow) => {
        workflow[encoders[0]![0]]!.inputs.image2 = workflow[encoders[0]![0]]!.inputs.image1;
      }],
      ["generic character adapter", (workflow) => {
        workflow["999"] = {
          class_type: "IPAdapterAdvanced",
          inputs: { image: [result.nodeIds.reIdReferenceImage!, 0], model: [result.nodeIds.reIdPatch!, 0] },
        };
      }],
    ];

    for (const [label, tamper] of cases) {
      const workflow = structuredClone(result.workflow);
      tamper(workflow);
      expect(getComfyUiKrea2ReIdWorkflowIssues(workflow), label).not.toEqual([]);
    }
  });

  it("rejects swapping the sampler positive and negative Flux conditioning chains", () => {
    const result = validWorkflow();
    const workflow = structuredClone(result.workflow);
    const sampler = workflow[result.nodeIds.sampler]!;
    const positive = sampler.inputs.positive;

    sampler.inputs.positive = sampler.inputs.negative;
    sampler.inputs.negative = positive;

    expect(getComfyUiKrea2ReIdWorkflowIssues(workflow)).not.toEqual([]);
  });
});
