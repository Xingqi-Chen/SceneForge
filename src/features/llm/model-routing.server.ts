import type { LlmChatRequest } from "./types";

function resolvePurposeDefaultModel(payload: LlmChatRequest) {
  if (payload.purpose === "prompt-library-classification") {
    return process.env.LITELLM_CLASSIFICATION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "scene-prompt-reverse" || payload.purpose === "prompt-tag-reverse") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "stick-figure-pose-generation") {
    return process.env.LITELLM_POSE_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "civitai-resource-enrichment") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "civitai-combination-recommendation") {
    return process.env.LITELLM_CIVITAI_RECOMMENDATION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "stable-diffusion-prompt-generation") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "story-style-reference-analysis") {
    return process.env.LITELLM_VISION_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "single-image-preview-scoring") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (payload.purpose === "comic-sequence-storyboard") {
    return process.env.LITELLM_DEFAULT_MODEL;
  }

  if (
    payload.purpose === "comfyui-generation-diagnosis" ||
    payload.purpose === "comfyui-inpaint-diagnosis"
  ) {
    return process.env.LITELLM_COMFYUI_DIAGNOSIS_MODEL || process.env.LITELLM_DEFAULT_MODEL;
  }

  return process.env.LITELLM_DEFAULT_MODEL;
}

function isVisionPurposeWithExplicitRouting(payload: LlmChatRequest) {
  return payload.purpose === "story-style-reference-analysis" ||
    payload.purpose === "single-image-preview-scoring";
}

export function resolveDefaultModel(payload: LlmChatRequest) {
  if (isVisionPurposeWithExplicitRouting(payload)) {
    return resolvePurposeDefaultModel(payload);
  }

  if (payload.nsfw === true) {
    return process.env.LITELLM_NSFW_MODEL || resolvePurposeDefaultModel(payload);
  }

  return resolvePurposeDefaultModel(payload);
}

export function resolveRequestModel(payload: LlmChatRequest) {
  const defaultModel = resolveDefaultModel(payload);

  if (payload.purpose === "single-image-preview-scoring") {
    return defaultModel;
  }

  if (isVisionPurposeWithExplicitRouting(payload)) {
    return payload.model ?? defaultModel;
  }

  if (payload.nsfw === true && process.env.LITELLM_NSFW_MODEL) {
    return process.env.LITELLM_NSFW_MODEL;
  }

  return payload.model ?? defaultModel;
}
