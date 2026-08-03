import { isKrea2CivitaiBaseModel } from "@/features/civitai-lora-library/base-model";

import type {
  ComfyUiKrea2ReIdDescriptor,
  ComfyUiTextToImageRequest,
  ComfyUiWorkflow,
} from "./types";
import { KREA2_STYLE_REFERENCE_LORA_NAME } from "./krea2-style-reference";
import { resolveComfyUiTextToImageWorkflowProfile } from "./workflow-profiles";

export const KREA2_REID_LORA_NAME = "krea2_reid_rank32.safetensors";
export const KREA2_REID_STRENGTH_MODEL = 1 as const;
export const KREA2_REID_KV_CACHE = true as const;
export const KREA2_REID_DESCRIPTOR_VERSION = 2 as const;
export const KREA2_REID_REFERENCE_SCALE_NODE = "ImageScaleToTotalPixels";
export const KREA2_REID_LATENT_METHOD_NODE = "FluxKontextMultiReferenceLatentMethod";
export const KREA2_REID_REFERENCE_UPSCALE_METHOD = "area" as const;
export const KREA2_REID_REFERENCE_MEGAPIXELS = 0.140625 as const;
export const KREA2_REID_REFERENCE_RESOLUTION_STEPS = 16 as const;
export const KREA2_REID_REFERENCE_LATENT_METHOD = "index_timestep_zero" as const;

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const KREA2_REID_POSITIVE_ENCODER_TITLE = "Positive Krea2 ReID Prompt";
const KREA2_REID_NEGATIVE_ENCODER_TITLE = "Negative Krea2 ReID Prompt";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeComfyUiKrea2ReIdDescriptor(
  value: unknown,
): ComfyUiKrea2ReIdDescriptor | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const keys = ["version", "referenceDigest", "loraName", "strengthModel", "kvCache", "imageCount"];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.version !== KREA2_REID_DESCRIPTOR_VERSION ||
    typeof value.referenceDigest !== "string" ||
    !SHA256_DIGEST_PATTERN.test(value.referenceDigest) ||
    value.loraName !== KREA2_REID_LORA_NAME ||
    value.strengthModel !== KREA2_REID_STRENGTH_MODEL ||
    value.kvCache !== KREA2_REID_KV_CACHE ||
    value.imageCount !== 1
  ) {
    return null;
  }
  return {
    version: KREA2_REID_DESCRIPTOR_VERSION,
    referenceDigest: value.referenceDigest,
    loraName: KREA2_REID_LORA_NAME,
    strengthModel: KREA2_REID_STRENGTH_MODEL,
    kvCache: KREA2_REID_KV_CACHE,
    imageCount: 1,
  };
}

export function getComfyUiKrea2ReIdContextIssue(
  request: Pick<
    ComfyUiTextToImageRequest,
    "checkpointName" | "modelBaseModel" | "modelStorageKind" | "workflowProfile"
  >,
) {
  const profile = resolveComfyUiTextToImageWorkflowProfile(request).id;
  return profile === "krea2" && request.modelStorageKind === "diffusion" &&
      isKrea2CivitaiBaseModel(request.modelBaseModel)
    ? ""
    : "Experimental Krea2 ReID requires an authoritative Krea 2 diffusion-model request context.";
}

function connectionTargets(value: unknown, nodeId: string, outputIndex = 0) {
  return Array.isArray(value) && value.length === 2 && value[0] === nodeId && value[1] === outputIndex;
}

/**
 * Revalidates the generated graph, not just request shape/object_info. This is
 * intentionally strict because ReID must never degrade to prompt-only, the
 * legacy dual-image adapter, or an unpatched Krea sampler.
 */
export function getComfyUiKrea2ReIdWorkflowIssues(workflow: ComfyUiWorkflow) {
  const entries = Object.entries(workflow);
  const issues: string[] = [];
  const unetLoaders = entries.filter(([, node]) => node.class_type === "UNETLoader");
  const clipLoaders = entries.filter(([, node]) => node.class_type === "CLIPLoader");
  const vaeLoaders = entries.filter(([, node]) => node.class_type === "VAELoader");
  const loadImages = entries.filter(([, node]) => node.class_type === "LoadImage");
  const referenceScalers = entries.filter(([, node]) => node.class_type === KREA2_REID_REFERENCE_SCALE_NODE);
  const reIdLoaders = entries.filter(([, node]) =>
    node.class_type === "LoraLoaderModelOnly" && node.inputs.lora_name === KREA2_REID_LORA_NAME
  );
  const allModelLoraLoaders = entries.filter(([, node]) => node.class_type === "LoraLoaderModelOnly");
  const patches = entries.filter(([, node]) => node.class_type === "Krea2OstrisEditModelPatch");
  const encoders = entries.filter(([, node]) => node.class_type === "TextEncodeKrea2OstrisEdit");
  const latentMethods = entries.filter(([, node]) => node.class_type === KREA2_REID_LATENT_METHOD_NODE);
  const conflictingReferenceNodes = entries.filter(([, node]) =>
    /ipadapter/i.test(node.class_type) ||
    ["CLIPVisionLoader", "CLIPVisionEncode", "unCLIPConditioning", "StyleModelLoader", "StyleModelApply"]
      .includes(node.class_type) ||
    node.class_type === "LoraLoaderModelOnly" &&
      node.inputs.lora_name === KREA2_STYLE_REFERENCE_LORA_NAME
  );
  const forbiddenRedrawNodes = entries.filter(([, node]) =>
    node.class_type === "ImageScale" || node.class_type === "VAEEncode"
  );

  if (conflictingReferenceNodes.length > 0) {
    issues.push("Krea2 ReID graph cannot contain generic IPAdapter, CLIP-vision, style-model, or Krea style-reference conditioning nodes.");
  }
  if (forbiddenRedrawNodes.length > 0) {
    issues.push("Krea2 ReID must render from noise and cannot contain ImageScale or VAEEncode redraw nodes.");
  }

  const [unetId, unet] = unetLoaders[0] ?? [];
  const [clipId, clip] = clipLoaders[0] ?? [];
  const [vaeId, vae] = vaeLoaders[0] ?? [];
  if (unetLoaders.length !== 1 || typeof unet?.inputs.unet_name !== "string" ||
      unet.inputs.unet_name.trim().length === 0 || unet.inputs.weight_dtype !== "default") {
    issues.push("Krea2 ReID must load exactly one selected Krea UNET with weight_dtype=default.");
  }
  if (clipLoaders.length !== 1 || typeof clip?.inputs.clip_name !== "string" ||
      clip.inputs.clip_name.trim().length === 0 || clip.inputs.type !== "krea2") {
    issues.push("Krea2 ReID must load exactly one configured CLIP with type krea2.");
  }
  if (vaeLoaders.length !== 1 || typeof vae?.inputs.vae_name !== "string" ||
      vae.inputs.vae_name.trim().length === 0) {
    issues.push("Krea2 ReID must load exactly one configured VAE.");
  }
  if (loadImages.length !== 1) {
    issues.push("Krea2 ReID graph must contain exactly one prepared-reference LoadImage node.");
  }
  const [referenceImageId] = loadImages[0] ?? [];
  const [referenceScaleId, referenceScale] = referenceScalers[0] ?? [];
  if (referenceScalers.length !== 1 || !referenceImageId ||
      !connectionTargets(referenceScale?.inputs.image, referenceImageId) ||
      referenceScale?.inputs.upscale_method !== KREA2_REID_REFERENCE_UPSCALE_METHOD ||
      referenceScale?.inputs.megapixels !== KREA2_REID_REFERENCE_MEGAPIXELS ||
      referenceScale?.inputs.resolution_steps !== KREA2_REID_REFERENCE_RESOLUTION_STEPS) {
    issues.push("Krea2 ReID must scale the one prepared reference with ImageScaleToTotalPixels(area, 0.140625 megapixels, resolution_steps=16).");
  }

  if (reIdLoaders.length !== 1 || allModelLoraLoaders.length !== 1) {
    issues.push("Krea2 ReID graph must contain exactly one model-only LoRA loader, for krea2_reid_rank32.safetensors only.");
  }
  const [loaderId, loader] = reIdLoaders[0] ?? [];
  if (loader && (loader.inputs.strength_model !== 1 || !unetId ||
      !connectionTargets(loader.inputs.model, unetId))) {
    issues.push("Krea2 ReID LoRA must consume the selected Krea UNET with strength_model exactly 1.0.");
  }
  if (patches.length !== 1) {
    issues.push("Krea2 ReID graph must contain exactly one Krea2OstrisEditModelPatch.");
  }
  const [patchId, patch] = patches[0] ?? [];
  if (patch && (patch.inputs.kv_cache !== true || !loaderId || !connectionTargets(patch.inputs.model, loaderId))) {
    issues.push("Krea2 ReID model patch must consume the ReID LoRA with kv_cache=true.");
  }
  if (encoders.length !== 2) {
    issues.push("Krea2 ReID graph must contain exactly two Krea encoders for positive and negative conditioning.");
  }
  if (!referenceScaleId || !clipId || !vaeId || encoders.some(([, node]) =>
    !connectionTargets(node.inputs.clip, clipId) ||
    !connectionTargets(node.inputs.vae, vaeId) ||
    !connectionTargets(node.inputs.image1, referenceScaleId) ||
    Object.keys(node.inputs).some((inputName) => /^image(?:[2-9]|[1-9][0-9]+)$/.test(inputName))
  )) {
    issues.push("Both Krea2 ReID encoders must receive the same configured CLIP, VAE, and scaled image1, with no extra reference images.");
  }
  if (latentMethods.length !== 2 || latentMethods.some(([, node]) =>
    node.inputs.reference_latents_method !== KREA2_REID_REFERENCE_LATENT_METHOD
  )) {
    issues.push("Krea2 ReID graph must contain two distinct FluxKontextMultiReferenceLatentMethod nodes set to index_timestep_zero.");
  }
  const positiveEncoderId = encoders.find(([, node]) =>
    node._meta?.title === KREA2_REID_POSITIVE_ENCODER_TITLE
  )?.[0] ?? "";
  const negativeEncoderId = encoders.find(([, node]) =>
    node._meta?.title === KREA2_REID_NEGATIVE_ENCODER_TITLE
  )?.[0] ?? "";
  const positiveLatentMethodId = latentMethods.find(([, node]) =>
    positiveEncoderId && connectionTargets(node.inputs.conditioning, positiveEncoderId)
  )?.[0] ?? "";
  const negativeLatentMethodId = latentMethods.find(([, node]) =>
    negativeEncoderId && connectionTargets(node.inputs.conditioning, negativeEncoderId)
  )?.[0] ?? "";
  if (!positiveEncoderId || !negativeEncoderId || positiveEncoderId === negativeEncoderId ||
      !positiveLatentMethodId || !negativeLatentMethodId ||
      positiveLatentMethodId === negativeLatentMethodId) {
    issues.push("The positive and negative ReID encoders must each feed their own matching latent-method node.");
  }
  const samplers = entries.filter(([, node]) => node.class_type === "KSampler");
  if (!patchId || samplers.length !== 1 || !connectionTargets(samplers[0]?.[1].inputs.model, patchId)) {
    issues.push("Krea2 ReID KSampler must consume the patched ReID model.");
  }
  const sampler = samplers[0]?.[1];
  if (!positiveLatentMethodId || !negativeLatentMethodId ||
      !connectionTargets(sampler?.inputs.positive, positiveLatentMethodId) ||
      !connectionTargets(sampler?.inputs.negative, negativeLatentMethodId)) {
    issues.push("Krea2 ReID KSampler must preserve the positive encoder-to-positive sampler and negative encoder-to-negative sampler chains.");
  }
  if (sampler && (sampler.inputs.steps !== 8 || sampler.inputs.cfg !== 1 ||
      sampler.inputs.sampler_name !== "euler" || sampler.inputs.scheduler !== "simple" ||
      sampler.inputs.denoise !== 1)) {
    issues.push("Krea2 ReID KSampler must use steps=8, cfg=1, sampler=euler, scheduler=simple, and denoise=1.");
  }
  const emptyLatents = entries.filter(([, node]) => node.class_type === "EmptyLatentImage");
  const [emptyLatentId, emptyLatent] = emptyLatents[0] ?? [];
  if (emptyLatents.length !== 1 || emptyLatent?.inputs.batch_size !== 1 || !emptyLatentId ||
      !connectionTargets(sampler?.inputs.latent_image, emptyLatentId)) {
    issues.push("Krea2 ReID must sample one EmptyLatentImage target from noise.");
  }
  return issues;
}
