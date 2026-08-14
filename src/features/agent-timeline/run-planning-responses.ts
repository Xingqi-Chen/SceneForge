import { createDefaultStickFigurePoseV1, defaultCharacter } from "@/features/editor/store/defaults";
import { buildStickFigurePoseGenerationMessages } from "@/features/editor/stick-figure-3d/llm-pose-generation";
import { buildStylePaletteAdviceMessages } from "@/features/editor/ai-prompt/style-palette-prompts";
import { isLlmChatRequest, type LlmChatRequest, type LlmResponsesRequest } from "@/features/llm";
import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library/types";
import { buildCharacterTextPromptTagMessages } from "@/features/prompt-engine/prompt-library/character-image-prompt-tags";

import { buildRunVisualStyleLlmInstructions } from "./run-visual-style";
import type { RunVisualStyle } from "./run-visual-style";

export type RunPlanningResponsesNodeId = "character-tags" | "character-action" | "style-advice";

export type RunPlanningResponsesApiRequest = {
  nodeId: RunPlanningResponsesNodeId;
  request: LlmChatRequest;
};

export function buildRunStyleAdviceLlmRequest({
  baseNegativePrompt,
  finalPositivePrompt,
  referenceResolution,
  selectedResources,
  visualStyle,
}: {
  baseNegativePrompt: string;
  finalPositivePrompt: string;
  referenceResolution?: { height: number; width: number };
  selectedResources: SelectedCivitaiResourcesPreview;
  visualStyle: RunVisualStyle;
}): LlmChatRequest {
  const description = referenceResolution
    ? `Timeline prompt used for img2img model parameter advice. Use the uploaded source image dimensions ${referenceResolution.width}x${referenceResolution.height} as the reference resolution.`
    : "Timeline prompt used for model parameter advice.";
  const messages = buildStylePaletteAdviceMessages({
    artistPrompts: [],
    preset: {
      id: "portrait",
      label: "Timeline render prompt",
      description,
      positive: finalPositivePrompt,
      negative: baseNegativePrompt,
    },
    resources: selectedResources,
  }).map((message, index) => index === 0 && typeof message.content === "string"
    ? {
        ...message,
        content: `${message.content}\n${buildRunVisualStyleLlmInstructions(visualStyle)}`,
      }
    : message);

  return {
    purpose: "stable-diffusion-prompt-generation",
    messages,
    temperature: 0.25,
    maxTokens: 900,
  };
}

const characterTagsSystemContent = buildCharacterTextPromptTagMessages({
  bodyParts: defaultCharacter.bodyParts,
  characterTarget: {
    label: "Run primary character",
    promptCategoryBindings: defaultCharacter.promptCategoryBindings,
  },
  userPrompt: "Run scene context",
})[0]?.content;
const characterTagsSystemPrompt = typeof characterTagsSystemContent === "string"
  ? characterTagsSystemContent
  : undefined;

const characterActionSystemContent = buildStickFigurePoseGenerationMessages(
  "Run character action",
  createDefaultStickFigurePoseV1(),
)[0]?.content;
const characterActionSystemPrompt = typeof characterActionSystemContent === "string"
  ? characterActionSystemContent
  : undefined;

const styleAdviceSystemPrompts = new Set(
  ["anime", "photoreal"].map((visualStyle) => {
    const content = buildRunStyleAdviceLlmRequest({
      baseNegativePrompt: "Run negative prompt",
      finalPositivePrompt: "Run positive prompt",
      selectedResources: { checkpoint: null, loras: [] },
      visualStyle: visualStyle as RunVisualStyle,
    }).messages[0]?.content;
    return typeof content === "string" ? content : "";
  }),
);

const characterPoseTargetIds = [
  "pelvis",
  "chest",
  "head",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
] as const;
const characterPosePoleIds = [
  "leftElbowPole",
  "rightElbowPole",
  "leftKneePole",
  "rightKneePole",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasExactTextMessages(
  request: LlmChatRequest,
  systemPrompt: string | undefined,
): request is LlmResponsesRequest {
  return typeof systemPrompt === "string" &&
    request.messages.length === 2 &&
    request.messages[0]?.role === "system" &&
    request.messages[0].content === systemPrompt &&
    request.messages[1]?.role === "user" &&
    typeof request.messages[1].content === "string";
}

function isFiniteVector(value: unknown) {
  return isRecord(value) &&
    hasOnlyKeys(value, ["x", "y", "z"]) &&
    [value.x, value.y, value.z].every((item) => typeof item === "number" && Number.isFinite(item));
}

function hasExactPoseMap(value: unknown, ids: readonly string[]) {
  return isRecord(value) &&
    hasOnlyKeys(value, ids) &&
    ids.every((id) => isFiniteVector(value[id]));
}

function isCharacterTagsUserPayload(value: unknown) {
  const payload = parseJsonRecord(value);
  if (!payload || !hasOnlyKeys(payload, ["characterTarget", "bodyParts", "userCharacterPrompt"])) {
    return false;
  }

  if (
    !isRecord(payload.characterTarget) ||
    !hasOnlyKeys(payload.characterTarget, ["targetKind", "label", "allowedCategories"]) ||
    payload.characterTarget.targetKind !== "character" ||
    typeof payload.characterTarget.label !== "string" ||
    !Array.isArray(payload.characterTarget.allowedCategories)
  ) {
    return false;
  }

  const expectedBodyPartIds = defaultCharacter.bodyParts.map((part) => part.id);
  if (
    !Array.isArray(payload.bodyParts) ||
    payload.bodyParts.length !== expectedBodyPartIds.length ||
    !payload.bodyParts.every((part, index) => (
      isRecord(part) &&
      hasOnlyKeys(part, ["id", "label", "allowedCategories"]) &&
      part.id === expectedBodyPartIds[index] &&
      typeof part.label === "string" &&
      Array.isArray(part.allowedCategories)
    ))
  ) {
    return false;
  }

  return typeof payload.userCharacterPrompt === "string" &&
    payload.userCharacterPrompt.includes("Already-selected primary character:") &&
    payload.userCharacterPrompt.includes("Primary character identity:") &&
    payload.userCharacterPrompt.includes("Scene intent:") &&
    payload.userCharacterPrompt.includes("Scene prompt:") &&
    payload.userCharacterPrompt.endsWith(
      "Do not rename, reselect, or redefine the primary character. Return only prompt-tag items for this character and their visible body parts.",
    );
}

function isCharacterActionUserPayload(value: unknown) {
  const payload = parseJsonRecord(value);
  if (!payload || !hasOnlyKeys(payload, ["poseDescription", "currentPose"])) {
    return false;
  }

  const poseDescription = payload.poseDescription;
  const currentPose = payload.currentPose;
  return typeof poseDescription === "string" &&
    poseDescription.includes("Scene intent:") &&
    poseDescription.includes("Scene prompt:") &&
    poseDescription.includes("Primary character:") &&
    poseDescription.endsWith(
      "Infer the primary character's physical action and a plausible editable 3D stick-figure pose.\nReturn the characterDescription/action summary in English.",
    ) &&
    isRecord(currentPose) &&
    hasOnlyKeys(currentPose, ["targets", "poles"]) &&
    hasExactPoseMap(currentPose.targets, characterPoseTargetIds) &&
    hasExactPoseMap(currentPose.poles, characterPosePoleIds);
}

function isStyleAdviceUserPayload(value: unknown) {
  const payload = parseJsonRecord(value);
  if (!payload || !hasOnlyKeys(payload, ["artistPrompt", "civitaiResources", "preset"])) {
    return false;
  }

  if (
    payload.artistPrompt !== "none" ||
    typeof payload.civitaiResources !== "string" ||
    payload.civitaiResources.trim() === "" ||
    payload.civitaiResources === "none" ||
    !isRecord(payload.preset) ||
    !hasOnlyKeys(payload.preset, ["id", "label", "description", "positive", "negative"])
  ) {
    return false;
  }

  const description = payload.preset.description;
  return payload.preset.id === "portrait" &&
    payload.preset.label === "Timeline render prompt" &&
    typeof description === "string" &&
    (
      description === "Timeline prompt used for model parameter advice." ||
      /^Timeline prompt used for img2img model parameter advice\. Use the uploaded source image dimensions \d+x\d+ as the reference resolution\.$/.test(description)
    ) &&
    typeof payload.preset.positive === "string" &&
    typeof payload.preset.negative === "string";
}

function hasExactRequestKeys(value: Record<string, unknown>) {
  return hasOnlyKeys(value, ["nsfw", "purpose", "messages", "temperature", "maxTokens"]);
}

export function isAuthorizedRunPlanningResponsesApiRequest(
  value: unknown,
): value is RunPlanningResponsesApiRequest & { request: LlmResponsesRequest } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["nodeId", "request"]) ||
    !isRecord(value.request) ||
    !hasExactRequestKeys(value.request) ||
    !isLlmChatRequest(value.request) ||
    value.request.responseFormat !== undefined
  ) {
    return false;
  }

  const request = value.request;
  if (value.nodeId === "character-tags") {
    return request.purpose === "prompt-tag-reverse" &&
      request.temperature === 0.25 &&
      request.maxTokens === 1000 &&
      hasExactTextMessages(request, characterTagsSystemPrompt) &&
      isCharacterTagsUserPayload(request.messages[1]?.content);
  }

  if (value.nodeId === "character-action") {
    return request.purpose === "stick-figure-pose-generation" &&
      request.temperature === 0.25 &&
      request.maxTokens === 900 &&
      hasExactTextMessages(request, characterActionSystemPrompt) &&
      isCharacterActionUserPayload(request.messages[1]?.content);
  }

  if (value.nodeId === "style-advice") {
    return request.nsfw === undefined &&
      request.purpose === "stable-diffusion-prompt-generation" &&
      request.temperature === 0.25 &&
      request.maxTokens === 900 &&
      request.messages.length === 2 &&
      request.messages[0]?.role === "system" &&
      typeof request.messages[0].content === "string" &&
      styleAdviceSystemPrompts.has(request.messages[0].content) &&
      request.messages[1]?.role === "user" &&
      isStyleAdviceUserPayload(request.messages[1].content);
  }

  return false;
}
