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

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

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
    value.version !== 1 ||
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
    version: 1,
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
    : "Krea2 ReID requires an authoritative Krea 2 diffusion-model request context.";
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
  const reIdLoaders = entries.filter(([, node]) =>
    node.class_type === "LoraLoaderModelOnly" && node.inputs.lora_name === KREA2_REID_LORA_NAME
  );
  const patches = entries.filter(([, node]) => node.class_type === "Krea2OstrisEditModelPatch");
  const encoders = entries.filter(([, node]) => node.class_type === "TextEncodeKrea2OstrisEdit");
  const conflictingReferenceNodes = entries.filter(([, node]) =>
    /ipadapter/i.test(node.class_type) ||
    ["CLIPVisionLoader", "CLIPVisionEncode", "unCLIPConditioning", "StyleModelLoader", "StyleModelApply"]
      .includes(node.class_type) ||
    node.class_type === "LoraLoaderModelOnly" &&
      node.inputs.lora_name === KREA2_STYLE_REFERENCE_LORA_NAME
  );

  if (conflictingReferenceNodes.length > 0) {
    issues.push("Krea2 ReID graph cannot contain generic IPAdapter, CLIP-vision, style-model, or Krea style-reference conditioning nodes.");
  }

  if (reIdLoaders.length !== 1) {
    issues.push("Krea2 ReID graph must contain exactly one loader for krea2_reid_rank32.safetensors.");
  }
  const [loaderId, loader] = reIdLoaders[0] ?? [];
  if (loader && loader.inputs.strength_model !== 1) {
    issues.push("Krea2 ReID LoRA strength_model must be exactly 1.0.");
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
  const referenceEncoders = encoders.filter(([, node]) => node.inputs.image1 !== undefined);
  if (referenceEncoders.length !== 1 || encoders.some(([, node]) =>
    Object.keys(node.inputs).some((inputName) => /^image(?:[2-9]|[1-9][0-9]+)$/.test(inputName))
  )) {
    issues.push("Krea2 ReID graph must condition exactly one prepared image as image1 and no additional image inputs.");
  }
  const referenceConnection = referenceEncoders[0]?.[1].inputs.image1;
  const referenceLoaderId = Array.isArray(referenceConnection) && typeof referenceConnection[0] === "string"
    ? referenceConnection[0]
    : "";
  if (!referenceLoaderId || workflow[referenceLoaderId]?.class_type !== "LoadImage") {
    issues.push("Krea2 ReID image1 must come from exactly one LoadImage reference node.");
  }
  const samplers = entries.filter(([, node]) => node.class_type === "KSampler");
  if (!patchId || samplers.length !== 1 || !connectionTargets(samplers[0]?.[1].inputs.model, patchId)) {
    issues.push("Krea2 ReID KSampler must consume the patched ReID model.");
  }
  const sampler = samplers[0]?.[1];
  const encoderIds = new Set(encoders.map(([nodeId]) => nodeId));
  const positiveEncoderId = Array.isArray(sampler?.inputs.positive) &&
      typeof sampler.inputs.positive[0] === "string"
    ? sampler.inputs.positive[0]
    : "";
  const negativeEncoderId = Array.isArray(sampler?.inputs.negative) &&
      typeof sampler.inputs.negative[0] === "string"
    ? sampler.inputs.negative[0]
    : "";
  if (!encoderIds.has(positiveEncoderId) || !encoderIds.has(negativeEncoderId) ||
      positiveEncoderId === negativeEncoderId ||
      !connectionTargets(sampler?.inputs.positive, positiveEncoderId) ||
      !connectionTargets(sampler?.inputs.negative, negativeEncoderId)) {
    issues.push("Krea2 ReID KSampler conditioning must come directly from the two Krea encoders.");
  }
  if (sampler && (sampler.inputs.steps !== 8 || sampler.inputs.cfg !== 1 ||
      sampler.inputs.sampler_name !== "euler" || sampler.inputs.scheduler !== "simple")) {
    issues.push("Krea2 ReID KSampler must use steps=8, cfg=1, sampler=euler, and scheduler=simple.");
  }
  return issues;
}
