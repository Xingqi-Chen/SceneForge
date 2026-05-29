import type { LlmChatRequest, LlmChatResponse } from "@/features/llm";
import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";
import {
  buildStickFigurePoseGenerationMessages,
  parseStickFigurePoseGenerationResponse,
} from "@/features/editor/stick-figure-3d/llm-pose-generation";
import {
  isPromptTagCategory,
  isPromptTagSubcategory,
  PROMPT_TAG_SUBCATEGORY_OPTIONS,
} from "@/features/prompt-engine/prompt-library/prompt-tag-taxonomy";
import type { BodyPartId, PromptTagCategory, SceneObject3DTransform } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

import { createLlmTimelineNodeAdapter, type TimelineCompleteChat } from "./llm-adapter";
import { createTimelineNodeError } from "./state";
import {
  TimelineNodeExecutionError,
  type CanvasBindingTimelineResult,
  type CharacterActionTimelineResult,
  type CharacterPromptTag,
  type CharacterTagsTimelineResult,
  type SceneInputTimelineResult,
  type ScenePromptTimelineResult,
  type TimelineNodeAdapters,
  type TimelineNodeExecutionContext,
  type TimelinePromptFragment,
} from "./types";

const bodyPartIds = [
  "head",
  "torso",
  "leftUpperArm",
  "leftForearm",
  "rightUpperArm",
  "rightForearm",
  "leftThigh",
  "leftShin",
  "rightThigh",
  "rightShin",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
] as const satisfies readonly BodyPartId[];

const bodyPartIdSet = new Set<BodyPartId>(bodyPartIds);
const characterTagCategories = new Set<PromptTagCategory>(["character", "body-part", "outfit"]);

const defaultCanvasTransform: SceneObject3DTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export type TimelineCanvasBindingInput = {
  primaryCharacter: CharacterTagsTimelineResult["primaryCharacter"];
  characterTags: CharacterPromptTag[];
  action: string;
  pose: StickFigurePoseV1;
  transform: SceneObject3DTransform;
  spatialSummary: string;
};

export type TimelineCanvasBinder = (
  input: TimelineCanvasBindingInput,
  context: TimelineNodeExecutionContext,
) => CanvasBindingTimelineResult | Promise<CanvasBindingTimelineResult>;

export type TimelineT5NodeAdapterOptions = {
  completeChat: TimelineCompleteChat;
  bindCanvas?: TimelineCanvasBinder;
  getCurrentPose?: () => StickFigurePoseV1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: unknown, maxLength = 1200) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseJsonObjectFromText(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next likely JSON span.
    }
  }

  return null;
}

function malformedResponse(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(
    createTimelineNodeError("llm_malformed_response", message, details),
  );
}

function invalidTimelineInput(message: string, details?: unknown): never {
  throw new TimelineNodeExecutionError(
    createTimelineNodeError("timeline_node_failed", message, details),
  );
}

function normalizeStringList(value: unknown, maxItems = 8) {
  if (Array.isArray(value)) {
    return value.map((item) => compactText(item, 300)).filter(Boolean).slice(0, maxItems);
  }

  const text = compactText(value, 600);
  return text ? [text] : [];
}

function normalizePromptFragments(value: unknown, maxItems = 5): TimelinePromptFragment[] {
  if (typeof value === "string") {
    const prompt = compactText(value, 500);
    return prompt ? [{ label: prompt.slice(0, 48), prompt }] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): TimelinePromptFragment | null => {
      if (typeof item === "string") {
        const prompt = compactText(item, 500);
        return prompt ? { label: prompt.slice(0, 48), prompt } : null;
      }

      if (!isRecord(item)) {
        return null;
      }

      const prompt = compactText(item.prompt ?? item.text, 500);
      if (!prompt) {
        return null;
      }

      const label = compactText(item.label, 80) || prompt.slice(0, 48);
      return { label, prompt };
    })
    .filter((item): item is TimelinePromptFragment => Boolean(item))
    .slice(0, maxItems);
}

export function normalizeScenePromptTimelineResult(raw: unknown): ScenePromptTimelineResult {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;

  if (!isRecord(parsed)) {
    malformedResponse("Scene prompt response must be a JSON object.", { raw });
  }

  const positivePrompt = compactText(
    parsed.positivePrompt ?? parsed.positive_prompt ?? parsed.prompt,
    2000,
  );

  if (!positivePrompt) {
    malformedResponse("Scene prompt response must include positivePrompt.", { raw });
  }

  return {
    positivePrompt,
    negativeSuggestions: normalizeStringList(
      parsed.negativeSuggestions ?? parsed.negative_suggestions ?? parsed.negativePrompt,
      10,
    ),
    style: normalizePromptFragments(parsed.style),
    camera: normalizePromptFragments(parsed.camera),
    lighting: normalizePromptFragments(parsed.lighting),
  };
}

function categoryForSubcategory(value: unknown): PromptTagCategory | null {
  if (!isPromptTagSubcategory(value)) {
    return null;
  }

  for (const [category, subcategories] of Object.entries(PROMPT_TAG_SUBCATEGORY_OPTIONS)) {
    if (subcategories.includes(value)) {
      return category as PromptTagCategory;
    }
  }

  return null;
}

function normalizeCharacterTag(value: unknown): CharacterPromptTag | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = compactText(value.prompt ?? value.text, 500);
  if (!prompt) {
    return null;
  }

  const subcategory = isPromptTagSubcategory(value.subcategory) ? value.subcategory : undefined;
  const inferredCategory = categoryForSubcategory(subcategory);
  const rawCategory = isPromptTagCategory(value.category) ? value.category : inferredCategory;
  const category = rawCategory && characterTagCategories.has(rawCategory) ? rawCategory : "character";
  const bodyPartId = bodyPartIdSet.has(value.bodyPartId as BodyPartId)
    ? (value.bodyPartId as BodyPartId)
    : undefined;
  const label = compactText(value.label, 80) || prompt.slice(0, 48);

  return {
    label,
    prompt,
    category,
    ...(subcategory && PROMPT_TAG_SUBCATEGORY_OPTIONS[category].includes(subcategory)
      ? { subcategory }
      : {}),
    ...(bodyPartId ? { bodyPartId } : {}),
  };
}

export function normalizeCharacterTagsTimelineResult(raw: unknown): CharacterTagsTimelineResult {
  const parsed = typeof raw === "string" ? parseJsonObjectFromText(raw) : raw;

  if (!isRecord(parsed)) {
    malformedResponse("Character tags response must be a JSON object.", { raw });
  }

  const primaryRaw = isRecord(parsed.primaryCharacter)
    ? parsed.primaryCharacter
    : isRecord(parsed.primary_character)
      ? parsed.primary_character
      : {};
  const name = compactText(primaryRaw.name, 80) || "Primary character";
  const description = compactText(primaryRaw.description ?? parsed.primaryCharacterDescription, 800);

  if (!description) {
    malformedResponse("Character tags response must include primaryCharacter.description.", {
      raw,
    });
  }

  const tagsRaw = Array.isArray(parsed.tags) ? parsed.tags : [];
  const tags = tagsRaw
    .map(normalizeCharacterTag)
    .filter((tag): tag is CharacterPromptTag => Boolean(tag))
    .slice(0, 24);

  if (tags.length === 0) {
    malformedResponse("Character tags response must include at least one usable tag.", { raw });
  }

  return {
    primaryCharacter: {
      name,
      description,
    },
    tags,
    extraPeopleContext: normalizeStringList(
      parsed.extraPeopleContext ?? parsed.extra_people_context,
      6,
    ),
  };
}

function getSceneInput(workflow: TimelineNodeExecutionContext["workflow"]) {
  const result = workflow.nodes["scene-input"].result;

  if (isRecord(result) && typeof result.rawIntent === "string") {
    return result as SceneInputTimelineResult;
  }

  invalidTimelineInput("Scene input result is missing rawIntent.", { result });
}

function getManualTextResult(result: unknown) {
  if (typeof result === "string") {
    return compactText(result, 2000);
  }

  if (isRecord(result) && typeof result.shellContent === "string") {
    return compactText(result.shellContent, 2000);
  }

  return "";
}

function getScenePromptResult(workflow: TimelineNodeExecutionContext["workflow"]): ScenePromptTimelineResult {
  const result = workflow.nodes["scene-prompt"].result;
  const manualText = getManualTextResult(result);

  if (manualText) {
    return {
      positivePrompt: manualText,
      negativeSuggestions: [],
      style: [],
      camera: [],
      lighting: [],
    };
  }

  try {
    return normalizeScenePromptTimelineResult(result);
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      invalidTimelineInput("Scene prompt dependency is not usable for downstream execution.", {
        error: error.message,
      });
    }

    throw error;
  }
}

function getCharacterTagsResult(workflow: TimelineNodeExecutionContext["workflow"]): CharacterTagsTimelineResult {
  const result = workflow.nodes["character-tags"].result;
  const manualText = getManualTextResult(result);

  if (manualText) {
    return {
      primaryCharacter: {
        name: "Primary character",
        description: manualText,
      },
      tags: [
        {
          label: "Manual character note",
          prompt: manualText,
          category: "character",
          subcategory: "character-subject",
        },
      ],
      extraPeopleContext: [],
    };
  }

  try {
    return normalizeCharacterTagsTimelineResult(result);
  } catch (error) {
    if (error instanceof TimelineNodeExecutionError) {
      invalidTimelineInput("Character tag dependency is not usable for downstream execution.", {
        error: error.message,
      });
    }

    throw error;
  }
}

function getCharacterActionResult(workflow: TimelineNodeExecutionContext["workflow"]): CharacterActionTimelineResult {
  const result = workflow.nodes["character-action"].result;
  const manualText = getManualTextResult(result);

  if (manualText) {
    return {
      action: manualText,
      pose: createDefaultStickFigurePoseV1(),
      poseSummary: manualText,
    };
  }

  if (
    isRecord(result) &&
    typeof result.action === "string" &&
    isRecord(result.pose) &&
    typeof result.poseSummary === "string"
  ) {
    return result as CharacterActionTimelineResult;
  }

  invalidTimelineInput("Character action dependency is not usable for canvas binding.", { result });
}

function buildScenePromptRequest(context: TimelineNodeExecutionContext): LlmChatRequest {
  const sceneInput = getSceneInput(context.workflow);

  return {
    purpose: "stable-diffusion-prompt-generation",
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's scene prompt agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "Expand the user scene into image-generation language while preserving constraints.",
          'Required shape: {"positivePrompt":"...","negativeSuggestions":["..."],"style":[{"label":"...","prompt":"..."}],"camera":[{"label":"...","prompt":"..."}],"lighting":[{"label":"...","prompt":"..."}]}',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            sceneRequest: sceneInput.rawIntent,
            notes: [
              "Keep this single-image only.",
              "Do not choose checkpoints, LoRAs, render parameters, file paths, or external resources.",
            ],
          },
          null,
          2,
        ),
      },
    ],
    temperature: 0.35,
    maxTokens: 900,
  };
}

function buildCharacterTagsRequest(context: TimelineNodeExecutionContext): LlmChatRequest {
  const sceneInput = getSceneInput(context.workflow);
  const scenePrompt = getScenePromptResult(context.workflow);

  return {
    purpose: "prompt-tag-reverse",
    messages: [
      {
        role: "system",
        content: [
          "You are SceneForge's primary character tag agent.",
          "Return only valid JSON. No markdown, comments, or prose.",
          "Select exactly one primary character for the MVP. If more people are present, keep them in extraPeopleContext instead of creating additional characters.",
          "Create editable prompt tags for character identity, expression, body details, clothing, and relevant body parts.",
          "Allowed tag categories: character, body-part, outfit.",
          `Allowed bodyPartId values: ${bodyPartIds.join(", ")}.`,
          'Required shape: {"primaryCharacter":{"name":"...","description":"..."},"tags":[{"label":"...","prompt":"...","category":"character","subcategory":"character-subject","bodyPartId":"head"}],"extraPeopleContext":["..."]}',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            sceneRequest: sceneInput.rawIntent,
            positivePrompt: scenePrompt.positivePrompt,
          },
          null,
          2,
        ),
      },
    ],
    temperature: 0.25,
    maxTokens: 1000,
  };
}

function buildActionDescription(context: TimelineNodeExecutionContext) {
  const sceneInput = getSceneInput(context.workflow);
  const scenePrompt = getScenePromptResult(context.workflow);
  const characterTags = getCharacterTagsResult(context.workflow);
  const tagPrompts = characterTags.tags.map((tag) => tag.prompt).join(", ");

  return [
    `Scene request: ${sceneInput.rawIntent}`,
    `Scene prompt: ${scenePrompt.positivePrompt}`,
    `Primary character: ${characterTags.primaryCharacter.name} - ${characterTags.primaryCharacter.description}`,
    tagPrompts ? `Character tags: ${tagPrompts}` : "",
    "Infer the primary character's physical action and a plausible editable 3D stick-figure pose.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCharacterActionRequest(
  context: TimelineNodeExecutionContext,
  currentPose: StickFigurePoseV1,
): LlmChatRequest {
  return {
    purpose: "stick-figure-pose-generation",
    messages: buildStickFigurePoseGenerationMessages(buildActionDescription(context), currentPose),
    temperature: 0.25,
    maxTokens: 900,
  };
}

function parseCharacterActionResponse(
  response: LlmChatResponse,
  currentPose: StickFigurePoseV1,
  context: TimelineNodeExecutionContext,
): CharacterActionTimelineResult {
  const parsed = parseStickFigurePoseGenerationResponse(response.content, currentPose);

  if (!parsed) {
    malformedResponse("Character action response must include usable stick-figure pose JSON.", {
      content: response.content,
    });
  }

  const characterTags = getCharacterTagsResult(context.workflow);
  const action = parsed.characterDescription
    ? compactText(parsed.characterDescription, 500)
    : characterTags.primaryCharacter.description;

  return {
    action,
    pose: parsed.pose,
    poseSummary: action,
  };
}

function buildSpatialSummary(
  scenePrompt: ScenePromptTimelineResult,
  characterTags: CharacterTagsTimelineResult,
  action: CharacterActionTimelineResult,
) {
  return compactText(
    `${characterTags.primaryCharacter.name} is bound as the primary editable 3D character at center stage, ${action.action}. Scene context: ${scenePrompt.positivePrompt}`,
    600,
  );
}

function createCanvasBindingInput(context: TimelineNodeExecutionContext): TimelineCanvasBindingInput {
  const scenePrompt = getScenePromptResult(context.workflow);
  const characterTags = getCharacterTagsResult(context.workflow);
  const action = getCharacterActionResult(context.workflow);

  return {
    primaryCharacter: characterTags.primaryCharacter,
    characterTags: characterTags.tags,
    action: action.action,
    pose: action.pose,
    transform: defaultCanvasTransform,
    spatialSummary: buildSpatialSummary(scenePrompt, characterTags, action),
  };
}

function createTemporaryCanvasBindingResult(
  input: TimelineCanvasBindingInput,
): CanvasBindingTimelineResult {
  return {
    primaryCharacter: {
      id: "timeline-primary-character",
      name: input.primaryCharacter.name,
      description: input.primaryCharacter.description,
    },
    characterTags: input.characterTags,
    action: input.action,
    transform: input.transform,
    pose: input.pose,
    spatialSummary: input.spatialSummary,
  };
}

export function createTimelineT5NodeAdapters({
  bindCanvas,
  completeChat,
  getCurrentPose = createDefaultStickFigurePoseV1,
}: TimelineT5NodeAdapterOptions): TimelineNodeAdapters {
  return {
    "scene-prompt": createLlmTimelineNodeAdapter({
      completeChat,
      buildRequest: buildScenePromptRequest,
      parseResponse: (response) => normalizeScenePromptTimelineResult(response.content),
    }),
    "character-tags": createLlmTimelineNodeAdapter({
      completeChat,
      buildRequest: buildCharacterTagsRequest,
      parseResponse: (response) => normalizeCharacterTagsTimelineResult(response.content),
    }),
    "character-action": createLlmTimelineNodeAdapter({
      completeChat,
      buildRequest: (context) => buildCharacterActionRequest(context, getCurrentPose()),
      parseResponse: (response, context) =>
        parseCharacterActionResponse(response, getCurrentPose(), context),
    }),
    "canvas-binding": async (context) => {
      const input = createCanvasBindingInput(context);
      return {
        value: bindCanvas ? await bindCanvas(input, context) : createTemporaryCanvasBindingResult(input),
        source: "system",
      };
    },
  };
}
